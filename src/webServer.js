import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { extractZip } from './extractZip.js';
import { findBannerEntry } from './findBannerEntry.js';
import { detectBannerSize } from './detectBannerSize.js';
import { captureBackup } from './captureBackup.js';
import { createServer as startFileServer } from './localServer.js';
import { logger } from './logger.js';
import { sanitizeFileName } from './utils.js';
import { parseRivDimensions, generateRiveHTML } from './riveTemplate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(ROOT, 'temp');
const UPLOAD_DIR = path.join(TEMP_DIR, 'uploads');

const MAX_CONCURRENT = 3;

class Semaphore {
  constructor(max) {
    this.max = max;
    this.count = 0;
    this.waiting = [];
  }
  async acquire() {
    if (this.count < this.max) {
      this.count++;
      return;
    }
    return new Promise(resolve => this.waiting.push(resolve));
  }
  release() {
    if (this.waiting.length > 0) {
      this.waiting.shift()();
    } else {
      this.count--;
    }
  }
}

const globalCap = new Semaphore(MAX_CONCURRENT);
const sessions = new Map();

function newId() {
  return crypto.randomUUID().slice(0, 8);
}

async function rmdir(dir) {
  await fs.remove(dir).catch(() => {});
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const dir = path.join(UPLOAD_DIR, req.sessionId);
      await fs.ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, file.originalname)
  }),
  fileFilter: (req, file, cb) => {
    if (!/\.(zip|riv)$/i.test(file.originalname)) {
      return cb(new Error('Only .zip and .riv files allowed'));
    }
    cb(null, true);
  }
});

export async function startWebServer(port = 3001) {
  const app = express();

  await fs.ensureDir(UPLOAD_DIR);

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));

  app.post('/api/upload', (req, res, next) => {
    req.sessionId = newId();
    next();
  }, upload.array('zips'), (req, res) => {
    const sessionId = req.sessionId;
    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    sessions.set(sessionId, {
      id: sessionId,
      files: files.map(f => ({
        name: f.originalname,
        path: f.path,
        type: /\.riv$/i.test(f.originalname) ? 'riv' : 'zip'
      })),
      status: 'uploaded',
      total: files.length,
      current: 0,
      results: [],
      errors: [],
      outputZip: null,
      resultDir: null
    });

    res.json({ sessionId, total: files.length });
  });

  app.post('/api/process/:sessionId', async (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status === 'processing') {
      return res.status(409).json({ error: 'Already processing' });
    }

    session.status = 'processing';
    session.current = 0;
    session.results = [];
    session.errors = [];
    session.resultDir = path.join(TEMP_DIR, 'results', session.id);
    await fs.ensureDir(session.resultDir);

    res.json({ sessionId: session.id, status: 'processing' });

    (async () => {
      const fileServer = await startFileServer(3002, TEMP_DIR).catch(() => null);
      const port = fileServer ? fileServer.address().port : 3002;

      const tasks = session.files.map(async (file) => {
        await globalCap.acquire();
        let sanitized = '';
        let keepDir = false;

        try {
          if (file.type === 'riv') {
            const base = path.basename(file.name, '.riv');
            sanitized = sanitizeFileName(base);
            const dims = parseRivDimensions(file.name);

            if (!dims) {
              throw new Error(`Could not parse dimensions from filename: ${file.name}`);
            }

            const creativeDir = path.join(TEMP_DIR, sanitized);
            await fs.ensureDir(creativeDir);

            const jsFile = path.join(creativeDir, `${sanitized}.js`);
            await fs.copyFile(file.path, jsFile);

            const htmlContent = generateRiveHTML(`${sanitized}.js`, dims.width, dims.height);
            const htmlFile = path.join(creativeDir, `${sanitized}.html`);
            await fs.writeFile(htmlFile, htmlContent);

            const url = `http://localhost:${port}/${sanitized}/${sanitized}.html`;

            await captureBackup(url, dims, session.resultDir, sanitized, {
              waitTimeout: 15000,
              quality: 90,
              strategy: 'auto'
            });

            keepDir = true;
            return { name: sanitized, type: 'riv', creativeDir };
          } else {
            const zipName = path.basename(file.name, '.zip');
            sanitized = sanitizeFileName(zipName);
            const extracted = await extractZip(file.path, TEMP_DIR);
            const entry = await findBannerEntry(extracted);
            const dimensions = await detectBannerSize(entry, file.path);

            const bannerFolder = path.basename(extracted);
            const relativeEntry = path.relative(extracted, entry);
            const url = `http://localhost:${port}/${bannerFolder}/${relativeEntry}`;

            await captureBackup(url, dimensions, session.resultDir, sanitized, {
              waitTimeout: 15000,
              quality: 90,
              strategy: 'auto'
            });

            return { name: sanitized, type: 'zip', creativeDir: null };
          }
        } catch (err) {
          session.errors.push({ file: file.name, error: err.message });
          return null;
        } finally {
          globalCap.release();
          await fs.remove(file.path).catch(() => {});
          if (sanitized && !keepDir) {
            await rmdir(path.join(TEMP_DIR, sanitized));
          }
          session.current++;
        }
      });

      const results = (await Promise.all(tasks)).filter(Boolean);
      session.results.push(...results);

      if (fileServer) {
        await new Promise(r => fileServer.close(r));
      }

      const outputZip = path.join(TEMP_DIR, 'results', `${session.id}.zip`);
      const zip = new AdmZip();

      for (const result of session.results) {
        if (result.type === 'riv' && result.creativeDir) {
          const nestedZipPath = path.join(session.resultDir, `${result.name}.zip`);
          const nestedZip = new AdmZip();
          const creativeFiles = await fs.readdir(result.creativeDir).catch(() => []);
          for (const f of creativeFiles) {
            if (f.endsWith('.html') || f.endsWith('.js')) {
              nestedZip.addLocalFile(path.join(result.creativeDir, f));
            }
          }
          nestedZip.writeZip(nestedZipPath);
          zip.addLocalFile(nestedZipPath, '', `${result.name}.zip`);
        }

        const jpgPath = path.join(session.resultDir, `${result.name}.jpg`);
        if (await fs.pathExists(jpgPath)) {
          zip.addLocalFile(jpgPath, '', `${result.name}.jpg`);
        }
      }

      zip.writeZip(outputZip);

      session.outputZip = outputZip;
      session.status = 'complete';
    })();
  });

  app.get('/api/status/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    res.json({
      status: session.status,
      current: session.current,
      total: session.total,
      errors: session.errors,
      results: session.results.length
    });
  });

  app.get('/api/download/:sessionId', async (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'complete') {
      return res.status(400).json({ error: 'Not complete yet' });
    }

    const zipPath = session.outputZip;
    if (!zipPath || !(await fs.pathExists(zipPath))) {
      return res.status(404).json({ error: 'Result not found' });
    }

    res.download(zipPath, `backup-images-${session.id}.zip`, async () => {
      await fs.remove(zipPath).catch(() => {});
      await rmdir(session.resultDir);
      for (const result of session.results) {
        if (result.type === 'riv' && result.creativeDir) {
          await rmdir(result.creativeDir);
        }
      }
      await rmdir(path.join(UPLOAD_DIR, session.id));
      sessions.delete(session.id);
    });
  });

  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', () => {
      logger.stepSuccess(`Web interface at http://localhost:${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startWebServer(parseInt(process.argv[2], 10) || 3001);
}
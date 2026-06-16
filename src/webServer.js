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
import { createServer as startFileServer, closeServer as stopFileServer } from './localServer.js';
import { logger } from './logger.js';
import { sanitizeFileName } from './utils.js';
import { parseRivDimensions, generateRiveHTML } from './riveTemplate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(ROOT, 'temp');
const UPLOAD_DIR = path.join(TEMP_DIR, 'uploads');

const MAX_CONCURRENT = 3;
const MAX_UPLOAD_SIZE = 200 * 1024 * 1024;
const MAX_UPLOAD_FILES = 50;
const SESSION_TTL_MS = 30 * 60 * 1000;

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

function isSafeFilename(name) {
  return !name.includes('..') && !name.includes('/') && !name.includes('\\');
}

function createFileId(fileName, index) {
  const parsed = path.parse(fileName);
  const safeBase = sanitizeFileName(parsed.name) || 'file';
  return `${String(index + 1).padStart(3, '0')}-${safeBase}`;
}

function getSessionWorkDir(session) {
  return path.join(TEMP_DIR, 'work', session.id);
}

function getFileWorkDir(session, file) {
  return path.join(getSessionWorkDir(session), file.id);
}

function getServedUrl(port, absolutePath) {
  const relativePath = path.relative(TEMP_DIR, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Cannot serve path outside temp directory: ${absolutePath}`);
  }
  const urlPath = relativePath.split(path.sep).map(encodeURIComponent).join('/');
  return `http://localhost:${port}/${urlPath}`;
}

function friendlyFileError(fileName, rawMessage) {
  const msg = String(rawMessage);

  if (msg.includes('path traversal') || msg.includes('max ')) {
    return 'This file looks suspicious or malformed. It may contain path traversal entries or exceed limits.';
  }
  if (msg.includes('No .html file found')) {
    return 'The ZIP must contain at least one .html file. None was found.';
  }
  if (msg.includes('Could not parse dimensions')) {
    return 'The .riv filename must include dimensions, e.g. "Banner_300x250.riv".';
  }
  if (msg.includes('Only .zip and .riv files')) {
    return 'Unsupported file type. Only .zip and .riv files are accepted.';
  }
  if (msg.includes('No usable') || msg.includes('screenshot') || msg.includes('blank')) {
    return 'The creative loaded but produced no usable backup image. Check that it renders correctly.';
  }
  if (msg.includes('File too large') || msg.includes('max 200 MB')) {
    return 'File exceeds the 200 MB size limit.';
  }
  if (msg.includes('EACCES') || msg.includes('EPERM')) {
    return 'A file permission error occurred. Check server directory permissions.';
  }
  if (msg.includes('ENOENT') || msg.includes('not found')) {
    return 'A required file was missing during processing. The upload may be incomplete.';
  }
  return msg;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const dir = path.join(UPLOAD_DIR, req.sessionId);
      await fs.ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      if (!isSafeFilename(file.originalname)) {
        cb(new Error('Unsafe filename rejected'));
        return;
      }
      cb(null, file.originalname);
    }
  }),
  limits: {
    fileSize: MAX_UPLOAD_SIZE,
    files: MAX_UPLOAD_FILES
  },
  fileFilter: (req, file, cb) => {
    if (!/\.(zip|riv)$/i.test(file.originalname)) {
      return cb(new Error('Only .zip and .riv files allowed'));
    }
    cb(null, true);
  }
});

function pruneStaleSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.status === 'processing') continue;
    if (now - s.createdAt > SESSION_TTL_MS) {
      rmdir(path.join(UPLOAD_DIR, id));
      rmdir(s.resultDir);
      rmdir(getSessionWorkDir(s));
      sessions.delete(id);
    }
  }
}

export async function startWebServer(port = 3001) {
  const app = express();

  await fs.ensureDir(UPLOAD_DIR);

  setInterval(pruneStaleSessions, 60_000).unref();

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

    const fileInfos = files.map((f, index) => ({
      id: createFileId(f.originalname, index),
      name: f.originalname,
      path: f.path,
      type: /\.riv$/i.test(f.originalname) ? 'riv' : 'zip',
      state: 'uploaded'
    }));

    sessions.set(sessionId, {
      id: sessionId,
      createdAt: Date.now(),
      files: fileInfos,
      status: 'uploaded',
      total: files.length,
      current: 0,
      results: [],
      errors: [],
      outputZip: null,
      resultDir: null
    });

    res.json({
      sessionId,
      total: files.length,
      files: fileInfos.map(f => ({ id: f.id, name: f.name, type: f.type, state: f.state }))
    });
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

    for (const f of session.files) {
      f.state = 'queued';
    }

    res.json({ sessionId: session.id, status: 'processing' });

    processSession(session);
  });

  app.get('/api/status/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    res.json({
      status: session.status,
      current: session.current,
      total: session.total,
      files: session.files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.type,
        state: f.state,
        error: f.error || null
      })),
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
      await cleanupSession(session);
    });
  });

  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large (max 200 MB)' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files (max 50)' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err.message) {
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

async function processSession(session) {
  let fileServer = null;

  try {
    fileServer = await startFileServer(3002, TEMP_DIR);
  } catch (err) {
    session.status = 'error';
    session.errors.push({ file: 'server', error: `Failed to start local file server: ${err.message}` });
    return;
  }

  const port = fileServer.address().port;

  try {
    const tasks = session.files.map(async (file) => {
      await globalCap.acquire();
      const fileWorkDir = getFileWorkDir(session, file);
      let sanitized = '';
      let keepDir = false;

      try {
        file.state = 'processing';

        if (file.type === 'riv') {
          const base = path.basename(file.name, '.riv');
          sanitized = sanitizeFileName(base);
          const dims = parseRivDimensions(file.name);

          if (!dims) {
            throw new Error(`Could not parse dimensions from filename: ${file.name}`);
          }

          const creativeDir = path.join(fileWorkDir, 'rive');
          await fs.ensureDir(creativeDir);

          const jsFile = path.join(creativeDir, `${sanitized}.js`);
          await fs.copyFile(file.path, jsFile);

          const htmlContent = generateRiveHTML(`${sanitized}.js`, dims.width, dims.height);
          const htmlFile = path.join(creativeDir, `${sanitized}.html`);
          await fs.writeFile(htmlFile, htmlContent);

          const url = getServedUrl(port, htmlFile);

          await captureBackup(url, dims, session.resultDir, sanitized, {
            waitTimeout: 15000,
            strategy: 'auto'
          });

          keepDir = true;
          file.state = 'complete';
          return { name: sanitized, type: 'riv', creativeDir };
        } else {
          const zipName = path.basename(file.name, '.zip');
          sanitized = sanitizeFileName(zipName);
          const extracted = await extractZip(file.path, fileWorkDir, { extractName: 'extracted' });
          const entry = await findBannerEntry(extracted);
          const dimensions = await detectBannerSize(entry, file.path);

          const url = getServedUrl(port, entry);

          await captureBackup(url, dimensions, session.resultDir, sanitized, {
            waitTimeout: 15000,
            strategy: 'auto'
          });

          keepDir = true;
          file.state = 'complete';
          return { name: sanitized, type: 'zip', creativeDir: null };
        }
      } catch (err) {
        file.state = 'failed';
        file.error = friendlyFileError(file.name, err.message);
        session.errors.push({ file: file.name, error: err.message, friendly: file.error });
        return null;
      } finally {
        globalCap.release();
        await fs.remove(file.path).catch(() => {});
        if (!keepDir) {
          await rmdir(fileWorkDir);
        }
        session.current++;
      }
    });

    const results = (await Promise.all(tasks)).filter(Boolean);
    session.results.push(...results);

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

    // Include errors.json when any file failed
    if (session.errors.length > 0) {
      const errorsJson = JSON.stringify(session.errors.map(e => ({
        file: e.file,
        error: e.error,
        friendly: e.friendly || friendlyFileError(e.file, e.error)
      })), null, 2);
      zip.addFile('errors.json', Buffer.from(errorsJson, 'utf-8'));
    }

    zip.writeZip(outputZip);

    session.outputZip = outputZip;
    session.status = 'complete';
  } catch (err) {
    logger.error(`Failed to build output ZIP for session ${session.id}: ${err.message}`);
    session.status = 'error';
    session.errors.push({ file: 'output', error: `Failed to build ZIP: ${err.message}`, friendly: 'Could not package the output files. Try again.' });
  } finally {
    await stopFileServer(fileServer);
  }
}

async function cleanupSession(session) {
  await rmdir(session.outputZip).catch(() => {});
  await rmdir(session.resultDir).catch(() => {});
  for (const result of session.results) {
    if (result.type === 'riv' && result.creativeDir) {
      await rmdir(result.creativeDir).catch(() => {});
    }
  }
  await rmdir(getSessionWorkDir(session)).catch(() => {});
  await rmdir(path.join(UPLOAD_DIR, session.id)).catch(() => {});
  sessions.delete(session.id);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startWebServer(parseInt(process.argv[2], 10) || 3001);
}

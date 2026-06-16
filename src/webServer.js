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
import { createAuthMiddleware } from './auth/middleware.js';
import { Job, FileInfo } from './jobs/Job.js';
import { InMemoryJobStore } from './jobs/JobStore.js';
import { LocalStorage } from './storage/LocalStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(ROOT, 'temp');

const storage = new LocalStorage(TEMP_DIR);

const MAX_CONCURRENT = 3;
const MAX_UPLOAD_SIZE = 200 * 1024 * 1024;
const MAX_UPLOAD_FILES = 50;
const SESSION_TTL_MS = 30 * 60 * 1000;

const APP_VERSION = '1.0.0';

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

const jobStore = new InMemoryJobStore();

function newId() {
  return crypto.randomUUID().slice(0, 8);
}

async function rmdir(dir) {
  return storage.rmdir(dir);
}

function isSafeFilename(name) {
  return !name.includes('..') && !name.includes('/') && !name.includes('\\');
}

function createFileId(fileName, index) {
  const parsed = path.parse(fileName);
  const safeBase = sanitizeFileName(parsed.name) || 'file';
  return `${String(index + 1).padStart(3, '0')}-${safeBase}`;
}

function getFileWorkDir(job, file) {
  return storage.fileWorkDir(job.id, file.id);
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

// ---------------------------------------------------------------------------
// Standardised response helpers
// ---------------------------------------------------------------------------

function errorBody(message, code) {
  const body = { error: message };
  if (code) body.code = code;
  return body;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function assertOwnership(job, auth, res) {
  if (!job || !job.isOwnedBy(auth)) {
    res.status(404).json(errorBody('Job not found', 'NOT_FOUND'));
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Multer setup
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const dir = storage.uploadDir(req.sessionId);
      await storage.ensureUploadDir(req.sessionId);
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

// ---------------------------------------------------------------------------
// Job lifecycle — cleanup
// ---------------------------------------------------------------------------

function pruneStaleSessions() {
  const now = Date.now();
  jobStore.list().then(jobs => {
    for (const s of jobs) {
      if (s.status === 'processing') continue;
      if (now - new Date(s.createdAt).getTime() > SESSION_TTL_MS) {
        storage.cleanupJob(s.id);
        jobStore.delete(s.id);
      }
    }
  });
}

async function processJob(jobId) {
  let fileServer = null;

  const job = await jobStore.get(jobId);
  if (!job) return;

  const serveDir = storage.workDir(job.id);

  try {
    fileServer = await startFileServer(3002, serveDir);
  } catch (err) {
    job.setStatus('error');
    job.errors.push({ file: 'server', error: `Failed to start local file server: ${err.message}` });
    await jobStore.update(jobId, { status: job.status, errors: job.errors });
    return;
  }

  const port = fileServer.address().port;

  try {
    const tasks = job.files.map(async (file) => {
      await globalCap.acquire();
      const fileWorkDir = getFileWorkDir(job, file);
      let sanitized = '';
      let keepDir = false;

      try {
        file.setState('processing');

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

          const url = storage.toPublicUrl(port, htmlFile, serveDir);

          await captureBackup(url, dims, job.resultDir, sanitized, {
            waitTimeout: 15000,
            strategy: 'auto'
          });

          keepDir = true;
          file.setState('complete');
          return { name: sanitized, type: 'riv', creativeDir };
        } else {
          const zipName = path.basename(file.name, '.zip');
          sanitized = sanitizeFileName(zipName);
          const extracted = await extractZip(file.path, fileWorkDir, { extractName: 'extracted' });
          const entry = await findBannerEntry(extracted);
          const dimensions = await detectBannerSize(entry, file.path);

          const url = storage.toPublicUrl(port, entry, serveDir);

          await captureBackup(url, dimensions, job.resultDir, sanitized, {
            waitTimeout: 15000,
            strategy: 'auto'
          });

          keepDir = true;
          file.setState('complete');
          return { name: sanitized, type: 'zip', creativeDir: null };
        }
      } catch (err) {
        file.setState('failed', friendlyFileError(file.name, err.message));
        job.errors.push({ file: file.name, error: err.message, friendly: file.error });
        return null;
      } finally {
        globalCap.release();
        await fs.remove(file.path).catch(() => {});
        if (!keepDir) {
          await rmdir(fileWorkDir);
        }
      }
    });

    const results = (await Promise.all(tasks)).filter(Boolean);
    job.results.push(...results);

    const outputZip = storage.outputZipPath(job.id);
    const zip = new AdmZip();

    for (const result of job.results) {
      if (result.type === 'riv' && result.creativeDir) {
        const nestedZipPath = path.join(job.resultDir, `${result.name}.zip`);
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

      const jpgPath = path.join(job.resultDir, `${result.name}.jpg`);
      if (await fs.pathExists(jpgPath)) {
        zip.addLocalFile(jpgPath, '', `${result.name}.jpg`);
      }
    }

    if (job.errors.length > 0) {
      const errorsJson = JSON.stringify(job.errors.map(e => ({
        file: e.file,
        error: e.error,
        friendly: e.friendly || friendlyFileError(e.file, e.error)
      })), null, 2);
      zip.addFile('errors.json', Buffer.from(errorsJson, 'utf-8'));
    }

    zip.writeZip(outputZip);

    job.outputZip = outputZip;
    job.setStatus('complete');
    await jobStore.update(jobId, {
      status: job.status,
      updatedAt: job.updatedAt,
      outputZip: job.outputZip,
      files: job.files,
      errors: job.errors,
      results: job.results
    });
  } catch (err) {
    logger.error(`Failed to build output ZIP for job ${job.id}: ${err.message}`);
    job.setStatus('error');
    job.errors.push({ file: 'output', error: `Failed to build ZIP: ${err.message}`, friendly: 'Could not package the output files. Try again.' });
    await jobStore.update(jobId, { status: job.status, errors: job.errors });
  } finally {
    await stopFileServer(fileServer);
  }
}

async function cleanupJob(job) {
  for (const result of job.results) {
    if (result.type === 'riv' && result.creativeDir) {
      await storage.rmdir(result.creativeDir);
    }
  }
  await storage.cleanupJob(job.id);
  await jobStore.delete(job.id);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleUpload(req, res) {
  const files = req.files || [];

  if (files.length === 0) {
    return res.status(400).json(errorBody('No files uploaded', 'NO_FILES'));
  }

  const auth = req.auth || {};

  const fileInfos = files.map((f, index) => new FileInfo({
    id: createFileId(f.originalname, index),
    name: f.originalname,
    path: f.path,
    type: /\.riv$/i.test(f.originalname) ? 'riv' : 'zip',
    state: 'uploaded'
  }));

  const job = new Job({
    id: req.sessionId,
    userId: auth.userId || null,
    tenantId: auth.tenantId || null,
    clientId: auth.clientId || null,
    files: fileInfos
  });

  await jobStore.create(job);

  const response = job.toJSON();
  res.status(201).json(response);
}

async function handleStartProcessing(req, res) {
  const job = await jobStore.get(req.params.jobId);
  if (!assertOwnership(job, req.auth, res)) return;

  if (job.status === 'processing') {
    return res.status(409).json(errorBody('Job is already processing', 'ALREADY_PROCESSING'));
  }

  job.setStatus('processing');
  job.results = [];
  job.errors = [];
  job.resultDir = storage.resultDir(job.id);
  await storage.ensureResultDir(job.id);

  for (const f of job.files) {
    f.setState('queued');
  }

  await jobStore.update(job.id, {
    status: job.status,
    updatedAt: job.updatedAt,
    results: job.results,
    errors: job.errors,
    resultDir: job.resultDir,
    files: job.files
  });

  const response = job.toJSON();
  res.json(response);

  processJob(job.id);
}

async function handleGetJob(req, res) {
  const job = await jobStore.get(req.params.jobId);
  if (!assertOwnership(job, req.auth, res)) return;

  const response = job.toJSON();
  if (job.status === 'complete') {
    response.download = `/api/v1/jobs/${job.id}/download`;
  }
  res.json(response);
}

async function handleGetJobFiles(req, res) {
  const job = await jobStore.get(req.params.jobId);
  if (!assertOwnership(job, req.auth, res)) return;

  res.json({
    jobId: job.id,
    files: job.files.map(f => f.toJSON())
  });
}

async function handleDownload(req, res) {
  const job = await jobStore.get(req.params.jobId);
  if (!assertOwnership(job, req.auth, res)) return;

  if (job.status !== 'complete') {
    return res.status(400).json(errorBody('Job is not complete yet', 'NOT_COMPLETE'));
  }

  const zipPath = job.outputZip;
  if (!zipPath || !(await fs.pathExists(zipPath))) {
    return res.status(404).json(errorBody('Result file not found', 'RESULT_NOT_FOUND'));
  }

  res.download(zipPath, `backup-images-${job.id}.zip`, async () => {
    await cleanupJob(job);
  });
}

function handleHealth(req, res) {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    uptime: process.uptime(),
    jobs: jobStore.size
  });
}

function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json(errorBody('File too large (max 200 MB)', 'FILE_TOO_LARGE'));
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json(errorBody('Too many files (max 50)', 'TOO_MANY_FILES'));
    }
    return res.status(400).json(errorBody(err.message, 'UPLOAD_ERROR'));
  }
  if (err.message) {
    if (err.message === 'Only .zip and .riv files allowed') {
      return res.status(400).json(errorBody(err.message, 'INVALID_FILE_TYPE'));
    }
    if (err.message === 'Unsafe filename rejected') {
      return res.status(400).json(errorBody('Filename contains invalid characters', 'UNSAFE_FILENAME'));
    }
    return res.status(400).json(errorBody(err.message, 'BAD_REQUEST'));
  }
  res.status(500).json(errorBody('Internal server error', 'INTERNAL_ERROR'));
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

export async function startWebServer(port = 3001, opts = {}) {
  const app = express();

  const corsOrigin = opts.corsOrigin || '*';
  const rateLimitMax = opts.rateLimitMax || 30;

  await fs.ensureDir(storage.root);

  setInterval(pruneStaleSessions, 60_000).unref();

  // -----------------------------------------------------------------------
  // Security headers
  // -----------------------------------------------------------------------

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // -----------------------------------------------------------------------
  // CORS
  // -----------------------------------------------------------------------

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));

  // -----------------------------------------------------------------------
  // Rate limiter (per-IP, applied to mutation endpoints)
  // -----------------------------------------------------------------------

  const rateLimitWindow = 60_000;
  const rateLimitMap = new Map();

  function rateLimiter(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);

    const window = rateLimitMap.get(ip).filter(t => now - t < rateLimitWindow);
    if (window.length >= rateLimitMax) {
      return res.status(429).json(errorBody('Too many requests. Please slow down.', 'RATE_LIMITED'));
    }

    window.push(now);
    rateLimitMap.set(ip, window);
    next();
  }

  // -----------------------------------------------------------------------
  // Auth middleware — applies to all /api/* routes
  // -----------------------------------------------------------------------

  const authMw = createAuthMiddleware(opts.auth || {});

  // Health endpoint is public (registered before auth middleware)
  app.get('/api/v1/health', handleHealth);

  app.use('/api', authMw);

  // -----------------------------------------------------------------------
  // v1 API router
  // -----------------------------------------------------------------------

  const v1 = express.Router();

  v1.post('/jobs', (req, res, next) => {
    req.sessionId = newId();
    next();
  }, upload.array('files'), handleUpload);

  v1.post('/jobs/:jobId/process', handleStartProcessing);

  v1.get('/jobs/:jobId', handleGetJob);

  v1.get('/jobs/:jobId/files', handleGetJobFiles);

  v1.get('/jobs/:jobId/download', handleDownload);

  v1.use(handleMulterError);

  app.use('/api/v1', v1);

  // -----------------------------------------------------------------------
  // Legacy backward-compatible routes (same handlers, old paths)
  // -----------------------------------------------------------------------

  app.post('/api/upload', (req, res, next) => {
    req.sessionId = newId();
    next();
  }, upload.array('zips'), handleUpload);

  app.post('/api/process/:sessionId', (req, res) => {
    req.params.jobId = req.params.sessionId;
    handleStartProcessing(req, res);
  });

  app.get('/api/status/:sessionId', (req, res) => {
    req.params.jobId = req.params.sessionId;
    handleGetJob(req, res);
  });

  app.get('/api/download/:sessionId', (req, res) => {
    req.params.jobId = req.params.sessionId;
    handleDownload(req, res);
  });

  app.use(handleMulterError);

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

import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import path from 'path';
import { logger } from './logger.js';
import { metrics } from './metrics.js';

const MAX_ENTRIES = 1000;
const MAX_ENTRY_SIZE = 50 * 1024 * 1024;
const MAX_TOTAL_SIZE = 200 * 1024 * 1024;

const IGNORED_PATTERNS = [
  '__MACOSX',
  '.DS_Store',
  /^\./,
  /^__/
];

function shouldIgnore(entryName) {
  return IGNORED_PATTERNS.some(pattern => {
    if (pattern instanceof RegExp) return pattern.test(entryName);
    return entryName.includes(pattern);
  });
}

export function isPathSafe(targetPath, extractRoot) {
  const resolved = path.resolve(targetPath);
  if (resolved !== targetPath) return false;
  return resolved.startsWith(extractRoot);
}

export async function extractZip(zipPath, tempDir, options = {}) {
  const log = logger.child({ module: 'extractZip' });
  const startTime = Date.now();

  const zipName = path.basename(zipPath, '.zip');
  const extractName = options.extractName || zipName;
  const tempRoot = path.resolve(tempDir) + path.sep;
  const extractPath = path.resolve(tempDir, extractName);
  const extractRoot = path.resolve(extractPath) + path.sep;

  if (!isPathSafe(extractPath, tempRoot)) {
    log.warn('Unsafe extraction directory', { extractName });
    throw new Error(`Unsafe extraction directory: ${extractName}`);
  }

  await fs.ensureDir(extractPath);

  try {
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    if (zipEntries.length > MAX_ENTRIES) {
      log.warn('ZIP exceeds max entries', { entryCount: zipEntries.length, max: MAX_ENTRIES });
      metrics.increment('extract.rejected', { reason: 'too_many_entries' });
      throw new Error(`ZIP contains ${zipEntries.length} entries (max ${MAX_ENTRIES})`);
    }

    let extractedCount = 0;
    let totalBytes = 0;

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;
      if (shouldIgnore(entry.entryName)) continue;

      const entryName = entry.entryName.replace(/\\/g, '/');
      const unsafeName = path.normalize(entryName);
      const targetPath = path.resolve(extractPath, unsafeName);

      if (!isPathSafe(targetPath, extractRoot)) {
        log.warn('Path traversal in ZIP entry', { entryName: entry.entryName });
        metrics.increment('extract.rejected', { reason: 'path_traversal' });
        throw new Error(`Rejected path traversal in ZIP entry: ${entry.entryName}`);
      }

      const data = entry.getData();
      if (data.length > MAX_ENTRY_SIZE) {
        log.warn('ZIP entry exceeds max size', { entryName: entry.entryName, size: data.length, max: MAX_ENTRY_SIZE });
        metrics.increment('extract.rejected', { reason: 'entry_too_large' });
        throw new Error(`ZIP entry ${entry.entryName} is ${data.length} bytes (max ${MAX_ENTRY_SIZE})`);
      }
      totalBytes += data.length;
      if (totalBytes > MAX_TOTAL_SIZE) {
        log.warn('Total extracted size exceeded', { totalBytes, max: MAX_TOTAL_SIZE });
        metrics.increment('extract.rejected', { reason: 'total_size_exceeded' });
        throw new Error(`Total extracted size exceeds ${MAX_TOTAL_SIZE} bytes`);
      }

      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, data);
      extractedCount++;
    }

    const duration = Date.now() - startTime;
    log.stepSuccess(`ZIP extracted (${extractedCount} files)`, { duration, extractedCount, totalBytes });
    metrics.timing('extract.duration', duration);
    metrics.increment('extract.complete');
    return extractPath;

  } catch (error) {
    await fs.remove(extractPath).catch(() => {});
    throw new Error(`Failed to extract ZIP: ${error.message}`);
  }
}

export async function cleanTempDir(tempDir) {
  try {
    await fs.remove(tempDir);
    await fs.ensureDir(tempDir);
  } catch (error) {
    logger.warn(`Failed to clean temp directory: ${error.message}`);
  }
}

import fs from 'fs-extra';
import path from 'path';
import { logger } from './logger.js';

export async function findBannerEntry(extractPath) {
  const htmlFiles = await findHtmlFiles(extractPath);

  if (htmlFiles.length === 0) {
    throw new Error('No .html file found in extracted ZIP');
  }

  if (htmlFiles.length > 1) {
    logger.warn(`Multiple .html files found (${htmlFiles.length}), using shallowest`);
  }

  const selectedEntry = selectShallowest(htmlFiles, extractPath);
  const relativePath = path.relative(extractPath, selectedEntry);

  logger.step(`Entry: ${relativePath}`);

  return selectedEntry;
}

async function findHtmlFiles(dir, results = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!shouldIgnoreDir(entry.name)) {
        await findHtmlFiles(fullPath, results);
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      results.push(fullPath);
    }
  }

  return results;
}

function shouldIgnoreDir(name) {
  return name === '__MACOSX' || name === 'node_modules' || name.startsWith('.');
}

function selectShallowest(files, extractPath) {
  const withDepth = files.map(file => ({
    path: file,
    depth: path.relative(extractPath, file).split(path.sep).length
  }));

  withDepth.sort((a, b) => {
    if (a.depth === 1 && b.depth !== 1) return -1;
    if (b.depth === 1 && a.depth !== 1) return 1;
    return a.depth - b.depth;
  });

  return withDepth[0].path;
}
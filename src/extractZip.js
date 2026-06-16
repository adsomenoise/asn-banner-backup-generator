import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import path from 'path';
import { logger } from './logger.js';

const IGNORED_PATTERNS = [
  '__MACOSX',
  '.DS_Store',
  /^\./,
  /^__/
];

function shouldIgnore(entryName) {
  return IGNORED_PATTERNS.some(pattern => {
    if (pattern instanceof RegExp) {
      return pattern.test(entryName);
    }
    return entryName.includes(pattern);
  });
}

export async function extractZip(zipPath, tempDir) {
  const zipName = path.basename(zipPath, '.zip');
  const extractPath = path.join(tempDir, zipName);
  
  await fs.ensureDir(extractPath);
  
  try {
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();
    
    let extractedCount = 0;
    
    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;
      if (shouldIgnore(entry.entryName)) continue;
      
      const targetPath = path.join(extractPath, entry.entryName);
      
      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, entry.getData());
      extractedCount++;
    }
    
    logger.stepSuccess(`ZIP extracted (${extractedCount} files)`);
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
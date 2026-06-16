import fs from 'fs-extra';
import path from 'path';
import minimist from 'minimist';
import { logger } from './logger.js';
import { extractZip, cleanTempDir } from './extractZip.js';
import { findBannerEntry } from './findBannerEntry.js';
import { detectBannerSize } from './detectBannerSize.js';
import { createServer, closeServer, getServerUrl, getPort } from './localServer.js';
import { captureBackup } from './captureBackup.js';
import { sanitizeFileName } from './utils.js';

const DEFAULT_OPTIONS = {
  input: './input',
  output: './output',
  temp: './temp',
  port: 3000,
  wait: 15000,
  quality: 90,
  strategy: 'auto'
};

async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: ['input', 'output', 'temp', 'port', 'wait', 'quality', 'strategy'],
    default: DEFAULT_OPTIONS,
    alias: {
      i: 'input',
      o: 'output',
      t: 'temp',
      p: 'port',
      w: 'wait',
      q: 'quality',
      s: 'strategy'
    }
  });
  
  const options = {
    inputDir: path.resolve(argv.input),
    outputDir: path.resolve(argv.output),
    tempDir: path.resolve(argv.temp),
    port: parseInt(argv.port, 10),
    waitTimeout: parseInt(argv.wait, 10),
    quality: parseInt(argv.quality, 10),
    strategy: argv.strategy
  };
  
  printBanner();
  logConfiguration(options);
  
  await fs.ensureDir(options.inputDir);
  await fs.ensureDir(options.outputDir);
  await fs.ensureDir(options.tempDir);
  
  await cleanTempDir(options.tempDir);
  
  const zipFiles = await getZipFiles(options.inputDir);
  
  if (zipFiles.length === 0) {
    logger.warn('No ZIP files found in input directory');
    logger.info(`Place your banner ZIP files in: ${options.inputDir}`);
    process.exit(0);
  }
  
  logger.info(`Found ${zipFiles.length} ZIP file(s) to process\n`);
  
  const fileServer = await createServer(options.port, options.tempDir);
  const serverPort = getPort(fileServer);

  const errors = [];

  for (const zipFile of zipFiles) {
    const zipName = path.basename(zipFile, '.zip');
    const sanitizedName = sanitizeFileName(zipName);
    
    logger.banner(zipFile);
    
    try {
      const extractPath = await extractZip(zipFile, options.tempDir);
      const entryPath = await findBannerEntry(extractPath);
      const dimensions = await detectBannerSize(entryPath, zipFile);
      
      const bannerFolderName = path.basename(extractPath);
      const relativeEntry = path.relative(extractPath, entryPath);
      const bannerUrl = getServerUrl(serverPort, bannerFolderName, relativeEntry);
      
      logger.step(`Opening: ${bannerUrl}`);
      
      const result = await captureBackup(bannerUrl, dimensions, options.outputDir, sanitizedName, {
        waitTimeout: options.waitTimeout,
        quality: options.quality,
        strategy: options.strategy
      });
      
      logger.stepSuccess(`Backup strategy used: ${result.strategy}`);
      
    } catch (error) {
      const errorMsg = error.message || String(error);
      logger.stepError(`Failed: ${errorMsg}`);
      errors.push({ zip: zipFile, error: errorMsg });
      logger.continue();
    }
  }
  
  await closeServer(fileServer);
  
  if (errors.length > 0) {
    const errorsPath = path.join(options.outputDir, 'errors.json');
    await fs.writeJson(errorsPath, errors, { spaces: 2 });
    logger.warn(`${errors.length} banner(s) failed - see ${errorsPath}`);
  }
  
  logger.success('\nAll banners processed!');
  logger.info(`Output directory: ${options.outputDir}`);
}

function printBanner() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           Rive Backup Image Generator v1.0.0                ║
║   Batch HTML5 banner ZIP → JPG backup images for ad platforms ║
╚══════════════════════════════════════════════════════════════╝
  `);
}

function logConfiguration(options) {
  logger.info('Configuration:');
  logger.info(`  Input:    ${options.inputDir}`);
  logger.info(`  Output:   ${options.outputDir}`);
  logger.info(`  Temp:     ${options.tempDir}`);
  logger.info(`  Port:     ${options.port}`);
  logger.info(`  Wait:     ${options.waitTimeout}ms`);
  logger.info(`  Quality:  ${options.quality}`);
  logger.info(`  Strategy: ${options.strategy}\n`);
}

async function getZipFiles(inputDir) {
  const files = await fs.readdir(inputDir);
  return files
    .filter(f => f.toLowerCase().endsWith('.zip'))
    .map(f => path.join(inputDir, f))
    .sort();
}

main().catch(error => {
  logger.error(`Fatal error: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
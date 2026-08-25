import fs from 'fs-extra';
import path from 'path';
import { logger } from '../logger.js';

export async function captureScreenshot(page, dimensions) {
  await ensureFontsLoaded(page);
  return page.screenshot({
    type: 'png',
    clip: { x: 0, y: 0, width: dimensions.width, height: dimensions.height }
  });
}

async function ensureFontsLoaded(page) {
  try {
    await page.evaluate(() => document.fonts.ready);
  } catch {
    logger.warn('Font loading check failed, continuing');
  }
}

export async function saveDebugArtifacts(page, debugDir, baseName, browserErrors) {
  try {
    await fs.ensureDir(debugDir);
    const base = path.join(debugDir, baseName);
    await fs.writeFile(`${base}_errors.json`, JSON.stringify(browserErrors, null, 2));
    try {
      const html = await page.content();
      await fs.writeFile(`${base}_page.html`, html.slice(0, 50_000));
    } catch (error) {
      logger.debug('Could not save page HTML for debug', { error: error.message });
    }
  } catch (error) {
    logger.debug('Failed to save debug artifacts', { error: error.message });
  }
}

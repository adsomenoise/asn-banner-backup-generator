import { chromium } from 'playwright';
import sharp from 'sharp';
import { logger } from './logger.js';
import { delay, getUniqueOutputPath } from './utils.js';

const STRATEGIES = {
  QUERY_PARAM: 'Query parameter (?backup=1)',
  GENERATE_BACKUP_FRAME: 'window.generateBackupFrame()',
  RIVE_INSTANCE_SCRUB: 'Rive instance scrub',
  FALLBACK_TIMEOUT: 'Fallback timeout'
};

export async function captureBackup(baseUrl, dimensions, outputDir, baseName, options = {}) {
  const {
    waitTimeout = 15000,
    quality = 90,
    strategy = 'auto'
  } = options;
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
  });
  
  const context = await browser.newContext({
    viewport: { width: dimensions.width, height: dimensions.height },
    deviceScaleFactor: 1
  });
  
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    let _pending = new Map();
    let _id = 0;
    window.requestAnimationFrame = (cb) => {
      _pending.set(++_id, cb);
      return _id;
    };
    window.cancelAnimationFrame = (id) => { _pending.delete(id); };
    window.__drainRAF = (maxFrames = 5000, virtualDuration = 30000) => {
      const _origPerfNow = performance.now.bind(performance);
      const msPerFrame = virtualDuration / maxFrames;
      let virtualNow = _origPerfNow();
      performance.now = () => virtualNow;
      let total = 0;
      while (total < maxFrames) {
        const batch = Array.from(_pending.values());
        if (batch.length === 0) break;
        _pending.clear();
        for (const cb of batch) {
          virtualNow += msPerFrame;
          try { cb(virtualNow); } catch (e) {}
          total++;
        }
      }
      performance.now = _origPerfNow;
      return total;
    };
    window.__hashViewport = () => {
      let hash = 0;
      const add = (v) => { hash = ((hash << 5) - hash) + (v | 0); hash |= 0; };
      const canvas = document.querySelector('canvas');
      if (canvas) {
        try {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 0; i < data.length; i += 4) {
              add(data[i] + (data[i + 1] << 8) + (data[i + 2] << 16) + (data[i + 3] << 24));
            }
          }
        } catch (e) {}
      }
      return hash;
    };
    window.__pendingCount = () => _pending.size;
  });
  
  try {
    let usedStrategy = STRATEGIES.FALLBACK_TIMEOUT;
    let backupReady = false;
    let url = baseUrl;
    
    if (strategy === 'auto' || strategy === 'query') {
      url = baseUrl.includes('?') ? `${baseUrl}&backup=1` : `${baseUrl}?backup=1`;
    }
    
    page.setDefaultTimeout(15000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
    await page.waitForLoadState('load', { timeout: 3000 }).catch(() => {});
    
    if (strategy === 'auto' || strategy === 'query') {
      backupReady = await checkBackupReady(page);
      if (backupReady) {
        usedStrategy = STRATEGIES.QUERY_PARAM;
      }
    }
    
    if (!backupReady && (strategy === 'auto' || strategy === 'generate')) {
      backupReady = await tryGenerateBackupFrame(page);
      if (backupReady) {
        usedStrategy = STRATEGIES.GENERATE_BACKUP_FRAME;
      }
    }
    
    if (!backupReady && (strategy === 'auto' || strategy === 'scrub')) {
      backupReady = await tryRiveInstanceScrub(page);
      if (backupReady) {
        usedStrategy = STRATEGIES.RIVE_INSTANCE_SCRUB;
      }
    }
    
    if (!backupReady) {
      logger.step('Waiting for content to load...');
      await page.evaluate(() => new Promise(r => {
        let n = 0;
        (function poll() {
          const c = document.querySelector('canvas');
          if (c) {
            try {
              const ctx = c.getContext('2d');
              if (ctx) {
                const d = ctx.getImageData(0, 0, c.width, c.height).data;
                for (let i = 3; i < d.length; i += 4) {
                  if (d[i] > 0) { r(true); return; }
                }
              }
            } catch (e) {}
          }
          if (++n > 15) { r(false); return; }
          setTimeout(poll, 200);
        })();
      }));

      const maxFrames = Math.ceil(waitTimeout / 6);
      const batchSize = 400;
      let totalDrained = 0;
      let lastHash = null;
      let stable = false;

      logger.step('Advancing animation frames...');

      while (totalDrained < maxFrames && !stable) {
        const drained = await page.evaluate((n) => window.__drainRAF(n), batchSize);
        totalDrained += drained;

        const hash = await page.evaluate(() => window.__hashViewport());

        // No more pending frames → animation stopped
        if (drained === 0) {
          if (lastHash !== null && hash === lastHash) {
            stable = true;
          }
          break;
        }

        // Fewer frames than batch → animation ended mid-batch
        // and canvas unchanged since last check
        if (drained < batchSize && lastHash !== null && hash === lastHash) {
          stable = true;
        }

        lastHash = hash;
      }

      if (!stable) {
        const remains = await page.evaluate(() => window.__pendingCount());
        if (remains === 0) {
          const hash = await page.evaluate(() => window.__hashViewport());
          if (lastHash === null || hash === lastHash) {
            stable = true;
          }
        }
      }

      logger.step(`Stable: ${stable}, frames: ${totalDrained}`);
      usedStrategy = STRATEGIES.FALLBACK_TIMEOUT;
    }
    
    logger.stepSuccess(`Backup strategy: ${usedStrategy}`);
    await ensureFontsLoaded(page);
    
    const screenshotBuffer = await captureScreenshot(page, dimensions);
    const outputPath = getUniqueOutputPath(outputDir, baseName, '.jpg');
    await processAndSaveImage(screenshotBuffer, outputPath);
    
    logger.stepSuccess('Screenshot captured');
    logger.saved(outputPath);
    
    return { path: outputPath, strategy: usedStrategy };
    
  } finally {
    await context.close();
    await browser.close();
  }
}

async function checkBackupReady(page) {
  try {
    return await page.waitForFunction(
      () => window.__BACKUP_READY__ === true,
      { timeout: 1000 }
    ).then(() => true);
  } catch {
    return false;
  }
}

async function tryGenerateBackupFrame(page) {
  try {
    const hasFunction = await page.evaluate(() => typeof window.generateBackupFrame === 'function');
    if (!hasFunction) return false;
    
    await page.evaluate(() => window.generateBackupFrame());
    
    return await checkBackupReady(page);
  } catch {
    return false;
  }
}

async function tryRiveInstanceScrub(page) {
  try {
    const hasRiveInstance = await page.evaluate(() => 
      window.riveInstance && typeof window.riveInstance.scrub === 'function'
    );
    if (!hasRiveInstance) return false;
    
    await page.evaluate(() => {
      try {
        const instance = window.riveInstance;
        if (instance.pause) instance.pause();
        if (instance.scrub) instance.scrub(Number.MAX_SAFE_INTEGER);
        if (instance.play) instance.play();
        window.__BACKUP_READY__ = true;
      } catch (e) {
        console.warn('Rive scrub failed:', e);
      }
    });
    
    await delay(1500);
    return await checkBackupReady(page);
  } catch {
    return false;
  }
}

async function ensureFontsLoaded(page) {
  try {
    await page.evaluate(() => document.fonts.ready);
  } catch {
    logger.warn('Font loading check failed, continuing');
  }
}

async function captureScreenshot(page, dimensions) {
  return await page.screenshot({
    type: 'png',
    clip: {
      x: 0,
      y: 0,
      width: dimensions.width,
      height: dimensions.height
    }
  });
}

const MAX_FILE_SIZE = 80 * 1024;
const QUALITY_TIERS = [95, 80, 65, 50, 35];

function jpegOptions(quality) {
  return {
    quality,
    mozjpeg: true,
    chromaSubsampling: '4:2:0',
    trellisQuantisation: true,
    overshootDeringing: true,
    optimiseScan: true
  };
}

async function processAndSaveImage(buffer, outputPath) {
  let result = null;

  for (const q of QUALITY_TIERS) {
    result = await sharp(buffer).jpeg(jpegOptions(q)).toBuffer();
    if (result.length <= MAX_FILE_SIZE) break;
  }

  await sharp(result).toFile(outputPath);
}
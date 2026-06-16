import sharp from 'sharp';
import fs from 'fs-extra';
import path from 'path';
import { logger } from './logger.js';
import { metrics } from './metrics.js';
import { delay, getUniqueOutputPath } from './utils.js';
import { getBrowserPool } from './browserPool.js';

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
    strategy = 'auto',
    debugDir = null
  } = options;

  const log = logger.child({ module: 'captureBackup' });
  const startTime = Date.now();
  const browserErrors = [];
  let usedStrategy = STRATEGIES.FALLBACK_TIMEOUT;

  const pool = getBrowserPool();
  const lease = await pool.acquire();
  const { browser } = lease;

  const context = await browser.newContext({
    viewport: { width: dimensions.width, height: dimensions.height },
    deviceScaleFactor: 1
  });

  const page = await context.newPage();

  // Capture browser console errors
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      browserErrors.push({
        type: msg.type(),
        text: msg.text().slice(0, 500),
        location: msg.location()
      });
    }
  });

  // Capture unhandled JS errors
  page.on('pageerror', err => {
    browserErrors.push({
      type: 'pageerror',
      text: err.message.slice(0, 500),
      stack: err.stack ? err.stack.split('\n').slice(0, 5).join('\n').slice(0, 1000) : null
    });
  });

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
    let backupReady = false;
    let url = baseUrl;
    let creativeTimelineStart = Date.now();

    if (strategy === 'auto' || strategy === 'query') {
      url = baseUrl.includes('?') ? `${baseUrl}&backup=1` : `${baseUrl}?backup=1`;
    }

    page.setDefaultTimeout(15000);
    try {
      creativeTimelineStart = Date.now();
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
      if (response && !response.ok()) {
        throw new Error(`HTTP ${response.status()} ${response.statusText()}`);
      }
    } catch (error) {
      log.error('Failed to load creative', { url: baseUrl, error: error.message, dimensions: `${dimensions.width}x${dimensions.height}` });
      metrics.increment('capture.load_error');
      throw new Error(`Failed to load creative URL ${url}: ${error.message}`);
    }
    await page.waitForLoadState('load', { timeout: 1000 }).catch(() => {});

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
      const hasCanvas = await page.evaluate(() => !!document.querySelector('canvas'));

      if (hasCanvas) {
        log.step('Waiting for content to load...');
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
      }

      const elapsed = Date.now() - creativeTimelineStart;
      const remaining = waitTimeout - elapsed;
      if (remaining > 0) {
        log.step(`Waiting ${remaining}ms for fallback end frame...`);
        await delay(remaining);
      }

      const maxFrames = Math.ceil(waitTimeout / 6);
      const batchSize = 400;
      let totalDrained = 0;
      let lastHash = null;
      let stable = false;

      if (hasCanvas) {
        log.step('Advancing animation frames...');
      }

      while (totalDrained < maxFrames && !stable) {
        const drained = await page.evaluate(
          ({ frames, virtualDuration }) => window.__drainRAF(frames, virtualDuration),
          { frames: batchSize, virtualDuration: waitTimeout }
        );
        totalDrained += drained;

        const hash = await page.evaluate(() => window.__hashViewport());

        if (drained === 0) {
          if (lastHash !== null && hash === lastHash) {
            stable = true;
          }
          break;
        }

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

      log.step(`Stable: ${stable}, frames: ${totalDrained}`);
      usedStrategy = STRATEGIES.FALLBACK_TIMEOUT;
    }

    log.stepSuccess(`Backup strategy: ${usedStrategy}`);
    metrics.increment('capture.strategy', { strategy: usedStrategy });
    await ensureFontsLoaded(page);

    const screenshotBuffer = await captureScreenshot(page, dimensions);
    const outputPath = getUniqueOutputPath(outputDir, baseName, '.jpg');
    await processAndSaveImage(screenshotBuffer, outputPath, quality);

    log.stepSuccess('Screenshot captured');
    log.saved(outputPath);

    const totalDuration = Date.now() - startTime;
    metrics.timing('capture.duration', totalDuration, { strategy: usedStrategy });

    log.info('Capture complete', {
      duration: totalDuration,
      strategy: usedStrategy,
      dimensions: `${dimensions.width}x${dimensions.height}`,
      browserErrors: browserErrors.length
    });

    if (browserErrors.length > 0) {
      log.warn('Browser errors during capture', { browserErrors: browserErrors.length });
      // Save debug artifacts if configured
      if (debugDir) {
        await saveDebugArtifacts(page, debugDir, baseName, browserErrors);
      }
    }

    return {
      path: outputPath,
      strategy: usedStrategy,
      duration: totalDuration,
      browserErrors
    };

  } finally {
    await context.close();
    pool.release(lease);
  }
}

async function checkBackupReady(page) {
  try {
    return await page.waitForFunction(
      () => window.__backupReady === true || window.__BACKUP_READY__ === true,
      null,
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

    await page.evaluate(async () => {
      const result = window.generateBackupFrame();
      if (result && typeof result.then === 'function') {
        await result;
      }
      if (result === true) {
        window.__backupReady = true;
      }
    });

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
        window.__backupReady = true;
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

async function saveDebugArtifacts(page, debugDir, baseName, browserErrors) {
  try {
    await fs.ensureDir(debugDir);
    const base = path.join(debugDir, baseName);

    // Save error metadata
    await fs.writeFile(
      `${base}_errors.json`,
      JSON.stringify(browserErrors, null, 2)
    );

    // Save page HTML (trimmed to first 50KB)
    try {
      const html = await page.content();
      await fs.writeFile(`${base}_page.html`, html.slice(0, 50_000));
    } catch (e) {
      logger.debug('Could not save page HTML for debug', { error: e.message });
    }
  } catch (e) {
    logger.debug('Failed to save debug artifacts', { error: e.message });
  }
}

const MAX_FILE_SIZE = 80 * 1024;
const DEFAULT_QUALITY_TIERS = [95, 80, 65, 50, 35];

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

export async function processAndSaveImage(buffer, outputPath, preferredQuality) {
  let result = null;
  const seen = new Set();
  const tiers = [];
  const log = logger.child({ module: 'captureBackup' });

  if (preferredQuality && preferredQuality >= 10 && preferredQuality <= 100) {
    tiers.push(preferredQuality);
    seen.add(preferredQuality);
  }
  for (const q of DEFAULT_QUALITY_TIERS) {
    if (!seen.has(q)) tiers.push(q);
  }

  const startTime = Date.now();

  for (const q of tiers) {
    result = await sharp(buffer).jpeg(jpegOptions(q)).toBuffer();
    log.debug('Compression tier', { quality: q, size: result.length });
    if (result.length <= MAX_FILE_SIZE) {
      log.debug('Selected quality tier', { quality: q, size: result.length });
      metrics.increment('compression.tier_selected', { quality: String(q) });
      break;
    }
  }

  const compressionTime = Date.now() - startTime;
  metrics.timing('compression.duration', compressionTime);

  await sharp(result).toFile(outputPath);

  metrics.increment('compression.complete');
  metrics.count('compression.bytes', result.length);
}

import { logger } from './logger.js';
import { metrics } from './metrics.js';
import { getBrowserPool } from './browserPool.js';
import { installRiveStateSignal, resolveEndFrame } from './capture/endFrameStrategies.js';
import { captureScreenshot, saveDebugArtifacts } from './capture/screenshot.js';
import { encodeScreenshot } from './capture/outputEncoder.js';
import { remainingBudget, resolveCapturePolicy } from './capture/policy.js';
import { assertSafeDimensions } from './utils.js';
import { installNetworkPolicy } from './capture/networkPolicy.js';
import { getPublicEgressProxyUrl } from './capture/publicEgressProxy.js';

export async function captureBackup(baseUrl, dimensions, options = {}) {
  assertSafeDimensions(dimensions);
  const {
    waitTimeout,
    quality = 90,
    format = 'jpeg',
    maxBytes,
    strategy = 'auto',
    debugDir = null,
    debugName = 'capture',
    allowedHosts = [],
    policy: policyOverrides = {}
  } = options;

  const policy = resolveCapturePolicy({
    ...policyOverrides,
    ...(waitTimeout === undefined ? {} : { endFrameTimeoutMs: waitTimeout })
  });

  const log = logger.child({ module: 'captureBackup' });
  const startTime = Date.now();
  const captureDeadlineAt = startTime + policy.overallTimeoutMs;
  const browserErrors = [];
  const pool = getBrowserPool();
  const lease = await pool.acquire();
  const { browser } = lease;
  let context = null;
  let page = null;

  try {
    const proxyUrl = await getPublicEgressProxyUrl();
    const documentHostname = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
    context = await browser.newContext({
      viewport: { width: dimensions.width, height: dimensions.height },
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
      proxy: {
        server: proxyUrl,
        bypass: documentHostname
      }
    });
    await installNetworkPolicy(context, baseUrl, allowedHosts, null, true);
    page = await context.newPage();
    await installRiveStateSignal(page, policy.riveEndStateNames);

    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        browserErrors.push({
          type: message.type(),
          text: message.text().slice(0, 500),
          location: message.location()
        });
      }
    });

    page.on('pageerror', error => {
      browserErrors.push({
        type: 'pageerror',
        text: error.message.slice(0, 500),
        stack: error.stack ? error.stack.split('\n').slice(0, 5).join('\n').slice(0, 1000) : null
      });
    });
    let url = baseUrl;
    let creativeTimelineStart = Date.now();
    if (strategy === 'auto' || strategy === 'query') {
      url = baseUrl.includes('?') ? `${baseUrl}&backup=1` : `${baseUrl}?backup=1`;
    }

    page.setDefaultTimeout(policy.overallTimeoutMs);
    try {
      creativeTimelineStart = Date.now();
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: remainingBudget(captureDeadlineAt, policy.navigationTimeoutMs)
      });
      if (response && !response.ok()) throw new Error(`HTTP ${response.status()} ${response.statusText()}`);
    } catch (error) {
      log.error('Failed to load creative', {
        url: baseUrl,
        error: error.message,
        dimensions: `${dimensions.width}x${dimensions.height}`
      });
      metrics.increment('capture.load_error');
      throw new Error(`Failed to load creative URL ${url}: ${error.message}`);
    }
    await page.waitForLoadState('load', {
      timeout: remainingBudget(captureDeadlineAt, policy.loadStateTimeoutMs)
    }).catch(() => {});

    const endFrame = await resolveEndFrame(page, {
      strategy,
      creativeTimelineStart,
      captureDeadlineAt,
      policy,
      log
    });
    if (endFrame.stability) {
      metrics.increment('capture.visual_stability', { outcome: endFrame.stability.outcome });
      metrics.timing('capture.visual_stability_duration', endFrame.stability.duration);
    }

    log.stepSuccess(`Backup strategy: ${endFrame.strategy}`);
    metrics.increment('capture.strategy', { strategy: endFrame.strategy });
    const screenshotBuffer = await captureScreenshot(page, dimensions);
    const encoded = await encodeScreenshot(screenshotBuffer, { format, maxBytes, quality });
    log.stepSuccess('Screenshot captured');

    const duration = Date.now() - startTime;
    metrics.timing('capture.duration', duration, { strategy: endFrame.strategy });
    log.info('Capture complete', {
      duration,
      strategy: endFrame.strategy,
      outcome: endFrame.outcome,
      dimensions: `${dimensions.width}x${dimensions.height}`,
      browserErrors: browserErrors.length,
      format: encoded.format,
      byteLength: encoded.byteLength,
      withinSizeLimit: encoded.withinSizeLimit
    });

    if (browserErrors.length > 0) {
      log.warn('Browser errors during capture', { browserErrors: browserErrors.length });
      if (debugDir) await saveDebugArtifacts(page, debugDir, debugName, browserErrors);
    }

    return {
      ...encoded,
      strategy: endFrame.strategy,
      outcome: endFrame.outcome,
      duration,
      policy,
      browserErrors
    };
  } finally {
    if (context) {
      await context.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
      await context.close().catch(() => {});
    }
    pool.release(lease);
  }
}

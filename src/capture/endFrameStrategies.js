import sharp from 'sharp';
import { delay } from '../utils.js';

export const STRATEGIES = {
  QUERY_PARAM: 'Query parameter (?backup=1)',
  GENERATE_BACKUP_FRAME: 'window.generateBackupFrame()',
  RIVE_STATE: 'Rive end state',
  RIVE_INSTANCE_SCRUB: 'Rive instance scrub',
  HTML_VIDEO_LAST_FRAME: 'HTML video last frame',
  FALLBACK_TIMEOUT: 'Fallback timeout'
};

const VISUAL_SAMPLE_SIZE = 32;
const VISUAL_POLL_INTERVAL_MS = 250;
const VISUAL_STABLE_FOR_MS = 2000;
const VISUAL_PIXEL_DELTA_THRESHOLD = 1;

export async function installRiveStateSignal(page, stateNames) {
  await page.addInitScript(names => {
    const normalizedNames = new Set(names.map(name => name.trim().toLowerCase()));

    function stateNamesFromEvent(event) {
      const value = event?.data ?? event;
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') return [value];
      if (Array.isArray(value?.states)) return value.states;
      if (typeof value?.state === 'string') return [value.state];
      return [];
    }

    function wrapRiveConstructor(namespace) {
      if (!namespace || (typeof namespace !== 'object' && typeof namespace !== 'function')) return;
      let RiveConstructor = namespace.Rive;
      if (RiveConstructor?.__backupStateWrapped) return;

      function wrap(Constructor) {
        if (typeof Constructor !== 'function' || Constructor.__backupStateWrapped) return Constructor;
        const WrappedRive = function (...args) {
          const options = args[0];
          if (options && typeof options === 'object') {
            const creativeCallback = options.onStateChange;
            args[0] = {
              ...options,
              onStateChange(event) {
                const matched = stateNamesFromEvent(event).some(name =>
                  typeof name === 'string' && normalizedNames.has(name.trim().toLowerCase())
                );
                if (matched) window.__riveEndStateReached = true;
                if (typeof creativeCallback === 'function') {
                  return creativeCallback.apply(this, arguments);
                }
              }
            };
          }
          return Reflect.construct(Constructor, args, new.target || WrappedRive);
        };
        Object.setPrototypeOf(WrappedRive, Constructor);
        WrappedRive.prototype = Constructor.prototype;
        Object.defineProperty(WrappedRive, '__backupStateWrapped', { value: true });
        return WrappedRive;
      }

      try {
        Object.defineProperty(namespace, 'Rive', {
          configurable: true,
          enumerable: true,
          get: () => RiveConstructor,
          set: value => { RiveConstructor = wrap(value); }
        });
        if (RiveConstructor) namespace.Rive = RiveConstructor;
      } catch {
        if (RiveConstructor) namespace.Rive = wrap(RiveConstructor);
      }
    }

    let riveNamespace = window.rive;
    try {
      Object.defineProperty(window, 'rive', {
        configurable: true,
        enumerable: true,
        get: () => riveNamespace,
        set: value => {
          riveNamespace = value;
          wrapRiveConstructor(value);
        }
      });
      if (riveNamespace) wrapRiveConstructor(riveNamespace);
    } catch {
      if (riveNamespace) wrapRiveConstructor(riveNamespace);
    }
  }, stateNames);
}

export async function resolveEndFrame(page, options) {
  const { strategy, creativeTimelineStart, captureDeadlineAt, policy, log } = options;
  let ready = false;
  let usedStrategy = STRATEGIES.FALLBACK_TIMEOUT;
  let outcome = null;

  if (strategy === 'auto' || strategy === 'query') {
    ready = await checkBackupReady(page, policy.explicitReadyTimeoutMs);
    if (ready) {
      usedStrategy = STRATEGIES.QUERY_PARAM;
      outcome = 'explicit-ready';
    }
  }

  if (!ready && (strategy === 'auto' || strategy === 'generate')) {
    ready = await tryGenerateBackupFrame(page, policy.explicitReadyTimeoutMs);
    if (ready) {
      usedStrategy = STRATEGIES.GENERATE_BACKUP_FRAME;
      outcome = 'explicit-ready';
    }
  }

  if (!ready && strategy === 'auto') {
    ready = await checkRiveEndState(page, policy.riveStateTimeoutMs);
    if (ready) {
      usedStrategy = STRATEGIES.RIVE_STATE;
      outcome = 'rive-state';
    }
  }

  if (!ready) {
    const videoResult = await trySeekHtmlVideosToEnd(page, policy.videoSeekTimeoutMs);
    if (videoResult.found > 0 && videoResult.seeked === videoResult.found) {
      ready = true;
      usedStrategy = STRATEGIES.HTML_VIDEO_LAST_FRAME;
      outcome = 'video-seeked';
      log.step(`Moved ${videoResult.seeked} HTML video element(s) to their final decodable frame`);
    }
  }

  if (!ready && (strategy === 'auto' || strategy === 'scrub')) {
    ready = await tryRiveInstanceScrub(page, policy);
    if (ready) {
      usedStrategy = STRATEGIES.RIVE_INSTANCE_SCRUB;
      outcome = 'rive-scrubbed';
    }
  }

  if (!ready) {
    await waitForInitialCanvasContent(page, log);
    const deadlineAt = Math.min(
      creativeTimelineStart + policy.endFrameTimeoutMs,
      captureDeadlineAt
    );
    log.step(`Watching for visual stability (hard deadline ${policy.endFrameTimeoutMs}ms)...`);
    const stability = await waitForVisualStability(page, {
      deadlineAt,
      stableForMs: policy.visualStableForMs,
      pollIntervalMs: policy.visualPollIntervalMs,
      pixelDeltaThreshold: policy.visualPixelDeltaThreshold
    });
    log.step(`Visual stability: ${stability.outcome}, samples: ${stability.samples}, changes: ${stability.changes}`);
    outcome = stability.outcome;
    return { strategy: STRATEGIES.FALLBACK_TIMEOUT, outcome, stability };
  }

  return { strategy: usedStrategy, outcome, stability: null };
}

async function waitForInitialCanvasContent(page, log) {
  const hasCanvas = await page.evaluate(() => !!document.querySelector('canvas'));
  if (!hasCanvas) return;

  log.step('Waiting for content to load...');
  await page.evaluate(() => new Promise(resolve => {
    let attempts = 0;
    (function poll() {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        try {
          const context = canvas.getContext('2d');
          if (context) {
            const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 3; i < data.length; i += 4) {
              if (data[i] > 0) {
                resolve(true);
                return;
              }
            }
          }
        } catch {}
      }
      if (++attempts > 15) {
        resolve(false);
        return;
      }
      setTimeout(poll, 200);
    })();
  }));
}

export function visualSamplesDiffer(previous, current, threshold = VISUAL_PIXEL_DELTA_THRESHOLD) {
  if (!previous || !current || previous.length !== current.length) return true;
  let totalDelta = 0;
  for (let i = 0; i < previous.length; i++) {
    totalDelta += Math.abs(previous[i] - current[i]);
  }
  return totalDelta / previous.length > threshold;
}

async function sampleViewport(page) {
  const screenshot = await page.screenshot({ type: 'png' });
  return sharp(screenshot)
    .resize(VISUAL_SAMPLE_SIZE, VISUAL_SAMPLE_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
}

export async function waitForVisualStability(page, options = {}) {
  const {
    deadlineAt = Date.now() + 15000,
    stableForMs = VISUAL_STABLE_FOR_MS,
    pollIntervalMs = VISUAL_POLL_INTERVAL_MS,
    pixelDeltaThreshold = VISUAL_PIXEL_DELTA_THRESHOLD
  } = options;
  const startedAt = Date.now();
  let previous = null;
  let lastChangeAt = startedAt;
  let samples = 0;
  let changes = 0;

  while (Date.now() < deadlineAt) {
    const current = await sampleViewport(page);
    const sampledAt = Date.now();
    samples++;
    if (previous && visualSamplesDiffer(previous, current, pixelDeltaThreshold)) {
      changes++;
      lastChangeAt = sampledAt;
    }
    previous = current;
    if (sampledAt - lastChangeAt >= stableForMs) {
      return { outcome: 'settled', samples, changes, duration: sampledAt - startedAt };
    }
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(pollIntervalMs, remaining));
  }
  return { outcome: 'timeout', samples, changes, duration: Date.now() - startedAt };
}

async function checkBackupReady(page, timeoutMs = 1000) {
  try {
    return await page.waitForFunction(
      () => window.__backupReady === true || window.__BACKUP_READY__ === true,
      null,
      { timeout: timeoutMs }
    ).then(() => true);
  } catch {
    return false;
  }
}

async function checkRiveEndState(page, timeoutMs = 1000) {
  try {
    return await page.waitForFunction(
      () => window.__riveEndStateReached === true,
      null,
      { timeout: timeoutMs }
    ).then(() => true);
  } catch {
    return false;
  }
}

async function tryGenerateBackupFrame(page, timeoutMs) {
  try {
    const hasFunction = await page.evaluate(() => typeof window.generateBackupFrame === 'function');
    if (!hasFunction) return false;
    await page.evaluate(async () => {
      const result = window.generateBackupFrame();
      if (result && typeof result.then === 'function') await result;
      if (result === true) window.__backupReady = true;
    });
    return await checkBackupReady(page, timeoutMs);
  } catch {
    return false;
  }
}

async function tryRiveInstanceScrub(page, policy) {
  try {
    const hasRiveInstance = await page.evaluate(() =>
      window.riveInstance && typeof window.riveInstance.scrub === 'function'
    );
    if (!hasRiveInstance) return false;
    await page.evaluate(() => {
      try {
        const instance = window.riveInstance;
        instance.pause?.();
        instance.scrub?.(Number.MAX_SAFE_INTEGER);
        instance.play?.();
        window.__backupReady = true;
        window.__BACKUP_READY__ = true;
      } catch (error) {
        console.warn('Rive scrub failed:', error);
      }
    });
    await delay(policy.riveSettleMs);
    return await checkBackupReady(page, policy.explicitReadyTimeoutMs);
  } catch {
    return false;
  }
}

async function trySeekHtmlVideosToEnd(page, timeoutMs = 5000) {
  try {
    return await page.evaluate(async (seekTimeoutMs) => {
      const videos = Array.from(document.querySelectorAll('video'));
      async function waitForMetadata(video) {
        if (video.readyState > 0 && Number.isFinite(video.duration)) return true;
        return new Promise(resolve => {
          const finish = value => {
            clearTimeout(timer);
            video.removeEventListener('loadedmetadata', onMetadata);
            video.removeEventListener('error', onError);
            resolve(value);
          };
          const onMetadata = () => finish(Number.isFinite(video.duration));
          const onError = () => finish(false);
          const timer = setTimeout(() => finish(false), seekTimeoutMs);
          video.addEventListener('loadedmetadata', onMetadata, { once: true });
          video.addEventListener('error', onError, { once: true });
          video.load?.();
        });
      }
      async function seekVideo(video) {
        if (!(await waitForMetadata(video)) || video.duration <= 0) return false;
        video.pause();
        const endTime = Math.max(0, video.duration - Math.min(0.04, video.duration / 2));
        return new Promise(resolve => {
          const finish = value => {
            clearTimeout(timer);
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('error', onError);
            resolve(value);
          };
          const onSeeked = () => finish(true);
          const onError = () => finish(false);
          const timer = setTimeout(() => finish(false), seekTimeoutMs);
          video.addEventListener('seeked', onSeeked, { once: true });
          video.addEventListener('error', onError, { once: true });
          try { video.currentTime = endTime; } catch { finish(false); }
        });
      }
      const outcomes = await Promise.all(videos.map(seekVideo));
      if (outcomes.some(Boolean)) {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      return { found: videos.length, seeked: outcomes.filter(Boolean).length };
    }, timeoutMs);
  } catch {
    return { found: 0, seeked: 0 };
  }
}

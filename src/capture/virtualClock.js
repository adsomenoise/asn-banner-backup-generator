import { delay } from '../utils.js';

/**
 * Virtual-time fast-forward for HTML5 display banners (GSAP, Animate/CreateJS,
 * Motion, anime.js, plain JS/CSS).
 *
 * An init script takes over setTimeout/setInterval/requestAnimationFrame,
 * performance.now and Date before any banner script runs. Time flows normally
 * while the page loads (so the explicit backup-contract checks still work);
 * fastForwardToEnd() then advances time frame by frame, as fast as the page can
 * run, until the banner's animation is over.
 *
 * Why frame by frame: animation libraries cap how far one tick may advance
 * (GSAP lag smoothing at 500 ms, Motion ~40 ms, Animate/CreateJS one frame per
 * tick), so large time jumps silently leave them mid-animation.
 *
 * Why not Playwright's page.clock: it yields a real setTimeout after every
 * timer, which Chrome clamps to >= 4 ms, i.e. ~5 ms per frame (a 30 s timeline
 * costs ~9 s). This script yields through MessageChannel instead.
 */
export async function installVirtualClock(page) {
  await page.addInitScript(virtualClockScript);
}

function virtualClockScript() {
  if (window.__bbgVirtualClock) return;
  const realRaf = window.requestAnimationFrame.bind(window);
  const realSetTimeout = window.setTimeout.bind(window);
  const realPerfNow = performance.now.bind(performance);
  const RealDate = window.Date;
  const epoch = RealDate.now() - realPerfNow();

  let virtual = false;
  let vnow = 0;
  let offset = 0; // virtual time gained over real time, kept when resuming real time
  const now = () => (virtual ? vnow : realPerfNow() + offset);

  let nextId = 1;
  const timers = new Map();
  let frames = new Map();

  function addTimer(fn, delayMs, args, repeat) {
    const id = nextId++;
    const ms = Math.max(0, Number(delayMs) || 0);
    timers.set(id, { at: now() + ms, fn, args, interval: repeat ? Math.max(1, ms) : 0, seq: id });
    return id;
  }

  function takeDue(limit) {
    let dueId = 0;
    let due = null;
    for (const [id, timer] of timers) {
      if (timer.at > limit) continue;
      if (!due || timer.at < due.at || (timer.at === due.at && timer.seq < due.seq)) {
        due = timer;
        dueId = id;
      }
    }
    if (!due) return null;
    if (due.interval) {
      due.at += due.interval;
      due.seq = nextId++;
    } else {
      timers.delete(dueId);
    }
    return due;
  }

  function report(error) {
    realSetTimeout(() => { throw error; });
  }

  function fire(timer) {
    try {
      if (typeof timer.fn === 'function') timer.fn(...(timer.args || []));
      else (0, eval)(String(timer.fn));
    } catch (error) {
      report(error);
    }
  }

  function runFrame(timestamp) {
    const callbacks = frames;
    frames = new Map();
    for (const callback of callbacks.values()) {
      try { callback(timestamp); } catch (error) { report(error); }
    }
  }

  window.setTimeout = (fn, delayMs, ...args) => addTimer(fn, delayMs, args, false);
  window.setInterval = (fn, delayMs, ...args) => addTimer(fn, delayMs, args, true);
  window.clearTimeout = id => { timers.delete(id); };
  window.clearInterval = id => { timers.delete(id); };
  window.requestAnimationFrame = callback => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = id => { frames.delete(id); };
  performance.now = now;

  class VirtualDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(epoch + now());
    }
    static now() { return epoch + now(); }
  }
  window.Date = VirtualDate;

  // Real-time mode: drive our timers and frames from the browser's own frames.
  function pump() {
    if (virtual) return;
    const current = now();
    let timer;
    while ((timer = takeDue(current))) fire(timer);
    runFrame(now());
    realRaf(pump);
  }
  realRaf(pump);

  // MessageChannel tasks are not clamped like nested setTimeout, but still let
  // promise chains and event callbacks run between frames.
  const channel = new MessageChannel();
  const waiting = [];
  channel.port1.onmessage = () => waiting.shift()?.();
  const yieldToPage = () => new Promise(resolve => {
    waiting.push(resolve);
    channel.port2.postMessage(0);
  });

  // CSS animations/transitions and WAAPI (incl. Motion) run on the document
  // timeline, not on our clock. While in virtual time we hold them paused and
  // move them forward with every virtual frame, so they stay in step with JS
  // timelines (including ones a later scene starts).
  const held = new Set();
  function advanceDocumentAnimations(deltaMs) {
    for (const animation of document.getAnimations()) {
      const state = animation.playState;
      if (state === 'running') {
        animation.pause();
        held.add(animation);
      } else if (!(state === 'paused' && held.has(animation))) {
        continue; // finished, idle, or paused by the banner itself
      }
      const next = (Number(animation.currentTime) || 0) + deltaMs * (animation.playbackRate || 1);
      const end = animation.effect?.getComputedTiming().endTime;
      if (Number.isFinite(end) && next >= end) {
        // A paused animation never reports "finished"; finish it so `finished`
        // promises and animationend handlers fire (Motion chains wait on them).
        held.delete(animation);
        animation.finish();
      } else {
        animation.currentTime = next;
      }
    }
  }

  // The explicit backup contract still wins: stop the moment the banner says it is ready.
  const contractReady = () => window.__backupReady === true || window.__BACKUP_READY__ === true;

  window.__bbgVirtualClock = {
    async advance(ms, frameMs = 1000 / 60) {
      if (!virtual) {
        vnow = now();
        virtual = true;
      }
      const end = vnow + ms;
      while (vnow < end && !contractReady()) {
        const frameStart = vnow;
        const frameEnd = Math.min(vnow + frameMs, end);
        let timer;
        while ((timer = takeDue(frameEnd))) {
          vnow = Math.max(vnow, timer.at);
          fire(timer);
          await Promise.resolve();
        }
        const delta = frameEnd - frameStart;
        vnow = frameEnd;
        runFrame(vnow);
        advanceDocumentAnimations(delta);
        await yieldToPage();
      }
      return contractReady();
    },
    resume() {
      if (!virtual) return;
      offset = vnow - realPerfNow();
      virtual = false;
      for (const animation of held) {
        if (animation.playState === 'paused') animation.play();
      }
      held.clear();
      realRaf(pump);
    }
  };
}

function finishDocumentAnimations() {
  let finished = 0;
  for (const animation of document.getAnimations()) {
    if (animation.playState === 'finished') continue;
    const end = animation.effect?.getComputedTiming().endTime;
    if (Number.isFinite(end)) {
      animation.finish();
      finished++;
    }
  }
  return finished;
}

async function inEveryFrame(page, fn, arg) {
  const results = await Promise.all(page.frames().map(frame =>
    frame.evaluate(fn, arg).catch(() => null)
  ));
  return results.filter(result => result !== null);
}

/** Advances every frame's clock; true when the banner signalled the backup contract. */
async function advanceAll(page, ms) {
  const ready = await inEveryFrame(page, value => window.__bbgVirtualClock?.advance(value) ?? null, ms);
  return ready.some(Boolean);
}

// Uneven offsets (in 60fps frames) so a looping animation cannot line up with
// every sample by accident, as it could with a single 1 s comparison.
const VERIFY_OFFSETS_FRAMES = [7, 23, 61];

/** Tracks in-flight requests so fast-forwarding can wait for a quiet network. */
export function trackNetwork(page) {
  const inflight = new Set();
  const add = request => inflight.add(request);
  const remove = request => inflight.delete(request);
  page.on('request', add);
  page.on('requestfinished', remove);
  page.on('requestfailed', remove);
  return {
    get pending() { return inflight.size; },
    dispose() {
      page.off('request', add);
      page.off('requestfinished', remove);
      page.off('requestfailed', remove);
    }
  };
}

export async function waitForNetworkQuiet(network, { quietMs, timeoutMs }) {
  const startedAt = Date.now();
  let quietSince = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (network.pending > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= quietMs) return true;
    await delay(25);
  }
  return false;
}

/**
 * Advance virtual time until the banner's animation is over, then check that
 * it has really stopped.
 *
 * @param {import('playwright').Page} page
 * @param {object} options
 * @param {object} options.network   trackNetwork() handle
 * @param {number} options.deadlineAt  real-time deadline (ms epoch)
 * @param {object} options.policy    capture policy (fastForward* / networkQuiet*)
 * @param {(page) => Promise<Buffer>} options.sample  small raw viewport sample
 * @param {(a: Buffer, b: Buffer) => boolean} options.differ
 * @returns {Promise<{ outcome: 'settled'|'explicit-ready'|'still-moving'|'unavailable'|'timeout', virtualMs: number, duration: number }>}
 */
export async function fastForwardToEnd(page, { network, deadlineAt, policy, sample, differ }) {
  const startedAt = Date.now();
  const result = outcome => ({ outcome, virtualMs, duration: Date.now() - startedAt });
  let virtualMs = 0;

  const installed = await page.evaluate(() => Boolean(window.__bbgVirtualClock)).catch(() => false);
  if (!installed) return result('unavailable');

  const quiet = { quietMs: policy.networkQuietMs, timeoutMs: policy.networkQuietTimeoutMs };
  await waitForNetworkQuiet(network, quiet);

  // Chunked so assets a later scene requests can arrive before we move past it.
  while (virtualMs < policy.fastForwardMs) {
    if (Date.now() >= deadlineAt) return result('timeout');
    const chunk = Math.min(policy.fastForwardChunkMs, policy.fastForwardMs - virtualMs);
    const ready = await advanceAll(page, chunk);
    virtualMs += chunk;
    if (ready) return result('explicit-ready');
    if (network.pending > 0) await waitForNetworkQuiet(network, quiet);
  }

  // Safety net: document animations normally advance with each virtual frame
  // (see advanceDocumentAnimations); jump anything finite that is left to its
  // end. Repeat for scenes that start when a previous animation finishes.
  for (let i = 0; i < 5; i++) {
    const finished = (await inEveryFrame(page, finishDocumentAnimations)).reduce((sum, n) => sum + n, 0);
    if (finished === 0) break;
    await advanceAll(page, 50);
  }

  // A few frames so libraries commit final styles, then verify nothing moves.
  await advanceAll(page, 200);
  virtualMs += 250;
  let previous = await sample(page);
  for (const frames of VERIFY_OFFSETS_FRAMES) {
    const ms = frames * 1000 / 60;
    await advanceAll(page, ms);
    virtualMs += ms;
    const current = await sample(page);
    if (differ(previous, current)) return result('still-moving');
    previous = current;
  }
  return result('settled');
}

/** Hand the page back to real time (used before falling back to visual stability). */
export async function resumeRealTime(page) {
  await inEveryFrame(page, () => { window.__bbgVirtualClock?.resume(); return true; });
}

import { chromium } from 'playwright';
import { getCaptureConcurrency } from './config.js';

export class BrowserPool {
  constructor({ max = getCaptureConcurrency(), launch = launchChromium } = {}) {
    this.max = Math.max(1, max);
    this.launch = launch;
    this.idle = [];
    this.total = 0;
    this.waiting = [];
    this.tracked = new Set();
    this.closed = false;
  }

  async acquire() {
    if (this.closed) {
      throw new Error('Browser pool is closed');
    }

    while (this.idle.length > 0) {
      const browser = this.idle.pop();
      if (isBrowserConnected(browser)) return { browser };
      this.#discard(browser);
      browser.close().catch(() => {});
    }

    if (this.total < this.max) {
      this.total++;
      try {
        const browser = await this.launch();
        this.#track(browser);
        return { browser };
      } catch (err) {
        this.total--;
        this.#drainWaiters();
        throw err;
      }
    }

    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
    });
  }

  release(lease) {
    if (!lease?.browser) return;

    if (this.closed || !isBrowserConnected(lease.browser)) {
      this.#discard(lease.browser);
      lease.browser.close().catch(() => {});
      return;
    }

    const waiter = this.waiting.shift();
    if (waiter) {
      waiter.resolve({ browser: lease.browser });
      return;
    }

    this.idle.push(lease.browser);
  }

  async close() {
    this.closed = true;
    const idle = this.idle.splice(0);

    for (const waiter of this.waiting.splice(0)) {
      waiter.reject(new Error('Browser pool is closed'));
    }

    for (const browser of idle) this.#discard(browser);
    await Promise.all(idle.map(browser => browser.close().catch(() => {})));
  }

  #drainWaiters() {
    if (this.closed || this.waiting.length === 0 || this.total >= this.max) return;
    const waiter = this.waiting.shift();
    this.total++;
    this.launch()
      .then(browser => {
        this.#track(browser);
        waiter.resolve({ browser });
      })
      .catch(err => {
        this.total--;
        waiter.reject(err);
        this.#drainWaiters();
      });
  }

  #track(browser) {
    this.tracked.add(browser);
    if (typeof browser?.on === 'function') {
      browser.on('disconnected', () => this.#discard(browser));
    }
  }

  #discard(browser) {
    if (!this.tracked.delete(browser)) return;
    const idleIndex = this.idle.indexOf(browser);
    if (idleIndex >= 0) this.idle.splice(idleIndex, 1);
    this.total = Math.max(0, this.total - 1);
    this.#drainWaiters();
  }
}

function isBrowserConnected(browser) {
  return typeof browser?.isConnected !== 'function' || browser.isConnected();
}

async function launchChromium() {
  return chromium.launch({
    headless: true
  });
}

let sharedPool = null;

export function getBrowserPool(options = {}) {
  if (!sharedPool) {
    sharedPool = new BrowserPool(options);
  }
  return sharedPool;
}

export async function closeBrowserPool() {
  if (!sharedPool) return;
  const pool = sharedPool;
  sharedPool = null;
  await pool.close();
}

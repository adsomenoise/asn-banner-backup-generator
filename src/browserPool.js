import { chromium } from 'playwright';
import { getCaptureConcurrency } from './config.js';

export class BrowserPool {
  constructor({ max = getCaptureConcurrency(), launch = launchChromium } = {}) {
    this.max = Math.max(1, max);
    this.launch = launch;
    this.idle = [];
    this.total = 0;
    this.waiting = [];
    this.closed = false;
  }

  async acquire() {
    if (this.closed) {
      throw new Error('Browser pool is closed');
    }

    const browser = this.idle.pop();
    if (browser) {
      return { browser };
    }

    if (this.total < this.max) {
      this.total++;
      try {
        return { browser: await this.launch() };
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

    if (this.closed) {
      this.total--;
      lease.browser.close().catch(() => {});
      this.#drainWaiters();
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
    this.total -= idle.length;

    for (const waiter of this.waiting.splice(0)) {
      waiter.reject(new Error('Browser pool is closed'));
    }

    await Promise.all(idle.map(browser => browser.close().catch(() => {})));
  }

  #drainWaiters() {
    if (this.closed || this.waiting.length === 0 || this.total >= this.max) return;
    const waiter = this.waiting.shift();
    this.total++;
    this.launch()
      .then(browser => waiter.resolve({ browser }))
      .catch(err => {
        this.total--;
        waiter.reject(err);
        this.#drainWaiters();
      });
  }
}

async function launchChromium() {
  return chromium.launch({
    headless: true,
    args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
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

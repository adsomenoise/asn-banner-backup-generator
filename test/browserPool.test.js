import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BrowserPool } from '../src/browserPool.js';

describe('BrowserPool', () => {
  it('reuses a launched browser after release', async () => {
    let launches = 0;
    const launched = [];
    const pool = new BrowserPool({
      max: 1,
      launch: async () => {
        const browser = {
          id: ++launches,
          closed: false,
          close: async () => { browser.closed = true; }
        };
        launched.push(browser);
        return browser;
      }
    });

    const first = await pool.acquire();
    pool.release(first);
    const second = await pool.acquire();
    pool.release(second);

    assert.strictEqual(launches, 1);
    assert.strictEqual(first.browser, second.browser);
    await pool.close();
    assert.strictEqual(launched[0].closed, true);
  });

  it('waits for a browser when the pool is at capacity', async () => {
    const pool = new BrowserPool({
      max: 1,
      launch: async () => ({ close: async () => {} })
    });

    const first = await pool.acquire();
    let resolved = false;
    const pending = pool.acquire().then(lease => {
      resolved = true;
      return lease;
    });

    await new Promise(resolve => setTimeout(resolve, 10));
    assert.strictEqual(resolved, false);

    pool.release(first);
    const second = await pending;
    assert.strictEqual(resolved, true);
    pool.release(second);
    await pool.close();
  });
});

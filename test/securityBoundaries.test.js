import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AdmissionController, AdmissionRejectedError } from '../src/admissionController.js';
import { createSessionToken, verifySessionToken } from '../src/auth/adapter.js';
import { isRequestAllowed } from '../src/capture/networkPolicy.js';
import { assertSafeDimensions } from '../src/utils.js';
import { assertVideoDimensions } from '../src/captureVideo.js';

describe('signed authentication sessions', () => {
  const identity = { userId: 'alice', tenantId: 'acme', clientId: 'brand' };

  it('accepts an intact, unexpired session', () => {
    const token = createSessionToken(identity, 'test-secret', { ttlMs: 1000 });
    assert.deepStrictEqual(verifySessionToken(token, 'test-secret'), identity);
  });

  it('rejects tampering, the wrong secret, and expiration', () => {
    const token = createSessionToken(identity, 'test-secret', { ttlMs: 1000 });
    assert.strictEqual(verifySessionToken(`${token}x`, 'test-secret'), null);
    assert.strictEqual(verifySessionToken(token, 'wrong-secret'), null);
    assert.strictEqual(verifySessionToken(token, 'test-secret', Date.now() + 2000), null);
  });
});

describe('workload admission', () => {
  it('enforces both global and per-tenant concurrency', async () => {
    const admission = new AdmissionController({ maxGlobal: 2, maxPerTenant: 1, maxQueued: 2 });
    const first = await admission.acquire('tenant-a');
    let sameTenantStarted = false;
    const sameTenant = admission.acquire('tenant-a').then(lease => {
      sameTenantStarted = true;
      return lease;
    });
    const otherTenant = await admission.acquire('tenant-b');
    assert.strictEqual(sameTenantStarted, false);
    first.release();
    const queuedLease = await sameTenant;
    queuedLease.release();
    otherTenant.release();
  });

  it('rejects work when the bounded queue is full', async () => {
    const admission = new AdmissionController({ maxGlobal: 1, maxPerTenant: 1, maxQueued: 1 });
    const active = await admission.acquire('tenant-a');
    const queued = admission.acquire('tenant-b');
    await assert.rejects(() => admission.acquire('tenant-c'), AdmissionRejectedError);
    active.release();
    (await queued).release();
  });
});

describe('renderer network policy', () => {
  const documentUrl = 'http://localhost:3002/job/index.html';

  it('allows only the creative origin and explicit host allowlist', () => {
    assert.strictEqual(isRequestAllowed('http://localhost:3002/job/app.js', documentUrl), true);
    assert.strictEqual(isRequestAllowed('https://s0.2mdn.net/runtime.js', documentUrl, ['s0.2mdn.net']), true);
    assert.strictEqual(isRequestAllowed('http://127.0.0.1:8080/admin', documentUrl), false);
    assert.strictEqual(isRequestAllowed('http://169.254.169.254/latest/meta-data', documentUrl), false);
    assert.strictEqual(isRequestAllowed('https://example.com/tracker', documentUrl), false);
  });

  it('confines file rendering to its extracted root', () => {
    const fileDocument = 'file:///tmp/job/index.html';
    const root = 'file:///tmp/job/';
    assert.strictEqual(isRequestAllowed('file:///tmp/job/assets/image.png', fileDocument, [], root), true);
    assert.strictEqual(isRequestAllowed('file:///etc/passwd', fileDocument, [], root), false);
  });
});

describe('allocation limits', () => {
  it('rejects unsafe browser and video dimensions', () => {
    assert.throws(() => assertSafeDimensions({ width: 9999, height: 9999 }), /safe rendering limit/);
    assert.throws(() => assertVideoDimensions({ width: 8192, height: 8192 }), /safe decode limit/);
    assert.deepStrictEqual(assertSafeDimensions({ width: 1920, height: 1080 }), { width: 1920, height: 1080 });
    assert.deepStrictEqual(assertVideoDimensions({ width: 3840, height: 2160 }), { width: 3840, height: 2160 });
  });
});

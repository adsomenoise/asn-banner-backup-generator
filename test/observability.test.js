import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import fs from 'fs-extra';
import { logger } from '../src/logger.js';
import { metrics } from '../src/metrics.js';
import { startWebServer } from '../src/webServer.js';

function fetch(method, url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: opts.headers || {}
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, body: body ? JSON.parse(body) : null });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// -----------------------------------------------------------------------
// Logger tests
// -----------------------------------------------------------------------

describe('Logger', () => {
  it('creates a child logger with merged context', () => {
    const child = logger.child({ module: 'test', jobId: 'j123' });
    assert.ok(child);
    assert.strictEqual(typeof child.info, 'function');
    assert.strictEqual(typeof child.warn, 'function');
    assert.strictEqual(typeof child.error, 'function');
    assert.strictEqual(typeof child.debug, 'function');
  });

  it('child logger inherits and extends parent context', () => {
    const parent = logger.child({ module: 'parent' });
    const child = parent.child({ jobId: 'j456', userId: 'user1' });
    // Should not throw
    child.info('test message', { fileId: 'f1' });
    child.warn('test warning', { code: 'TEST' });
    child.error('test error', { error: 'something broke' });
  });

  it('step methods do not throw', () => {
    const log = logger.child({ module: 'test' });
    log.step('step message');
    log.stepSuccess('success step');
    log.stepError('error step');
    log.saved('/tmp/test.jpg');
    log.banner('test banner');
    log.continue();
  });

  it('handles empty meta gracefully', () => {
    const log = logger.child({ module: 'test' });
    log.info('no meta');
    log.info('with meta', { key: 'value' });
  });

  it('tolerates undefined meta values', () => {
    const log = logger.child({ module: 'test' });
    log.info('undefined val test', { userId: undefined, tenantId: null });
  });
});

// -----------------------------------------------------------------------
// Metrics tests
// -----------------------------------------------------------------------

describe('Metrics', () => {
  beforeEach(() => {
    metrics.reset();
  });

  it('increment increases counter', () => {
    metrics.increment('test.counter');
    const snap = metrics.snapshot();
    assert.strictEqual(snap.counters['test.counter'], 1);
  });

  it('increment with tags creates tagged keys', () => {
    metrics.increment('test.op', { type: 'zip' });
    const snap = metrics.snapshot();
    assert.ok(snap.counters['test.op|type=zip']);
    assert.strictEqual(snap.counters['test.op|type=zip'], 1);
  });

  it('count adds specified value', () => {
    metrics.count('test.bytes', 1024);
    const snap = metrics.snapshot();
    assert.strictEqual(snap.counters['test.bytes'], 1024);
  });

  it('timing records durations', () => {
    metrics.timing('test.op', 150);
    metrics.timing('test.op', 250);
    const snap = metrics.snapshot();
    const t = snap.timings['test.op'];
    assert.ok(t);
    assert.strictEqual(t.count, 2);
    assert.strictEqual(t.min, 150);
    assert.strictEqual(t.max, 250);
    assert.strictEqual(t.avg, 200);
  });

  it('timing with tags is isolated', () => {
    metrics.timing('test.duration', 100, { type: 'riv' });
    metrics.timing('test.duration', 200, { type: 'zip' });
    const snap = metrics.snapshot();
    assert.ok(snap.timings['test.duration|type=riv']);
    assert.ok(snap.timings['test.duration|type=zip']);
  });

  it('startTimer and endTimer record duration', () => {
    const start = metrics.startTimer();
    const elapsed = metrics.endTimer('test.timer', start);
    assert.ok(elapsed >= 0);
    const snap = metrics.snapshot();
    assert.ok(snap.timings['test.timer']);
    assert.strictEqual(snap.timings['test.timer'].count, 1);
  });

  it('reset clears all data', () => {
    metrics.increment('a');
    metrics.timing('b', 100);
    metrics.reset();
    const snap = metrics.snapshot();
    assert.strictEqual(Object.keys(snap.counters).length, 0);
    assert.strictEqual(Object.keys(snap.timings).length, 0);
  });

  it('snapshot is a plain object', () => {
    metrics.increment('x');
    metrics.timing('y', 50);
    const snap = metrics.snapshot();
    assert.ok(typeof snap.counters === 'object');
    assert.ok(typeof snap.timings === 'object');
  });

  it('percentile computation is correct', () => {
    for (let i = 1; i <= 100; i++) metrics.timing('test.pct', i);
    const snap = metrics.snapshot();
    const t = snap.timings['test.pct'];
    assert.strictEqual(t.p50, 50);
    assert.strictEqual(t.p95, 95);
    assert.strictEqual(t.p99, 99);
  });
});

// -----------------------------------------------------------------------
// Health endpoint includes metrics
// -----------------------------------------------------------------------

describe('Health endpoint metrics', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = await startWebServer(0);
    const addr = server.address();
    baseUrl = `http://localhost:${addr.port}/api/v1`;
  });

  after(async () => {
    if (server) await new Promise(r => server.close(r));
  });

  it('health returns counters and timings', async () => {
    const res = await fetch('GET', `${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.metrics);
    assert.ok(typeof res.body.metrics.counters === 'object');
    assert.ok(typeof res.body.metrics.timings === 'object');
  });

  it('health counters reflect activity', async () => {
    // Do a no-files upload to trigger a metric
    const mp = createMultipartBody({}, []);
    await fetch('POST', `${baseUrl}/jobs`, {
      headers: { 'x-auth-user-id': 'health-test', ...mp.headers }, body: mp.body
    });
    const res = await fetch('GET', `${baseUrl}/health`);
    const uploadRejected = Object.keys(res.body.metrics.counters)
      .find(k => k.startsWith('upload.rejected'));
    assert.ok(uploadRejected, 'Expected upload.rejected counter to exist');
  });
});

function createMultipartBody(fields, files) {
  const boundary = '----TestBoundary' + Math.random().toString(36).slice(2);
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  for (const file of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.mime || 'application/octet-stream'}\r\n\r\n`));
    parts.push(Buffer.from(file.content, 'binary'));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
  };
}

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import http from 'node:http';
import fs from 'fs-extra';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { startWebServer } from '../src/webServer.js';
import { generateRiveHTML } from '../src/riveTemplate.js';

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
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body ? JSON.parse(body) : null
        });
      });
    });

    req.on('error', reject);

    if (opts.body) {
      if (Buffer.isBuffer(opts.body)) {
        req.write(opts.body);
      } else {
        req.write(opts.body);
      }
    }

    req.end();
  });
}

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

// -----------------------------------------------------------------------
// Template escaping (pure unit tests, no server needed)
// -----------------------------------------------------------------------

describe('Template HTML escaping', () => {
  it('escapes HTML in jsFileName for the title', () => {
    const html = generateRiveHTML('<script>alert(1)</script>.js', 300, 250);
    const match = html.match(/<title>(.*?)<\/title>/);
    assert.ok(match);
    assert.ok(match[1].includes('&lt;script&gt;'));
    assert.ok(!match[1].includes('<script>'));
  });

  it('escapes quotes in jsFileName for JS string literal', () => {
    const html = generateRiveHTML("file'name.js", 300, 250);
    assert.ok(html.includes("file\\'name.js"));
  });

  it('escapes backslashes in jsFileName', () => {
    const html = generateRiveHTML('file\\name.js', 300, 250);
    assert.ok(html.includes('file\\\\name.js'));
  });

  it('handles normal filenames without issues', () => {
    const html = generateRiveHTML('Banner_300x250.js', 300, 250);
    assert.ok(html.includes('Banner_300x250'));
  });
});

// -----------------------------------------------------------------------
// HTTP-level security tests (need a web server)
// -----------------------------------------------------------------------

describe('HTTP security', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = await startWebServer(0, { corsOrigin: 'https://example.com' });
    const addr = server.address();
    baseUrl = `http://localhost:${addr.port}`;
  });

  after(async () => {
    if (server) await new Promise(r => server.close(r));
  });

  describe('security headers', () => {
    let headers;

    before(async () => {
      const res = await fetch('GET', `${baseUrl}/api/v1/health`);
      headers = res.headers;
    });

    it('sets X-Content-Type-Options: nosniff', () => {
      assert.strictEqual(headers['x-content-type-options'], 'nosniff');
    });

    it('sets X-Frame-Options: DENY', () => {
      assert.strictEqual(headers['x-frame-options'], 'DENY');
    });

    it('sets X-XSS-Protection: 0', () => {
      assert.strictEqual(headers['x-xss-protection'], '0');
    });

    it('sets Referrer-Policy: no-referrer', () => {
      assert.strictEqual(headers['referrer-policy'], 'no-referrer');
    });
  });

  describe('CORS', () => {
    it('reflects configured origin', async () => {
      const res = await fetch('GET', `${baseUrl}/api/v1/health`, {
        headers: { Origin: 'https://example.com' }
      });
      assert.strictEqual(res.headers['access-control-allow-origin'], 'https://example.com');
    });

    it('allows GET and POST', async () => {
      const res = await fetch('GET', `${baseUrl}/api/v1/health`);
      const methods = res.headers['access-control-allow-methods'];
      assert.ok(methods.includes('GET'));
      assert.ok(methods.includes('POST'));
    });
  });

  describe('ZIP magic-byte validation', () => {
    it('rejects upload with invalid ZIP magic bytes', async () => {
      const mp = createMultipartBody({}, [{
        name: 'fake.zip',
        content: 'not a zip file at all',
        mime: 'application/zip'
      }]);
      const res = await fetch('POST', `${baseUrl}/api/v1/jobs`, {
        headers: {
          ...mp.headers,
          'x-auth-user-id': 'test-user'
        },
        body: mp.body
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.code, 'INVALID_FILE_TYPE');
    });

    it('accepts upload with valid ZIP magic bytes', async () => {
      const mp = createMultipartBody({}, [{
        name: 'valid.zip',
        content: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).toString('binary'),
        mime: 'application/zip'
      }]);
      const res = await fetch('POST', `${baseUrl}/api/v1/jobs`, {
        headers: {
          ...mp.headers,
          'x-auth-user-id': 'test-user'
        },
        body: mp.body
      });
      assert.strictEqual(res.status, 201);
    });
  });
});

// -----------------------------------------------------------------------
// Rate limiting (separate server with strict limit)
// -----------------------------------------------------------------------

describe('Rate limiting', () => {
  let server;
  let url;

  before(async () => {
    server = await startWebServer(0, { rateLimitMax: 2 });
    const addr = server.address();
    url = `http://localhost:${addr.port}`;
  });

  after(async () => {
    if (server) await new Promise(r => server.close(r));
  });

  it('allows requests under the limit', async () => {
    const res = await fetch('POST', `${url}/api/v1/jobs`, {
      headers: { 'x-auth-user-id': 'rate-test-1', 'content-type': 'application/json' },
      body: '[]'
    });
    assert.notStrictEqual(res.status, 429);
  });

  it('blocks requests over the limit', async () => {
    await fetch('POST', `${url}/api/v1/jobs`, {
      headers: { 'x-auth-user-id': 'rate-test-2', 'content-type': 'application/json' },
      body: '[]'
    });
    await fetch('POST', `${url}/api/v1/jobs`, {
      headers: { 'x-auth-user-id': 'rate-test-2', 'content-type': 'application/json' },
      body: '[]'
    });
    const third = await fetch('POST', `${url}/api/v1/jobs`, {
      headers: { 'x-auth-user-id': 'rate-test-2', 'content-type': 'application/json' },
      body: '[]'
    });
    assert.strictEqual(third.status, 429);
    assert.strictEqual(third.body.code, 'RATE_LIMITED');
  });
});

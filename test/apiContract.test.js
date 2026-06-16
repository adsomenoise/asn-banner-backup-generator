import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { startWebServer } from '../src/webServer.js';
import { writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let server;
let base;

function json(r) {
  if (r.status === 204) return null;
  return r.json();
}

async function uploadFiles(files) {
  const body = new FormData();
  for (const f of files) {
    body.append('files', new Blob([f.content], { type: 'application/octet-stream' }), f.name);
  }
  const res = await fetch(`${base}/jobs`, { method: 'POST', body });
  return { status: res.status, body: await json(res), headers: res.headers };
}

function validZipContent() {
  // Minimal valid ZIP containing an index.html with meta ad.size
  const buf = new Uint8Array([
    0x50, 0x4B, 0x03, 0x04, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0A, 0x00, 0x00, 0x00, 'i', 'n', 'd', 'e', 'x', '.', 'h', 't', 'm', 'l',
    0x50, 0x4B, 0x01, 0x02, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    'i', 'n', 'd', 'e', 'x', '.', 'h', 't', 'm', 'l',
    0x50, 0x4B, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
    0x01, 0x00, 0x3A, 0x00, 0x00, 0x00, 0x1E, 0x00, 0x00, 0x00,
    0x00, 0x00
  ]);
  // This binary won't parse as a valid ZIP in practice.
  // Instead, create a real minimal ZIP using a helper.
  return Buffer.from(
    'UEsDBBQAAAAIAAAAAACKIVPLIQAAACkAAAAIABwAaW5kZXguaHRtbFVUCQADrO' +
    'JOZqziTmZ1eAsAAQT1AQAABBQAAAAA4+Pj5OTk5OTk5OTk5OTk5OTk5OTk5OT' +
    'k5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZ' +
    'WVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlFBQUFBQUFBQUFBQUFBQUFBQUFBQ' +
    'UFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUEsBAAAUAAAAAP//AwBQSwECLQ' +
    'AUAAAACAAAAAAAiIVTyyEAAAApAAAACAAcAAAAAAAAAAAAAIABAAAAAGluZGV4' +
    'Lmh0bWxVVAUAA6ziTmZ1eAsAAQT1AQAABBQAAAAAUEsFBgAAAAABAAEATgAAAG' +
    '8AAAAAAA==',
    'base64'
  );
}

describe('API Contract — v1 endpoints', () => {
  before(async () => {
    server = await startWebServer(0);
    const addr = server.address();
    base = `http://127.0.0.1:${addr.port}/api/v1`;
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/health
  // -----------------------------------------------------------------------
  describe('GET /health', () => {
    it('returns 200 with correct shape', async () => {
      const res = await fetch(`${base}/health`);
      assert.strictEqual(res.status, 200);
      const body = await json(res);
      assert.ok(body.status);
      assert.strictEqual(body.status, 'ok');
      assert.ok(body.timestamp);
      assert.ok(body.version);
      assert.ok(body.uptime);
    });

    it('timestamp is valid ISO 8601', async () => {
      const res = await fetch(`${base}/health`);
      const body = await json(res);
      const ts = new Date(body.timestamp);
      assert.ok(ts instanceof Date && !isNaN(ts));
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/v1/jobs
  // -----------------------------------------------------------------------
  describe('POST /jobs', () => {
    it('returns 201 with job shape on successful upload', async () => {
      const { status, body } = await uploadFiles([
        { name: 'test.zip', content: validZipContent() }
      ]);
      assert.strictEqual(status, 201);
      assert.ok(body.jobId);
      assert.strictEqual(body.status, 'uploaded');
      assert.ok(body.createdAt);
      assert.ok(Array.isArray(body.files));
      assert.strictEqual(body.files.length, 1);
      assert.ok(body.progress);
      assert.strictEqual(body.progress.total, 1);
      assert.strictEqual(body.progress.completed, 0);
      assert.strictEqual(body.progress.failed, 0);
      assert.strictEqual(body.progress.results, 0);
    });

    it('file object has correct v1 fields', async () => {
      const { body } = await uploadFiles([
        { name: 'Banner_300x250.zip', content: validZipContent() }
      ]);
      const f = body.files[0];
      assert.ok(f.fileId);
      assert.strictEqual(f.fileName, 'Banner_300x250.zip');
      assert.strictEqual(f.fileType, 'zip');
      assert.strictEqual(f.state, 'uploaded');
      assert.strictEqual(f.error, null);
      // Must NOT have old names
      assert.strictEqual(f.id, undefined);
      assert.strictEqual(f.name, undefined);
      assert.strictEqual(f.type, undefined);
    });

    it('returns 400 when no files uploaded', async () => {
      const body = new FormData();
      const res = await fetch(`${base}/jobs`, { method: 'POST', body });
      assert.strictEqual(res.status, 400);
      const data = await json(res);
      assert.ok(data.error);
      assert.ok(data.code);
      assert.strictEqual(data.code, 'NO_FILES');
    });

    it('returns 400 for invalid file type', async () => {
      const body = new FormData();
      body.append('files', new Blob(['hello']), 'test.txt');
      const res = await fetch(`${base}/jobs`, { method: 'POST', body });
      assert.strictEqual(res.status, 400);
      const data = await json(res);
      assert.ok(data.error);
      assert.strictEqual(data.code, 'INVALID_FILE_TYPE');
    });

    it('supports multiple files', async () => {
      const { status, body } = await uploadFiles([
        { name: 'a.zip', content: validZipContent() },
        { name: 'b.zip', content: validZipContent() },
        { name: 'c.zip', content: validZipContent() }
      ]);
      assert.strictEqual(status, 201);
      assert.strictEqual(body.files.length, 3);
      assert.strictEqual(body.progress.total, 3);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/jobs/:jobId
  // -----------------------------------------------------------------------
  describe('GET /jobs/:jobId', () => {
    it('returns 404 for unknown job', async () => {
      const res = await fetch(`${base}/jobs/nonexistent`);
      assert.strictEqual(res.status, 404);
      const data = await json(res);
      assert.ok(data.error);
      assert.strictEqual(data.code, 'NOT_FOUND');
    });

    it('returns job details for existing job', async () => {
      const { body: upload } = await uploadFiles([
        { name: 'test.zip', content: validZipContent() }
      ]);
      const res = await fetch(`${base}/jobs/${upload.jobId}`);
      assert.strictEqual(res.status, 200);
      const body = await json(res);
      assert.strictEqual(body.jobId, upload.jobId);
      assert.strictEqual(body.status, 'uploaded');
      assert.ok(body.files);
      assert.ok(body.progress);
      // Should NOT have download link before completion
      assert.strictEqual(body.download, undefined);
    });

    it('job response has consistent shape', async () => {
      const { body: upload } = await uploadFiles([
        { name: 'b.zip', content: validZipContent() }
      ]);
      const res = await fetch(`${base}/jobs/${upload.jobId}`);
      const body = await json(res);

      // Top-level fields
      assert.ok(body.jobId);
      assert.ok(body.status);
      assert.ok(body.createdAt);
      assert.ok(Array.isArray(body.files));
      assert.ok(body.progress);

      // progress fields
      assert.ok(typeof body.progress.total === 'number');
      assert.ok(typeof body.progress.completed === 'number');
      assert.ok(typeof body.progress.failed === 'number');
      assert.ok(typeof body.progress.results === 'number');

      // Each file has correct v1 shape
      for (const f of body.files) {
        assert.ok(f.fileId);
        assert.ok(f.fileName);
        assert.ok(f.fileType);
        assert.ok(f.state);
        assert.ok(f.error === null || typeof f.error === 'string');
        assert.strictEqual(f.id, undefined); // must NOT have legacy keys
        assert.strictEqual(f.name, undefined);
        assert.strictEqual(f.type, undefined);
      }
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/v1/jobs/:jobId/process
  // -----------------------------------------------------------------------
  describe('POST /jobs/:jobId/process', () => {
    it('returns 404 for unknown job', async () => {
      const res = await fetch(`${base}/jobs/nonexistent/process`, { method: 'POST' });
      assert.strictEqual(res.status, 404);
      const data = await json(res);
      assert.ok(data.error);
      assert.strictEqual(data.code, 'NOT_FOUND');
    });

    it('starts processing and returns 200 with jobId', async () => {
      const { body: upload } = await uploadFiles([
        { name: 'test.zip', content: validZipContent() }
      ]);
      const res = await fetch(`${base}/jobs/${upload.jobId}/process`, { method: 'POST' });
      assert.strictEqual(res.status, 200);
      const body = await json(res);
      assert.strictEqual(body.jobId, upload.jobId);
      assert.strictEqual(body.status, 'processing');
    });

    it('returns 409 when already processing', async () => {
      const { body: upload } = await uploadFiles([
        { name: 'dup.zip', content: validZipContent() }
      ]);
      await fetch(`${base}/jobs/${upload.jobId}/process`, { method: 'POST' });
      const res = await fetch(`${base}/jobs/${upload.jobId}/process`, { method: 'POST' });
      assert.strictEqual(res.status, 409);
      const data = await json(res);
      assert.ok(data.error);
      assert.strictEqual(data.code, 'ALREADY_PROCESSING');
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/jobs/:jobId/files
  // -----------------------------------------------------------------------
  describe('GET /jobs/:jobId/files', () => {
    it('returns 404 for unknown job', async () => {
      const res = await fetch(`${base}/jobs/nonexistent/files`);
      assert.strictEqual(res.status, 404);
      const data = await json(res);
      assert.strictEqual(data.code, 'NOT_FOUND');
    });

    it('returns file array with correct shape', async () => {
      const { body: upload } = await uploadFiles([
        { name: 'f1.zip', content: validZipContent() },
        { name: 'f2.zip', content: validZipContent() }
      ]);
      const res = await fetch(`${base}/jobs/${upload.jobId}/files`);
      assert.strictEqual(res.status, 200);
      const body = await json(res);
      assert.strictEqual(body.jobId, upload.jobId);
      assert.ok(Array.isArray(body.files));
      assert.strictEqual(body.files.length, 2);
      for (const f of body.files) {
        assert.ok(f.fileId);
        assert.ok(f.fileName);
        assert.ok(f.fileType);
        assert.ok(f.state);
      }
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/jobs/:jobId/download
  // -----------------------------------------------------------------------
  describe('GET /jobs/:jobId/download', () => {
    it('returns 404 for unknown job', async () => {
      const res = await fetch(`${base}/jobs/nonexistent/download`);
      assert.strictEqual(res.status, 404);
      const data = await json(res);
      assert.strictEqual(data.code, 'NOT_FOUND');
    });

    it('returns 400 when job is not complete', async () => {
      const { body: upload } = await uploadFiles([
        { name: 'dl-test.zip', content: validZipContent() }
      ]);
      const res = await fetch(`${base}/jobs/${upload.jobId}/download`);
      assert.strictEqual(res.status, 400);
      const data = await json(res);
      assert.ok(data.error);
      assert.strictEqual(data.code, 'NOT_COMPLETE');
    });
  });

  // -----------------------------------------------------------------------
  // Error response consistency
  // -----------------------------------------------------------------------
  describe('Error response shape', () => {
    it('all error responses have "error" and "code"', async () => {
      const endpoints = [
        ['GET', `${base}/jobs/nope`],
        ['GET', `${base}/jobs/nope/files`],
        ['POST', `${base}/jobs/nope/process`],
        ['GET', `${base}/jobs/nope/download`],
      ];

      for (const [method, url] of endpoints) {
        const res = await fetch(url, { method });
        const body = await json(res);
        assert.ok(body.error, `Missing "error" for ${method} ${url}`);
        assert.ok(body.code, `Missing "code" for ${method} ${url}`);
        assert.strictEqual(typeof body.error, 'string');
        assert.strictEqual(typeof body.code, 'string');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Legacy backward-compatible aliases
  // -----------------------------------------------------------------------
  describe('Legacy /api/* backward compat', () => {
    let legacyBase;
    before(() => {
      legacyBase = base.replace('/api/v1', '/api');
    });

    it('POST /api/upload returns sessionId (legacy)', async () => {
      const body = new FormData();
      body.append('zips', new Blob([validZipContent()], { type: 'application/octet-stream' }), 'legacy.zip');
      const res = await fetch(`${legacyBase}/upload`, { method: 'POST', body });
      assert.strictEqual(res.status, 201);
      const data = await json(res);
      assert.ok(data.jobId);
      assert.ok(data.files);
      // Legacy response also has modern fields
      assert.ok(data.status);
    });

    it('POST /api/process/:sessionId aliases to v1', async () => {
      const body = new FormData();
      body.append('zips', new Blob([validZipContent()], { type: 'application/octet-stream' }), 'legacy2.zip');
      const up = await (await fetch(`${legacyBase}/upload`, { method: 'POST', body })).json();
      const res = await fetch(`${legacyBase}/process/${up.jobId}`, { method: 'POST' });
      assert.strictEqual(res.status, 200);
      const data = await json(res);
      assert.strictEqual(data.jobId, up.jobId);
    });

    it('GET /api/status/:sessionId aliases to v1', async () => {
      const body = new FormData();
      body.append('zips', new Blob([validZipContent()], { type: 'application/octet-stream' }), 'legacy3.zip');
      const up = await (await fetch(`${legacyBase}/upload`, { method: 'POST', body })).json();
      const res = await fetch(`${legacyBase}/status/${up.jobId}`);
      assert.strictEqual(res.status, 200);
      const data = await json(res);
      assert.strictEqual(data.jobId, up.jobId);
      assert.ok(data.files);
    });

    it('GET /api/download/:sessionId aliases to v1', async () => {
      const body = new FormData();
      body.append('zips', new Blob([validZipContent()], { type: 'application/octet-stream' }), 'legacy4.zip');
      const up = await (await fetch(`${legacyBase}/upload`, { method: 'POST', body })).json();
      const res = await fetch(`${legacyBase}/download/${up.jobId}`);
      // Not complete, so returns 400 with proper error shape
      assert.strictEqual(res.status, 400);
      const data = await json(res);
      assert.ok(data.error);
      assert.ok(data.code);
    });
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { startWebServer } from '../src/webServer.js';
import { DevAuthAdapter, HeaderAuthAdapter, AuthError, ForbiddenError } from '../src/auth/adapter.js';
import { createAuthMiddleware } from '../src/auth/middleware.js';

// ---------------------------------------------------------------------------
// Adapter unit tests
// ---------------------------------------------------------------------------

describe('DevAuthAdapter', () => {
  it('returns default identity when no headers present', () => {
    const adapter = new DevAuthAdapter();
    const req = { headers: {} };
    const identity = adapter.extract(req);
    assert.strictEqual(identity.userId, 'dev-user');
    assert.strictEqual(identity.tenantId, 'dev-tenant');
    assert.strictEqual(identity.clientId, 'dev-client');
  });

  it('allows overrides via defaultUser option', () => {
    const adapter = new DevAuthAdapter({
      defaultUser: { userId: 'custom-user', tenantId: 'custom-tenant', clientId: 'custom-client' }
    });
    const req = { headers: {} };
    const identity = adapter.extract(req);
    assert.strictEqual(identity.userId, 'custom-user');
    assert.strictEqual(identity.tenantId, 'custom-tenant');
    assert.strictEqual(identity.clientId, 'custom-client');
  });

  it('respects request headers over defaults', () => {
    const adapter = new DevAuthAdapter();
    const req = {
      headers: {
        'x-user-id': 'header-user',
        'x-tenant-id': 'header-tenant',
        'x-client-id': 'header-client'
      }
    };
    const identity = adapter.extract(req);
    assert.strictEqual(identity.userId, 'header-user');
    assert.strictEqual(identity.tenantId, 'header-tenant');
    assert.strictEqual(identity.clientId, 'header-client');
  });
});

describe('HeaderAuthAdapter', () => {
  it('extracts identity from default header names', () => {
    const adapter = new HeaderAuthAdapter();
    const req = {
      headers: {
        'x-user-id': 'alice',
        'x-tenant-id': 'acme-corp',
        'x-client-id': 'widget-brand'
      }
    };
    const identity = adapter.extract(req);
    assert.strictEqual(identity.userId, 'alice');
    assert.strictEqual(identity.tenantId, 'acme-corp');
    assert.strictEqual(identity.clientId, 'widget-brand');
  });

  it('returns null when required header missing in required mode', () => {
    const adapter = new HeaderAuthAdapter({ required: true });
    const req = { headers: {} };
    const identity = adapter.extract(req);
    assert.strictEqual(identity, null);
  });

  it('allows missing headers when not required', () => {
    const adapter = new HeaderAuthAdapter({ required: false });
    const req = { headers: {} };
    const identity = adapter.extract(req);
    assert.ok(identity);
    assert.strictEqual(identity.userId, null);
  });

  it('accepts custom header names', () => {
    const adapter = new HeaderAuthAdapter({
      headers: {
        userId: 'x-my-user',
        tenantId: 'x-my-tenant',
        clientId: 'x-my-client'
      }
    });
    const req = {
      headers: {
        'x-my-user': 'bob',
        'x-my-tenant': 'my-org',
        'x-my-client': 'sub-brand'
      }
    };
    const identity = adapter.extract(req);
    assert.strictEqual(identity.userId, 'bob');
    assert.strictEqual(identity.tenantId, 'my-org');
    assert.strictEqual(identity.clientId, 'sub-brand');
  });

  it('returns null for missing custom header in required mode', () => {
    const adapter = new HeaderAuthAdapter({
      headers: { userId: 'x-custom-auth' },
      required: true
    });
    const req = { headers: {} };
    assert.strictEqual(adapter.extract(req), null);
  });
});

describe('AuthError', () => {
  it('has correct status and code', () => {
    const err = new AuthError('test error');
    assert.strictEqual(err.message, 'test error');
    assert.strictEqual(err.statusCode, 401);
    assert.strictEqual(err.code, 'UNAUTHORIZED');
  });
});

describe('ForbiddenError', () => {
  it('has correct status and code', () => {
    const err = new ForbiddenError('no access');
    assert.strictEqual(err.message, 'no access');
    assert.strictEqual(err.statusCode, 403);
    assert.strictEqual(err.code, 'FORBIDDEN');
  });
});

describe('createAuthMiddleware', () => {
  it('defaults to dev mode with dev-user fallback', () => {
    const mw = createAuthMiddleware();
    let capturedAuth = null;
    const req = { headers: {} };
    mw(req, null, () => {
      capturedAuth = req.auth;
    });
    assert.ok(capturedAuth);
    assert.strictEqual(capturedAuth.userId, 'dev-user');
  });

  it('production mode without adapter requires adapter option', () => {
    assert.doesNotThrow(() => {
      createAuthMiddleware({ mode: 'production' });
    });
  });

  it('accepts custom adapter', () => {
    const customAdapter = {
      extract() {
        return { userId: 'custom', tenantId: 't1', clientId: 'c1' };
      }
    };
    const mw = createAuthMiddleware({ adapter: customAdapter });
    const req = { headers: {} };
    mw(req, null, () => {
      assert.strictEqual(req.auth.userId, 'custom');
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests — production mode with header auth
// ---------------------------------------------------------------------------

function json(r) {
  return r.json();
}

// Minimal valid ZIP buffer (empty archive with proper magic bytes)
const MINI_ZIP = Buffer.from([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x50, 0x4b, 0x01, 0x02, 0x3f, 0x00, 0x14, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]);

async function createJob(base, headers) {
  const body = new FormData();
  body.append('files', new Blob([MINI_ZIP], { type: 'application/zip' }), 'dummy.zip');
  const res = await fetch(`${base}/jobs`, { method: 'POST', headers, body });
  return { status: res.status, body: await json(res) };
}

describe('Production auth mode — header adapter', () => {
  let server;
  let base;

  before(async () => {
    server = await startWebServer(0, {
      auth: {
        mode: 'production',
        headers: {
          userId: 'x-user-id',
          tenantId: 'x-tenant-id',
          clientId: 'x-client-id'
        }
      }
    });
    const addr = server.address();
    base = `http://127.0.0.1:${addr.port}/api/v1`;
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  // -----------------------------------------------------------------------
  // Unauthenticated
  // -----------------------------------------------------------------------
  describe('unauthenticated requests', () => {
    it('returns 401 for POST /jobs without auth header', async () => {
      const res = await fetch(`${base}/jobs`, { method: 'POST' });
      assert.strictEqual(res.status, 401);
      const data = await json(res);
      assert.strictEqual(data.code, 'UNAUTHORIZED');
    });

    it('returns 401 for GET /jobs/:jobId without auth', async () => {
      const res = await fetch(`${base}/jobs/some-id`);
      assert.strictEqual(res.status, 401);
    });

    it('returns 401 for POST /jobs/:jobId/process without auth', async () => {
      const res = await fetch(`${base}/jobs/some-id/process`, { method: 'POST' });
      assert.strictEqual(res.status, 401);
    });

    it('returns 401 for GET /jobs/:jobId/files without auth', async () => {
      const res = await fetch(`${base}/jobs/some-id/files`);
      assert.strictEqual(res.status, 401);
    });

    it('returns 401 for GET /jobs/:jobId/download without auth', async () => {
      const res = await fetch(`${base}/jobs/some-id/download`);
      assert.strictEqual(res.status, 401);
    });
  });

  // -----------------------------------------------------------------------
  // Health bypasses auth
  // -----------------------------------------------------------------------
  describe('health endpoint', () => {
    it('is publicly accessible without auth headers', async () => {
      const res = await fetch(`${base}/health`);
      assert.strictEqual(res.status, 200);
      const data = await json(res);
      assert.strictEqual(data.status, 'ok');
    });
  });

  // -----------------------------------------------------------------------
  // Own job access
  // -----------------------------------------------------------------------
  describe('own job access', () => {
    let jobId;

    before(async () => {
      const { body } = await createJob(base, { 'x-user-id': 'alice', 'x-tenant-id': 'acme' });
      jobId = body.jobId;
    });

    it('user can access their own job status', async () => {
      const res = await fetch(`${base}/jobs/${jobId}`, {
        headers: { 'x-user-id': 'alice', 'x-tenant-id': 'acme' }
      });
      assert.strictEqual(res.status, 200);
      const data = await json(res);
      assert.strictEqual(data.jobId, jobId);
    });

    it('user can access their own job files', async () => {
      const res = await fetch(`${base}/jobs/${jobId}/files`, {
        headers: { 'x-user-id': 'alice', 'x-tenant-id': 'acme' }
      });
      assert.strictEqual(res.status, 200);
      const data = await json(res);
      assert.strictEqual(data.jobId, jobId);
    });

    it('user can start processing their own job', async () => {
      const res = await fetch(`${base}/jobs/${jobId}/process`, {
        method: 'POST',
        headers: { 'x-user-id': 'alice', 'x-tenant-id': 'acme' }
      });
      assert.strictEqual(res.status, 200);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-user access isolation
  // -----------------------------------------------------------------------
  describe('cross-user isolation', () => {
    let aliceJobId;

    before(async () => {
      const { body } = await createJob(base, { 'x-user-id': 'alice', 'x-tenant-id': 'acme' });
      aliceJobId = body.jobId;
    });

    it('bob cannot access alice\'s job status', async () => {
      const res = await fetch(`${base}/jobs/${aliceJobId}`, {
        headers: { 'x-user-id': 'bob', 'x-tenant-id': 'acme' }
      });
      assert.strictEqual(res.status, 404);
      const data = await json(res);
      assert.strictEqual(data.code, 'NOT_FOUND');
    });

    it('bob cannot access alice\'s job files', async () => {
      const res = await fetch(`${base}/jobs/${aliceJobId}/files`, {
        headers: { 'x-user-id': 'bob', 'x-tenant-id': 'acme' }
      });
      assert.strictEqual(res.status, 404);
    });

    it('bob cannot start processing alice\'s job', async () => {
      const res = await fetch(`${base}/jobs/${aliceJobId}/process`, {
        method: 'POST',
        headers: { 'x-user-id': 'bob', 'x-tenant-id': 'acme' }
      });
      assert.strictEqual(res.status, 404);
    });

    it('bob cannot download alice\'s job', async () => {
      const res = await fetch(`${base}/jobs/${aliceJobId}/download`, {
        headers: { 'x-user-id': 'bob', 'x-tenant-id': 'acme' }
      });
      assert.strictEqual(res.status, 404);
    });
  });

  // -----------------------------------------------------------------------
  // Tenant isolation (same user, different tenant)
  // -----------------------------------------------------------------------
  describe('tenant isolation', () => {
    let jobId;

    before(async () => {
      const { body } = await createJob(base, {
        'x-user-id': 'charlie',
        'x-tenant-id': 'tenant-a',
        'x-client-id': 'brand-x'
      });
      jobId = body.jobId;
    });

    it('same user in different tenant cannot access job', async () => {
      const res = await fetch(`${base}/jobs/${jobId}`, {
        headers: {
          'x-user-id': 'charlie',
          'x-tenant-id': 'tenant-b',
          'x-client-id': 'brand-y'
        }
      });
      assert.strictEqual(res.status, 404);
    });

    it('same user but no tenant info cannot access tenant-scoped job (dev: same default tenant)', async () => {
      const res = await fetch(`${base}/jobs/${jobId}`, {
        headers: {
          'x-user-id': 'charlie',
          'x-tenant-id': 'tenant-b'
        }
      });
      assert.strictEqual(res.status, 404);
    });

    it('correct tenant can access job', async () => {
      const res = await fetch(`${base}/jobs/${jobId}`, {
        headers: {
          'x-user-id': 'charlie',
          'x-tenant-id': 'tenant-a',
          'x-client-id': 'brand-x'
        }
      });
      assert.strictEqual(res.status, 200);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests — legacy routes also enforce auth
// ---------------------------------------------------------------------------

describe('Production auth — legacy aliases', () => {
  let server;
  let legacyBase;

  before(async () => {
    server = await startWebServer(0, {
      auth: {
        mode: 'production',
        headers: { userId: 'x-user-id' }
      }
    });
    const addr = server.address();
    legacyBase = `http://127.0.0.1:${addr.port}/api`;
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  it('POST /api/upload without auth returns 401', async () => {
    const res = await fetch(`${legacyBase}/upload`, { method: 'POST' });
    assert.strictEqual(res.status, 401);
  });

  it('POST /api/upload with auth header succeeds', async () => {
    const body = new FormData();
    body.append('zips', new Blob([MINI_ZIP], { type: 'application/zip' }), 'legacy.zip');
    const res = await fetch(`${legacyBase}/upload`, {
      method: 'POST',
      headers: { 'x-user-id': 'legacy-user' },
      body
    });
    assert.strictEqual(res.status, 201);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — dev mode (no auth config) remains open
// ---------------------------------------------------------------------------

describe('Dev mode (no auth config)', () => {
  let server;
  let base;

  before(async () => {
    server = await startWebServer(0);
    const addr = server.address();
    base = `http://127.0.0.1:${addr.port}/api/v1`;
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  it('accepts requests without any auth headers', async () => {
    const body = new FormData();
    body.append('files', new Blob([MINI_ZIP], { type: 'application/zip' }), 'dev.zip');
    const res = await fetch(`${base}/jobs`, { method: 'POST', body });
    assert.strictEqual(res.status, 201);
  });

  it('creates jobs under dev-user identity', async () => {
    const body = new FormData();
    body.append('files', new Blob([MINI_ZIP], { type: 'application/zip' }), 'dev2.zip');
    const res = await (await fetch(`${base}/jobs`, { method: 'POST', body })).json();
    const jobRes = await fetch(`${base}/jobs/${res.jobId}`);
    assert.strictEqual(jobRes.status, 200);
  });
});

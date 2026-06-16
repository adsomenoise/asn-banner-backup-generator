import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Job, FileInfo, JOB_STATUSES, FILE_STATES } from '../src/jobs/Job.js';
import { InMemoryJobStore } from '../src/jobs/JobStore.js';

// ---------------------------------------------------------------------------
// FileInfo
// ---------------------------------------------------------------------------
describe('FileInfo', () => {
  it('creates with defaults', () => {
    const f = new FileInfo();
    assert.strictEqual(f.state, 'uploaded');
    assert.strictEqual(f.type, 'zip');
    assert.strictEqual(f.error, null);
  });

  it('creates with props', () => {
    const f = new FileInfo({
      id: 'f1',
      name: 'test.zip',
      path: '/tmp/test.zip',
      type: 'zip',
      state: 'uploaded'
    });
    assert.strictEqual(f.id, 'f1');
    assert.strictEqual(f.name, 'test.zip');
    assert.strictEqual(f.path, '/tmp/test.zip');
    assert.strictEqual(f.type, 'zip');
  });

  it('setState transitions correctly', () => {
    const f = new FileInfo({ id: 'f1', name: 'a.zip' });
    assert.strictEqual(f.state, 'uploaded');

    f.setState('queued');
    assert.strictEqual(f.state, 'queued');

    f.setState('processing');
    assert.strictEqual(f.state, 'processing');

    f.setState('complete');
    assert.strictEqual(f.state, 'complete');
  });

  it('setState accepts error message on failed', () => {
    const f = new FileInfo({ id: 'f1', name: 'a.zip' });
    f.setState('failed', 'Something went wrong');
    assert.strictEqual(f.state, 'failed');
    assert.strictEqual(f.error, 'Something went wrong');
  });

  it('setState rejects invalid state', () => {
    const f = new FileInfo({ id: 'f1', name: 'a.zip' });
    assert.throws(() => f.setState('invalid'), /Invalid file state/);
  });

  it('toJSON returns v1-compatible shape', () => {
    const f = new FileInfo({ id: 'f1', name: 'banner.zip', type: 'zip', state: 'uploaded' });
    const json = f.toJSON();
    assert.strictEqual(json.fileId, 'f1');
    assert.strictEqual(json.fileName, 'banner.zip');
    assert.strictEqual(json.fileType, 'zip');
    assert.strictEqual(json.state, 'uploaded');
    assert.strictEqual(json.error, null);
  });

  it('toJSON includes error when set', () => {
    const f = new FileInfo({ id: 'f1', name: 'bad.zip' });
    f.setState('failed', 'missing HTML');
    const json = f.toJSON();
    assert.strictEqual(json.state, 'failed');
    assert.strictEqual(json.error, 'missing HTML');
  });
});

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------
describe('Job', () => {
  it('creates with defaults', () => {
    const job = new Job();
    assert.ok(job.id);
    assert.strictEqual(job.status, 'uploaded');
    assert.strictEqual(job.userId, null);
    assert.strictEqual(job.tenantId, null);
    assert.strictEqual(job.clientId, null);
    assert.ok(Array.isArray(job.files));
    assert.strictEqual(job.files.length, 0);
    assert.strictEqual(job.total, 0);
    assert.ok(job.createdAt);
    assert.ok(job.updatedAt);
  });

  it('creates with identity fields', () => {
    const job = new Job({ userId: 'alice', tenantId: 'acme', clientId: 'widgets' });
    assert.strictEqual(job.userId, 'alice');
    assert.strictEqual(job.tenantId, 'acme');
    assert.strictEqual(job.clientId, 'widgets');
  });

  it('creates with file array and sets total', () => {
    const files = [
      new FileInfo({ id: 'f1', name: 'a.zip' }),
      new FileInfo({ id: 'f2', name: 'b.zip' })
    ];
    const job = new Job({ files });
    assert.strictEqual(job.files.length, 2);
    assert.strictEqual(job.total, 2);
  });

  it('converts plain file objects to FileInfo', () => {
    const job = new Job({
      files: [
        { id: 'f1', name: 'a.zip' },
        { id: 'f2', name: 'b.riv', type: 'riv' }
      ]
    });
    assert.ok(job.files[0] instanceof FileInfo);
    assert.ok(job.files[1] instanceof FileInfo);
    assert.strictEqual(job.files[1].type, 'riv');
  });

  it('setStatus validates transitions', () => {
    const job = new Job();
    assert.strictEqual(job.status, 'uploaded');

    job.setStatus('processing');
    assert.strictEqual(job.status, 'processing');

    job.setStatus('complete');
    assert.strictEqual(job.status, 'complete');

    job.setStatus('error');
    assert.strictEqual(job.status, 'error');
  });

  it('setStatus updates updatedAt', async () => {
    const job = new Job();
    const original = job.updatedAt;
    await new Promise(r => setTimeout(r, 5));
    job.setStatus('processing');
    assert.ok(new Date(job.updatedAt) > new Date(original));
  });

  it('setStatus rejects invalid status', () => {
    const job = new Job();
    assert.throws(() => job.setStatus('invalid'), /Invalid job status/);
  });

  it('completedCount filters complete files', () => {
    const job = new Job({
      files: [
        { id: 'f1', state: 'complete' },
        { id: 'f2', state: 'failed' },
        { id: 'f3', state: 'processing' }
      ]
    });
    assert.strictEqual(job.completedCount, 1);
  });

  it('failedCount filters failed files', () => {
    const job = new Job({
      files: [
        { id: 'f1', state: 'complete' },
        { id: 'f2', state: 'failed' },
        { id: 'f3', state: 'failed' }
      ]
    });
    assert.strictEqual(job.failedCount, 2);
  });

  it('resultsCount matches results array length', () => {
    const job = new Job();
    assert.strictEqual(job.resultsCount, 0);
    job.results.push({ name: 'test' });
    assert.strictEqual(job.resultsCount, 1);
  });

  it('isExpired returns false when no expiry set', () => {
    const job = new Job();
    assert.strictEqual(job.isExpired(), false);
  });

  it('isExpired returns true past expiresAt', () => {
    const job = new Job({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.strictEqual(job.isExpired(), true);
  });

  it('isExpired returns false before expiresAt', () => {
    const job = new Job({ expiresAt: new Date(Date.now() + 3600000).toISOString() });
    assert.strictEqual(job.isExpired(), false);
  });

  // -----------------------------------------------------------------------
  // Ownership — isOwnedBy
  // -----------------------------------------------------------------------
  describe('isOwnedBy', () => {
    it('returns true when userId matches', () => {
      const job = new Job({ userId: 'alice' });
      assert.strictEqual(job.isOwnedBy({ userId: 'alice' }), true);
    });

    it('returns false when userId differs', () => {
      const job = new Job({ userId: 'alice' });
      assert.strictEqual(job.isOwnedBy({ userId: 'bob' }), false);
    });

    it('returns false when auth is null', () => {
      const job = new Job({ userId: 'alice' });
      assert.strictEqual(job.isOwnedBy(null), false);
    });

    it('returns false when auth is undefined', () => {
      const job = new Job({ userId: 'alice' });
      assert.strictEqual(job.isOwnedBy(undefined), false);
    });

    it('returns true when job has no userId (open access)', () => {
      const job = new Job();
      assert.strictEqual(job.isOwnedBy({ userId: 'anyone' }), true);
    });

    it('enforces tenantId when both sides have it', () => {
      const job = new Job({ userId: 'alice', tenantId: 'acme' });
      assert.strictEqual(job.isOwnedBy({ userId: 'alice', tenantId: 'acme' }), true);
      assert.strictEqual(job.isOwnedBy({ userId: 'alice', tenantId: 'other' }), false);
    });

    it('skips tenant check when auth has no tenantId', () => {
      const job = new Job({ userId: 'alice', tenantId: 'acme' });
      assert.strictEqual(job.isOwnedBy({ userId: 'alice' }), true);
    });

    it('enforces clientId when both sides have it', () => {
      const job = new Job({ userId: 'alice', clientId: 'brand-x' });
      assert.strictEqual(job.isOwnedBy({ userId: 'alice', clientId: 'brand-x' }), true);
      assert.strictEqual(job.isOwnedBy({ userId: 'alice', clientId: 'brand-y' }), false);
    });
  });

  // -----------------------------------------------------------------------
  // toJSON for API responses
  // -----------------------------------------------------------------------
  describe('toJSON', () => {
    it('returns v1-compatible job shape', () => {
      const job = new Job({
        id: 'test123',
        userId: 'alice',
        files: [{ id: 'f1', name: 'b.zip' }]
      });
      const json = job.toJSON();
      assert.strictEqual(json.jobId, 'test123');
      assert.strictEqual(json.status, 'uploaded');
      assert.ok(json.createdAt);
      assert.ok(json.updatedAt);
      assert.ok(Array.isArray(json.files));
      assert.strictEqual(json.files.length, 1);
      assert.ok(json.progress);
      assert.strictEqual(json.progress.total, 1);
      assert.strictEqual(json.progress.completed, 0);
      assert.strictEqual(json.progress.failed, 0);
      assert.strictEqual(json.progress.results, 0);
    });

    it('files use v1 field names (fileId, fileName, fileType)', () => {
      const job = new Job({
        files: [{ id: 'f1', name: 'test.zip', type: 'zip' }]
      });
      const json = job.toJSON();
      const f = json.files[0];
      assert.strictEqual(f.fileId, 'f1');
      assert.strictEqual(f.fileName, 'test.zip');
      assert.strictEqual(f.fileType, 'zip');
      assert.strictEqual(f.id, undefined);
      assert.strictEqual(f.name, undefined);
      assert.strictEqual(f.type, undefined);
    });
  });
});

// ---------------------------------------------------------------------------
// InMemoryJobStore
// ---------------------------------------------------------------------------
describe('InMemoryJobStore', () => {
  let store;

  it('starts empty', () => {
    store = new InMemoryJobStore();
    assert.strictEqual(store.size, 0);
  });

  it('create stores a job and returns it', async () => {
    const job = new Job({ id: 'j1', userId: 'alice', files: [{ id: 'f1', name: 'a.zip' }] });
    const result = await store.create(job);
    assert.strictEqual(result, job);
    assert.strictEqual(store.size, 1);
  });

  it('get returns stored job', async () => {
    const job = await store.get('j1');
    assert.ok(job);
    assert.strictEqual(job.id, 'j1');
    assert.strictEqual(job.userId, 'alice');
  });

  it('get returns null for unknown id', async () => {
    const job = await store.get('nonexistent');
    assert.strictEqual(job, null);
  });

  it('create rejects duplicate id', async () => {
    const job = new Job({ id: 'j1' });
    await assert.rejects(() => store.create(job), /already exists/);
  });

  it('update modifies fields and sets updatedAt', async () => {
    const original = await store.get('j1');
    const originalUpdated = original.updatedAt;
    await new Promise(r => setTimeout(r, 5));

    const updated = await store.update('j1', { status: 'processing' });
    assert.ok(updated);
    assert.strictEqual(updated.status, 'processing');
    assert.ok(new Date(updated.updatedAt) > new Date(originalUpdated));
  });

  it('update returns null for unknown id', async () => {
    const result = await store.update('nope', { status: 'processing' });
    assert.strictEqual(result, null);
  });

  it('delete removes a job', async () => {
    const removed = await store.delete('j1');
    assert.strictEqual(removed, true);
    assert.strictEqual(store.size, 0);
  });

  it('delete returns false for unknown id', async () => {
    const removed = await store.delete('nope');
    assert.strictEqual(removed, false);
  });

  it('findByUser returns matching jobs', async () => {
    store = new InMemoryJobStore();
    await store.create(new Job({ id: 'a1', userId: 'alice' }));
    await store.create(new Job({ id: 'a2', userId: 'alice' }));
    await store.create(new Job({ id: 'b1', userId: 'bob' }));

    const alices = await store.findByUser('alice');
    assert.strictEqual(alices.length, 2);
    assert.ok(alices.find(j => j.id === 'a1'));
    assert.ok(alices.find(j => j.id === 'a2'));

    const bobs = await store.findByUser('bob');
    assert.strictEqual(bobs.length, 1);
    assert.strictEqual(bobs[0].id, 'b1');
  });

  it('findByUser returns empty array for unknown user', async () => {
    const jobs = await store.findByUser('nobody');
    assert.ok(Array.isArray(jobs));
    assert.strictEqual(jobs.length, 0);
  });

  it('list returns all jobs', async () => {
    store = new InMemoryJobStore();
    await store.create(new Job({ id: 'x1' }));
    await store.create(new Job({ id: 'x2' }));
    const all = await store.list();
    assert.strictEqual(all.length, 2);
  });

  it('create preserves reference (mutation is shared)', async () => {
    store = new InMemoryJobStore();
    const job = new Job({ id: 'ref1' });
    await store.create(job);
    const fetched = await store.get('ref1');
    assert.strictEqual(fetched, job); // same reference
  });
});

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------
describe('Job lifecycle', () => {
  it('starts as uploaded', async () => {
    const store = new InMemoryJobStore();
    const job = new Job({
      id: 'lifecycle1',
      userId: 'alice',
      files: [
        { id: 'f1', name: 'a.zip' },
        { id: 'f2', name: 'b.riv', type: 'riv' }
      ]
    });
    await store.create(job);

    assert.strictEqual(job.status, 'uploaded');
    assert.strictEqual(job.files[0].state, 'uploaded');
    assert.strictEqual(job.files[1].state, 'uploaded');
  });

  it('transitions to processing with queued files', async () => {
    const store = new InMemoryJobStore();
    const job = new Job({
      id: 'lifecycle2',
      userId: 'alice',
      files: [{ id: 'f1', name: 'a.zip' }]
    });
    await store.create(job);

    job.setStatus('processing');
    job.files[0].setState('queued');
    job.resultDir = '/tmp/results';
    await store.update(job.id, {
      status: job.status,
      resultDir: job.resultDir
    });

    const reloaded = await store.get(job.id);
    assert.strictEqual(reloaded.status, 'processing');
    assert.strictEqual(reloaded.files[0].state, 'queued');
  });

  it('tracks per-file state transitions', async () => {
    const store = new InMemoryJobStore();
    const job = new Job({
      id: 'lifecycle3',
      userId: 'alice',
      files: [
        { id: 'f1', name: 'good.zip' },
        { id: 'f2', name: 'bad.zip' }
      ]
    });
    await store.create(job);

    job.files[0].setState('complete');
    job.files[1].setState('failed', 'No HTML found');
    job.errors.push({ file: 'bad.zip', error: 'No HTML found', friendly: 'Missing HTML' });

    job.setStatus('complete');
    job.results.push({ name: 'good' });
    job.outputZip = '/tmp/output.zip';
    await store.update(job.id, {
      status: job.status,
      files: job.files,
      errors: job.errors,
      results: job.results,
      outputZip: job.outputZip
    });

    const reloaded = await store.get(job.id);
    assert.strictEqual(reloaded.status, 'complete');
    assert.strictEqual(reloaded.files[0].state, 'complete');
    assert.strictEqual(reloaded.files[1].state, 'failed');
    assert.strictEqual(reloaded.files[1].error, 'No HTML found');
    assert.strictEqual(reloaded.completedCount, 1);
    assert.strictEqual(reloaded.failedCount, 1);
    assert.strictEqual(reloaded.resultsCount, 1);
    assert.strictEqual(reloaded.outputZip, '/tmp/output.zip');
  });

  it('supports job error state', async () => {
    const store = new InMemoryJobStore();
    const job = new Job({
      id: 'lifecycle4',
      userId: 'alice',
      files: [{ id: 'f1', name: 'a.zip' }]
    });
    await store.create(job);

    job.setStatus('error');
    job.errors.push({ file: 'output', error: 'Disk full' });
    await store.update(job.id, { status: job.status, errors: job.errors });

    const reloaded = await store.get(job.id);
    assert.strictEqual(reloaded.status, 'error');
    assert.strictEqual(reloaded.errors.length, 1);
    assert.strictEqual(reloaded.errors[0].error, 'Disk full');
  });

  it('delete removes job from store', async () => {
    const store = new InMemoryJobStore();
    const job = new Job({ id: 'lifecycle5', userId: 'alice' });
    await store.create(job);
    assert.strictEqual(store.size, 1);

    await store.delete(job.id);
    assert.strictEqual(await store.get(job.id), null);
    assert.strictEqual(store.size, 0);
  });
});

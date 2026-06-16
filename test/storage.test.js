import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs-extra';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { LocalStorage } from '../src/storage/LocalStorage.js';

describe('LocalStorage', () => {
  let tmpRoot;
  let storage;

  before(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'storage-test-'));
    storage = new LocalStorage(tmpRoot);
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Path construction
  // -----------------------------------------------------------------------
  describe('path construction', () => {
    it('uploadDir returns jobs upload path under root', () => {
      const p = storage.uploadDir('job-abc');
      assert.ok(p.startsWith(tmpRoot));
      assert.ok(p.endsWith(path.join('uploads', 'job-abc')));
    });

    it('workDir returns job work path under root', () => {
      const p = storage.workDir('job-abc');
      assert.ok(p.startsWith(tmpRoot));
      assert.ok(p.endsWith(path.join('work', 'job-abc')));
    });

    it('fileWorkDir scopes to job and file', () => {
      const p = storage.fileWorkDir('job-abc', 'file-001');
      assert.ok(p.endsWith(path.join('work', 'job-abc', 'file-001')));
    });

    it('resultDir returns job result path', () => {
      const p = storage.resultDir('job-abc');
      assert.ok(p.endsWith(path.join('results', 'job-abc')));
    });

    it('outputZipPath returns zip path under results', () => {
      const p = storage.outputZipPath('job-abc');
      assert.ok(p.endsWith(path.join('results', 'job-abc.zip')));
    });

    it('outputZipPath has .zip extension', () => {
      const p = storage.outputZipPath('job-xyz');
      assert.ok(p.endsWith('.zip'));
    });

    it('different jobs produce different paths', () => {
      assert.notStrictEqual(storage.uploadDir('a'), storage.uploadDir('b'));
      assert.notStrictEqual(storage.workDir('a'), storage.workDir('b'));
      assert.notStrictEqual(storage.resultDir('a'), storage.resultDir('b'));
      assert.notStrictEqual(storage.outputZipPath('a'), storage.outputZipPath('b'));
    });

    it('root is the resolved directory', () => {
      assert.strictEqual(storage.root, path.resolve(tmpRoot));
    });
  });

  // -----------------------------------------------------------------------
  // Directory lifecycle
  // -----------------------------------------------------------------------
  describe('directory lifecycle', () => {
    let jobId;

    before(() => {
      jobId = 'dir-lifecycle-test';
    });

    it('ensureUploadDir creates the directory', async () => {
      const p = storage.uploadDir(jobId);
      assert.strictEqual(await fs.pathExists(p), false);
      await storage.ensureUploadDir(jobId);
      assert.strictEqual(await fs.pathExists(p), true);
    });

    it('ensureResultDir creates the directory', async () => {
      const p = storage.resultDir(jobId);
      assert.strictEqual(await fs.pathExists(p), false);
      await storage.ensureResultDir(jobId);
      assert.strictEqual(await fs.pathExists(p), true);
    });

    it('rmdir removes directory quietly', async () => {
      const p = storage.uploadDir(jobId);
      assert.strictEqual(await fs.pathExists(p), true);
      await storage.rmdir(p);
      assert.strictEqual(await fs.pathExists(p), false);
    });

    it('rmdir does not throw on non-existent path', async () => {
      await assert.doesNotReject(() => storage.rmdir('/nonexistent/random/path'));
    });
  });

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------
  describe('cleanupJob', () => {
    it('removes all job-scoped directories', async () => {
      const jobId = 'cleanup-me';

      await storage.ensureUploadDir(jobId);
      await storage.ensureResultDir(jobId);
      // Create a file in the work dir to verify it gets cleaned
      const workDir = storage.workDir(jobId);
      await fs.ensureDir(workDir);
      await fs.writeFile(path.join(workDir, 'test.txt'), 'hello');

      // Verify directories exist before cleanup
      assert.strictEqual(await fs.pathExists(storage.uploadDir(jobId)), true);
      assert.strictEqual(await fs.pathExists(storage.resultDir(jobId)), true);
      assert.strictEqual(await fs.pathExists(workDir), true);

      await storage.cleanupJob(jobId);

      // All should be gone
      assert.strictEqual(await fs.pathExists(storage.uploadDir(jobId)), false);
      assert.strictEqual(await fs.pathExists(storage.resultDir(jobId)), false);
      assert.strictEqual(await fs.pathExists(workDir), false);
    });

    it('does not throw on non-existent job', async () => {
      await assert.doesNotReject(() => storage.cleanupJob('does-not-exist'));
    });

    it('does not affect other jobs', async () => {
      const jobA = 'job-a';
      const jobB = 'job-b';

      await storage.ensureUploadDir(jobA);
      await storage.ensureUploadDir(jobB);

      await storage.cleanupJob(jobA);

      assert.strictEqual(await fs.pathExists(storage.uploadDir(jobA)), false);
      assert.strictEqual(await fs.pathExists(storage.uploadDir(jobB)), true);

      // Cleanup B
      await storage.cleanupJob(jobB);
    });
  });

  // -----------------------------------------------------------------------
  // URL resolution
  // -----------------------------------------------------------------------
  describe('toPublicUrl', () => {
    it('resolves a path inside root to a URL', () => {
      const p = path.join(storage.root, 'work', 'j1', 'index.html');
      const url = storage.toPublicUrl(3000, p);
      assert.ok(url.startsWith('http://localhost:3000/'));
      assert.ok(url.includes('work'));
      assert.ok(url.includes('j1'));
      assert.ok(url.includes('index.html'));
    });

    it('throws on path outside root', () => {
      assert.throws(() => storage.toPublicUrl(3000, '/etc/passwd'), /Path traversal/);
    });

    it('throws on path with upward traversal', () => {
      const p = path.join(storage.root, 'uploads', 'j1', '..', '..', '..', 'secret');
      assert.throws(() => storage.toPublicUrl(3000, p), /Path traversal/);
    });

    it('encodes special characters', () => {
      const p = path.join(storage.root, 'work', 'j1', 'my file.html');
      const url = storage.toPublicUrl(3000, p);
      assert.ok(url.includes('my%20file.html'));
    });
  });

  // -----------------------------------------------------------------------
  // Result ZIP streaming
  // -----------------------------------------------------------------------
  describe('result ZIP operations', () => {
    it('outputZipExists returns false when no ZIP', async () => {
      const exists = await storage.outputZipExists('no-such-job');
      assert.strictEqual(exists, false);
    });

    it('createOutputZipStream returns null when no ZIP', async () => {
      const stream = await storage.createOutputZipStream('no-such-job');
      assert.strictEqual(stream, null);
    });

    it('outputZipExists returns true after creating a ZIP', async () => {
      const jobId = 'zip-exists-test';
      const zipPath = storage.outputZipPath(jobId);
      await fs.ensureDir(path.dirname(zipPath));
      await fs.writeFile(zipPath, 'fake zip content');

      const exists = await storage.outputZipExists(jobId);
      assert.strictEqual(exists, true);

      // cleanup
      await storage.rmdir(zipPath);
    });

    it('createOutputZipStream returns a readable stream', async () => {
      const jobId = 'zip-stream-test';
      const zipPath = storage.outputZipPath(jobId);
      await fs.ensureDir(path.dirname(zipPath));
      await fs.writeFile(zipPath, 'stream content');

      const stream = await storage.createOutputZipStream(jobId);
      assert.ok(stream);
      assert.strictEqual(typeof stream.pipe, 'function');

      // Read the content
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      assert.strictEqual(Buffer.concat(chunks).toString(), 'stream content');

      await storage.rmdir(zipPath);
    });
  });

  // -----------------------------------------------------------------------
  // Prune stale
  // -----------------------------------------------------------------------
  describe('pruneStale', () => {
    it('removes directories for IDs not in active set', async () => {
      const staleId = 'stale-job';
      const activeId = 'active-job';

      await storage.ensureUploadDir(staleId);
      await storage.ensureUploadDir(activeId);
      await fs.ensureDir(storage.workDir(staleId));
      await fs.writeFile(path.join(storage.workDir(staleId), 'data.txt'), 'x');

      assert.strictEqual(await fs.pathExists(storage.uploadDir(staleId)), true);
      assert.strictEqual(await fs.pathExists(storage.uploadDir(activeId)), true);

      await storage.pruneStale([activeId]);

      assert.strictEqual(await fs.pathExists(storage.uploadDir(staleId)), false);
      assert.strictEqual(await fs.pathExists(storage.workDir(staleId)), false);
      assert.strictEqual(await fs.pathExists(storage.uploadDir(activeId)), true);

      await storage.cleanupJob(activeId);
    });

    it('does nothing when all jobs are active', async () => {
      const j1 = 'p-j1';
      const j2 = 'p-j2';
      await storage.ensureUploadDir(j1);
      await storage.ensureUploadDir(j2);

      await storage.pruneStale([j1, j2]);

      assert.strictEqual(await fs.pathExists(storage.uploadDir(j1)), true);
      assert.strictEqual(await fs.pathExists(storage.uploadDir(j2)), true);

      await storage.cleanupJob(j1);
      await storage.cleanupJob(j2);
    });

    it('handles non-existent directories gracefully', async () => {
      await assert.doesNotReject(() => storage.pruneStale(['some-id']));
    });

    it('cleans up orphan result ZIPs', async () => {
      const active = 'orphan-test-active';
      const orphanZip = storage.outputZipPath('orphan-zip');
      await fs.ensureDir(path.dirname(orphanZip));
      await fs.writeFile(orphanZip, 'orphan');

      await storage.ensureUploadDir(active);

      assert.strictEqual(await fs.pathExists(orphanZip), true);

      await storage.pruneStale([active]);

      assert.strictEqual(await fs.pathExists(orphanZip), false);

      await storage.cleanupJob(active);
    });
  });
});

import path from 'path';
import fs from 'fs-extra';

/**
 * Local filesystem storage backend.
 *
 * Organises uploaded files, working directories, and result artifacts
 * under a configurable root.  Every path is scoped to a job ID.
 */
export class LocalStorage {
  constructor(rootPath) {
    this.root = path.resolve(rootPath);
    this._uploads = path.join(this.root, 'uploads');
    this._work = path.join(this.root, 'work');
    this._results = path.join(this.root, 'results');
  }

  // -----------------------------------------------------------------------
  // Path construction
  // -----------------------------------------------------------------------

  uploadDir(jobId) {
    return path.join(this._uploads, jobId);
  }

  workDir(jobId) {
    return path.join(this._work, jobId);
  }

  fileWorkDir(jobId, fileId) {
    return path.join(this._work, jobId, fileId);
  }

  resultDir(jobId) {
    return path.join(this._results, jobId);
  }

  outputZipPath(jobId) {
    return path.join(this._results, `${jobId}.zip`);
  }

  // -----------------------------------------------------------------------
  // Directory lifecycle
  // -----------------------------------------------------------------------

  async ensureUploadDir(jobId) {
    return fs.ensureDir(this.uploadDir(jobId));
  }

  async ensureResultDir(jobId) {
    return fs.ensureDir(this.resultDir(jobId));
  }

  async rmdir(dir) {
    return fs.remove(dir).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Per-job cleanup
  // -----------------------------------------------------------------------

  async cleanupJob(jobId) {
    await Promise.all([
      this.rmdir(this.uploadDir(jobId)),
      this.rmdir(this.workDir(jobId)),
      this.rmdir(this.resultDir(jobId)),
      this.rmdir(this.outputZipPath(jobId))
    ]);
  }

  // -----------------------------------------------------------------------
  // URL resolution (for Playwright local server)
  // -----------------------------------------------------------------------

  toPublicUrl(port, absolutePath, relativeTo) {
    const base = relativeTo ? path.resolve(relativeTo) : this.root;
    const relative = path.relative(base, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(
        `Path traversal detected: ${absolutePath} is outside serve root ${base}`
      );
    }
    const urlPath = relative.split(path.sep).map(encodeURIComponent).join('/');
    return `http://localhost:${port}/${urlPath}`;
  }

  // -----------------------------------------------------------------------
  // Result ZIP streaming (for download endpoint)
  // -----------------------------------------------------------------------

  async createOutputZipStream(jobId) {
    const zipPath = this.outputZipPath(jobId);
    if (!(await fs.pathExists(zipPath))) return null;
    return fs.createReadStream(zipPath);
  }

  async outputZipExists(jobId) {
    return fs.pathExists(this.outputZipPath(jobId));
  }

  // -----------------------------------------------------------------------
  // Stale directory pruning
  // -----------------------------------------------------------------------

  async pruneStale(activeJobIds) {
    const set = new Set(activeJobIds);
    const buckets = ['_uploads', '_work', '_results'];
    for (const bucket of buckets) {
      const dir = this[bucket];
      let entries;
      try {
        entries = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const jobId = entry.endsWith('.zip') ? path.basename(entry, '.zip') : entry;
        if (!set.has(jobId)) {
          await this.rmdir(path.join(dir, entry));
        }
      }
    }
  }
}

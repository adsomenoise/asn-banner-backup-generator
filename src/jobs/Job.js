import crypto from 'crypto';

export const JOB_STATUSES = ['uploaded', 'processing', 'complete', 'error'];
export const FILE_STATES = ['uploaded', 'queued', 'processing', 'complete', 'failed'];

export class FileInfo {
  constructor(props = {}) {
    this.id = props.id || '';
    this.name = props.name || '';
    this.path = props.path || null;
    this.type = props.type || 'zip';
    this.state = props.state || 'uploaded';
    this.error = props.error || null;
  }

  setState(newState, errorMsg) {
    if (!FILE_STATES.includes(newState)) {
      throw new Error(`Invalid file state: ${newState}`);
    }
    this.state = newState;
    if (errorMsg) {
      this.error = errorMsg;
    }
  }

  toJSON() {
    return {
      fileId: this.id,
      fileName: this.name,
      fileType: this.type,
      state: this.state,
      error: this.error || null
    };
  }
}

export class Job {
  constructor(props = {}) {
    this.id = props.id || crypto.randomUUID().slice(0, 8);
    this.userId = props.userId || null;
    this.tenantId = props.tenantId || null;
    this.clientId = props.clientId || null;
    this.status = props.status || 'uploaded';
    this.createdAt = props.createdAt || new Date().toISOString();
    this.updatedAt = props.updatedAt || this.createdAt;
    this.expiresAt = props.expiresAt || null;
    this.files = (props.files || []).map(f => (f instanceof FileInfo ? f : new FileInfo(f)));
    this.total = props.total || this.files.length;
    this.results = props.results || [];
    this.errors = props.errors || [];
    this.outputZip = props.outputZip || null;
    this.resultDir = props.resultDir || null;
  }

  setStatus(newStatus) {
    if (!JOB_STATUSES.includes(newStatus)) {
      throw new Error(`Invalid job status: ${newStatus}`);
    }
    this.status = newStatus;
    this.updatedAt = new Date().toISOString();
  }

  get completedCount() {
    return this.files.filter(f => f.state === 'complete').length;
  }

  get failedCount() {
    return this.files.filter(f => f.state === 'failed').length;
  }

  get resultsCount() {
    return this.results.length;
  }

  isExpired() {
    return this.expiresAt ? Date.now() > new Date(this.expiresAt).getTime() : false;
  }

  isOwnedBy(auth) {
    if (!auth) return false;
    if (this.userId && this.userId !== auth.userId) return false;
    if (this.tenantId && auth.tenantId && this.tenantId !== auth.tenantId) return false;
    if (this.clientId && auth.clientId && this.clientId !== auth.clientId) return false;
    return true;
  }

  toJSON() {
    return {
      jobId: this.id,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      files: this.files.map(f => f.toJSON()),
      progress: {
        total: this.total,
        completed: this.completedCount,
        failed: this.failedCount,
        results: this.resultsCount
      },
      canRetry: this.failedCount > 0 && (this.status === 'complete' || this.status === 'error')
    };
  }
}

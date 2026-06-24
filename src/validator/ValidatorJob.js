import crypto from 'crypto';
import { summarizeFindings } from './findings.js';

export const VALIDATOR_JOB_STATUSES = ['uploaded', 'validating', 'complete', 'error'];
export const VALIDATOR_FILE_STATUSES = ['pending', 'validating', 'pass', 'warning', 'fail', 'error'];

function copyData(value) {
  return value == null ? value : structuredClone(value);
}

export class ValidatorFileReport {
  constructor(props = {}) {
    this.fileId = props.fileId || props.id || '';
    this.fileName = props.fileName || props.name || '';
    this.fileType = props.fileType || props.type || 'zip';
    this.path = props.path || null;
    this.size = props.size || 0;
    this.status = props.status || 'pending';
    this.metadata = copyData(props.metadata || {});
    this.findings = copyData(props.findings || []);
  }

  setFindings(findings) {
    this.findings = copyData(findings || []);
    this.status = summarizeFindings(this.findings).status;
  }

  setStatus(status) {
    if (!VALIDATOR_FILE_STATUSES.includes(status)) {
      throw new Error(`Invalid validator file status: ${status}`);
    }
    this.status = status;
  }

  toJSON() {
    const summary = summarizeFindings(this.findings);
    return {
      fileId: this.fileId,
      fileName: this.fileName,
      fileType: this.fileType,
      size: this.size,
      status: this.status,
      metadata: copyData(this.metadata),
      findings: copyData(this.findings),
      summary
    };
  }
}

export class ValidatorJob {
  constructor(props = {}) {
    this.id = props.id || crypto.randomUUID().slice(0, 8);
    this.userId = props.userId || null;
    this.tenantId = props.tenantId || null;
    this.clientId = props.clientId || null;
    this.preset = props.preset || 'generic';
    this.status = props.status || 'uploaded';
    this.createdAt = props.createdAt || new Date().toISOString();
    this.updatedAt = props.updatedAt || this.createdAt;
    this.files = (props.files || []).map(f => f instanceof ValidatorFileReport ? f : new ValidatorFileReport(f));
    this.error = props.error || null;
  }

  setStatus(status) {
    if (!VALIDATOR_JOB_STATUSES.includes(status)) {
      throw new Error(`Invalid validator job status: ${status}`);
    }
    this.status = status;
    this.updatedAt = new Date().toISOString();
  }

  isOwnedBy(auth) {
    if (!auth) return false;
    if (this.userId && this.userId !== auth.userId) return false;
    if (this.tenantId && auth.tenantId && this.tenantId !== auth.tenantId) return false;
    if (this.clientId && auth.clientId && this.clientId !== auth.clientId) return false;
    return true;
  }

  get allFindings() {
    return this.files.flatMap(f => f.findings);
  }

  get overall() {
    return summarizeFindings(this.allFindings);
  }

  get progress() {
    const completedFiles = this.files.filter(f => ['pass', 'warning', 'fail', 'error'].includes(f.status));
    return {
      total: this.files.length,
      completed: completedFiles.length,
      failed: this.files.filter(f => ['fail', 'error'].includes(f.status)).length,
      warnings: this.files.filter(f => f.status === 'warning').length
    };
  }

  toJSON() {
    return {
      jobId: this.id,
      status: this.status,
      preset: this.preset,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      progress: this.progress,
      overall: this.overall,
      files: this.files.map(f => f.toJSON()),
      error: this.error
    };
  }
}

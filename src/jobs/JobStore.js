export class JobStore {
  async create(job) {
    throw new Error('Not implemented');
  }

  async get(jobId) {
    throw new Error('Not implemented');
  }

  async update(jobId, changes) {
    throw new Error('Not implemented');
  }

  async delete(jobId) {
    throw new Error('Not implemented');
  }

  async findByUser(userId) {
    throw new Error('Not implemented');
  }

  async list() {
    throw new Error('Not implemented');
  }
}

export class InMemoryJobStore extends JobStore {
  constructor() {
    super();
    this._jobs = new Map();
  }

  async create(job) {
    const id = job.id;
    if (this._jobs.has(id)) {
      throw new Error(`Job "${id}" already exists`);
    }
    this._jobs.set(id, job);
    return job;
  }

  async get(jobId) {
    return this._jobs.get(jobId) || null;
  }

  async update(jobId, changes) {
    const job = this._jobs.get(jobId);
    if (!job) return null;
    Object.assign(job, changes);
    job.updatedAt = new Date().toISOString();
    return job;
  }

  async delete(jobId) {
    return this._jobs.delete(jobId);
  }

  async findByUser(userId) {
    const results = [];
    for (const job of this._jobs.values()) {
      if (job.userId === userId) results.push(job);
    }
    return results;
  }

  async list() {
    return Array.from(this._jobs.values());
  }

  get size() {
    return this._jobs.size;
  }
}

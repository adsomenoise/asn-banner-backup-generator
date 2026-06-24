export class ValidatorStore {
  constructor() {
    this.jobs = new Map();
  }

  get size() {
    return this.jobs.size;
  }

  async create(job) {
    if (this.jobs.has(job.id)) {
      throw new Error(`Validator job already exists: ${job.id}`);
    }
    this.jobs.set(job.id, job);
    return job;
  }

  async get(id) {
    return this.jobs.get(id) || null;
  }

  async update(id, updates) {
    const job = await this.get(id);
    if (!job) return null;
    Object.assign(job, updates);
    job.updatedAt = new Date().toISOString();
    return job;
  }

  async delete(id) {
    return this.jobs.delete(id);
  }

  async list() {
    return Array.from(this.jobs.values());
  }
}

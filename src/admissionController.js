export class AdmissionRejectedError extends Error {
  constructor(message = 'The processing queue is full') {
    super(message);
    this.name = 'AdmissionRejectedError';
    this.code = 'QUEUE_FULL';
  }
}

export class AdmissionController {
  constructor({ maxGlobal = 3, maxPerTenant = 1, maxQueued = 100 } = {}) {
    this.maxGlobal = maxGlobal;
    this.maxPerTenant = maxPerTenant;
    this.maxQueued = maxQueued;
    this.running = 0;
    this.byTenant = new Map();
    this.waiting = [];
  }

  acquire(tenantId = 'default') {
    const key = String(tenantId || 'default');
    if (this.#canRun(key)) return Promise.resolve(this.#lease(key));
    if (this.waiting.length >= this.maxQueued) {
      return Promise.reject(new AdmissionRejectedError());
    }
    return new Promise((resolve, reject) => this.waiting.push({ key, resolve, reject }));
  }

  #canRun(key) {
    return this.running < this.maxGlobal && (this.byTenant.get(key) || 0) < this.maxPerTenant;
  }

  #lease(key) {
    this.running++;
    this.byTenant.set(key, (this.byTenant.get(key) || 0) + 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.running--;
        const remaining = (this.byTenant.get(key) || 1) - 1;
        if (remaining > 0) this.byTenant.set(key, remaining);
        else this.byTenant.delete(key);
        this.#drain();
      }
    };
  }

  #drain() {
    for (let index = 0; index < this.waiting.length && this.running < this.maxGlobal;) {
      const waiter = this.waiting[index];
      if (!this.#canRun(waiter.key)) {
        index++;
        continue;
      }
      this.waiting.splice(index, 1);
      waiter.resolve(this.#lease(waiter.key));
    }
  }

  snapshot() {
    return { running: this.running, queued: this.waiting.length, tenants: this.byTenant.size };
  }
}

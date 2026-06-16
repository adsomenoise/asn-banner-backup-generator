// ---------------------------------------------------------------------------
// Simple in-memory metrics collector
// ---------------------------------------------------------------------------
// Tags are appended to the metric name as |key=value to keep it flat.
// This lets us swap in a real metrics backend (Prometheus, StatsD, etc.)
// later without changing the calling code.

function taggedName(name, tags) {
  if (!tags || Object.keys(tags).length === 0) return name;
  const suffix = Object.entries(tags)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('|');
  return suffix ? `${name}|${suffix}` : name;
}

class Metrics {
  constructor() {
    this._counters = new Map();
    this._timings = new Map();
  }

  increment(name, tags = {}) {
    const key = taggedName(name, tags);
    this._counters.set(key, (this._counters.get(key) || 0) + 1);
  }

  count(name, value, tags = {}) {
    const key = taggedName(name, tags);
    this._counters.set(key, (this._counters.get(key) || 0) + value);
  }

  timing(name, durationMs, tags = {}) {
    const key = taggedName(name, tags);
    if (!this._timings.has(key)) {
      this._timings.set(key, []);
    }
    this._timings.get(key).push(durationMs);
  }

  // Returns a millisecond start time for use with endTimer
  startTimer() {
    return Date.now();
  }

  // Records a completed timer
  endTimer(name, startTime, tags = {}) {
    const elapsed = Date.now() - startTime;
    this.timing(name, elapsed, tags);
    return elapsed;
  }

  snapshot() {
    const counters = {};
    for (const [key, val] of this._counters) {
      counters[key] = val;
    }
    const timings = {};
    for (const [key, vals] of this._timings) {
      if (vals.length === 0) continue;
      const sorted = [...vals].sort((a, b) => a - b);
      timings[key] = {
        count: vals.length,
        sum: vals.reduce((a, b) => a + b, 0),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99)
      };
    }
    return { counters, timings };
  }

  reset() {
    this._counters.clear();
    this._timings.clear();
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export const metrics = new Metrics();

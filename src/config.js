export function parseCaptureConcurrency(value, { defaultValue = 3, max = 8 } = {}) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (!/^\d+$/.test(String(value))) return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return defaultValue;
  return Math.min(parsed, max);
}

// Virtual-time fast-forward for HTML5 banner ZIPs. On unless explicitly disabled.
export function getCaptureFastForward(env = process.env) {
  const value = String(env.CAPTURE_FAST_FORWARD ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(value);
}

export function getCaptureConcurrency(env = process.env) {
  return parseCaptureConcurrency(env.CAPTURE_CONCURRENCY);
}

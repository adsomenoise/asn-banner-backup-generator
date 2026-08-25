const DEFAULTS = {
  overallTimeoutMs: 30000,
  navigationTimeoutMs: 8000,
  loadStateTimeoutMs: 1000,
  explicitReadyTimeoutMs: 1000,
  videoSeekTimeoutMs: 5000,
  riveSettleMs: 1500,
  endFrameTimeoutMs: 15000,
  visualStableForMs: 2000,
  visualPollIntervalMs: 250,
  visualPixelDeltaThreshold: 1
};

export const DEFAULT_CAPTURE_POLICY = Object.freeze({ ...DEFAULTS });

function positiveNumber(value, fallback, name) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Capture policy ${name} must be a positive number`);
  }
  return parsed;
}

export function resolveCapturePolicy(overrides = {}) {
  const policy = {};
  for (const [name, fallback] of Object.entries(DEFAULTS)) {
    policy[name] = positiveNumber(overrides[name], fallback, name);
  }
  policy.visualStableForMs = Math.min(policy.visualStableForMs, policy.endFrameTimeoutMs);
  return Object.freeze(policy);
}

export function remainingBudget(deadlineAt, maximum) {
  return Math.max(1, Math.min(maximum, deadlineAt - Date.now()));
}

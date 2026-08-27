const DEFAULTS = {
  overallTimeoutMs: 30000,
  navigationTimeoutMs: 8000,
  loadStateTimeoutMs: 1000,
  explicitReadyTimeoutMs: 1000,
  riveStateTimeoutMs: 1000,
  videoSeekTimeoutMs: 5000,
  riveSettleMs: 1500,
  endFrameTimeoutMs: 15000,
  visualStableForMs: 2000,
  visualPollIntervalMs: 250,
  visualPixelDeltaThreshold: 1
};

const DEFAULT_RIVE_END_STATE_NAMES = Object.freeze(['end', 'main_animation_rollout']);

export const DEFAULT_CAPTURE_POLICY = Object.freeze({
  ...DEFAULTS,
  riveEndStateNames: DEFAULT_RIVE_END_STATE_NAMES
});

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
  const stateNames = overrides.riveEndStateNames ?? DEFAULT_RIVE_END_STATE_NAMES;
  if (!Array.isArray(stateNames) || stateNames.length === 0 || stateNames.some(name => typeof name !== 'string' || !name.trim())) {
    throw new Error('Capture policy riveEndStateNames must be a non-empty array of state names');
  }
  policy.riveEndStateNames = Object.freeze(stateNames.map(name => name.trim()));
  policy.visualStableForMs = Math.min(policy.visualStableForMs, policy.endFrameTimeoutMs);
  return Object.freeze(policy);
}

export function remainingBudget(deadlineAt, maximum) {
  return Math.max(1, Math.min(maximum, deadlineAt - Date.now()));
}

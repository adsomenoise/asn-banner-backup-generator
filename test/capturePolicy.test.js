import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DEFAULT_CAPTURE_POLICY, resolveCapturePolicy } from '../src/capture/policy.js';

describe('capture policy', () => {
  it('exposes all stage budgets from one immutable policy', () => {
    const policy = resolveCapturePolicy();
    assert.deepStrictEqual(policy, DEFAULT_CAPTURE_POLICY);
    assert.ok(Object.isFrozen(policy));
    assert.ok(policy.navigationTimeoutMs < policy.overallTimeoutMs);
  });

  it('accepts overrides and bounds visual stability by the end-frame deadline', () => {
    const policy = resolveCapturePolicy({
      endFrameTimeoutMs: 900,
      visualStableForMs: 2000,
      videoSeekTimeoutMs: 250
    });
    assert.strictEqual(policy.endFrameTimeoutMs, 900);
    assert.strictEqual(policy.visualStableForMs, 900);
    assert.strictEqual(policy.videoSeekTimeoutMs, 250);
  });

  it('rejects invalid budgets', () => {
    assert.throws(
      () => resolveCapturePolicy({ navigationTimeoutMs: 0 }),
      /navigationTimeoutMs must be a positive number/
    );
  });
});

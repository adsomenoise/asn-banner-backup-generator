import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseCaptureConcurrency } from '../src/webServer.js';

describe('parseCaptureConcurrency', () => {
  it('defaults to 3 when CAPTURE_CONCURRENCY is not set', () => {
    assert.strictEqual(parseCaptureConcurrency(undefined), 3);
  });

  it('uses a positive integer from CAPTURE_CONCURRENCY', () => {
    assert.strictEqual(parseCaptureConcurrency('5'), 5);
  });

  it('falls back to the default for invalid values', () => {
    assert.strictEqual(parseCaptureConcurrency('fast'), 3);
    assert.strictEqual(parseCaptureConcurrency('0'), 3);
    assert.strictEqual(parseCaptureConcurrency('-2'), 3);
    assert.strictEqual(parseCaptureConcurrency('1.5'), 3);
  });

  it('caps excessive values at 8', () => {
    assert.strictEqual(parseCaptureConcurrency('99'), 8);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  commonDenominator, deliveryTimestamp, deliveryZipName, getDeliveryTimeZone, DEFAULT_DELIVERY_TIMEZONE
} from '../src/jobs/deliveryName.js';

const TEL = [
  'tel-cons-ns-bingefoot-platforms-w3-display-970x250-nl.zip',
  'tel-cons-ns-bingefoot-platforms-w3-display-320x480-nl.zip',
  'tel-cons-ns-bingefoot-platforms-w3-display-300x600-nl.zip',
  'tel-cons-ns-bingefoot-platforms-w3-display-300x250-nl.zip'
];

describe('commonDenominator', () => {
  it('returns the shared prefix without the trailing separator', () => {
    assert.strictEqual(commonDenominator(TEL), 'tel-cons-ns-bingefoot-platforms-w3-display');
  });

  it('cuts back to a whole segment instead of stopping mid-word', () => {
    assert.strictEqual(commonDenominator(['banner-300x250.zip', 'banner-300x600.zip']), 'banner');
  });

  it('keeps a prefix that ends exactly on a boundary', () => {
    assert.strictEqual(commonDenominator(['hero_300x250.riv', 'hero_300x250_v2.zip']), 'hero_300x250');
  });

  it('ignores extensions, so mixed .zip/.riv/.mp4 still match', () => {
    assert.strictEqual(commonDenominator(['camp_a_300x250.zip', 'camp_a_1080x1920.riv', 'camp_a_video.mp4']), 'camp_a');
  });

  it('returns a single name whole', () => {
    assert.strictEqual(commonDenominator(['tel-display-970x250-nl.zip']), 'tel-display-970x250-nl');
  });

  it('returns empty when the names share nothing', () => {
    assert.strictEqual(commonDenominator(['alpha.zip', 'beta.zip']), '');
    assert.strictEqual(commonDenominator(['abc-1.zip', 'abd-1.zip']), '');
    assert.strictEqual(commonDenominator([]), '');
  });

  it('strips characters that are unsafe in filenames', () => {
    assert.strictEqual(commonDenominator(['a:b-1.zip', 'a:b-2.zip']), 'ab');
  });
});

describe('deliveryTimestamp', () => {
  it('formats YYMMDDHHmm in the given time zone', () => {
    const date = new Date('2026-09-25T13:16:00Z'); // 15:16 in Brussels (CEST)
    assert.strictEqual(deliveryTimestamp(date, 'Europe/Brussels'), '2609251516');
    assert.strictEqual(deliveryTimestamp(date, 'UTC'), '2609251316');
  });

  it('uses 24-hour time with midnight as 00', () => {
    assert.strictEqual(deliveryTimestamp(new Date('2026-01-05T00:07:00Z'), 'UTC'), '2601050007');
  });
});

describe('deliveryZipName', () => {
  it('matches the documented example', () => {
    const date = new Date('2026-09-25T13:16:00Z');
    assert.strictEqual(
      deliveryZipName(TEL, { date, timeZone: 'Europe/Brussels' }),
      '2609251516_delivery_tel-cons-ns-bingefoot-platforms-w3-display.zip'
    );
  });

  it('falls back to <timestamp>_delivery.zip when nothing is shared', () => {
    const date = new Date('2026-09-25T13:16:00Z');
    assert.strictEqual(deliveryZipName(['alpha.zip', 'beta.zip'], { date, timeZone: 'UTC' }), '2609251316_delivery.zip');
  });
});

describe('getDeliveryTimeZone', () => {
  it('defaults to Europe/Brussels', () => {
    assert.strictEqual(getDeliveryTimeZone({}), DEFAULT_DELIVERY_TIMEZONE);
  });

  it('uses a valid DELIVERY_TIMEZONE', () => {
    assert.strictEqual(getDeliveryTimeZone({ DELIVERY_TIMEZONE: 'UTC' }), 'UTC');
  });

  it('ignores an invalid DELIVERY_TIMEZONE', () => {
    assert.strictEqual(getDeliveryTimeZone({ DELIVERY_TIMEZONE: 'Mars/Olympus' }), DEFAULT_DELIVERY_TIMEZONE);
  });
});

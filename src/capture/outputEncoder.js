import sharp from 'sharp';
import { logger } from '../logger.js';
import { metrics } from '../metrics.js';

export const DEFAULT_MAX_BYTES = 80 * 1024;
const JPEG_QUALITY_TIERS = [95, 80, 65, 50, 35];
const PNG_QUALITY_TIERS = [100, 80, 60, 40, 20];

export function normalizeOutputFormat(format = 'jpeg') {
  const normalized = String(format).toLowerCase();
  if (normalized === 'jpg') return 'jpeg';
  if (normalized === 'jpeg' || normalized === 'png') return normalized;
  throw new Error(`Unsupported output format: ${format}`);
}

export function extensionForFormat(format) {
  return normalizeOutputFormat(format) === 'png' ? '.png' : '.jpg';
}

function qualityTiers(preferredQuality, defaults) {
  if (Number.isInteger(preferredQuality) && preferredQuality >= 1 && preferredQuality <= 100) {
    return [preferredQuality, ...defaults.filter(quality => quality < preferredQuality)];
  }
  return [...defaults];
}

function validMaxBytes(maxBytes) {
  if (maxBytes === null || maxBytes === false) return null;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('maxBytes must be a positive integer, null, or false');
  }
  return maxBytes;
}

export async function encodeScreenshot(inputBuffer, options = {}) {
  const format = normalizeOutputFormat(options.format || 'jpeg');
  const maxBytes = validMaxBytes(options.maxBytes === undefined ? DEFAULT_MAX_BYTES : options.maxBytes);
  const defaults = format === 'png' ? PNG_QUALITY_TIERS : JPEG_QUALITY_TIERS;
  const tiers = qualityTiers(options.quality, defaults);
  const log = logger.child({ module: 'outputEncoder' });
  const startedAt = Date.now();
  let buffer = inputBuffer;
  let selectedQuality = tiers[tiers.length - 1];

  for (const quality of tiers) {
    selectedQuality = quality;
    buffer = format === 'png'
      ? await sharp(inputBuffer).png({ palette: true, quality, compressionLevel: 9 }).toBuffer()
      : await sharp(inputBuffer).jpeg({
        quality,
        mozjpeg: true,
        chromaSubsampling: '4:2:0',
        trellisQuantisation: true,
        overshootDeringing: true,
        optimiseScan: true
      }).toBuffer();
    log.debug('Compression tier', { format, quality, size: buffer.length, maxBytes });
    if (maxBytes === null || buffer.length <= maxBytes) break;
  }

  const withinSizeLimit = maxBytes === null || buffer.length <= maxBytes;
  metrics.timing('compression.duration', Date.now() - startedAt, { format });
  metrics.increment('compression.complete', { format });
  metrics.increment('compression.tier_selected', { format, quality: String(selectedQuality) });
  metrics.count('compression.bytes', buffer.length, { format });

  return {
    buffer,
    format,
    byteLength: buffer.length,
    quality: selectedQuality,
    maxBytes,
    withinSizeLimit
  };
}

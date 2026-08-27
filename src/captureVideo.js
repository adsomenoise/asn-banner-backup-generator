import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import sharp from 'sharp';
import { logger } from './logger.js';

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.wmv'];
const DEFAULT_VIDEO_PROBE_TIMEOUT_MS = 15000;
const DEFAULT_VIDEO_FRAME_TIMEOUT_MS = 30000;
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_VIDEO_AXIS = 4096;
const MAX_VIDEO_PIXELS = 16 * 1024 * 1024;

function isVideoFile(filename) {
  return VIDEO_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext));
}

function createTimeoutGuard(proc, commandName, timeoutMs, reject) {
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    proc.kill('SIGKILL');
    reject(new Error(`${commandName} timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return callback => {
    if (settled) return false;
    settled = true;
    clearTimeout(timer);
    callback();
    return true;
  };
}

function appendBounded(current, chunk, maxBytes, proc, label, finish, reject) {
  const next = Buffer.byteLength(current) + chunk.length;
  if (next > maxBytes) {
    proc.kill('SIGKILL');
    finish(() => reject(new Error(`${label} exceeded the ${maxBytes} byte output limit`)));
    return current;
  }
  return current + chunk.toString();
}

function assertVideoDimensions(dimensions) {
  const { width, height } = dimensions || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > MAX_VIDEO_AXIS || height > MAX_VIDEO_AXIS || width * height > MAX_VIDEO_PIXELS) {
    throw new Error(`Video dimensions ${width}x${height} exceed the safe decode limit`);
  }
  return dimensions;
}

async function getVideoDimensions(videoPath, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs || DEFAULT_VIDEO_PROBE_TIMEOUT_MS;
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      videoPath
    ]);
    const finish = createTimeoutGuard(proc, 'ffprobe', timeoutMs, reject);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk, MAX_PROCESS_OUTPUT_BYTES, proc, 'ffprobe stdout', finish, reject); });
    proc.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk, MAX_PROCESS_OUTPUT_BYTES, proc, 'ffprobe stderr', finish, reject); });

    proc.on('close', code => finish(() => {
      if (code !== 0) return reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      const parts = stdout.trim().split(',');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return reject(new Error(`Could not parse video dimensions from: ${stdout.trim()}`));
      }
      const width = parseInt(parts[0], 10);
      const height = parseInt(parts[1], 10);
      if (!width || !height) return reject(new Error(`Invalid video dimensions: ${width}x${height}`));
      resolve(assertVideoDimensions({ width, height }));
    }));

    proc.on('error', error => finish(() => reject(error)));
  });
}

async function getVideoMetadata(videoPath, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs || DEFAULT_VIDEO_PROBE_TIMEOUT_MS;
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,width,height:format=duration,bit_rate',
      '-of', 'json',
      videoPath
    ]);
    const finish = createTimeoutGuard(proc, 'ffprobe', timeoutMs, reject);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk, MAX_PROCESS_OUTPUT_BYTES, proc, 'ffprobe stdout', finish, reject); });
    proc.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk, MAX_PROCESS_OUTPUT_BYTES, proc, 'ffprobe stderr', finish, reject); });

    proc.on('close', code => finish(() => {
      if (code !== 0) return reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));

      try {
        const parsed = JSON.parse(stdout);
        const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
        const videoStream = streams.find(stream => stream.codec_type === 'video');
        const hasAudio = streams.some(stream => stream.codec_type === 'audio');
        const duration = Number.parseFloat(parsed.format?.duration);
        const bitrate = Number.parseInt(parsed.format?.bit_rate, 10);

        resolve({
          dimensions: videoStream?.width && videoStream?.height
            ? { width: videoStream.width, height: videoStream.height }
            : null,
          durationSeconds: Number.isFinite(duration) ? duration : null,
          bitrate: Number.isFinite(bitrate) ? bitrate : null,
          hasAudio
        });
      } catch (error) {
        reject(new Error(`Could not parse ffprobe JSON: ${error.message}`));
      }
    }));

    proc.on('error', error => finish(() => reject(error)));
  });
}

function parseIntegratedLoudness(stderr) {
  const summaryMatch = stderr.match(/Integrated loudness:[\s\S]*?\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/i);
  if (summaryMatch) return Number.parseFloat(summaryMatch[1]);

  const lineMatches = [...stderr.matchAll(/\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/gi)];
  if (lineMatches.length === 0) return null;
  return Number.parseFloat(lineMatches[lineMatches.length - 1][1]);
}

async function probeVideoLoudness(videoPath, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs || DEFAULT_VIDEO_PROBE_TIMEOUT_MS;
    const proc = spawn('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-i', videoPath,
      '-filter_complex', 'ebur128',
      '-f', 'null',
      '-'
    ]);
    const finish = createTimeoutGuard(proc, 'ffmpeg', timeoutMs, reject);

    let stderr = '';
    proc.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk, MAX_PROCESS_OUTPUT_BYTES, proc, 'ffmpeg stderr', finish, reject); });

    proc.on('close', code => finish(() => {
      const integrated = parseIntegratedLoudness(stderr);
      if (integrated !== null) {
        resolve({ integrated });
        return;
      }
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        return;
      }
      reject(new Error(`ffmpeg did not report integrated loudness: ${stderr}`));
    }));

    proc.on('error', error => finish(() => reject(error)));
  });
}

async function extractLastFrame(videoPath, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs || DEFAULT_VIDEO_FRAME_TIMEOUT_MS;
    const buffers = [];
    let outputBytes = 0;
    const proc = spawn('ffmpeg', [
      '-sseof', '-0.1',
      '-i', videoPath,
      '-vframes', '1',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-'
    ]);
    const finish = createTimeoutGuard(proc, 'ffmpeg', timeoutMs, reject);

    proc.stdout.on('data', chunk => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_FRAME_BYTES) {
        proc.kill('SIGKILL');
        finish(() => reject(new Error(`ffmpeg frame exceeded the ${MAX_FRAME_BYTES} byte output limit`)));
        return;
      }
      buffers.push(chunk);
    });

    let stderr = '';
    proc.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk, MAX_PROCESS_OUTPUT_BYTES, proc, 'ffmpeg stderr', finish, reject); });

    proc.on('close', code => finish(() => {
      if (buffers.length === 0) {
        return reject(new Error(`ffmpeg produced no output (exit ${code}): ${stderr}`));
      }
      resolve(Buffer.concat(buffers, outputBytes));
    }));

    proc.on('error', error => finish(() => reject(error)));
  });
}

const JPEG_QUALITY_TIERS = [85, 75, 60, 45, 30, 15];
const MAX_SIZE = 80 * 1024;

async function captureVideoFrame(videoPath, resultDir, baseName) {
  const log = logger.child({ module: 'captureVideo' });
  const start = Date.now();

  const dimensions = await getVideoDimensions(videoPath);
  log.info('Video dimensions', { width: dimensions.width, height: dimensions.height });

  const frameBuffer = await extractLastFrame(videoPath);

  const outputPath = path.join(resultDir, `${baseName}.jpg`);

  let finalBuffer = null;
  let usedQuality = null;

  for (const quality of JPEG_QUALITY_TIERS) {
    const buffer = await sharp(frameBuffer)
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    if (buffer.length <= MAX_SIZE) {
      finalBuffer = buffer;
      usedQuality = quality;
      break;
    }
  }

  if (!finalBuffer) {
    finalBuffer = await sharp(frameBuffer)
      .jpeg({ quality: 10, mozjpeg: true })
      .toBuffer();
    usedQuality = 10;
  }

  await fs.writeFile(outputPath, finalBuffer);

  const duration = Date.now() - start;
  const fileSize = finalBuffer.length;

  log.info('Capture complete', {
    duration,
    dimensions: `${dimensions.width}x${dimensions.height}`,
    size: fileSize,
    quality: usedQuality
  });

  return {
    dimensions,
    duration,
    strategy: 'video_last_frame',
    size: fileSize,
    quality: usedQuality
  };
}

export {
  captureVideoFrame,
  isVideoFile,
  getVideoDimensions,
  getVideoMetadata,
  probeVideoLoudness,
  VIDEO_EXTENSIONS,
  assertVideoDimensions
};

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import sharp from 'sharp';
import { logger } from './logger.js';

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.wmv'];

function isVideoFile(filename) {
  return VIDEO_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext));
}

async function getVideoDimensions(videoPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      videoPath
    ]);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      const parts = stdout.trim().split(',');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return reject(new Error(`Could not parse video dimensions from: ${stdout.trim()}`));
      }
      const width = parseInt(parts[0], 10);
      const height = parseInt(parts[1], 10);
      if (!width || !height) return reject(new Error(`Invalid video dimensions: ${width}x${height}`));
      resolve({ width, height });
    });

    proc.on('error', reject);
  });
}

async function getVideoMetadata(videoPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,width,height:format=duration,bit_rate',
      '-of', 'json',
      videoPath
    ]);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

    proc.on('close', code => {
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
    });

    proc.on('error', reject);
  });
}

function parseIntegratedLoudness(stderr) {
  const summaryMatch = stderr.match(/Integrated loudness:[\s\S]*?\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/i);
  if (summaryMatch) return Number.parseFloat(summaryMatch[1]);

  const lineMatches = [...stderr.matchAll(/\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/gi)];
  if (lineMatches.length === 0) return null;
  return Number.parseFloat(lineMatches[lineMatches.length - 1][1]);
}

async function probeVideoLoudness(videoPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-i', videoPath,
      '-filter_complex', 'ebur128',
      '-f', 'null',
      '-'
    ]);

    let stderr = '';
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

    proc.on('close', code => {
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
    });

    proc.on('error', reject);
  });
}

async function extractLastFrame(videoPath) {
  return new Promise((resolve, reject) => {
    const buffers = [];
    const proc = spawn('ffmpeg', [
      '-sseof', '-0.1',
      '-i', videoPath,
      '-vframes', '1',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-'
    ]);

    proc.stdout.on('data', chunk => buffers.push(chunk));

    let stderr = '';
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

    proc.on('close', code => {
      if (buffers.length === 0) {
        return reject(new Error(`ffmpeg produced no output (exit ${code}): ${stderr}`));
      }
      resolve(Buffer.concat(buffers));
    });

    proc.on('error', reject);
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
  VIDEO_EXTENSIONS
};

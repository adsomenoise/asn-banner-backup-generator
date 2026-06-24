import { getVideoMetadata, probeVideoLoudness } from '../../captureVideo.js';
import { buildFinding } from '../findings.js';

const HIGH_BITRATE_BPS = 5000000;
const HIGH_LOUDNESS_LUFS = -14;

export function classifyVideoMetadata(metadata, preset) {
  const findings = [];

  if (!metadata.dimensions || !metadata.dimensions.width || !metadata.dimensions.height) {
    findings.push(buildFinding('error', 'VIDEO_DIMENSIONS_MISSING', {
      title: 'Video dimensions missing',
      message: 'The video probe did not return width and height.',
      suggestion: 'Export the video with a valid video stream.'
    }));
  }

  if (
    preset.maxVideoDurationSeconds &&
    metadata.durationSeconds &&
    metadata.durationSeconds > preset.maxVideoDurationSeconds
  ) {
    findings.push(buildFinding('warning', 'VIDEO_DURATION_LONG', {
      title: 'Video duration exceeds preset',
      message: `Video duration is ${metadata.durationSeconds.toFixed(2)} seconds; the preset allows ${preset.maxVideoDurationSeconds} seconds.`,
      suggestion: 'Shorten the video or choose a preset that allows longer video.'
    }));
  }

  if (metadata.bitrate && metadata.bitrate > HIGH_BITRATE_BPS) {
    findings.push(buildFinding('warning', 'VIDEO_BITRATE_HIGH', {
      title: 'Video bitrate is high',
      message: `Video bitrate is ${metadata.bitrate} bps.`,
      suggestion: 'Reduce export bitrate if the destination has file size or delivery limits.'
    }));
  }

  if (metadata.hasAudio) {
    findings.push(buildFinding('info', 'VIDEO_HAS_AUDIO', {
      title: 'Video includes audio',
      message: 'The video has at least one audio stream.',
      suggestion: 'Confirm audio is allowed for the selected ad destination.'
    }));
  }

  if (
    metadata.loudness &&
    typeof metadata.loudness.integrated === 'number' &&
    metadata.loudness.integrated > HIGH_LOUDNESS_LUFS
  ) {
    findings.push(buildFinding('warning', 'VIDEO_LOUDNESS_HIGH', {
      title: 'Video loudness is high',
      message: `Integrated loudness is ${metadata.loudness.integrated} LUFS.`,
      suggestion: 'Normalize audio to -14 LUFS or lower if the destination requires quieter audio.'
    }));
  }

  return { metadata, findings };
}

export async function checkVideoFile({ filePath, fileName, preset }) {
  try {
    const metadata = await getVideoMetadata(filePath);
    if (metadata.hasAudio) {
      metadata.loudness = await probeVideoLoudness(filePath);
    }
    const result = classifyVideoMetadata(metadata, preset);
    result.findings.forEach(finding => {
      finding.path = finding.path || fileName;
    });
    return result;
  } catch (error) {
    return {
      metadata: {},
      findings: [
        buildFinding('error', 'VIDEO_PROBE_FAILED', {
          title: 'Video could not be probed',
          message: `Video metadata could not be read: ${error.message}`,
          suggestion: 'Verify the file is a playable video and that ffprobe is available.',
          path: fileName
        })
      ]
    };
  }
}

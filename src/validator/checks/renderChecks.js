import path from 'path';
import { pathToFileURL } from 'url';
import sharp from 'sharp';
import { getBrowserPool } from '../../browserPool.js';
import { buildFinding } from '../findings.js';

const DEFAULT_RENDER_SAMPLE_DELAY_MS = 2000;

function isNearBlank(stats) {
  const colorChannels = stats.channels.slice(0, 3);
  const means = colorChannels.map(channel => channel.mean);
  const deviations = colorChannels.map(channel => channel.stdev);
  const averageDeviation = deviations.reduce((sum, value) => sum + value, 0) / deviations.length;
  const isUniform = averageDeviation < 2;
  const isWhite = means.every(mean => mean > 245);
  const isBlack = means.every(mean => mean < 10);
  return isUniform && (isWhite || isBlack);
}

export async function checkRenderability({
  htmlPath,
  dimensions,
  displayPath = null,
  sampleDelayMs = DEFAULT_RENDER_SAMPLE_DELAY_MS
}) {
  const findings = [];
  const metadata = {
    rendered: false,
    blank: null,
    sampleDelayMs
  };
  let lease = null;
  let context = null;

  try {
    const pool = getBrowserPool();
    lease = await pool.acquire();
    context = await lease.browser.newContext({
      viewport: {
        width: dimensions.width,
        height: dimensions.height
      }
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, {
      waitUntil: 'load',
      timeout: 10000
    });
    if (sampleDelayMs > 0) {
      await page.waitForTimeout(sampleDelayMs);
    }
    const screenshot = await page.screenshot({ type: 'png' });
    const stats = await sharp(screenshot).stats();

    metadata.rendered = true;
    metadata.blank = isNearBlank(stats);

    if (metadata.blank) {
      findings.push(buildFinding('warning', 'BLANK_RENDER', {
        title: 'Rendered creative appears blank',
        message: `The HTML loaded, but the captured image is nearly blank after ${sampleDelayMs / 1000} seconds.`,
        suggestion: 'Check that required assets are included and the creative draws visible content within the first few seconds.',
        path: displayPath
      }));
    }
  } catch (error) {
    findings.push(buildFinding('error', 'RENDER_FAILED', {
      title: 'Creative could not be rendered',
      message: `The HTML could not be rendered: ${error.message}`,
      suggestion: 'Open the HTML locally and check for JavaScript, asset, or browser runtime errors.',
      path: displayPath
    }));
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (lease) {
      getBrowserPool().release(lease);
    }
  }

  return { metadata, findings };
}

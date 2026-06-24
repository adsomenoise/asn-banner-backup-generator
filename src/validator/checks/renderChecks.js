import path from 'path';
import { pathToFileURL } from 'url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { buildFinding } from '../findings.js';

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

export async function checkRenderability({ htmlPath, dimensions, displayPath = null }) {
  const findings = [];
  const metadata = {
    rendered: false,
    blank: null
  };
  let browser = null;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: {
        width: dimensions.width,
        height: dimensions.height
      }
    });
    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, {
      waitUntil: 'load',
      timeout: 10000
    });
    const screenshot = await page.screenshot({ type: 'png' });
    const stats = await sharp(screenshot).stats();

    metadata.rendered = true;
    metadata.blank = isNearBlank(stats);

    if (metadata.blank) {
      findings.push(buildFinding('warning', 'BLANK_RENDER', {
        title: 'Rendered creative appears blank',
        message: 'The HTML loaded, but the captured image is nearly blank.',
        suggestion: 'Check that required assets are included and the creative draws visible content immediately.',
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
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  return { metadata, findings };
}

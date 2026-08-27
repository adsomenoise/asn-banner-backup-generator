import fs from 'fs-extra';
import path from 'path';

export function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function getUniqueOutputPath(outputDir, baseName, extension = '.jpg') {
  let counter = 1;
  let outputPath = path.join(outputDir, `${baseName}${extension}`);
  
  while (fs.existsSync(outputPath)) {
    outputPath = path.join(outputDir, `${baseName}_${counter}${extension}`);
    counter++;
  }
  
  return outputPath;
}

export function parseDimensionsFromFileName(fileName) {
  const patterns = [
    /(\d+)x(\d+)/i,
    /(\d+)[-_]?(\d+)/,
    /width[=_](\d+).*height[=_](\d+)/i,
    /w[=_](\d+).*h[=_](\d+)/i
  ];
  
  for (const pattern of patterns) {
    const match = fileName.match(pattern);
    if (match) {
      const width = parseInt(match[1], 10);
      const height = parseInt(match[2], 10);
      if (width > 0 && height > 0 && width < 10000 && height < 10000) {
        return { width, height };
      }
    }
  }
  
  return null;
}

export function extractMetaAdSize(html) {
  const patterns = [
    /<meta\s+name=["']ad\.size["']\s+content=["']width=(\d+),height=(\d+)["']/i,
    /<meta\s+name=["']ad\.size["']\s+content=["'](\d+)x(\d+)["']/i,
    /<meta\s+property=["']og:image:width["']\s+content=["'](\d+)["'].*<meta\s+property=["']og:image:height["']\s+content=["'](\d+)["']/is
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const width = parseInt(match[1], 10);
      const height = parseInt(match[2], 10);
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
  }
  
  return null;
}

export function extractCanvasDimensions(html) {
  const canvasPattern = /<canvas[^>]*\bwidth=["']?(\d+)["']?[^>]*\bheight=["']?(\d+)["']?/i;
  const match = html.match(canvasPattern);
  if (match) {
    const width = parseInt(match[1], 10);
    const height = parseInt(match[2], 10);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }
  
  const stylePattern = /<canvas[^>]*style=["'][^"']*width:\s*(\d+)px[^"']*height:\s*(\d+)px/i;
  const styleMatch = html.match(stylePattern);
  if (styleMatch) {
    const width = parseInt(styleMatch[1], 10);
    const height = parseInt(styleMatch[2], 10);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }
  
  return null;
}

export function extractDivDimensions(html) {
  const patterns = [
    /<div[^>]*id=["']ad["'][^>]*style=["'][^"']*width:\s*(\d+)px[^"']*height:\s*(\d+)px/i,
    /<div[^>]*class=["'][^"']*ad[^"']*["'][^>]*style=["'][^"']*width:\s*(\d+)px[^"']*height:\s*(\d+)px/i
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const width = parseInt(match[1], 10);
      const height = parseInt(match[2], 10);
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
  }
  
  return null;
}

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isValidDimension(dim) {
  return dim && typeof dim.width === 'number' && typeof dim.height === 'number' && 
         Number.isInteger(dim.width) && Number.isInteger(dim.height) &&
         dim.width > 0 && dim.height > 0 && dim.width <= 4096 && dim.height <= 4096 &&
         dim.width * dim.height <= 16 * 1024 * 1024;
}

export function assertSafeDimensions(dimensions, label = 'Creative') {
  if (!isValidDimension(dimensions)) {
    throw new Error(`${label} dimensions ${dimensions?.width}x${dimensions?.height} exceed the safe rendering limit`);
  }
  return dimensions;
}

export const DEFAULT_DIMENSIONS = { width: 300, height: 250 };

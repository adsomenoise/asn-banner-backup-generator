import fs from 'fs-extra';
import path from 'path';
import { logger } from './logger.js';
import { 
  parseDimensionsFromFileName, 
  extractMetaAdSize, 
  extractCanvasDimensions, 
  extractDivDimensions,
  isValidDimension,
  DEFAULT_DIMENSIONS
} from './utils.js';

export async function detectBannerSize(entryPath, zipFileName) {
  const html = await fs.readFile(entryPath, 'utf-8');
  
  let dimensions = null;
  let source = '';
  
  dimensions = extractMetaAdSize(html);
  if (isValidDimension(dimensions)) {
    source = 'meta ad.size tag';
  }
  
  if (!dimensions) {
    dimensions = extractCanvasDimensions(html);
    if (isValidDimension(dimensions)) {
      source = 'canvas element';
    }
  }
  
  if (!dimensions) {
    dimensions = extractDivDimensions(html);
    if (isValidDimension(dimensions)) {
      source = 'ad container div';
    }
  }
  
  if (!dimensions) {
    dimensions = parseDimensionsFromFileName(zipFileName);
    if (isValidDimension(dimensions)) {
      source = 'filename';
    }
  }
  
  if (!dimensions) {
    dimensions = DEFAULT_DIMENSIONS;
    source = 'default (300x250)';
  }
  
  logger.stepSuccess(`Dimensions: ${dimensions.width}x${dimensions.height} (${source})`);
  
  return dimensions;
}
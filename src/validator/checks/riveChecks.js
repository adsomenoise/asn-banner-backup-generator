import { buildFinding } from '../findings.js';
import { generateRiveHTML, parseRivDimensions } from '../../riveTemplate.js';

export function checkRiveFile({ fileName }) {
  const findings = [];
  const dimensions = parseRivDimensions(fileName);
  const metadata = {
    dimensions,
    wrapperGenerated: false
  };

  if (!dimensions) {
    findings.push(buildFinding('error', 'RIVE_DIMENSIONS_MISSING', {
      title: 'Rive dimensions missing',
      message: 'The Rive filename does not include dimensions.',
      suggestion: 'Include dimensions in the filename, for example banner_300x250.riv.',
      path: fileName
    }));
    return { metadata, findings };
  }

  try {
    const jsFileName = fileName.replace(/\.riv$/i, '.js');
    const html = generateRiveHTML(jsFileName, dimensions.width, dimensions.height);
    metadata.wrapperGenerated = html.includes('rive.Rive') &&
      html.includes(`width=${dimensions.width},height=${dimensions.height}`) &&
      html.includes(jsFileName);

    if (!metadata.wrapperGenerated) {
      findings.push(buildFinding('error', 'RIVE_WRAPPER_FAILED', {
        title: 'Rive wrapper generation failed',
        message: 'The generated Rive wrapper HTML is missing required content.',
        suggestion: 'Check the Rive wrapper template before packaging this creative.',
        path: fileName
      }));
    }
  } catch (error) {
    findings.push(buildFinding('error', 'RIVE_WRAPPER_FAILED', {
      title: 'Rive wrapper generation failed',
      message: `The Rive wrapper could not be generated: ${error.message}`,
      suggestion: 'Check the Rive wrapper template before packaging this creative.',
      path: fileName
    }));
  }

  return { metadata, findings };
}

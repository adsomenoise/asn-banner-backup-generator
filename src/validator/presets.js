export const PRESETS = {
  generic: {
    id: 'generic',
    label: 'Generic QA',
    appliesTo: ['zip', 'riv', 'video'],
    maxUploadBytes: 200 * 1024 * 1024,
    requiresHtml: true,
    requiresClickTag: false,
    allowExternalReferences: false,
    allowedExtensions: ['.html', '.htm', '.js', '.css', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.json', '.woff', '.woff2', '.ttf'],
    maxVideoDurationSeconds: 30
  },
  cm360_dv360: {
    id: 'cm360_dv360',
    label: 'CM360 / DV360',
    appliesTo: ['zip'],
    maxUploadBytes: 200 * 1024 * 1024,
    requiresHtml: true,
    requiresClickTag: true,
    allowExternalReferences: false,
    allowedExtensions: ['.html', '.htm', '.js', '.css', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.json', '.woff', '.woff2', '.ttf'],
    maxVideoDurationSeconds: null
  },
  google_ads: {
    id: 'google_ads',
    label: 'Google Ads',
    appliesTo: ['zip'],
    maxUploadBytes: 200 * 1024 * 1024,
    requiresHtml: true,
    requiresClickTag: true,
    allowExternalReferences: false,
    allowedExtensions: ['.html', '.htm', '.js', '.css', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.json', '.woff', '.woff2', '.ttf'],
    maxVideoDurationSeconds: null
  },
  amazon_ads: {
    id: 'amazon_ads',
    label: 'Amazon Ads',
    appliesTo: ['zip'],
    maxUploadBytes: 200 * 1024 * 1024,
    requiresHtml: true,
    requiresClickTag: true,
    allowExternalReferences: false,
    allowedExtensions: ['.html', '.htm', '.js', '.css', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.json', '.woff', '.woff2', '.ttf'],
    maxVideoDurationSeconds: null
  },
  rive: {
    id: 'rive',
    label: 'Rive',
    appliesTo: ['riv'],
    maxUploadBytes: 200 * 1024 * 1024,
    requiresHtml: false,
    requiresClickTag: false,
    allowExternalReferences: true,
    allowedExtensions: ['.riv'],
    maxVideoDurationSeconds: null
  },
  video: {
    id: 'video',
    label: 'Video',
    appliesTo: ['video'],
    maxUploadBytes: 200 * 1024 * 1024,
    requiresHtml: false,
    requiresClickTag: false,
    allowExternalReferences: true,
    allowedExtensions: ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.wmv'],
    maxVideoDurationSeconds: 30
  }
};

export function getPreset(id = 'generic') {
  const preset = PRESETS[id];
  if (!preset) throw new Error(`Unknown validator preset: ${id}`);
  return preset;
}

export function listPresets() {
  return Object.values(PRESETS).map(({ id, label, appliesTo }) => ({ id, label, appliesTo }));
}

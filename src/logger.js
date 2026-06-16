const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

const LEVELS = {
  info: { prefix: 'INFO', color: COLORS.cyan },
  success: { prefix: 'OK', color: COLORS.green },
  warn: { prefix: 'WARN', color: COLORS.yellow },
  error: { prefix: 'ERROR', color: COLORS.red },
  debug: { prefix: 'DEBUG', color: COLORS.gray }
};

const LOG_LEVELS = { debug: 0, info: 1, success: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;
const IS_JSON = process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// Structured logger
// ---------------------------------------------------------------------------

function buildEntry(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  delete entry.module; // redundant with module field if present in meta
  return entry;
}

function jsonOutput(entry) {
  console.log(JSON.stringify(entry));
}

function prettyOutput(level, message, meta = {}) {
  const { prefix, color } = LEVELS[level] || LEVELS.info;
  const ts = new Date().toISOString().split('T')[1].slice(0, -1);

  const metaKeys = ['module', 'jobId', 'fileId', 'userId', 'tenantId', 'clientId',
    'duration', 'error', 'code', 'strategy', 'fileCount', 'entryCount',
    'dimensions', 'quality', 'totalBytes', 'retryAttempt', 'status', 'files',
    'reason', 'browserErrors'];
  const metaParts = [];
  for (const k of metaKeys) {
    const v = meta[k];
    if (v !== undefined && v !== null) {
      if (v === Object(v)) continue;
      metaParts.push(`${k}=${v}`);
    }
  }
  const extra = metaParts.length > 0 ? ' ' + metaParts.join(' ') : '';

  console.log(`${COLORS.dim}[${ts}]${COLORS.reset} ${color}${prefix.padEnd(5)}${COLORS.reset} ${message}${extra}`);
}

function writeLog(level, message, meta = {}) {
  if (LOG_LEVELS[level] == null || LOG_LEVELS[level] < CURRENT_LEVEL) return;
  const entry = buildEntry(level, message, meta);
  if (IS_JSON) {
    jsonOutput(entry);
  } else {
    prettyOutput(level, message, meta);
  }
}

// ---------------------------------------------------------------------------
// Logger factory
// ---------------------------------------------------------------------------

function createLogger(context = {}) {
  return {
    child: (extra) => createLogger({ ...context, ...extra }),

    info: (message, meta) => writeLog('info', message, { ...context, ...meta }),
    success: (message, meta) => writeLog('success', message, { ...context, ...meta }),
    warn: (message, meta) => writeLog('warn', message, { ...context, ...meta }),
    error: (message, meta) => writeLog('error', message, { ...context, ...meta }),
    debug: (message, meta) => writeLog('debug', message, { ...context, ...meta }),

    step: (message, meta) => {
      if (IS_JSON) {
        writeLog('info', `  → ${message}`, { ...context, ...meta });
      } else {
        const ts = new Date().toISOString().split('T')[1].slice(0, -1);
        console.log(`${COLORS.dim}[${ts}] INFO ${COLORS.reset} ${COLORS.dim}→${COLORS.reset} ${message}`);
      }
    },

    stepSuccess: (message, meta) => {
      if (IS_JSON) {
        writeLog('success', `  ✓ ${message}`, { ...context, ...meta });
      } else {
        const ts = new Date().toISOString().split('T')[1].slice(0, -1);
        console.log(`${COLORS.dim}[${ts}] OK    ${COLORS.reset} ${COLORS.dim}✓${COLORS.reset} ${COLORS.green}${message}${COLORS.reset}`);
      }
    },

    stepError: (message, meta) => {
      if (IS_JSON) {
        writeLog('error', `  ✗ ${message}`, { ...context, ...meta });
      } else {
        const ts = new Date().toISOString().split('T')[1].slice(0, -1);
        console.log(`${COLORS.dim}[${ts}] ERROR ${COLORS.reset} ${COLORS.dim}✗${COLORS.reset} ${COLORS.red}${message}${COLORS.reset}`);
      }
    },

    banner: (name) => {
      if (IS_JSON) {
        writeLog('info', `Processing ${name}`, { ...context });
      } else {
        const line = '-'.repeat(36);
        console.log(`\n${COLORS.bright}${line}${COLORS.reset}`);
        console.log(`${COLORS.bright}Processing ${name}${COLORS.reset}`);
        console.log(`${COLORS.bright}${line}${COLORS.reset}\n`);
      }
    },

    saved: (path) => {
      if (IS_JSON) {
        writeLog('success', 'File saved', { ...context, path });
      } else {
        const ts = new Date().toISOString().split('T')[1].slice(0, -1);
        console.log(`${COLORS.dim}[${ts}] OK    ${COLORS.reset}Saved: ${COLORS.bright}${path}${COLORS.reset}`);
      }
    },

    continue: () => {
      if (IS_JSON) {
        writeLog('warn', 'Continuing with next banner', { ...context });
      } else {
        console.log(`\n${COLORS.yellow}Continuing with next banner...${COLORS.reset}\n`);
      }
    }
  };
}

export const logger = createLogger();

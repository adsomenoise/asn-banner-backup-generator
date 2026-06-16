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

function formatMessage(level, message, ...args) {
  const { prefix, color } = LEVELS[level] || LEVELS.info;
  const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
  const formattedArgs = args.length > 0 ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ') : '';
  return `${COLORS.dim}[${timestamp}]${COLORS.reset} ${color}${prefix.padEnd(5)}${COLORS.reset} ${message}${formattedArgs}`;
}

function log(level, message, ...args) {
  console.log(formatMessage(level, message, ...args));
}

export const logger = {
  info: (message, ...args) => log('info', message, ...args),
  success: (message, ...args) => log('success', message, ...args),
  warn: (message, ...args) => log('warn', message, ...args),
  error: (message, ...args) => log('error', message, ...args),
  debug: (message, ...args) => log('debug', message, ...args),
  
  banner: (name) => {
    const line = '-'.repeat(36);
    console.log(`\n${COLORS.bright}${line}${COLORS.reset}`);
    console.log(`${COLORS.bright}Processing ${name}${COLORS.reset}`);
    console.log(`${COLORS.bright}${line}${COLORS.reset}\n`);
  },
  
  step: (message) => log('info', `  ${COLORS.dim}→${COLORS.reset} ${message}`),
  
  stepSuccess: (message) => log('success', `  ${COLORS.dim}✓${COLORS.reset} ${message}`),
  
  stepError: (message) => log('error', `  ${COLORS.dim}✗${COLORS.reset} ${message}`),
  
  saved: (path) => log('success', `Saved: ${COLORS.bright}${path}${COLORS.reset}`),
  
  continue: () => log('warn', '\nContinuing with next banner...\n')
};
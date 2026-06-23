function parsePositiveInt(name, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return `${name} must be a positive integer`;
  }
  return null;
}

function parseCaptureConcurrency(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    return 'CAPTURE_CONCURRENCY must be an integer between 1 and 8';
  }
  return null;
}

function checkProductionEnv(env = process.env) {
  const errors = [];
  const warnings = [];

  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  if (!isProduction) {
    warnings.push('NODE_ENV is not production; strict production preflight checks were skipped.');
    return { errors, warnings };
  }

  if (!env.CORS_ORIGIN || String(env.CORS_ORIGIN).trim() === '') {
    errors.push('CORS_ORIGIN is required when NODE_ENV=production');
  }

  if (env.CORS_ORIGIN === '*') {
    errors.push('CORS_ORIGIN must not be * in production');
  }

  const authMode = env.AUTH_MODE || 'production';

  if (authMode === 'production') {
    const prodHeaders = ['AUTH_USER_ID_HEADER', 'AUTH_TENANT_ID_HEADER', 'AUTH_CLIENT_ID_HEADER'];
    for (const varName of prodHeaders) {
      if (!env[varName] || String(env[varName]).trim() === '') {
        errors.push(`${varName} is required when AUTH_MODE=production`);
      }
    }
  } else {
    warnings.push(`AUTH_MODE is "${authMode}" — authentication is disabled. Set AUTH_MODE=production with a reverse proxy to enable it.`);
  }

  const portError = parsePositiveInt('PORT', env.PORT || '3001');
  if (portError) errors.push(portError);

  const rateLimitError = parsePositiveInt('RATE_LIMIT_MAX', env.RATE_LIMIT_MAX || '30');
  if (rateLimitError) errors.push(rateLimitError);

  const concurrencyError = parseCaptureConcurrency(env.CAPTURE_CONCURRENCY);
  if (concurrencyError) errors.push(concurrencyError);

  return { errors, warnings };
}

function main() {
  const { errors, warnings } = checkProductionEnv(process.env);

  for (const warning of warnings) {
    console.warn(`[preflight] WARN: ${warning}`);
  }

  if (errors.length > 0) {
    console.error('[preflight] FAILED');
    for (const error of errors) {
      console.error(`[preflight] ERROR: ${error}`);
    }
    process.exit(1);
  }

  console.log('[preflight] OK');
}

main();

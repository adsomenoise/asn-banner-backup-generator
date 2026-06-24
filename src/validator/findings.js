const SEVERITIES = ['info', 'warning', 'error'];

export function buildFinding(severity, code, props = {}) {
  if (!SEVERITIES.includes(severity)) {
    throw new Error(`Invalid finding severity: ${severity}`);
  }
  return {
    severity,
    code,
    title: props.title || code,
    message: props.message || '',
    suggestion: props.suggestion || '',
    path: props.path || null
  };
}

export function summarizeFindings(findings = []) {
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const info = findings.filter(f => f.severity === 'info').length;
  return {
    status: errors > 0 ? 'fail' : warnings > 0 ? 'warning' : 'pass',
    errors,
    warnings,
    info
  };
}

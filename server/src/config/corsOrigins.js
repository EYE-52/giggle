const DEFAULT_LOCAL_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:4000',
  'http://localhost:4011',
  'http://localhost:8081',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:4000',
  'http://127.0.0.1:4011',
  'http://127.0.0.1:8081',
];

function splitOrigins(value = '') {
  return value
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function buildAllowedOrigins(frontendUrl = process.env.FRONTEND_URL || '', options = {}) {
  const nodeEnv = options.nodeEnv || process.env.NODE_ENV;
  const configuredOrigins = splitOrigins(frontendUrl);
  const localOrigins = nodeEnv === 'production' ? [] : DEFAULT_LOCAL_ORIGINS;

  return Array.from(new Set([...localOrigins, ...configuredOrigins]));
}

module.exports = {
  buildAllowedOrigins,
  DEFAULT_LOCAL_ORIGINS,
};

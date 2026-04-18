function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

function required(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

export const env = {
  PORT: parseInt(optional('PORT', '3000'), 10),
  NODE_ENV: optional('NODE_ENV', 'development'),
  REACT_EDITOR: optional('REACT_EDITOR', 'code'),
  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL: required('REDIS_URL'),
  GOOGLE_CLIENT_ID: required('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: required('GOOGLE_CLIENT_SECRET'),
  SUPER_ADMIN_EMAILS: optional('SUPER_ADMIN_EMAIL', '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean),
  AUDIT_LOG_RETENTION_DAYS: parseInt(optional('AUDIT_LOG_RETENTION_DAYS', '90'), 10),
  MCP_SECRET: optional('MCP_SECRET', ''),
  MCP_SECRET_ADMIN: optional('MCP_SECRET_ADMIN', ''),
  PMW_WEBHOOK_TOKEN: optional('PMW_WEBHOOK_TOKEN', ''),
  PMW_EVENT_BATCH_MAX: parseInt(optional('PMW_EVENT_BATCH_MAX', '500'), 10),
  WEBHOOK_LOG_RETENTION_DAYS: parseInt(optional('WEBHOOK_LOG_RETENTION_DAYS', '7'), 10),
  GITHUB_WEBHOOK_SECRET: optional('GITHUB_WEBHOOK_SECRET', ''),
  UPLOADS_DIR: optional('UPLOADS_DIR', './uploads'),
  UPLOAD_MAX_BYTES: parseInt(optional('UPLOAD_MAX_BYTES', String(10 * 1024 * 1024)), 10),
} as const

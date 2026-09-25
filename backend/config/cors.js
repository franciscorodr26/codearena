const {
  enforceCodeArenaProductionUrl
} = require('../../shared/deploymentIsolation')

const LOCAL_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://[::1]:3000',
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
  /^http:\/\/\[::1\]:\d+$/
]

const DEFAULT_PRODUCTION_ORIGINS = [
  'https://codearena.co',
  'https://www.codearena.co'
]

function parseConfiguredOrigins(value) {
  return String(value || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

function buildAllowedOrigins(env = process.env) {
  const isProduction = env.NODE_ENV === 'production'
  const configuredOrigins = parseConfiguredOrigins(env.CORS_ALLOWED_ORIGINS)
  const productionOrigins = configuredOrigins.map(origin => (
    enforceCodeArenaProductionUrl(origin, 'CORS_ALLOWED_ORIGINS', isProduction, env)
  ))

  return [
    ...(!isProduction ? LOCAL_ORIGINS : []),
    ...(productionOrigins.length > 0 ? productionOrigins : DEFAULT_PRODUCTION_ORIGINS)
  ]
}

function isOriginAllowed(origin, allowedOrigins = buildAllowedOrigins()) {
  if (!origin) return true

  return allowedOrigins.some(allowedOrigin => (
    typeof allowedOrigin === 'string'
      ? allowedOrigin === origin
      : allowedOrigin.test(origin)
  ))
}

function createCorsOriginHandler({ allowedOrigins = buildAllowedOrigins(), onDenied } = {}) {
  return (origin, callback) => {
    if (isOriginAllowed(origin, allowedOrigins)) {
      return callback(null, true)
    }

    if (onDenied) onDenied(origin)
    const error = new Error('Origin is not allowed by CORS')
    error.code = 'CORS_ORIGIN_DENIED'
    return callback(error, false)
  }
}

function corsErrorHandler(err, req, res, next) {
  if (err?.code === 'CORS_ORIGIN_DENIED') {
    return res.status(403).json({ error: 'Origin is not allowed' })
  }
  return next(err)
}

module.exports = {
  LOCAL_ORIGINS,
  DEFAULT_PRODUCTION_ORIGINS,
  parseConfiguredOrigins,
  buildAllowedOrigins,
  isOriginAllowed,
  createCorsOriginHandler,
  corsErrorHandler
}

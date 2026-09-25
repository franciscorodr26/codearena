const {
  enforceCodeArenaProductionUrl
} = require('../../shared/deploymentIsolation')

const isProduction = process.env.NODE_ENV === 'production'

const DEFAULT_FRONTEND_URL = isProduction
  ? 'https://codearena.co'
  : 'http://localhost:3000'

const DEFAULT_BACKEND_URL = isProduction
  ? 'https://api.codearena.co'
  : 'http://localhost:3001'

function normalizeBaseUrl(value, fallback) {
  const normalized = String(value || '').trim().replace(/\/+$/, '')
  return normalized || fallback
}

const FRONTEND_URL = enforceCodeArenaProductionUrl(
  normalizeBaseUrl(process.env.FRONTEND_URL, DEFAULT_FRONTEND_URL),
  'FRONTEND_URL',
  isProduction
)

const BACKEND_URL = enforceCodeArenaProductionUrl(
  normalizeBaseUrl(
    process.env.BACKEND_URL || process.env.API_BASE_URL || process.env.API_URL,
    DEFAULT_BACKEND_URL
  ),
  'BACKEND_URL',
  isProduction
)

module.exports = {
  FRONTEND_URL,
  BACKEND_URL,
  DEFAULT_FRONTEND_URL,
  DEFAULT_BACKEND_URL,
  normalizeBaseUrl
}

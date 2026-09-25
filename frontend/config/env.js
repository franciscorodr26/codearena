/**
 * Simple environment configuration for CodeArena MVP
 * 
 * Environment is set server-side and passed to client via Next.js
 */

const {
  enforceCodeArenaProductionUrl
} = require('../../shared/deploymentIsolation')

// Get environment from server-side data or fallback
const getEnvironment = () => {
  // Server-side: use NODE_ENV
  if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
    return process.env.NODE_ENV === 'production' ? 'production' : 'development';
  }

  // Client-side: use the value passed from server
  if (typeof window !== 'undefined' && window.__ENVIRONMENT__) {
    return window.__ENVIRONMENT__;
  }

  // SECURITY: Default to production to ensure anti-cheat is enabled
  // Development mode must be explicitly set via NODE_ENV
  return 'production';
};

const environment = getEnvironment();

// Optional override (see .env.example) — fixes local `next start` talking to Railway by mistake
const normalizeBaseUrl = value => String(value || '').trim().replace(/\/+$/, '')

const rawBackendUrl =
  typeof process !== 'undefined'
    ? enforceCodeArenaProductionUrl(
      normalizeBaseUrl(process.env.NEXT_PUBLIC_BACKEND_URL),
      'NEXT_PUBLIC_BACKEND_URL',
      environment === 'production'
    )
    : ''

const rawFrontendUrl =
  typeof process !== 'undefined'
    ? enforceCodeArenaProductionUrl(
      normalizeBaseUrl(process.env.NEXT_PUBLIC_FRONTEND_URL),
      'NEXT_PUBLIC_FRONTEND_URL',
      environment === 'production'
    )
    : ''

// Type-safe environment constants
export const environments = {
  production: 'production',
  development: 'development'
};

const defaultProdBackendUrl = 'https://api.codearena.co'
const defaultLocalBackendUrl = 'http://localhost:3001'

const defaultBackendUrl =
  environment === environments.production
    ? defaultProdBackendUrl
    : defaultLocalBackendUrl

/** True when the browser tab is clearly local dev (not codearena.co / Vercel). */
function isBrowserLocalHost() {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
}

function resolveBackendUrl() {
  if (rawBackendUrl) return rawBackendUrl
  // Production build opened at http://localhost or http://127.0.0.1 → talk to local API
  if (isBrowserLocalHost()) return defaultLocalBackendUrl
  return defaultBackendUrl
}

function resolveFrontendUrl() {
  if (typeof window !== 'undefined' && isBrowserLocalHost()) {
    return window.location.origin
  }
  if (rawFrontendUrl) return rawFrontendUrl
  return environment === environments.production
    ? 'https://codearena.co'
    : 'http://localhost:3000'
}

export const config = {
  environment,
  allow_cheating: environment === environments.development,
  get backend_url() {
    return resolveBackendUrl()
  },
  get frontend_url() {
    return resolveFrontendUrl()
  },
  // Feature flags. Centaur is not part of the CodeArena consumer product.
  features: {
    centaur: false
  },
  // Google OAuth Client ID - must be set in .env.local as NEXT_PUBLIC_GOOGLE_CLIENT_ID for production
  google_client_id: typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    ? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    : (typeof window !== 'undefined' && window.__GOOGLE_CLIENT_ID__)
      ? window.__GOOGLE_CLIENT_ID__
      : null, // No fallback - must be configured via environment variable
  // GitHub OAuth Client ID - must be set in .env.local as NEXT_PUBLIC_GITHUB_CLIENT_ID for production
  github_client_id: typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_GITHUB_CLIENT_ID
    ? process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID
    : (typeof window !== 'undefined' && window.__GITHUB_CLIENT_ID__)
      ? window.__GITHUB_CLIENT_ID__
      : null // No fallback - must be configured via environment variable
};

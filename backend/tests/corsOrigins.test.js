const request = require('supertest')
const express = require('express')
const cors = require('cors')
const {
  buildAllowedOrigins,
  isOriginAllowed,
  createCorsOriginHandler,
  corsErrorHandler
} = require('../config/cors')

function createApp(env = {}) {
  const app = express()
  app.use(cors({
    origin: createCorsOriginHandler({ allowedOrigins: buildAllowedOrigins(env) }),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  }))
  app.use(corsErrorHandler)
  app.get('/health', (req, res) => res.json({ ok: true }))
  app.patch('/resource', (req, res) => res.json({ ok: true }))
  return app
}

describe('CodeArena CORS origins', () => {
  test('allows CodeArena defaults but not other hosts or localhost in production', () => {
    const allowed = buildAllowedOrigins({ NODE_ENV: 'production' })

    expect(isOriginAllowed('https://codearena.co', allowed)).toBe(true)
    expect(isOriginAllowed('https://www.codearena.co', allowed)).toBe(true)
    expect(isOriginAllowed('https://rival.example', allowed)).toBe(false)
    expect(isOriginAllowed('http://localhost:3000', allowed)).toBe(false)
    expect(isOriginAllowed('http://127.0.0.1:4317', allowed)).toBe(false)
    expect(isOriginAllowed('https://codearena-unknown.vercel.app', allowed)).toBe(false)
  })

  test('only admits a non-default production origin when explicitly configured', () => {
    const allowed = buildAllowedOrigins({
      NODE_ENV: 'production',
      CORS_ALLOWED_ORIGINS: 'https://preview.codearena.co/'
    })

    expect(isOriginAllowed('https://preview.codearena.co', allowed)).toBe(true)
    expect(isOriginAllowed('https://codearena.co', allowed)).toBe(false)
  })

  test('allows local development origins', () => {
    const allowed = buildAllowedOrigins({ NODE_ENV: 'development' })

    expect(isOriginAllowed('http://localhost:3000', allowed)).toBe(true)
    expect(isOriginAllowed('http://127.0.0.1:4317', allowed)).toBe(true)
  })

  test('rejects a configured forbidden-host origin in production', () => {
    const env = { NODE_ENV: 'production', CODEARENA_FORBIDDEN_HOST_FRAGMENTS: 'rival.example' }
    expect(() => buildAllowedOrigins({
      ...env,
      CORS_ALLOWED_ORIGINS: 'https://codearena.co,https://api.rival.example'
    })).toThrow(/CORS_ALLOWED_ORIGINS must not point at a forbidden host/)

    expect(() => buildAllowedOrigins({
      ...env,
      CORS_ALLOWED_ORIGINS: 'rival.example'
    })).toThrow(/CORS_ALLOWED_ORIGINS must not point at a forbidden host/)
  })

  test('without configured fragments any explicit origin is accepted', () => {
    const allowed = buildAllowedOrigins({
      NODE_ENV: 'production',
      CORS_ALLOWED_ORIGINS: 'https://rival.example'
    })
    expect(isOriginAllowed('https://rival.example', allowed)).toBe(true)
  })

  test('preserves forbidden-host origins outside production', () => {
    const allowed = buildAllowedOrigins({
      NODE_ENV: 'test',
      CODEARENA_FORBIDDEN_HOST_FRAGMENTS: 'rival.example',
      CORS_ALLOWED_ORIGINS: 'https://rival.example.local'
    })

    expect(isOriginAllowed('https://rival.example.local', allowed)).toBe(true)
  })

  test('returns a stable 403 for a denied browser origin', async () => {
    await request(createApp({ NODE_ENV: 'production' }))
      .get('/health')
      .set('Origin', 'https://rival.example')
      .expect(403, { error: 'Origin is not allowed' })
  })

  test('allows CodeArena PATCH preflight requests', async () => {
    const response = await request(createApp({ NODE_ENV: 'production' }))
      .options('/resource')
      .set('Origin', 'https://codearena.co')
      .set('Access-Control-Request-Method', 'PATCH')
      .expect(204)

    expect(response.headers['access-control-allow-methods']).toContain('PATCH')
  })
})

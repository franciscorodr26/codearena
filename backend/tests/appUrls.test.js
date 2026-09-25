const ORIGINAL_ENV = { ...process.env }

function loadUrls(env = {}) {
  jest.resetModules()
  process.env = { ...ORIGINAL_ENV, ...env }
  delete process.env.FRONTEND_URL
  delete process.env.BACKEND_URL
  delete process.env.API_BASE_URL
  delete process.env.API_URL
  delete process.env.CODEARENA_FORBIDDEN_HOST_FRAGMENTS
  Object.assign(process.env, env)
  return require('../config/appUrls')
}

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('CodeArena deployment URLs', () => {
  test('uses isolated CodeArena origins in production', () => {
    const urls = loadUrls({ NODE_ENV: 'production' })

    expect(urls.FRONTEND_URL).toBe('https://codearena.co')
    expect(urls.BACKEND_URL).toBe('https://api.codearena.co')
      })

  test('uses localhost defaults outside production', () => {
    const urls = loadUrls({ NODE_ENV: 'test' })

    expect(urls.FRONTEND_URL).toBe('http://localhost:3000')
    expect(urls.BACKEND_URL).toBe('http://localhost:3001')
  })

  test('honors explicit origins and removes trailing slashes', () => {
    const urls = loadUrls({
      NODE_ENV: 'production',
      FRONTEND_URL: ' https://community.codearena.co/ ',
      BACKEND_URL: 'https://backend.codearena.co///'
    })

    expect(urls.FRONTEND_URL).toBe('https://community.codearena.co')
    expect(urls.BACKEND_URL).toBe('https://backend.codearena.co')
  })

  test('keeps API_URL as a backwards-compatible backend override', () => {
    const urls = loadUrls({
      NODE_ENV: 'production',
      API_URL: 'https://legacy-api.codearena.co/'
    })

    expect(urls.BACKEND_URL).toBe('https://legacy-api.codearena.co')
  })

  test.each([
    ['FRONTEND_URL', 'https://rival.example'],
    ['FRONTEND_URL', 'rival.example'],
    ['FRONTEND_URL', 'https://app.rival.example'],
    ['BACKEND_URL', 'https://api.rival.example'],
    ['API_BASE_URL', 'https://rival-example-preview.vercel.app'],
    ['API_URL', 'https://rival.example.internal']
  ])('rejects a forbidden-host production override in %s', (variableName, value) => {
    expect(() => loadUrls({
      NODE_ENV: 'production',
      CODEARENA_FORBIDDEN_HOST_FRAGMENTS: 'rival.example,rival-example',
      [variableName]: value
    })).toThrow(/must not point at a forbidden host/)
  })

  test('accepts any explicit production origin when no fragments are configured', () => {
    const urls = loadUrls({ NODE_ENV: 'production', FRONTEND_URL: 'https://rival.example' })
    expect(urls.FRONTEND_URL).toBe('https://rival.example')
  })

  test('preserves flexible URL overrides outside production', () => {
    const urls = loadUrls({
      NODE_ENV: 'test',
      CODEARENA_FORBIDDEN_HOST_FRAGMENTS: 'rival.example',
      FRONTEND_URL: 'https://rival.example.local',
      BACKEND_URL: 'https://api.rival.example.local'
    })

    expect(urls.FRONTEND_URL).toBe('https://rival.example.local')
    expect(urls.BACKEND_URL).toBe('https://api.rival.example.local')
  })
})

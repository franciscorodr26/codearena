const ORIGINAL_ENV = { ...process.env }

function loadConfig(env = {}) {
  jest.resetModules()
  process.env = { ...ORIGINAL_ENV }
  delete process.env.NEXT_PUBLIC_BACKEND_URL
  delete process.env.NEXT_PUBLIC_FRONTEND_URL
  Object.assign(process.env, env)
  return require('./env').config
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('CodeArena frontend URL configuration', () => {
  test('an explicit backend override wins and loses its trailing slash', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      NEXT_PUBLIC_BACKEND_URL: 'https://api.arena.example/'
    })

    expect(config.backend_url).toBe('https://api.arena.example')
  })

  test('falls back to the local backend when nothing is configured', () => {
    const config = loadConfig({ NODE_ENV: 'test' })

    expect(config.backend_url).toBe('http://localhost:3001')
  })

  test('uses the current origin as the frontend URL on localhost', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      NEXT_PUBLIC_FRONTEND_URL: 'https://arena.example'
    })

    expect(config.frontend_url).toBe(window.location.origin)
  })
})

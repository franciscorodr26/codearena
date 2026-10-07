// Production must never run with the public example JWT secret.
const ORIGINAL = { ...process.env }

function load(env) {
  jest.resetModules()
  process.env = { ...ORIGINAL, ...env }
  return () => require('../utils/jwtSecret')
}

afterEach(() => { process.env = { ...ORIGINAL } })

test('production refuses the example secret from .env.example', () => {
  const example = require('fs').readFileSync(require('path').join(__dirname, '../.env.example'), 'utf8')
    .match(/^JWT_SECRET=(.*)$/m)[1]
  expect(load({ NODE_ENV: 'production', JWT_SECRET: example })).toThrow(/example value/)
})

test('production accepts a real secret; development tolerates the example', () => {
  expect(load({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(64) })().SECRET).toBe('a'.repeat(64))
  expect(load({ NODE_ENV: 'development', JWT_SECRET: 'your-super-secret-jwt-key-change-this' })().SECRET)
    .toBe('your-super-secret-jwt-key-change-this')
})

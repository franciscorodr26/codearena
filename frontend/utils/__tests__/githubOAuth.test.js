import { createGitHubAuthorizationUrl, consumeGitHubOAuthState, getGitHubCallbackUrl } from '../githubOAuth'

const now = 1000000
const storage = window.sessionStorage
const browser = {
  location: { origin: 'https://codearena.co' },
  sessionStorage: storage,
  crypto: window.crypto
}

beforeEach(() => storage.clear())

function begin() {
  return new URL(createGitHubAuthorizationUrl('codearena-client', browser, now))
}

test('authorization uses the canonical callback, requested scopes, and fresh random state', () => {
  const first = begin()
  const second = begin()
  expect(first.origin).toBe('https://github.com')
  expect(first.searchParams.get('client_id')).toBe('codearena-client')
  expect(first.searchParams.get('redirect_uri')).toBe('https://codearena.co/auth/github/callback')
  expect(first.searchParams.get('scope')).toBe('user:email read:user')
  expect(first.searchParams.get('state')).toMatch(/^[a-f0-9]{64}$/)
  expect(second.searchParams.get('state')).not.toBe(first.searchParams.get('state'))
})

test('valid state is accepted once and cannot be replayed', () => {
  const state = begin().searchParams.get('state')
  expect(consumeGitHubOAuthState(state, storage, now + 1)).toBe(true)
  expect(consumeGitHubOAuthState(state, storage, now + 2)).toBe(false)
})

test.each([undefined, '', ['state'], '0'.repeat(64)])('rejects missing or mismatched state: %p', state => {
  const expected = begin().searchParams.get('state')
  expect(consumeGitHubOAuthState(state, storage, now)).toBe(false)
  expect(consumeGitHubOAuthState(expected, storage, now)).toBe(false)
})

test.each([-1, 600000, 600001])('rejects expired or future-dated state at offset %i', offset => {
  const state = begin().searchParams.get('state')
  expect(consumeGitHubOAuthState(state, storage, now + offset)).toBe(false)
})

test('rejects malformed stored state and inaccessible storage', () => {
  storage.setItem('codearena.githubOAuth', '{broken')
  expect(consumeGitHubOAuthState('a'.repeat(64), storage, now)).toBe(false)
  expect(consumeGitHubOAuthState('a'.repeat(64), { getItem() { throw new Error('blocked') } }, now)).toBe(false)
})

test('fails closed before navigating when session storage cannot be written', () => {
  expect(() => createGitHubAuthorizationUrl('id', {
    ...browser,
    sessionStorage: { setItem() { throw new Error('blocked') } }
  })).toThrow('blocked')
})

test('preview and alias tabs first move to canonical login to preserve origin-bound state', () => {
  const previewBrowser = { ...browser, location: { origin: 'https://preview.vercel.app' } }
  expect(createGitHubAuthorizationUrl('id', previewBrowser, now)).toBe('https://codearena.co/login')
  expect(storage.length).toBe(0)
})

test('supports explicit local development callback origins', () => {
  expect(getGitHubCallbackUrl('http://localhost:3000')).toBe('http://localhost:3000/auth/github/callback')
  expect(getGitHubCallbackUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/auth/github/callback')
  expect(getGitHubCallbackUrl('https://unknown-host.example')).toBe('https://codearena.co/auth/github/callback')
})

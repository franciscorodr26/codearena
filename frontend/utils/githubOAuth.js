const STATE_KEY = 'codearena.githubOAuth'
const STATE_TTL_MS = 10 * 60 * 1000

export function getGitHubCallbackUrl(origin) {
  const url = new URL(origin)
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const callbackOrigin = isLocal && ['http:', 'https:'].includes(url.protocol)
    ? url.origin
    : 'https://codearena.co'
  return `${callbackOrigin}/auth/github/callback`
}

export function createGitHubAuthorizationUrl(clientId, browser = window, now = Date.now()) {
  const redirectUri = getGitHubCallbackUrl(browser.location.origin)
  // Begin on the callback origin so the tab's sessionStorage survives the round trip.
  if (new URL(redirectUri).origin !== browser.location.origin) {
    return 'https://codearena.co/login'
  }
  const bytes = browser.crypto.getRandomValues(new Uint8Array(32))
  const state = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  browser.sessionStorage.setItem(STATE_KEY, JSON.stringify({ state, createdAt: now }))
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'user:email read:user',
    state
  })
  return `https://github.com/login/oauth/authorize?${params}`
}

export function consumeGitHubOAuthState(state, storage = window.sessionStorage, now = Date.now()) {
  try {
    const saved = storage.getItem(STATE_KEY)
    storage.removeItem(STATE_KEY)
    if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state) || !saved) return false
    const pending = JSON.parse(saved)
    const age = now - pending.createdAt
    return pending.state === state && Number.isFinite(pending.createdAt) && age >= 0 && age < STATE_TTL_MS
  } catch {
    return false
  }
}

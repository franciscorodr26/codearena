const REDIRECT_KEY = 'redirectAfterLogin'

export function safeAuthRedirect(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null
  if (/[\\\u0000-\u0020\u007f]/.test(value)) return null
  try {
    const url = new URL(value, 'https://codearena.co')
    const path = decodeURIComponent(url.pathname)
    if (url.origin !== 'https://codearena.co' || path.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(path)) return null
    if (/^\/(?:login|register|complete-profile|verify-required)(?:\/|$)/.test(path) || path.startsWith('/auth/')) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

export function saveAuthRedirect(value) {
  const destination = safeAuthRedirect(value)
  try {
    if (destination) sessionStorage.setItem(REDIRECT_KEY, destination)
    else sessionStorage.removeItem(REDIRECT_KEY)
  } catch { /* Login must still work if browser storage is unavailable. */ }
}

export function readAuthRedirect(consume = false) {
  try {
    const destination = safeAuthRedirect(sessionStorage.getItem(REDIRECT_KEY))
    if (consume || !destination) sessionStorage.removeItem(REDIRECT_KEY)
    return destination
  } catch {
    return null
  }
}

export function postAuthDestination(user, fallback = '/dashboard') {
  // Preserve the intended destination until onboarding/verification completes.
  if (user?.username_chosen === 0) return '/complete-profile'
  const destination = readAuthRedirect()
  if (user?.email_verified === false && !destination?.startsWith('/battle/invite/')) return '/verify-required'
  return readAuthRedirect(true) || fallback
}

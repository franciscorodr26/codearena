// Guards against a production deployment pointing at the wrong product's hosts.
// CODEARENA_FORBIDDEN_HOST_FRAGMENTS is a comma-separated list of substrings
// that must never appear in a production URL (for example the hostname of a
// sibling product that shares this codebase's ancestry). Empty by default.

function forbiddenFragments(env) {
  const source = (env && env.CODEARENA_FORBIDDEN_HOST_FRAGMENTS) || ''
  return String(source)
    .split(',')
    .map(fragment => fragment.trim().toLowerCase())
    .filter(Boolean)
}

function isForbiddenUrl(value, env) {
  const fragments = forbiddenFragments(env || (typeof process !== 'undefined' ? process.env : {}))
  if (!fragments.length) return false
  const candidate = String(value || '').trim().toLowerCase()
  if (!candidate) return false
  let host = candidate
  try {
    host = new URL(candidate).hostname.toLowerCase()
  } catch {
    // Fail closed for a host-like value missing a URL scheme as well.
  }
  return fragments.some(fragment => host.includes(fragment))
}

function enforceCodeArenaProductionUrl(value, variableName, isProduction, env) {
  if (isProduction && isForbiddenUrl(value, env)) {
    throw new Error(`${variableName} must not point at a forbidden host in production`)
  }
  return value
}

module.exports = {
  isForbiddenUrl,
  enforceCodeArenaProductionUrl
}

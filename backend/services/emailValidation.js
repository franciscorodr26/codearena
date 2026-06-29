/**
 * Email validation for B2B invites.
 * Syntactic check + normalize (trim/lowercase) + a typo suggestion for common
 * provider domains. No network calls, undeliverable domains are caught later
 * by the Resend bounce webhook.
 */

// Same shape used by the existing inline checks in the invite routes.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COMMON_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com',
  'outlook.com', 'icloud.com', 'protonmail.com', 'aol.com'
];

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function suggestDomain(domain) {
  if (COMMON_DOMAINS.includes(domain)) return null;
  let best = null;
  let bestDist = Infinity;
  for (const known of COMMON_DOMAINS) {
    const d = levenshtein(domain, known);
    if (d < bestDist) { bestDist = d; best = known; }
  }
  // Only suggest for near-misses (1–2 edits) to avoid bogus "corrections".
  return bestDist > 0 && bestDist <= 2 ? best : null;
}

/**
 * @param {string} email
 * @returns {{ valid: boolean, normalized: string|null, suggestion: string|null }}
 */
function validateAndNormalize(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, normalized: null, suggestion: null };
  }
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) {
    return { valid: false, normalized: null, suggestion: null };
  }
  const [local, domain] = normalized.split('@');
  const suggestedDomain = suggestDomain(domain);
  const suggestion = suggestedDomain ? `${local}@${suggestedDomain}` : null;
  return { valid: true, normalized, suggestion };
}

module.exports = { validateAndNormalize };

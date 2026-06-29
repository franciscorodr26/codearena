/**
 * URL Safety Helper
 *
 * Validates that URLs do not target internal/private/loopback/metadata
 * endpoints. Used to prevent SSRF when the server makes outbound HTTP
 * requests on behalf of user-supplied URLs (e.g. webhooks).
 *
 * Two layers of protection:
 *   1. Block unsafe protocols / hostname patterns / literal-IP ranges.
 *   2. Resolve hostnames via DNS and re-check the resolved IPs so an
 *      attacker cannot use `evil.example.com` resolving to `127.0.0.1`.
 *
 * The helper provides:
 *   - isPublicUrl(url)      , sync literal-IP / hostname / protocol checks
 *   - isPublicUrlAsync(url) , async helper that ALSO resolves DNS and
 *                              validates each returned address. Use this
 *                              right before performing a fetch().
 */

const dns = require('dns').promises;
const net = require('net');

// Protocols that we explicitly allow. We only allow http(s) outbound; in
// practice only https: is appropriate for production webhooks, but we
// keep http: enabled so localhost-rejection tests and any non-prod tools
// still work. Everything else (file:, ftp:, gopher:, ssh:, etc.) is blocked.
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Hostnames that are always rejected. Lower-cased for comparison.
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
]);

// Hostname suffixes that are always rejected. Lower-cased.
const BLOCKED_HOSTNAME_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
];

// Hostname prefixes that are always rejected. Lower-cased.
const BLOCKED_HOSTNAME_PREFIXES = [
  'metadata.',
];

/**
 * Check whether an IPv4 address (as a string) is in a blocked range.
 * Covers loopback, RFC1918 private, link-local (incl. cloud metadata),
 * CGNAT, broadcast, "this network", and multicast/reserved.
 * @param {string} ip
 * @returns {boolean}
 */
function isBlockedIPv4(ip) {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) {
    // Malformed, treat as blocked.
    return true;
  }
  const [a, b] = parts;

  // 0.0.0.0/8, "this network"
  if (a === 0) return true;
  // 10.0.0.0/8, RFC1918
  if (a === 10) return true;
  // 127.0.0.0/8, loopback
  if (a === 127) return true;
  // 169.254.0.0/16, link-local (covers AWS/GCP/Azure metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12, RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24, IETF protocol assignments
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  // 192.168.0.0/16, RFC1918
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15, benchmarking
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 100.64.0.0/10, CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 224.0.0.0/4, multicast
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4, reserved / 255.255.255.255 broadcast
  if (a >= 240) return true;

  return false;
}

/**
 * Normalize an IPv6 address to its full 8-group hex form for prefix
 * matching. Returns null if the input is not a valid IPv6 literal.
 * @param {string} ip
 * @returns {string|null}
 */
function expandIPv6(ip) {
  if (typeof ip !== 'string') return null;
  // Strip an optional zone id (e.g. fe80::1%eth0).
  const noZone = ip.split('%')[0];
  if (net.isIPv6(noZone) !== true) return null;

  // Handle IPv4-mapped form like ::ffff:127.0.0.1 by converting the
  // tail to two hex groups.
  let working = noZone;
  const lastColon = working.lastIndexOf(':');
  const tail = working.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4parts = tail.split('.').map(p => parseInt(p, 10));
    if (v4parts.length === 4 && v4parts.every(n => !Number.isNaN(n) && n >= 0 && n <= 255)) {
      const hex1 = ((v4parts[0] << 8) | v4parts[1]).toString(16);
      const hex2 = ((v4parts[2] << 8) | v4parts[3]).toString(16);
      working = working.slice(0, lastColon + 1) + hex1 + ':' + hex2;
    }
  }

  // Expand "::" into the appropriate number of zero groups.
  let groups;
  if (working.includes('::')) {
    const [head, taail] = working.split('::');
    const headGroups = head === '' ? [] : head.split(':');
    const tailGroups = taail === '' ? [] : taail.split(':');
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 0) return null;
    groups = [
      ...headGroups,
      ...Array(missing).fill('0'),
      ...tailGroups,
    ];
  } else {
    groups = working.split(':');
  }

  if (groups.length !== 8) return null;
  return groups.map(g => g.toLowerCase().padStart(4, '0')).join(':');
}

/**
 * Check whether an IPv6 address is in a blocked range.
 * Covers ::1 (loopback), unique-local fc00::/7, link-local fe80::/10,
 * multicast ff00::/8, unspecified ::, IPv4-mapped/compat embeddings of
 * already-blocked v4 ranges, and the explicit fd00:ec2::254 metadata IP.
 * @param {string} ip
 * @returns {boolean}
 */
function isBlockedIPv6(ip) {
  const expanded = expandIPv6(ip);
  if (!expanded) return true; // malformed, block.

  // ::  (unspecified)  and  ::1 (loopback)
  if (expanded === '0000:0000:0000:0000:0000:0000:0000:0000') return true;
  if (expanded === '0000:0000:0000:0000:0000:0000:0000:0001') return true;

  const firstGroup = parseInt(expanded.slice(0, 4), 16);

  // ff00::/8 multicast
  if ((firstGroup & 0xff00) === 0xff00) return true;
  // fe80::/10 link-local
  if ((firstGroup & 0xffc0) === 0xfe80) return true;
  // fc00::/7 unique-local (incl. fd00::/8)
  if ((firstGroup & 0xfe00) === 0xfc00) return true;

  // ::ffff:a.b.c.d, IPv4-mapped. If the embedded v4 is blocked, block.
  if (expanded.startsWith('0000:0000:0000:0000:0000:ffff:')) {
    const tail = expanded.slice('0000:0000:0000:0000:0000:ffff:'.length);
    const [hex1, hex2] = tail.split(':');
    const n1 = parseInt(hex1, 16);
    const n2 = parseInt(hex2, 16);
    const v4 = `${(n1 >> 8) & 0xff}.${n1 & 0xff}.${(n2 >> 8) & 0xff}.${n2 & 0xff}`;
    if (isBlockedIPv4(v4)) return true;
  }

  return false;
}

/**
 * Check whether an IP literal (v4 or v6) is in a blocked range.
 * @param {string} ip
 * @returns {boolean}
 */
function isBlockedIP(ip) {
  if (typeof ip !== 'string' || ip.length === 0) return true;
  if (net.isIPv4(ip)) return isBlockedIPv4(ip);
  if (net.isIPv6(ip)) return isBlockedIPv6(ip);
  return true;
}

/**
 * Parse the URL and run all synchronous safety checks. Returns a result
 * object: { ok: true, parsed } on success, or { ok: false, reason } on
 * failure. Does NOT perform DNS resolution.
 * @param {string} url
 */
function checkUrlSync(url) {
  if (typeof url !== 'string' || url.length === 0) {
    return { ok: false, reason: 'URL must be a non-empty string' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return { ok: false, reason: 'Invalid URL format' };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: `Disallowed protocol: ${parsed.protocol}` };
  }

  // No userinfo (user:pass@), can be used to obscure the real host.
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'URL must not contain credentials' };
  }

  const rawHost = parsed.hostname;
  if (!rawHost) {
    return { ok: false, reason: 'URL must have a hostname' };
  }

  // URL parses bracketed IPv6 as `[::1]` -> hostname `[::1]`. Strip brackets
  // for our IP checks.
  let host = rawHost;
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  const lowerHost = host.toLowerCase();

  // Literal IP?
  if (net.isIP(host)) {
    if (isBlockedIP(host)) {
      return { ok: false, reason: `Blocked IP literal: ${host}` };
    }
    return { ok: true, parsed, host: lowerHost, isLiteralIp: true };
  }

  // Hostname checks.
  if (BLOCKED_HOSTNAMES.has(lowerHost)) {
    return { ok: false, reason: `Blocked hostname: ${lowerHost}` };
  }
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (lowerHost.endsWith(suffix)) {
      return { ok: false, reason: `Blocked hostname suffix: ${suffix}` };
    }
  }
  for (const prefix of BLOCKED_HOSTNAME_PREFIXES) {
    if (lowerHost.startsWith(prefix)) {
      return { ok: false, reason: `Blocked hostname prefix: ${prefix}` };
    }
  }

  return { ok: true, parsed, host: lowerHost, isLiteralIp: false };
}

/**
 * Synchronous public-URL check. Use this at validation time (e.g. when
 * a user submits a webhook URL via POST/PUT) for a fast 400 reject.
 *
 * NOTE: this does NOT perform DNS resolution, so it cannot catch
 * `evil.example.com` -> `127.0.0.1`. For defense in depth at send-time,
 * use `isPublicUrlAsync` (or `assertPublicUrlAsync`) which also resolves
 * the hostname and checks every returned address.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isPublicUrl(url) {
  return checkUrlSync(url).ok === true;
}

/**
 * Async public-URL check. Performs the sync checks first, then resolves
 * the hostname via DNS and rejects if ANY returned address is in a
 * blocked range. Returns true only if every resolved address is public.
 *
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function isPublicUrlAsync(url) {
  const sync = checkUrlSync(url);
  if (!sync.ok) return false;
  if (sync.isLiteralIp) return true; // already vetted by isBlockedIP

  try {
    const addresses = await dns.lookup(sync.host, { all: true, verbatim: true });
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return false;
    }
    for (const { address } of addresses) {
      if (isBlockedIP(address)) return false;
    }
    return true;
  } catch (err) {
    // DNS failure, fail closed.
    return false;
  }
}

/**
 * Convenience wrapper that throws an Error with a useful message if the
 * URL is not public. Throws synchronously for sync failures and via a
 * rejected promise for DNS / IP failures. Callers can `catch` to surface
 * a 400 / refuse-to-send.
 *
 * @param {string} url
 * @returns {Promise<void>}
 */
async function assertPublicUrlAsync(url) {
  const sync = checkUrlSync(url);
  if (!sync.ok) {
    const err = new Error(`Unsafe URL: ${sync.reason}`);
    err.code = 'UNSAFE_URL';
    throw err;
  }
  if (sync.isLiteralIp) return;

  let addresses;
  try {
    addresses = await dns.lookup(sync.host, { all: true, verbatim: true });
  } catch (dnsErr) {
    const err = new Error(`Unsafe URL: DNS lookup failed for ${sync.host}`);
    err.code = 'UNSAFE_URL';
    throw err;
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    const err = new Error(`Unsafe URL: no DNS records for ${sync.host}`);
    err.code = 'UNSAFE_URL';
    throw err;
  }
  for (const { address } of addresses) {
    if (isBlockedIP(address)) {
      const err = new Error(`Unsafe URL: ${sync.host} resolves to blocked address ${address}`);
      err.code = 'UNSAFE_URL';
      throw err;
    }
  }
}

module.exports = {
  isPublicUrl,
  isPublicUrlAsync,
  assertPublicUrlAsync,
  // Exposed for unit testing only:
  _isBlockedIPv4: isBlockedIPv4,
  _isBlockedIPv6: isBlockedIPv6,
  _checkUrlSync: checkUrlSync,
};

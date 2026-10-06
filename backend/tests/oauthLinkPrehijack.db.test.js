// Account pre-hijack: someone registers the victim's email with a password
// (registration does not prove mailbox ownership), then the real owner signs
// in with Google or GitHub. The link must hand the account to the owner and
// lock the squatter out; a verified account is just linked.
const crypto = require('crypto')
const db = require('../db')

const hash = value => crypto.createHash('sha256').update(value).digest('hex')

async function squattedAccount(label, { verified = false } = {}) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const user = await db.createUser(`prehijack-${label}-${stamp}@example.test`, '$2b$10$attackerchosenpasswordhashxxxxxxxxxxxxxxxxxxxxxxxxxx', `prehijack${label}${stamp}`.slice(0, 30))
  const id = user.id
  await db.run('UPDATE users SET email_verified = ?, totp_secret = ?, is_2fa_enabled = 1, github_access_token = ?, bio = ? WHERE id = ?',
    [verified ? 1 : 0, 'attacker-totp-secret', 'attacker-gh-token', 'attacker bio', id])
  await db.createUserSession(id, hash(`attacker-session-${stamp}`), { ipAddress: '203.0.113.9' })
  await db.saveBackupCodes(id, [hash(`backup-${stamp}`)])
  await db.addTrustedDevice(id, hash(`device-${stamp}`), { deviceName: 'attacker laptop' })
  const now = new Date().toISOString()
  await db.run('INSERT INTO email_changes (user_id, new_email, token_hash, expires_at, used, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    [id, `attacker-${stamp}@example.test`, hash(`change-${stamp}`), Date.now() + 3600000, now])
  await db.run('INSERT INTO password_resets (user_id, token_hash, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)',
    [id, hash(`reset-${stamp}`), Date.now() + 3600000, now])
  await db.run('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, `https://push.example.test/${stamp}`, 'p', 'a', now])
  const before = await db.get('SELECT token_version FROM users WHERE id = ?', [id])
  return { id, tokenVersion: Number(before.token_version || 0) }
}

const count = async (table, id, extra = '') => Number((await db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?${extra}`, [id])).n)

describe('OAuth linking to an account found by email', () => {
  beforeAll(async () => { await db.init() })

  test.each(['google', 'github'])('%s sign-in reclaims an unverified account and locks the squatter out', async provider => {
    const { id, tokenVersion } = await squattedAccount(provider)
    const providerId = `${provider}-owner-${id}`

    expect(await db.linkOAuthIdentity(id, provider, providerId)).toEqual({ linked: true, reclaimed: true })

    const row = await db.get('SELECT * FROM users WHERE id = ?', [id])
    expect(row[provider === 'google' ? 'google_id' : 'github_id']).toBe(providerId)
    expect(row.password).toBe(provider === 'google' ? '$google_oauth_user$' : '$github_oauth_user$')
    expect(Number(row.token_version)).toBe(tokenVersion + 1)
    expect(row.totp_secret).toBeNull()
    expect(Number(row.is_2fa_enabled)).toBe(0)
    expect(row.github_access_token).toBeNull()
    expect(row.bio).toBeNull()
    for (const table of ['user_sessions', 'trusted_devices', 'two_factor_backup_codes', 'push_subscriptions']) {
      expect(await count(table, id)).toBe(0)
    }
    expect(await count('email_changes', id, ' AND used = 0')).toBe(0)
    expect(await count('password_resets', id, ' AND used = 0')).toBe(0)
  })

  test('a verified account is linked without touching its password, sessions or second factor', async () => {
    const { id, tokenVersion } = await squattedAccount('verified', { verified: true })
    expect(await db.linkOAuthIdentity(id, 'google', `google-verified-${id}`)).toEqual({ linked: true, reclaimed: false })
    const row = await db.get('SELECT * FROM users WHERE id = ?', [id])
    expect(row.google_id).toBe(`google-verified-${id}`)
    expect(row.password).not.toBe('$google_oauth_user$')
    expect(Number(row.token_version || 0)).toBe(tokenVersion)
    expect(row.totp_secret).toBe('attacker-totp-secret')
    expect(await count('user_sessions', id)).toBe(1)
  })

  test('both sign-in handlers go through the safe link, never the bare update', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '../routes/auth.js'), 'utf8')
    expect(source).toContain("db.linkOAuthIdentity(existingUser.id, 'google', googleId)")
    expect(source).toContain("db.linkOAuthIdentity(existingUser.id, 'github', githubId)")
    expect(source).not.toMatch(/db\.link(Google|GitHub)Account\(/)
  })

  test('unknown providers and missing users are refused', async () => {
    await expect(db.linkOAuthIdentity(1, 'myspace', 'x')).rejects.toThrow(/Unknown OAuth provider/)
    expect(await db.linkOAuthIdentity(987654321, 'google', 'x')).toEqual({ linked: false, reclaimed: false })
  })
})

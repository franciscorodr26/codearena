import { test, expect, type Page } from '@playwright/test'

async function dashboard(page: Page, { username = 'player_rezpja', rating = 1000, returning = false, resume = false } = {}) {
  const user = { id: 901, username, email: 'player@example.test', username_chosen: 1, has_onboarded: true, avatar: '⭐', rating }
  const now = new Date().toISOString()
  const consent = { analytics: false, functional: false, updatedAt: now }
  const progress = {
    stats: { rating, wins: returning ? 8 : 0, losses: returning ? 2 : 0, winRate: returning ? 80 : 0, currentStreak: returning ? 2 : 0, bestStreak: returning ? 4 : 0 },
    recentActivity: returning ? Array.from({ length: 15 }, (_, i) => ({ id: i, type: 'prompt_practice', title: `Prompt practice ${i + 1}: ${'A long challenge title '.repeat(8)}`, timestamp: now, score: 80, metadata: { challenge_id: 'fixture-prompt' } })) : [],
    promptScoreHistory: { 'fixture-prompt': [50, 65, 80] },
    ratingHistory: [], activityHeatmap: [], trends: {},
  }
  const unexpected: string[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.routeWebSocket('**/*', socket => socket.close())
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const headers = { 'access-control-allow-origin': request.headers().origin || '*', 'access-control-allow-headers': 'authorization,content-type,accept', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-credentials': 'true' }
    const responses: Record<string, unknown> = {
      '/auth/me': { user }, '/auth/consent': { consent }, '/health': { status: 'ok' },
      '/api/analytics/progress': { progress }, '/api/badges/me': { badges: [] }, '/api/badges/me/unnotified': { badges: [] },
      '/api/friends': { friends: [] }, '/api/friends/requests/incoming': { requests: [] }, '/api/friends/requests/outgoing': { requests: [] },
      '/api/messages/conversations': { conversations: [] }, '/api/messages/groups': { groups: [] }, '/api/messages/unread/count': { count: 0 },
      '/api/notifications/in-app': { notifications: [], unreadCount: 0 }, '/api/notifications/in-app/count': { count: 0 },
    }
    if (url.pathname in responses) return route.fulfill(request.method() === 'OPTIONS' ? { status: 204, headers } : { json: responses[url.pathname], headers })
    if (url.pathname.startsWith('/socket.io')) return route.abort()
    if (['fonts.googleapis.com', 'fonts.gstatic.com', 'api.fontshare.com', 'cdn.fontshare.com'].includes(url.hostname)) return route.fulfill({ body: '', contentType: 'text/css' })
    const allowedOrigin = new URL(test.info().project.use.baseURL as string || 'http://127.0.0.1:4417').origin
    if (url.origin === allowedOrigin && request.method() === 'GET' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/auth/')) return route.continue()
    unexpected.push(`${request.method()} ${url.origin}${url.pathname}`)
    return route.abort()
  })
  await page.addInitScript(({ user, consent, resume }) => {
    localStorage.setItem('auth_token', 'synthetic-dashboard-token')
    localStorage.setItem('auth_user', JSON.stringify(user))
    localStorage.setItem('codearena_cookie_consent', JSON.stringify(consent))
    localStorage.setItem(`codearena_onboarded:${user.id}`, 'true')
    sessionStorage.setItem('dashboard_visited', 'true')
    if (resume) localStorage.setItem('lastPracticeSession', JSON.stringify({ problemName: 'Pairs & brackets', problemSlug: 'pairs & brackets', timestamp: Date.now() }))
  }, { user, consent, resume })
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { level: 1, name: username, exact: true })).toBeVisible()
  return { unexpected, errors }
}

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  const heading = page.getByRole('heading', { level: 1 })
  expect(await heading.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
}

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`new player dashboard fits ${width}px with clear actions and honest progress`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const { unexpected, errors } = await dashboard(page)
    const actions = page.getByRole('region', { name: 'What will you try today?' })
    for (const [name, href] of [['Code practice', '/practice'], ['Prompt practice', '/prompt-practice'], ['Quick Match', '/matchmaking'], ['Play with friends', '/battle']]) {
      await expect(actions.getByRole('link', { name: new RegExp(name) })).toHaveAttribute('href', href)
    }
    const rank = page.getByRole('region', { name: 'Battle rating' })
    const bar = rank.getByRole('progressbar')
    await expect(bar).toHaveAttribute('aria-valuemin', '0')
    await expect(bar).toHaveAttribute('aria-valuemax', '1200')
    await expect(bar).toHaveAttribute('aria-valuenow', '1000')
    await expect(rank.getByText('200 points to go')).toBeVisible()
    const bounds = await bar.boundingBox()
    const fill = await bar.locator(':scope > div').boundingBox()
    expect(fill!.width / bounds!.width).toBeCloseTo(1000 / 1200, 2)
    const recent = page.getByRole('region', { name: 'Recent activity' })
    await expect(recent).toContainText('Your coding sessions, prompt practice and battles will appear here.')
    expect((await recent.boundingBox())!.y).toBeGreaterThan((await actions.boundingBox())!.y + (await actions.boundingBox())!.height)
    expect((await recent.boundingBox())!.height).toBeLessThan(180)
    await fits(page)
    await expect(page.getByRole('heading', { name: 'Rating History' })).not.toBeVisible()
    if (width >= 1024) {
      const a = await actions.boundingBox()
      const r = await rank.boundingBox()
      expect(a!.x + a!.width).toBeLessThanOrEqual(r!.x)
      expect(r!.height).toBeLessThan(290)
    }
    await page.screenshot({ path: info.outputPath(`dashboard-${width}.png`), fullPage: true })
    await page.locator('summary').filter({ hasText: 'Your progress' }).click()
    await expect(page.getByRole('heading', { name: 'Rating History' })).toBeVisible()
    if (width < 1024) {
      await page.getByRole('button', { name: 'Open menu' }).click()
      await expect(page.getByRole('link', { name: 'Find Match', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Close menu' }).click()
    }
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

test('long names and populated activity stay separate and readable', async ({ page }, info) => {
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const { unexpected, errors } = await dashboard(page, { username: 'player_with_a_very_long_display_name_for_layout', rating: 1300, returning: true })
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemin', '1200')
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '1400')
    await expect(page.getByRole('list', { name: 'Recent sessions' }).getByRole('listitem')).toHaveCount(15)
    expect((await page.getByRole('list', { name: 'Recent sessions' }).boundingBox())!.height).toBeLessThanOrEqual(256)
    await fits(page)
    await page.screenshot({ path: info.outputPath(`returning-${width}.png`), fullPage: true })
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  }
})

test('zero rating, saved practice and keyboard navigation', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  const { unexpected, errors } = await dashboard(page, { rating: 0, resume: true })
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  await expect(page.getByRole('region', { name: 'Battle rating' })).toContainText('1200 points to go')
  const resume = page.getByRole('link', { name: /Code practice/ })
  await expect(resume).toHaveAttribute('href', '/practice?problem=pairs%20%26%20brackets')
  await resume.focus()
  // Safari on macOS includes links in keyboard traversal with Option-Tab.
  await page.keyboard.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab')
  await expect(page.getByRole('link', { name: /Prompt practice Try/ })).toBeFocused()
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

test('highest tier has no invented next rank or progress target', async ({ page }) => {
  const { unexpected, errors } = await dashboard(page, { rating: 2400 })
  const rank = page.getByRole('region', { name: 'Battle rating' })
  await expect(rank).toContainText('Grandmaster')
  await expect(rank).toContainText('Highest tier reached')
  await expect(rank.getByRole('progressbar')).toHaveCount(0)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

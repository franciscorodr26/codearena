import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

// End-to-end proof of the open edition against a running local stack.
// See open-edition.config.ts for how the servers are expected to run.

const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:3201'
const SHOTS = process.env.E2E_SHOTS || path.resolve(__dirname, '../test-results/open-edition-shots')
const SOLUTIONS = path.resolve(__dirname, '../../backend/arena/solutions')
mkdirSync(SHOTS, { recursive: true })

type DevUser = { token: string; user: { id: number; username: string } }
type Problem = { id: string; title: string; difficulty: string; starterCode: Record<string, string>; hiddenTestCases: number; totalTests: number; testCases: { input: string; expected: string }[] }

async function devSession(slot: 1 | 2): Promise<DevUser> {
  const res = await fetch(`${BACKEND}/auth/dev-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot }) })
  if (!res.ok) throw new Error(`dev-session ${slot} failed: ${res.status}`)
  const dev: DevUser = await res.json()
  // A first visit shows the welcome tour. Real users skip it once; the proof completes it up front.
  await fetch(`${BACKEND}/auth/onboarding/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dev.token}` }, body: '{}' })
  return dev
}

// Fallback if the welcome tour still appears: its close button has no accessible name (reported).
async function dismissWelcome(page: Page) {
  const welcome = page.getByText('Welcome!')
  if (await welcome.isVisible({ timeout: 2500 }).catch(() => false)) {
    await page.locator('button.absolute.top-4.right-4').first().click()
    await welcome.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  }
}

async function signedInContext(browser: Browser, dev: DevUser): Promise<BrowserContext> {
  const context = await browser.newContext()
  await context.addInitScript(({ token, user }) => {
    window.localStorage.setItem('auth_token', token)
    window.localStorage.setItem('auth_user', JSON.stringify(user))
    window.localStorage.setItem('codearena_cookie_consent', JSON.stringify({ analytics: false, decided: true }))
  }, dev)
  return context
}

function watchConsole(page: Page, label: string, sink: string[]) {
  page.on('pageerror', err => sink.push(`${label}: pageerror ${err.message}`))
  page.on('console', msg => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (/favicon|hydration|Download the React DevTools|net::ERR_|Failed to load resource/i.test(text)) return
    sink.push(`${label}: console.error ${text.slice(0, 200)}`)
  })
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false })
}

async function allProblems(): Promise<Problem[]> {
  const res = await fetch(`${BACKEND}/api/problems?shuffle=false`)
  const data = await res.json()
  return data.problems
}

function referenceSolution(id: string, language: 'python' | 'javascript') {
  return readFileSync(path.join(SOLUTIONS, `${id}.${language === 'python' ? 'py' : 'js'}`), 'utf8')
}

// Monaco 0.55 uses the EditContext API in Chromium (no hidden textarea and
// synthetic select-all is unreliable), so set the value through Monaco's own
// API; @monaco-editor/react exposes it on window.monaco and forwards the change.
async function setEditorCode(page: Page, code: string) {
  await page.locator('.monaco-editor .view-lines').first().waitFor({ state: 'visible', timeout: 45000 })
  await page.waitForFunction(() => (window as any).monaco?.editor?.getEditors?.().length > 0, null, { timeout: 30000 })
  await page.evaluate((value) => {
    const editors = (window as any).monaco.editor.getEditors()
    const editor = editors.find((e: any) => e.hasTextFocus?.()) || editors[editors.length - 1]
    editor.setValue(value)
  }, code)
  await page.waitForTimeout(300)
}

// Monaco renders spaces as non-breaking spaces; normalise before matching.
async function editorText(page: Page) {
  const text = await page.locator('.monaco-editor .view-lines').first().innerText()
  return text.replace(/\u00a0/g, ' ')
}

async function currentProblemTitle(page: Page, problems: Problem[]) {
  for (let i = 0; i < 40; i++) {
    const text = await page.locator('main, body').first().innerText()
    const hit = problems.find(p => text.includes(p.title))
    if (hit) return hit
    await page.waitForTimeout(500)
  }
  throw new Error('no known problem title on the page')
}

test.describe.configure({ mode: 'default' })

let userA: DevUser
let userB: DevUser
let problems: Problem[]

test.beforeAll(async () => {
  userA = await devSession(1)
  userB = await devSession(2)
  problems = await allProblems()
  expect(problems.length).toBe(25)
})

test('1. practice warm-up: starter, run, reference solution, custom input, chips, next', async ({ browser }) => {
  const context = await signedInContext(browser, userA)
  const page = await context.newPage()
  const errors: string[] = []
  watchConsole(page, 'practice', errors)

  await page.goto('/practice')
  await dismissWelcome(page)
  await page.locator('.monaco-editor').first().waitFor({ timeout: 45000 })
  const first = await currentProblemTitle(page, problems)
  await page.selectOption('select[aria-label="Language"]', 'python')
  await expect.poll(() => editorText(page), { timeout: 15000 }).toContain('def ')
  await shot(page, '01-practice-loaded')

  // Starter fails honestly
  await page.getByRole('button', { name: /run tests/i }).click()
  await expect(page.getByText(/of \d+ tests passed/)).toBeVisible({ timeout: 60000 })
  const starterSummary = await page.getByText(/of \d+ tests passed/).innerText()
  expect(starterSummary).toMatch(/^0 of/)
  await shot(page, '02-practice-starter-fails')

  // Reference solution passes everything, hidden count shown
  await setEditorCode(page, referenceSolution(first.id, 'python'))
  await page.getByRole('button', { name: /run tests/i }).click()
  await expect(page.getByText('Every test passed, hidden ones included.')).toBeVisible({ timeout: 60000 })
  await expect(page.getByText(new RegExp(`${first.hiddenTestCases} of ${first.hiddenTestCases} hidden`))).toBeVisible()
  await expect(page.getByText('XP today', { exact: true })).toBeVisible()
  const xpText = await page.getByText('XP today', { exact: true }).locator('..').innerText()
  await shot(page, '03-practice-reference-passes')

  // Custom input prefilled from the first example
  await page.getByRole('button', { name: /try your own input/i }).click()
  const custom = page.locator('#practice-custom-input')
  await expect(custom).toBeVisible()
  const prefilled = await custom.inputValue()
  expect(prefilled.trim()).toBe(first.testCases[0].input)
  await page.getByRole('button', { name: /run with this input/i }).click()
  await expect(page.getByText(/Returned:/)).toBeVisible({ timeout: 60000 })
  const returned = await page.getByText(/Returned:/).locator('..').innerText()
  expect(returned.replace(/\s+/g, ' ')).toContain(first.testCases[0].expected.replace(/\s+/g, ' '))
  await shot(page, '04-practice-custom-input')

  // Difficulty chip + quick warm-up fetch a different problem
  await page.getByRole('button', { name: /^hard$/i }).click()
  await page.getByRole('button', { name: /quick warm-up/i }).click()
  await expect.poll(async () => (await currentProblemTitle(page, problems)).id, { timeout: 20000 }).not.toBe(first.id)
  const hard = await currentProblemTitle(page, problems)
  expect(hard.difficulty).toBe('Hard')
  await shot(page, '05-practice-hard-warmup')

  // Next warm-up after a pass
  await page.selectOption('select[aria-label="Language"]', 'python')
  await setEditorCode(page, referenceSolution(hard.id, 'python'))
  await page.getByRole('button', { name: /run tests/i }).click()
  await expect(page.getByText('Every test passed, hidden ones included.')).toBeVisible({ timeout: 90000 })
  await page.getByRole('button', { name: /next warm-up/i }).click()
  await expect.poll(async () => (await currentProblemTitle(page, problems)).id, { timeout: 20000 }).not.toBe(hard.id)
  await shot(page, '06-practice-next-warmup')

  // Direct link
  await page.goto('/practice?problem=win-streak')
  await expect(page.getByText('Win Streak').first()).toBeVisible({ timeout: 30000 })
  await shot(page, '07-practice-direct-link')

  expect(errors, errors.join('\n')).toEqual([])
  test.info().annotations.push({ type: 'xp', description: xpText })
  await context.close()
})

test('2. problem library lists 25 problems and links into practice', async ({ browser }) => {
  const context = await signedInContext(browser, userA)
  const page = await context.newPage()
  const errors: string[] = []
  watchConsole(page, 'problems', errors)

  await page.goto('/problems')
  await dismissWelcome(page)
  await expect(page.getByRole('link', { name: 'Win Streak' })).toBeVisible({ timeout: 30000 })
  const links = page.locator('a[href^="/problems/"]')
  await expect.poll(() => links.count()).toBeGreaterThanOrEqual(25)
  await page.getByRole('button', { name: /^hard$/i }).click()
  await expect.poll(() => links.count()).toBe(5)
  await shot(page, '08-problems-hard-filter')
  await page.getByRole('button', { name: /^all$/i }).click()

  await page.goto('/problems/win-streak')
  await expect(page.getByRole('heading', { name: 'Win Streak' })).toBeVisible({ timeout: 30000 })
  await shot(page, '09-problem-page')
  await page.locator('a[href*="/practice?problem=win-streak"]').first().click()
  await expect(page).toHaveURL(/\/practice\?problem=win-streak/)
  await page.locator('.monaco-editor').first().waitFor({ timeout: 45000 })
  expect(errors, errors.join('\n')).toEqual([])
  await context.close()
})

test('3. private battle between two browsers, wrong then right submission, profiles', async ({ browser }) => {
  const contextA = await signedInContext(browser, userA)
  const contextB = await signedInContext(browser, userB)
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  const errors: string[] = []
  watchConsole(pageA, 'battle A', errors)
  watchConsole(pageB, 'battle B', errors)

  await pageA.goto('/battle')
  await dismissWelcome(pageA)
  const createResponse = pageA.waitForResponse(r => r.url().includes('/api/battle/create') && r.request().method() === 'POST')
  await pageA.getByRole('button', { name: /create battle/i }).click()
  const created = await (await createResponse).json()
  expect(created.battleId).toBeTruthy()
  await expect(pageA.getByText(/waiting for opponent/i)).toBeVisible({ timeout: 30000 })
  await shot(pageA, '10-battle-created-waiting')

  const inviteRes = await fetch(`${BACKEND}/api/battle/${created.battleId}/invite`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userA.token}` }, body: '{}'
  })
  expect(inviteRes.ok).toBe(true)
  const { inviteUrl } = await inviteRes.json()
  const invitePath = new URL(inviteUrl).pathname
  await pageB.goto(invitePath)
  await dismissWelcome(pageB)
  await expect(pageB).toHaveURL(/\/battle\?id=/, { timeout: 30000 })
  await shot(pageB, '11-battle-b-joined')
  await expect(pageA.getByText(/opponent found/i)).toBeVisible({ timeout: 30000 })

  for (const page of [pageA, pageB]) {
    const select = page.locator('select').first()
    await select.waitFor({ timeout: 30000 })
    await select.selectOption('python')
  }
  await pageA.getByRole('button', { name: /^ready$/i }).click()
  await pageB.getByRole('button', { name: /^ready$/i }).click()
  await pageA.locator('.monaco-editor').first().waitFor({ timeout: 60000 })
  await pageB.locator('.monaco-editor').first().waitFor({ timeout: 60000 })
  const problem = await currentProblemTitle(pageB, problems)
  await shot(pageA, '12-battle-coding-a')

  // A submits the starter first and gets honest failure feedback
  await pageA.getByRole('button', { name: /submit solution/i }).click()
  await expect(pageA.getByText(/failed|tests? passed|0\s*\/\s*\d+/i).first()).toBeVisible({ timeout: 60000 })
  await shot(pageA, '13-battle-a-wrong-submission')
  const aAfterWrong = await pageA.locator('body').innerText()
  test.info().annotations.push({ type: 'wrong-submission-feedback', description: aAfterWrong.replace(/\s+/g, ' ').slice(0, 600) })

  // B submits the reference solution and wins
  await setEditorCode(pageB, referenceSolution(problem.id, 'python'))
  await pageB.getByRole('button', { name: /submit solution/i }).click()
  await expect(pageB.getByRole('heading', { name: /victory/i })).toBeVisible({ timeout: 90000 })
  await shot(pageB, '14-battle-b-victory')
  await expect(pageA.getByRole('heading', { name: /defeat/i })).toBeVisible({ timeout: 60000 })
  await shot(pageA, '15-battle-a-defeat')

  // Profiles list the battle
  await pageB.goto(`/profile/${userB.user.username}`)
  await expect(pageB.getByText(new RegExp(`${problem.id}|${problem.title}`)).first()).toBeVisible({ timeout: 30000 })
  const profileText = await pageB.locator('body').innerText()
  test.info().annotations.push({ type: 'profile-shows-title', description: String(profileText.includes(problem.title)) })
  await shot(pageB, '16-profile-b-battles')
  await pageA.goto(`/profile/${userA.user.username}`)
  await expect(pageA.getByText(new RegExp(`${problem.id}|${problem.title}`)).first()).toBeVisible({ timeout: 30000 })
  await shot(pageA, '17-profile-a-battles')

  expect(errors, errors.join('\n')).toEqual([])
  await contextA.close()
  await contextB.close()
})

test('4. bot battle runs to a result', async ({ browser }) => {
  const context = await signedInContext(browser, userA)
  const page = await context.newPage()
  const errors: string[] = []
  watchConsole(page, 'bot', errors)

  await page.goto('/bot-battle')
  await dismissWelcome(page)
  await page.getByRole('button', { name: /python/i }).first().click()
  await page.getByRole('button', { name: /^start .* battle$/i }).click()
  await expect(page).toHaveURL(/\/battle\?id=.*isAgainstBot=true/, { timeout: 30000 })
  const ready = page.getByRole('button', { name: /^ready$/i })
  if (await ready.isVisible({ timeout: 5000 }).catch(() => false)) await ready.click()
  await page.locator('.monaco-editor').first().waitFor({ timeout: 90000 })
  const problem = await currentProblemTitle(page, problems)
  await shot(page, '18-bot-battle-coding')
  await setEditorCode(page, referenceSolution(problem.id, 'python'))
  await page.getByRole('button', { name: /submit solution/i }).click()
  const heading = page.getByRole('heading', { name: /victory|defeat|close battle|partial win/i })
  await expect(heading).toBeVisible({ timeout: 120000 })
  test.info().annotations.push({ type: 'bot-result', description: await heading.innerText() })
  await shot(page, '19-bot-battle-result')
  expect(errors, errors.join('\n')).toEqual([])
  await context.close()
})

test('5. matchmaking: practice while you wait, then a match pulls A into the battle', async ({ browser }) => {
  const contextA = await signedInContext(browser, userA)
  const contextB = await signedInContext(browser, userB)
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  const errors: string[] = []
  watchConsole(pageA, 'queue A', errors)
  watchConsole(pageB, 'queue B', errors)

  await pageA.goto('/matchmaking')
  await dismissWelcome(pageA)
  await pageA.getByRole('button', { name: /find (ranked|unranked) match/i }).click()
  await shot(pageA, '20-queue-a-searching')
  const practiceNow = pageA.getByRole('button', { name: /start practicing now/i })
  await expect(practiceNow).toBeVisible({ timeout: 60000 })
  await shot(pageA, '21-queue-a-play-while-you-wait')
  await practiceNow.click()
  await expect(pageA).toHaveURL(/\/practice\?queueActive=true/, { timeout: 30000 })
  await expect(pageA.getByText(/In queue for/)).toBeVisible({ timeout: 30000 })
  await shot(pageA, '22-practice-in-queue-banner')

  await pageB.goto('/matchmaking')
  await dismissWelcome(pageB)
  await pageB.getByRole('button', { name: /find (ranked|unranked) match/i }).click()

  const accept = pageA.getByRole('button', { name: /accept/i })
  const matched = await Promise.race([
    accept.waitFor({ timeout: 45000 }).then(() => 'overlay').catch(() => null),
    pageA.waitForURL(/\/battle\?id=/, { timeout: 45000 }).then(() => 'navigated').catch(() => null)
  ])
  await shot(pageA, '23-practice-match-found')
  if (matched === 'overlay') await accept.click()
  if (!matched) {
    const text = await pageA.locator('body').innerText()
    test.info().annotations.push({ type: 'queue-no-match', description: text.replace(/\s+/g, ' ').slice(0, 500) })
  }
  expect(matched, 'match-found never reached A on the practice page').toBeTruthy()
  await expect(pageA).toHaveURL(/\/battle\?id=/, { timeout: 45000 })
  const acceptB = pageB.getByRole('button', { name: /accept/i })
  if (await acceptB.isVisible({ timeout: 5000 }).catch(() => false)) await acceptB.click()
  await expect(pageB).toHaveURL(/\/battle\?id=/, { timeout: 45000 })
  await shot(pageA, '24-matchmade-battle-a')
  expect(errors, errors.join('\n')).toEqual([])
  await contextA.close()
  await contextB.close()
})

test('6. prompt practice without a model key says so and does not crash', async ({ browser }) => {
  const context = await signedInContext(browser, userA)
  const page = await context.newPage()
  const errors: string[] = []
  watchConsole(page, 'prompt', errors)

  await page.goto('/practice?mode=prompting')
  await dismissWelcome(page)
  await expect(page).toHaveURL(/prompt-practice/, { timeout: 30000 })
  await expect(page.getByRole('button', { name: /patch notes/i })).toBeVisible({ timeout: 30000 })
  const items = page.locator('button', { hasText: /easy|medium|hard/i })
  await expect.poll(() => items.count()).toBeGreaterThanOrEqual(12)
  await shot(page, '25-prompt-list')
  // The server reports up front that no model is configured; the page says so before any attempt.
  await expect(page.getByText('Prompt evaluation is not enabled on this server.')).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: /patch notes/i }).click()
  await expect(page.getByRole('heading', { name: 'Patch Notes' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^evaluate$/i })).toBeDisabled()
  await shot(page, '26-prompt-not-enabled')
  expect(errors, errors.join('\n')).toEqual([])
  await context.close()
})

test('7. every page renders without console or page errors while signed in', async ({ browser }) => {
  const context = await signedInContext(browser, userA)
  const page = await context.newPage()
  const errors: string[] = []
  const statuses: string[] = []
  watchConsole(page, 'smoke', errors)
  const pages = [
    '/', '/about', '/activity', '/admin', '/admin/accounts', '/admin/emails', '/admin/moderation', '/admin/trust',
    '/analytics', `/badges/${userA.user.username}`, '/battle', '/battle/invite/not-a-real-code', '/bot-battle', '/challenge',
    '/complete-profile', '/create', '/dashboard', '/forgot-password', '/friends', '/gallery', '/leaderboard', '/login',
    '/matchmaking', '/messages', `/messages/${userB.user.id}`, '/modes', '/players', '/practice', '/pricing', '/privacy',
    '/problems', '/problems/win-streak', `/profile/${userA.user.username}`, '/profile', '/prompt-battle', '/prompt-practice',
    '/register', '/reset-password', '/settings/profile', '/terms', '/tournaments', '/tournaments/join/not-a-code',
    '/unsubscribe', '/verify-email', '/verify-required', '/does-not-exist'
  ]
  for (const route of pages) {
    const before = errors.length
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => null)
    await page.waitForTimeout(1500)
    const status = response ? response.status() : 0
    const body = await page.locator('body').innerText().catch(() => '')
    const serverError = /Application error|Internal Server Error|Unhandled Runtime Error/i.test(body)
    statuses.push(`${route} -> ${status}${serverError ? ' SERVER-ERROR' : ''}${errors.length > before ? ` (${errors.length - before} console errors)` : ''}`)
    if (serverError || status >= 500) await shot(page, `27-smoke${route.replace(/[^a-z0-9]+/gi, '-')}`)
  }
  test.info().annotations.push({ type: 'page-statuses', description: statuses.join(' | ') })
  const bad = statuses.filter(s => /SERVER-ERROR| -> 5\d\d/.test(s))
  expect(bad, bad.join('\n')).toEqual([])
  expect(errors, errors.join('\n')).toEqual([])
  await context.close()
})

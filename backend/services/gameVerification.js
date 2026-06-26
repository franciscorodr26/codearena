const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const vm = require('vm')
const Anthropic = require('@anthropic-ai/sdk')
const { validateGameHtml, hasCanvasElement } = require('./gameTemplates')

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 30000 })
  : null

const VERIFIER_VERSION = 'creatorarena-verify-v1'
const RUNTIME_TIMEOUT_MS = Number(process.env.CREATORARENA_VERIFY_TIMEOUT_MS) || 8000
const ACCURACY_PASS_THRESHOLD = Number(process.env.CREATORARENA_VERIFY_ACCURACY_THRESHOLD) || 0.66

function extractScripts(html) {
  return [...String(html || '').matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1] || '')
}

function normalizePrompt(prompt) {
  return String(prompt || '').trim()
}

function inferControlRequirements(promptLower) {
  const controls = []

  if (/(arrow keys?|left\/right|left and right)/.test(promptLower)) {
    controls.push('arrow')
  }
  if (/\bwasd\b/.test(promptLower)) {
    controls.push('wasd')
  }
  if (/\bspace\b/.test(promptLower)) {
    controls.push('space')
  }
  if (/mouse|click|aim|drag/.test(promptLower)) {
    controls.push('mouse')
  }
  if (/touch|tap/.test(promptLower)) {
    controls.push('touch')
  }

  return [...new Set(controls)]
}

function inferHudRequirements(promptLower) {
  const hud = []
  if (/\bscore\b/.test(promptLower)) hud.push('score')
  if (/\blives?\b|\bhp\b|\bhealth\b/.test(promptLower)) hud.push('lives')
  if (/\btimer\b|\btime remaining\b|\bseconds?\b/.test(promptLower)) hud.push('timer')
  if (/\bwave\b/.test(promptLower)) hud.push('wave')
  if (/\bcombo\b/.test(promptLower)) hud.push('combo')
  return [...new Set(hud)]
}

function inferEntities(promptLower) {
  const entities = []
  if (/player|ship|character|hero|slime|ball|snake/.test(promptLower)) entities.push('player')
  if (/enemy|zombie|obstacle|brick|customers|bug|tower|fish|card|ghost/.test(promptLower)) entities.push('enemy_or_obstacle')
  if (/coin|power-?up|item|collect|pickup|guest dot/.test(promptLower)) entities.push('collectible')
  return [...new Set(entities)]
}

function inferMechanics(promptLower) {
  const mechanics = []
  if (/collision|hit|bounce|contact/.test(promptLower)) mechanics.push('collision')
  if (/restart|play again|press r/.test(promptLower)) mechanics.push('restart')
  if (/win when|victory|complete all|clear all/.test(promptLower)) mechanics.push('win_condition')
  if (/game over|lose|0 lives|0 hp|bust/.test(promptLower)) mechanics.push('lose_condition')
  if (/shoot|bullet|laser/.test(promptLower)) mechanics.push('shooting')
  return [...new Set(mechanics)]
}

function inferSubjectiveAssertions(promptLower) {
  const assertions = []
  if (/neon|retro|cozy|cyberpunk|pastel|dark theme|terminal|artist studio/.test(promptLower)) {
    assertions.push('visual_theme_match')
  }
  if (/theme|story|narrative|cat theme|party theme|coding theme/.test(promptLower)) {
    assertions.push('semantic_theme_match')
  }
  return assertions
}

function extractVerificationSpec({ prompt, html, gameType = 'browser' }) {
  const cleanPrompt = normalizePrompt(prompt)
  const promptLower = cleanPrompt.toLowerCase()
  const isCanvasGame = gameType === 'browser' || hasCanvasElement(html)

  return {
    gameType: gameType || (isCanvasGame ? 'browser' : 'text'),
    requiredControls: inferControlRequirements(promptLower),
    requiredHud: inferHudRequirements(promptLower),
    requiredEntities: inferEntities(promptLower),
    requiredMechanics: inferMechanics(promptLower),
    subjectiveAssertions: inferSubjectiveAssertions(promptLower),
    requiresCanvas: isCanvasGame,
    requiresRestart: /restart|play again|press r/.test(promptLower),
    requiresScore: /\bscore\b/.test(promptLower),
    requiresLives: /\blives?\b|\bhp\b|\bhealth\b/.test(promptLower),
    requiresTimer: /\btimer\b|\btime remaining\b|\bseconds?\b/.test(promptLower),
    sourcePrompt: cleanPrompt
  }
}

function getDeterministicAssertions(spec) {
  const assertions = []

  if (spec.requiresCanvas) {
    assertions.push({
      id: 'canvas-present',
      type: 'html',
      description: 'Canvas element exists',
      test: ({ html }) => /<canvas[\s>]/i.test(html)
    })
  }

  for (const hudItem of spec.requiredHud) {
    assertions.push({
      id: `hud-${hudItem}`,
      type: 'html',
      description: `HUD includes ${hudItem}`,
      test: ({ html }) => new RegExp(hudItem, 'i').test(html)
    })
  }

  if (spec.requiresRestart) {
    assertions.push({
      id: 'restart-affordance',
      type: 'html',
      description: 'Restart affordance exists',
      test: ({ html }) => /restart|play again|keyr|press r/i.test(html)
    })
  }

  if (spec.requiredControls.includes('arrow')) {
    assertions.push({
      id: 'controls-arrow',
      type: 'html',
      description: 'Arrow key handling exists',
      test: ({ html }) => /ArrowLeft|ArrowRight|ArrowUp|ArrowDown/.test(html)
    })
  }

  if (spec.requiredControls.includes('wasd')) {
    assertions.push({
      id: 'controls-wasd',
      type: 'html',
      description: 'WASD handling exists',
      test: ({ html }) => /KeyW|KeyA|KeyS|KeyD/.test(html)
    })
  }

  if (spec.requiredControls.includes('mouse')) {
    assertions.push({
      id: 'controls-mouse',
      type: 'html',
      description: 'Mouse handling exists',
      test: ({ html }) => /mousedown|mouseup|mousemove|click/.test(html)
    })
  }

  return assertions
}

function buildFinding(id, severity, message, details = {}) {
  return { id, severity, message, ...details }
}

function runStaticValidation(html, spec) {
  const findings = []
  const issues = validateGameHtml(html)
  const assertions = getDeterministicAssertions(spec)

  for (const issue of issues) {
    findings.push(buildFinding(issue.name, 'error', issue.fix, { source: 'validator' }))
  }

  for (const scriptContent of extractScripts(html)) {
    try {
      new vm.Script(scriptContent)
    } catch (err) {
      findings.push(buildFinding('js-syntax', 'error', `JavaScript syntax error: ${err.message}`, { source: 'vm' }))
    }
  }

  if (/document\.write\s*\(/i.test(html)) {
    findings.push(buildFinding('forbidden-document-write', 'error', 'document.write() is not allowed', { source: 'policy' }))
  }

  if (String(html || '').length > 500000) {
    findings.push(buildFinding('html-too-large', 'error', 'Game HTML exceeds 500KB', { source: 'policy' }))
  }

  for (const assertion of assertions) {
    let passed = false
    try {
      passed = Boolean(assertion.test({ html, spec }))
    } catch (err) {
      passed = false
    }
    if (!passed) {
      findings.push(buildFinding(assertion.id, 'error', assertion.description, { source: 'assertion' }))
    }
  }

  return {
    status: findings.some(f => f.severity === 'error') ? 'failed' : 'passed',
    findings
  }
}

function resolvePlaywright() {
  try {
    return require('playwright')
  } catch (_) {
    try {
      const frontendNodeModules = path.resolve(__dirname, '../../frontend/node_modules')
      return require(require.resolve('playwright', { paths: [frontendNodeModules] }))
    } catch (err) {
      return null
    }
  }
}

async function writeHarnessFile(html) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'creatorarena-verify-'))
  const harnessPath = path.join(tempDir, 'harness.html')
  const harnessHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CreatorArena Verification Harness</title>
  <style>
    html, body { margin: 0; padding: 0; background: #111; }
    iframe { width: 800px; height: 600px; border: 0; display: block; margin: 0 auto; background: white; }
  </style>
</head>
<body>
  <iframe id="game-frame" name="game-frame" sandbox="allow-scripts"></iframe>
  <script>
    const iframe = document.getElementById('game-frame')
    iframe.srcdoc = ${JSON.stringify(String(html || ''))}
  </script>
</body>
</html>`
  await fs.writeFile(harnessPath, harnessHtml, 'utf8')
  return { tempDir, harnessPath }
}

async function cleanupHarness(tempDir) {
  if (!tempDir) return
  try {
    await fs.rm(tempDir, { recursive: true, force: true })
  } catch (_) {
    // Best effort cleanup only
  }
}

async function runRuntimeValidation(html, spec) {
  const playwright = resolvePlaywright()
  if (!playwright) {
    return {
      status: 'passed',
      findings: [buildFinding('playwright-missing', 'warning', 'Playwright runtime is not available on this host; skipping runtime check', { source: 'infrastructure' })],
      artifacts: { verifierVersion: VERIFIER_VERSION }
    }
  }

  let browser
  let tempDir
  const findings = []
  const artifacts = { verifierVersion: VERIFIER_VERSION, screenshotCaptured: false }

  try {
    const { harnessPath, tempDir: createdTempDir } = await writeHarnessFile(html)
    tempDir = createdTempDir

    browser = await playwright.chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const consoleErrors = []
    const pageErrors = []

    page.on('pageerror', error => {
      pageErrors.push(String(error.message || error))
    })
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    await page.goto(`file://${harnessPath}`, { waitUntil: 'load', timeout: RUNTIME_TIMEOUT_MS })
    const frameHandle = await page.waitForSelector('#game-frame', { timeout: RUNTIME_TIMEOUT_MS })
    const frame = await frameHandle.contentFrame()
    if (!frame) {
      findings.push(buildFinding('iframe-missing', 'error', 'Verification harness could not access the sandboxed game frame', { source: 'runtime' }))
    } else {
      await frame.waitForLoadState('domcontentloaded', { timeout: RUNTIME_TIMEOUT_MS }).catch(() => {})
      await page.waitForTimeout(750)

      const runtimeSnapshot = await frame.evaluate(() => {
        const text = (document.body?.innerText || '').slice(0, 2000)
        const canvas = document.querySelector('canvas')
        return {
          readyState: document.readyState,
          text,
          bodyChildCount: document.body?.children?.length || 0,
          nodeCount: document.querySelectorAll('*').length,
          canvasPresent: Boolean(canvas),
          canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null
        }
      }).catch(() => null)

      artifacts.runtimeSnapshot = runtimeSnapshot

      if (!runtimeSnapshot) {
        findings.push(buildFinding('frame-eval-failed', 'error', 'Could not inspect sandboxed game DOM', { source: 'runtime' }))
      } else {
        if (runtimeSnapshot.nodeCount === 0 || runtimeSnapshot.bodyChildCount === 0) {
          findings.push(buildFinding('blank-frame', 'error', 'Game rendered no usable DOM content', { source: 'runtime' }))
        }
        if (spec.requiresCanvas && !runtimeSnapshot.canvasPresent) {
          findings.push(buildFinding('canvas-not-rendered', 'error', 'Expected a canvas game but no canvas rendered at runtime', { source: 'runtime' }))
        }
        if (spec.requiresCanvas && runtimeSnapshot.canvasSize && (
          runtimeSnapshot.canvasSize.width !== 600 || runtimeSnapshot.canvasSize.height !== 400
        )) {
          findings.push(buildFinding('canvas-size-mismatch', 'error', 'Canvas runtime size is not 600x400', { source: 'runtime' }))
        }
        if (spec.requiresScore && !/score/i.test(runtimeSnapshot.text || '')) {
          findings.push(buildFinding('score-missing-runtime', 'error', 'Expected score UI was not visible at runtime', { source: 'runtime' }))
        }
      }

      await frame.click('body', { position: { x: 100, y: 100 }, timeout: 1000 }).catch(() => {})

      if (spec.requiredControls.includes('arrow')) {
        await page.keyboard.press('ArrowLeft').catch(() => {})
        await page.keyboard.press('ArrowRight').catch(() => {})
      }
      if (spec.requiredControls.includes('wasd')) {
        await page.keyboard.press('KeyW').catch(() => {})
        await page.keyboard.press('KeyD').catch(() => {})
      }
      if (spec.requiredControls.includes('space')) {
        await page.keyboard.press('Space').catch(() => {})
      }

      await page.waitForTimeout(500)

      if (pageErrors.length > 0) {
        findings.push(buildFinding('pageerror', 'error', pageErrors.join(' | '), { source: 'runtime' }))
      }
      if (consoleErrors.length > 0) {
        findings.push(buildFinding('console-error', 'error', consoleErrors.join(' | '), { source: 'runtime' }))
      }

      const screenshotPath = path.join(tempDir, 'runtime.png')
      const screenshotTaken = await page.screenshot({ path: screenshotPath, fullPage: true }).then(() => true).catch(() => false)
      artifacts.screenshotCaptured = screenshotTaken
    }

    return {
      status: findings.some(f => f.severity === 'error') ? 'failed' : 'passed',
      findings,
      artifacts
    }
  } catch (err) {
    return {
      status: 'failed',
      findings: [buildFinding('runtime-exception', 'error', `Runtime verification failed: ${err.message}`, { source: 'runtime' })],
      artifacts
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
    await cleanupHarness(tempDir)
  }
}

function runDeterministicAccuracyEvaluation(html, spec, runtimeArtifacts = {}) {
  const findings = []
  const checks = []

  if (spec.requiresScore) {
    checks.push({
      id: 'score-semantic',
      passed: /score/i.test(html) || /score/i.test(runtimeArtifacts.runtimeSnapshot?.text || ''),
      message: 'Prompt requires a score display'
    })
  }
  if (spec.requiresLives) {
    checks.push({
      id: 'lives-semantic',
      passed: /lives?|hp|health/i.test(html) || /lives?|hp|health/i.test(runtimeArtifacts.runtimeSnapshot?.text || ''),
      message: 'Prompt requires lives or health UI'
    })
  }
  if (spec.requiredMechanics.includes('restart')) {
    checks.push({
      id: 'restart-semantic',
      passed: /restart|play again|press r/i.test(html),
      message: 'Prompt requires a restart affordance'
    })
  }
  if (spec.requiredControls.includes('arrow')) {
    checks.push({
      id: 'arrow-semantic',
      passed: /ArrowLeft|ArrowRight|ArrowUp|ArrowDown/.test(html),
      message: 'Prompt requires arrow-key support'
    })
  }
  if (spec.requiredEntities.includes('enemy_or_obstacle')) {
    checks.push({
      id: 'enemy-semantic',
      passed: /enemy|zombie|obstacle|brick|bug|customer|tower|fish/i.test(html),
      message: 'Prompt implies enemies or obstacles'
    })
  }

  const passedCount = checks.filter(check => check.passed).length
  const deterministicScore = checks.length === 0 ? 1 : passedCount / checks.length

  for (const check of checks) {
    if (!check.passed) {
      findings.push(buildFinding(check.id, 'error', check.message, { source: 'accuracy-deterministic' }))
    }
  }

  return {
    score: deterministicScore,
    findings
  }
}

async function runLlmAccuracyEvaluation({ spec, prompt, runtimeArtifacts }) {
  if (!anthropic || spec.subjectiveAssertions.length === 0) {
    return null
  }

  try {
    const response = await anthropic.messages.create({
      model: process.env.CREATORARENA_VERIFY_ACCURACY_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `You are an evaluation system for generated browser games.
Score whether the generated game matches the user's prompt.
Return strict JSON only with keys:
{
  "score": 0.0_to_1.0,
  "passed": true_or_false,
  "findings": ["short finding", "..."]
}
Use only the supplied evidence. Be conservative.`,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          prompt,
          spec,
          runtimeEvidence: runtimeArtifacts.runtimeSnapshot || null
        })
      }]
    })

    const raw = response.content[0]?.text || '{}'
    const parsed = JSON.parse(raw)
    return {
      score: Number(parsed.score) || 0,
      passed: Boolean(parsed.passed),
      findings: Array.isArray(parsed.findings) ? parsed.findings : []
    }
  } catch (_) {
    return null
  }
}

async function runAccuracyEvaluation({ html, spec, prompt, runtimeArtifacts }) {
  const deterministic = runDeterministicAccuracyEvaluation(html, spec, runtimeArtifacts)
  const llm = await runLlmAccuracyEvaluation({ spec, prompt, runtimeArtifacts })
  const llmScore = llm ? llm.score : deterministic.score
  const score = spec.subjectiveAssertions.length > 0
    ? ((deterministic.score * 0.65) + (llmScore * 0.35))
    : deterministic.score

  const findings = [...deterministic.findings]
  if (llm && Array.isArray(llm.findings)) {
    for (const finding of llm.findings) {
      findings.push(buildFinding('llm-accuracy', llm.passed ? 'warning' : 'error', finding, { source: 'accuracy-llm' }))
    }
  }

  return {
    status: score >= ACCURACY_PASS_THRESHOLD && !findings.some(f => f.severity === 'error') ? 'passed' : 'failed',
    score,
    findings,
    usedLlm: Boolean(llm)
  }
}

async function verifyGeneratedGame({ html, prompt, gameType = 'browser' }) {
  const spec = extractVerificationSpec({ prompt, html, gameType })
  const staticResult = runStaticValidation(html, spec)
  const runtimeResult = await runRuntimeValidation(html, spec)
  const accuracyResult = await runAccuracyEvaluation({
    html,
    spec,
    prompt,
    runtimeArtifacts: runtimeResult.artifacts || {}
  })

  const overallStatus = [staticResult.status, runtimeResult.status, accuracyResult.status].every(status => status === 'passed')
    ? 'passed'
    : 'failed'

  return {
    verifierVersion: VERIFIER_VERSION,
    spec,
    staticResult,
    runtimeResult,
    accuracyResult,
    overallStatus,
    findings: [
      ...staticResult.findings,
      ...runtimeResult.findings,
      ...accuracyResult.findings
    ],
    artifacts: runtimeResult.artifacts || {}
  }
}

module.exports = {
  VERIFIER_VERSION,
  extractVerificationSpec,
  runStaticValidation,
  runRuntimeValidation,
  runAccuracyEvaluation,
  verifyGeneratedGame
}

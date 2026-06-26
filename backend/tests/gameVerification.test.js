const {
  extractVerificationSpec,
  runStaticValidation,
  runAccuracyEvaluation
} = require('../services/gameVerification')

describe('gameVerification', () => {
  it('extracts deterministic requirements from a gameplay prompt', () => {
    const spec = extractVerificationSpec({
      prompt: 'Make a neon shooter with arrow keys, score, 3 lives, and restart on R.',
      html: '<!DOCTYPE html><html><body><canvas></canvas></body></html>',
      gameType: 'browser'
    })

    expect(spec.requiresCanvas).toBe(true)
    expect(spec.requiredControls).toContain('arrow')
    expect(spec.requiredHud).toEqual(expect.arrayContaining(['score', 'lives']))
    expect(spec.requiredMechanics).toContain('restart')
    expect(spec.subjectiveAssertions).toContain('visual_theme_match')
  })

  it('fails static validation for broken script and missing score requirement', () => {
    const html = `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width"><style>body{margin:0}</style></head>
<body>
  <canvas></canvas>
  <script>function broken( {</script>
</body>
</html>`

    const spec = extractVerificationSpec({
      prompt: 'Make a game with arrow keys and score.',
      html,
      gameType: 'browser'
    })

    const result = runStaticValidation(html, spec)
    expect(result.status).toBe('failed')
    expect(result.findings.some(f => f.id === 'js-syntax')).toBe(true)
    expect(result.findings.some(f => f.id === 'hud-score')).toBe(true)
  })

  it('passes deterministic accuracy for a matching prompt', async () => {
    const html = `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width"><style>body{margin:0}</style></head>
<body>
  <canvas id="canvas" width="600" height="400"></canvas>
  <div>Score: 0</div>
  <div>Lives: 3</div>
  <button>Restart</button>
  <script>
    document.addEventListener('keydown', e => {
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyR') {}
    })
    requestAnimationFrame(function loop() { requestAnimationFrame(loop) })
  </script>
</body>
</html>`

    const spec = extractVerificationSpec({
      prompt: 'Make a game with arrow keys, score, 3 lives, and restart on R.',
      html,
      gameType: 'browser'
    })

    const result = await runAccuracyEvaluation({
      html,
      spec,
      prompt: spec.sourcePrompt,
      runtimeArtifacts: {
        runtimeSnapshot: {
          text: 'Score: 0 Lives: 3 Restart'
        }
      }
    })

    expect(result.status).toBe('passed')
    expect(result.score).toBeGreaterThanOrEqual(0.66)
  })
})

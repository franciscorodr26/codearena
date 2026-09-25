process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'

const mockAnthropicCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: mockAnthropicCreate }
})))

jest.mock('express-rate-limit', () => () => (req, res, next) => next())

jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { sub: 7 }
    next()
  }
}))

jest.mock('../utils/contentFilter', () => ({
  containsProfanityForGames: jest.fn(() => false)
}))

jest.mock('../services/email', () => ({
  sendReferralCompletedEmail: jest.fn()
}))

jest.mock('../services/gameTemplates', () => ({
  MINIMAL_CANVAS_TEMPLATE: '<canvas></canvas>',
  MINIMAL_DOM_TEMPLATE: '<div></div>',
  MINIMAL_TEXT_TEMPLATE: '<input />',
  RELIABLE_PATTERNS: '',
  validateGameHtml: jest.fn(() => []),
  autoFixHtml: jest.fn(html => html)
}))

jest.mock('../db', () => ({
  CREDITS_PER_GENERATION: 5,
  CREDITS_PER_REVISION: 2,
  FREE_REVISIONS_PER_GAME: 0,
  deductCredits: jest.fn(),
  refundCredits: jest.fn(),
  completeReferral: jest.fn().mockResolvedValue(null),
  getRevisionCost: jest.fn().mockResolvedValue(2),
  getGameById: jest.fn(),
  incrementRevisionCount: jest.fn(),
  addGameVersion: jest.fn()
}))

const db = require('../db')
const aiRouter = require('../routes/ai')

const VALID_GAME_HTML = '<!DOCTYPE html><html><body><canvas id="game"></canvas><script>const canvas=document.getElementById("game");const ctx=canvas.getContext("2d");document.addEventListener("keydown",()=>{});function loop(){requestAnimationFrame(loop)}requestAnimationFrame(loop)</script></body></html>'
const FULL_PROMPT = 'Create a colorful browser puzzle game with scoring levels and keyboard controls'

function getGenerateHandlers() {
  const layer = aiRouter.stack.find(entry => entry.route?.path === '/generate-game')
  return layer.route.stack.map(entry => entry.handle)
}

async function invokeGenerate(body) {
  const req = { body, headers: {}, method: 'POST' }
  let statusCode = 200
  let jsonBody
  const res = {
    status(code) {
      statusCode = code
      return this
    },
    json(payload) {
      jsonBody = payload
      return this
    }
  }

  for (const handler of getGenerateHandlers()) {
    let nextCalled = false
    await handler(req, res, () => {
      nextCalled = true
    })
    if (!nextCalled || jsonBody !== undefined) break
  }

  return { status: statusCode, body: jsonBody }
}

describe('CreatorArena generation cost controls', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    db.completeReferral.mockResolvedValue(null)
    db.refundCredits.mockResolvedValue({ success: true, balance: 10 })
  })

  it('reserves credits before any paid model call', async () => {
    db.deductCredits.mockResolvedValue({ success: true, balance: 10 })
    mockAnthropicCreate
      .mockResolvedValueOnce({ content: [{ text: 'SAFE' }] })
      .mockResolvedValueOnce({ content: [{ text: VALID_GAME_HTML }] })

    const response = await invokeGenerate({ prompt: FULL_PROMPT, gameType: 'browser' })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ success: true, credits: 10, isPro: false })
    expect(db.deductCredits).toHaveBeenCalledWith(7, 5, expect.any(String), null)
    expect(db.deductCredits.mock.invocationCallOrder[0])
      .toBeLessThan(mockAnthropicCreate.mock.invocationCallOrder[0])
    expect(db.refundCredits).not.toHaveBeenCalled()
  })

  it('refunds the reservation when generation fails', async () => {
    db.deductCredits.mockResolvedValue({ success: true, balance: 10 })
    mockAnthropicCreate
      .mockResolvedValueOnce({ content: [{ text: 'SAFE' }] })
      .mockRejectedValueOnce(new Error('provider unavailable'))

    const response = await invokeGenerate({ prompt: FULL_PROMPT, gameType: 'browser' })

    expect(response.status).toBe(500)
    expect(db.refundCredits).toHaveBeenCalledWith(
      7,
      5,
      expect.stringContaining('provider unavailable'),
      null
    )
  })

  it('never calls the model when the account lacks CreatorArena credits', async () => {
    db.deductCredits.mockResolvedValue({ success: false, balance: 0 })

    const response = await invokeGenerate({ prompt: FULL_PROMPT, gameType: 'browser' })

    expect(response.status).toBe(402)
    expect(response.body).toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
      credits: 0,
      cost: 5,
      isPro: false
    })
    expect(mockAnthropicCreate).not.toHaveBeenCalled()
  })

  it('charges an unsaved revision instead of treating it as free', async () => {
    db.deductCredits.mockResolvedValue({ success: false, balance: 0 })

    const response = await invokeGenerate({
      prompt: 'Make the player movement smoother',
      gameType: 'browser',
      mode: 'revise',
      existingHtml: VALID_GAME_HTML
    })

    expect(response.status).toBe(402)
    expect(db.deductCredits).toHaveBeenCalledWith(7, 2, expect.any(String), null)
  })

  it('keeps an existing-game revision unsaved until the creator explicitly saves it', async () => {
    db.getGameById.mockResolvedValue({ id: 99, creator_id: 7, revision_count: 0 })
    db.getRevisionCost.mockResolvedValue(2)
    db.deductCredits.mockResolvedValue({ success: true, balance: 8 })
    mockAnthropicCreate.mockResolvedValueOnce({ content: [{ text: VALID_GAME_HTML }] })

    const response = await invokeGenerate({
      prompt: 'Make the player movement smoother',
      gameType: 'browser',
      mode: 'revise',
      existingHtml: VALID_GAME_HTML,
      gameId: 99
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ success: true, html: VALID_GAME_HTML })
    expect(db.incrementRevisionCount).toHaveBeenCalledWith(99)
    expect(db.addGameVersion).not.toHaveBeenCalled()
  })

  it('rejects oversized prompts before reserving credits or calling a model', async () => {
    const response = await invokeGenerate({
      prompt: 'x'.repeat(4001),
      gameType: 'browser'
    })

    expect(response.status).toBe(413)
    expect(db.deductCredits).not.toHaveBeenCalled()
    expect(mockAnthropicCreate).not.toHaveBeenCalled()
  })

  it('rejects oversized combined sections before paid work', async () => {
    const response = await invokeGenerate({
      prompt: 'game '.repeat(600),
      gameType: 'browser',
      sections: {
        mechanics: 'movement '.repeat(220),
        graphics: 'colorful '.repeat(220),
        story: 'adventure '.repeat(220)
      }
    })

    expect(response.status).toBe(413)
    expect(db.deductCredits).not.toHaveBeenCalled()
    expect(mockAnthropicCreate).not.toHaveBeenCalled()
  })
})

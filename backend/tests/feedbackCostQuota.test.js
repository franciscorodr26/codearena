process.env.JWT_SECRET = 'test-secret-key'
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'

const mockAnthropicCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: mockAnthropicCreate }
})))

jest.mock('express-rate-limit', () => {
  const rateLimit = () => (req, res, next) => next()
  rateLimit.ipKeyGenerator = jest.fn(ip => ip)
  return rateLimit
})

jest.mock('../db', () => ({
  tryConsumeConsumerDailyUsage: jest.fn()
}))

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}))

const jwt = require('jsonwebtoken')
const db = require('../db')
const { SECRET } = require('../config/jwt')
const feedbackRouter = require('../routes/feedback')

function tokenFor(userId) {
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: '1h' })
}

async function invokeComplexity(userId, body) {
  const layer = feedbackRouter.stack.find(entry => entry.route?.path === '/complexity')
  const handlers = layer.route.stack.map(entry => entry.handle)
  const req = {
    body,
    headers: { authorization: `Bearer ${tokenFor(userId)}` },
    method: 'POST',
    ip: '127.0.0.1'
  }
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

  for (const handler of handlers) {
    let nextCalled = false
    await handler(req, res, () => {
      nextCalled = true
    })
    if (!nextCalled || jsonBody !== undefined) break
  }

  return { status: statusCode, body: jsonBody }
}

describe('feedback AI cost quotas', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('checks user and global quota before calling the complexity model', async () => {
    db.tryConsumeConsumerDailyUsage.mockResolvedValue({ allowed: true })
    mockAnthropicCreate.mockResolvedValue({
      content: [{
        text: JSON.stringify({
          timeComplexity: 'O(n)',
          optimalComplexity: 'O(n)',
          explanation: 'The solution visits each input once.',
          wrongOptions: ['O(1)', 'O(log n)', 'O(n^2)']
        })
      }]
    })

    const response = await invokeComplexity(42, {
      code: 'for (const item of input) visit(item)',
      language: 'javascript'
    })

    expect(response.status).toBe(200)
    expect(db.tryConsumeConsumerDailyUsage).toHaveBeenCalledWith([
      { metric: 'complexity_analysis', subjectId: 'user:42', limit: 5 },
      { metric: 'prompt_evaluation', subjectId: 'global', limit: 500 }
    ])
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1)
  })

  it('does not call the model after the global circuit breaker is exhausted', async () => {
    db.tryConsumeConsumerDailyUsage.mockResolvedValue({
      allowed: false,
      reason: 'global_limit'
    })

    const response = await invokeComplexity(42, {
      code: 'return input.length',
      language: 'javascript'
    })

    expect(response.status).toBe(429)
    expect(response.body).toMatchObject({
      limitReached: true,
      globalLimitReached: true,
      dailyLimit: 500
    })
    expect(mockAnthropicCreate).not.toHaveBeenCalled()
  })
})

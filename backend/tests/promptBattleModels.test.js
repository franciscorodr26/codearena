// Prompt battles offer each model only when its provider key is set, charge
// pricier models more of the global daily budget, and run Gemini through its
// REST API.
const mockCreate = jest.fn()
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })))

const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']

function loadRunner(env) {
  jest.resetModules()
  for (const key of KEYS) delete process.env[key]
  Object.assign(process.env, env)
  return require('../services/promptBattleRunner')
}

afterEach(() => {
  for (const key of KEYS) delete process.env[key]
  delete global.fetch
})

describe('prompt battle models', () => {
  test('an Anthropic key offers Haiku, Sonnet and Opus; Gemini and GPT need their own keys', () => {
    const runner = loadRunner({ ANTHROPIC_API_KEY: 'a' })
    expect(runner.getAvailablePromptBattleModels().map(m => m.id))
      .toEqual(['claude-haiku-4-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])
    expect(runner.getDefaultPromptBattleModelId()).toBe('claude-haiku-4-5')

    const all = loadRunner({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' })
    expect(all.getAvailablePromptBattleModels().map(m => m.provider))
      .toEqual(['anthropic', 'anthropic', 'anthropic', 'google', 'openai'])
  })

  test('a model without its key cannot be selected', () => {
    const runner = loadRunner({ ANTHROPIC_API_KEY: 'a' })
    expect(runner.sanitizeModelId('gemini-2.5-flash')).toBe('claude-haiku-4-5')
    expect(runner.sanitizeModelId('claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(loadRunner({}).sanitizeModelId('claude-opus-5-5')).toBeNull()
  })

  test('pricier models cost more of the daily budget; unknown ids cost one', () => {
    const runner = loadRunner({ ANTHROPIC_API_KEY: 'a' })
    expect(runner.getModelQuotaCost('claude-haiku-4-5')).toBe(1)
    expect(runner.getModelQuotaCost('claude-sonnet-5-5')).toBe(3)
    expect(runner.getModelQuotaCost('claude-opus-5-5')).toBe(5)
    expect(runner.getModelQuotaCost('nope')).toBe(1)
  })

  test('Gemini runs through generateContent and reports its token usage', async () => {
    const runner = loadRunner({ GEMINI_API_KEY: 'g-key' })
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Plan: ' }, { text: 'ship it' }] } }],
        usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 12, totalTokenCount: 52 }
      })
    }))
    const problem = { scenario: 'Launch a feature', description: 'Plan', targetOutput: 'A plan' }
    const result = await runner.runPlayerModel(problem, 'Write the plan', { modelId: 'gemini-2.5-flash' })
    expect(result).toEqual({ text: 'Plan: ship it', inputTokens: 40, outputTokens: 12, totalTokens: 52 })

    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
    expect(init.headers['x-goog-api-key']).toBe('g-key')
    const body = JSON.parse(init.body)
    expect(body.systemInstruction.parts[0].text).toContain('Launch a feature')
    expect(body.contents[0].parts[0].text).toBe('Write the plan')
  })

  test('a Gemini error is surfaced, not scored as an empty answer', async () => {
    const runner = loadRunner({ GEMINI_API_KEY: 'g-key' })
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: { message: 'API key not valid' } }) }))
    await expect(runner.runPlayerModel({}, 'x', { modelId: 'gemini-2.5-flash' })).rejects.toThrow('API key not valid')
  })

  test('Opus answers after a thinking block: only the text is used, and its low-effort settings are sent', async () => {
    const runner = loadRunner({ ANTHROPIC_API_KEY: 'a' })
    mockCreate.mockReset().mockResolvedValue({
      content: [{ type: 'thinking', thinking: 'planning...' }, { type: 'text', text: 'Three actions' }],
      usage: { input_tokens: 30, output_tokens: 90 }
    })
    const result = await runner.runPlayerModel({ scenario: 's' }, 'p', { modelId: 'claude-opus-5-5' })
    expect(result).toMatchObject({ text: 'Three actions', inputTokens: 30, outputTokens: 90 })
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      model: 'claude-opus-5-5',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' }
    })

    mockCreate.mockClear()
    await runner.runPlayerModel({ scenario: 's' }, 'p', { modelId: 'claude-sonnet-5-5' })
    expect(mockCreate.mock.calls[0][0].thinking).toEqual({ type: 'between_tools' })

    mockCreate.mockClear()
    await runner.runPlayerModel({ scenario: 's' }, 'p', { modelId: 'claude-haiku-4-5' })
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('thinking')
  })

  test('a reply with only thinking and no answer is an error, not an empty score', async () => {
    const runner = loadRunner({ ANTHROPIC_API_KEY: 'a' })
    mockCreate.mockReset().mockResolvedValue({ content: [{ type: 'thinking', thinking: '...' }], usage: {} })
    await expect(runner.runPlayerModel({}, 'p', { modelId: 'claude-opus-5-5' })).rejects.toThrow('Empty model response')
  })
})

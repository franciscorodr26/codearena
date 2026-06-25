const Anthropic = require('@anthropic-ai/sdk')
const logger = require('../utils/logger')

const MODEL_CATALOG = [
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    provider: 'anthropic',
    envVar: 'ANTHROPIC_API_KEY'
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    provider: 'openai',
    envVar: 'OPENAI_API_KEY'
  }
]
const DEFAULT_MODEL_ID = 'claude-haiku-4-5'
const MAX_OUT = 2048

function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

function getModelById(modelId) {
  return MODEL_CATALOG.find((m) => m.id === modelId) || MODEL_CATALOG.find((m) => m.id === DEFAULT_MODEL_ID)
}

function getAvailablePromptBattleModels() {
  return MODEL_CATALOG.filter((m) => Boolean(process.env[m.envVar])).map((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider
  }))
}

function getDefaultPromptBattleModelId() {
  const available = getAvailablePromptBattleModels()
  if (!available.length) return null
  if (available.some((m) => m.id === DEFAULT_MODEL_ID)) return DEFAULT_MODEL_ID
  return available[0].id
}

function sanitizeModelId(requestedModelId) {
  const available = getAvailablePromptBattleModels()
  if (!available.length) return null
  if (!requestedModelId) return getDefaultPromptBattleModelId()
  const match = available.find((m) => m.id === requestedModelId)
  return match ? match.id : getDefaultPromptBattleModelId()
}

/**
 * Run the competitor's meta-prompt against a fixed system context (scenario + task).
 */
async function runPlayerModel(problem, userPrompt, options = {}) {
  const modelId = sanitizeModelId(options.modelId)
  if (!modelId) {
    throw new Error('No AI model is configured for prompt battles')
  }
  const model = getModelById(modelId)
  const system = `You are a skilled professional assistant. Follow the user's instructions and produce a thorough, well-organized answer. Use clear sections with headings or numbered lists where appropriate.

## Scenario
${problem.scenario || ''}

## Task type
${problem.description || ''}

## Expected kind of output
${problem.targetOutput || 'A structured, actionable deliverable.'}`

  const user = typeof userPrompt === 'string' && userPrompt.trim()
    ? userPrompt.trim()
    : '(The user did not provide a prompt. Produce a minimal useful outline that still addresses the scenario.)'

  if (model.provider === 'anthropic') {
    const anthropic = getAnthropicClient()
    if (!anthropic) {
      throw new Error('ANTHROPIC_API_KEY is not configured')
    }
    const res = await anthropic.messages.create({
      model: model.id,
      max_tokens: MAX_OUT,
      system,
      messages: [{ role: 'user', content: user.slice(0, 12000) }]
    })
    const text = res.content?.[0]?.text
    if (!text) {
      logger.error('[prompt-battle] Empty model response')
      throw new Error('Empty model response')
    }
    const usage = res.usage || {}
    return {
      text,
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
    }
  }

  if (model.provider === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured')
    }
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model.id,
        max_tokens: MAX_OUT,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user.slice(0, 12000) }
        ]
      })
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data?.error?.message || 'OpenAI request failed')
    }
    const text = data?.choices?.[0]?.message?.content
    if (!text) {
      logger.error('[prompt-battle] Empty model response')
      throw new Error('Empty model response')
    }
    const usage = data?.usage || {}
    return {
      text,
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0))
    }
  }

  throw new Error(`Unsupported model provider: ${model.provider}`)
}

/**
 * Count exact tokens for a prompt using the Anthropic count_tokens API (no model run).
 */
async function countPromptTokens(problem, userPrompt, options = {}) {
  const modelId = sanitizeModelId(options.modelId)
  if (!modelId) return 0
  const model = getModelById(modelId)
  const system = `You are a skilled professional assistant. Follow the user's instructions and produce a thorough, well-organized answer. Use clear sections with headings or numbered lists where appropriate.

## Scenario
${problem.scenario || ''}

## Task type
${problem.description || ''}

## Expected kind of output
${problem.targetOutput || 'A structured, actionable deliverable.'}`

  const user = typeof userPrompt === 'string' && userPrompt.trim()
    ? userPrompt.trim()
    : '(The user did not provide a prompt. Produce a minimal useful outline that still addresses the scenario.)'

  if (model.provider === 'openai') {
    // Rough estimate for OpenAI to avoid extra API calls during live preview.
    return Math.ceil((`${system}\n${user.slice(0, 12000)}`).length / 4)
  }

  const anthropic = getAnthropicClient()
  if (!anthropic) return 0

  try {
    const res = await anthropic.messages.countTokens({
      model: model.id,
      system,
      messages: [{ role: 'user', content: user.slice(0, 12000) }]
    })
    return res.input_tokens || 0
  } catch (err) {
    logger.error('[prompt-battle] countTokens error:', err.message)
    return 0
  }
}

module.exports = {
  runPlayerModel,
  countPromptTokens,
  getAvailablePromptBattleModels,
  getDefaultPromptBattleModelId,
  sanitizeModelId,
  MODEL_CATALOG
}

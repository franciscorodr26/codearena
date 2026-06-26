/**
 * Prompt Practice Runner
 *
 * Unlike the battle runner, this does NOT tell the model what to do.
 * The system prompt only provides the scenario context.
 * The user's prompt must contain ALL instructions, if it's vague,
 * the model will produce a vague response that fails the tier checks.
 */

const Anthropic = require('@anthropic-ai/sdk')
const logger = require('../utils/logger')

const MODEL = 'claude-haiku-4-5'
const MAX_OUT = 2048

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

/**
 * Run the user's prompt with only scenario context (no task instructions).
 * The quality of the output depends entirely on the user's prompt.
 */
async function runPracticePrompt(problem, userPrompt) {
  const anthropic = getClient()
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }

  const system = `You are a general-purpose AI assistant. You must follow the user's instructions LITERALLY and EXACTLY. Important rules:

1. If the user's message is a greeting, small talk, or does not contain specific instructions, respond conversationally in 1-2 short sentences. Do NOT produce any document, outline, or structured content.
2. If the user gives vague instructions (e.g., "write something about payments"), produce only what they literally asked for, no more. Do not add sections, headings, or detail they did not request.
3. Only produce structured, detailed output if the user explicitly asks for specific sections, format, and depth.
4. Never infer or assume what the user "probably meant." Respond to what they actually wrote.

## Background context (for reference only, do NOT act on this unless the user's instructions tell you to):
${problem.scenario || 'No additional context provided.'}`

  const user = typeof userPrompt === 'string' && userPrompt.trim()
    ? userPrompt.trim()
    : 'hi'

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_OUT,
    system,
    messages: [{ role: 'user', content: user.slice(0, 12000) }]
  })

  const text = res.content?.[0]?.text
  if (!text) {
    logger.error('[prompt-practice] Empty model response')
    throw new Error('Empty model response')
  }
  return text
}

module.exports = {
  runPracticePrompt,
  MODEL
}

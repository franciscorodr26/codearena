// Display names for AI model providers shown in prompt battle model pickers.
const PROVIDER_LABELS = { anthropic: 'Anthropic', google: 'Google', openai: 'OpenAI', deepseek: 'DeepSeek' }

export function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider
}

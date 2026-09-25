const URL_CANDIDATE_REGEX = /\bhttps?:\/\/[^\s<>"'`]+/gi
const SIMPLE_TRAILING_PUNCTUATION = new Set(['.', ',', '!', '?', ';', ':'])
const CLOSING_PAIRS = {
  ')': '(',
  ']': '[',
  '}': '{'
}

function countChar(value, char) {
  let count = 0
  for (const current of value) {
    if (current === char) count++
  }
  return count
}

function stripTrailingPunctuation(value) {
  let url = value
  let suffix = ''

  while (url.length > 0) {
    const last = url[url.length - 1]
    if (SIMPLE_TRAILING_PUNCTUATION.has(last)) {
      suffix = last + suffix
      url = url.slice(0, -1)
      continue
    }

    const opener = CLOSING_PAIRS[last]
    if (opener && countChar(url, last) > countChar(url, opener)) {
      suffix = last + suffix
      url = url.slice(0, -1)
      continue
    }

    break
  }

  return { url, suffix }
}

export function sanitizeExternalHttpUrl(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || /[\s\u0000-\u001f\u007f]/.test(trimmed)) return null

  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return null
  if (!parsed.hostname || parsed.username || parsed.password) return null

  return parsed.href
}

export function splitTextIntoSafeLinkParts(value) {
  const text = typeof value === 'string' ? value : ''
  const parts = []
  let lastIndex = 0

  const pushText = (segment) => {
    if (!segment) return
    const previous = parts[parts.length - 1]
    if (previous?.type === 'text') {
      previous.text += segment
    } else {
      parts.push({ type: 'text', text: segment })
    }
  }

  for (const match of text.matchAll(URL_CANDIDATE_REGEX)) {
    const candidate = match[0]
    const start = match.index
    const { url, suffix } = stripTrailingPunctuation(candidate)
    const href = sanitizeExternalHttpUrl(url)

    if (!href) continue

    if (start > lastIndex) pushText(text.slice(lastIndex, start))
    parts.push({ type: 'link', text: url, href })
    pushText(suffix)
    lastIndex = start + candidate.length
  }

  if (lastIndex < text.length) pushText(text.slice(lastIndex))
  return parts.length > 0 ? parts : [{ type: 'text', text }]
}

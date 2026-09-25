import { sanitizeExternalHttpUrl, splitTextIntoSafeLinkParts } from '../safeLinks'

describe('safeLinks', () => {
  it('allows only normalized public http and https URLs', () => {
    expect(sanitizeExternalHttpUrl('https://Example.com/docs?x=1#top')).toBe('https://example.com/docs?x=1#top')
    expect(sanitizeExternalHttpUrl('http://codearena.co')).toBe('http://codearena.co/')
  })

  it('rejects unsafe or ambiguous URLs', () => {
    expect(sanitizeExternalHttpUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeExternalHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(sanitizeExternalHttpUrl('ftp://example.com/file')).toBeNull()
    expect(sanitizeExternalHttpUrl('/relative/path')).toBeNull()
    expect(sanitizeExternalHttpUrl('https://user:pass@example.com/private')).toBeNull()
    expect(sanitizeExternalHttpUrl('https://example.com/a b')).toBeNull()
    expect(sanitizeExternalHttpUrl('https://example.com/\nnext')).toBeNull()
    expect(sanitizeExternalHttpUrl(null)).toBeNull()
  })

  it('splits message text into safe link and text parts', () => {
    expect(splitTextIntoSafeLinkParts('See https://example.com/docs, then https://user:pass@example.com/private')).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'link', text: 'https://example.com/docs', href: 'https://example.com/docs' },
      { type: 'text', text: ', then https://user:pass@example.com/private' }
    ])
  })

  it('keeps sentence punctuation outside links without breaking balanced URL punctuation', () => {
    expect(splitTextIntoSafeLinkParts('Open (https://codearena.co/demo). Try https://codearena.co/a_(b).')).toEqual([
      { type: 'text', text: 'Open (' },
      { type: 'link', text: 'https://codearena.co/demo', href: 'https://codearena.co/demo' },
      { type: 'text', text: '). Try ' },
      { type: 'link', text: 'https://codearena.co/a_(b)', href: 'https://codearena.co/a_(b)' },
      { type: 'text', text: '.' }
    ])
  })

  it('returns plain text when no safe links are present', () => {
    expect(splitTextIntoSafeLinkParts('plain message')).toEqual([{ type: 'text', text: 'plain message' }])
    expect(splitTextIntoSafeLinkParts(undefined)).toEqual([{ type: 'text', text: '' }])
  })
})

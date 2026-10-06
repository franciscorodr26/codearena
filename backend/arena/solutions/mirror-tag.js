function isMirrorTag(tag) {
  const s = tag.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (let i = 0, j = s.length - 1; i < j; i++, j--) if (s[i] !== s[j]) return false
  return true
}

function countByPrefix(handles, prefixes) {
  const root = { count: 0, next: new Map() }
  for (const h of handles) {
    let node = root
    node.count++
    for (const ch of h) {
      if (!node.next.has(ch)) node.next.set(ch, { count: 0, next: new Map() })
      node = node.next.get(ch)
      node.count++
    }
  }
  return prefixes.map(p => {
    let node = root
    for (const ch of p) {
      node = node.next.get(ch)
      if (!node) return 0
    }
    return node.count
  })
}

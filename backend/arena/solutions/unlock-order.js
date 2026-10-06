function unlockOrder(n, requires) {
  const next = Array.from({ length: n }, () => [])
  const indegree = new Array(n).fill(0)
  for (const [a, b] of requires) { next[a].push(b); indegree[b]++ }
  // binary min-heap of available skills
  const heap = []
  const push = v => { heap.push(v); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p] <= heap[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p } }
  const pop = () => {
    const top = heap[0], last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < heap.length && heap[l] < heap[m]) m = l
        if (r < heap.length && heap[r] < heap[m]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  for (let v = 0; v < n; v++) if (indegree[v] === 0) push(v)
  const order = []
  while (heap.length) {
    const v = pop()
    order.push(v)
    for (const w of next[v]) if (--indegree[w] === 0) push(w)
  }
  return order.length === n ? order : []
}

function safestRoute(n, roads) {
  const adj = Array.from({ length: n }, () => [])
  for (const [a, b, w] of roads) { adj[a].push([b, w]); adj[b].push([a, w]) }
  const dist = new Array(n).fill(Infinity)
  dist[0] = 0
  const heap = [[0, 0]]
  const push = item => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p } }
  const pop = () => {
    const top = heap[0], last = heap.pop()
    if (heap.length) {
      heap[0] = last
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  while (heap.length) {
    const [d, v] = pop()
    if (d > dist[v]) continue
    for (const [w, cost] of adj[v]) {
      if (d + cost < dist[w]) { dist[w] = d + cost; push([dist[w], w]) }
    }
  }
  return dist[n - 1] === Infinity ? -1 : dist[n - 1]
}

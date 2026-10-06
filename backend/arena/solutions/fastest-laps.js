function fastestLaps(laps, k) {
  // min-heap of [time, list, index]
  const heap = []
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])
  const push = item => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i], heap[p])) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p } }
  const pop = () => {
    const top = heap[0], last = heap.pop()
    if (heap.length) {
      heap[0] = last
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < heap.length && less(heap[l], heap[m])) m = l
        if (r < heap.length && less(heap[r], heap[m])) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  laps.forEach((list, d) => { if (list.length) push([list[0], d, 0]) })
  const out = []
  while (out.length < k && heap.length) {
    const [t, d, i] = pop()
    out.push(t)
    if (i + 1 < laps[d].length) push([laps[d][i + 1], d, i + 1])
  }
  return out
}

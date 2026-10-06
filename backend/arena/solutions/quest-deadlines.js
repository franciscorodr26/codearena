function maxQuests(quests) {
  const sorted = [...quests].sort((a, b) => a[1] - b[1])
  const heap = [] // max-heap of durations
  const push = v => { heap.push(v); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p] >= heap[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p } }
  const pop = () => {
    const top = heap[0], last = heap.pop()
    if (heap.length) {
      heap[0] = last
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < heap.length && heap[l] > heap[m]) m = l
        if (r < heap.length && heap[r] > heap[m]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  let time = 0
  for (const [d, deadline] of sorted) {
    push(d)
    time += d
    if (time > deadline) time -= pop()
  }
  return heap.length
}

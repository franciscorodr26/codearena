function breachRun(grid, charges) {
  const R = grid.length, C = grid[0].length
  const seen = new Set(['0,0,' + charges])
  let frontier = [[0, 0, charges]], steps = 0
  while (frontier.length) {
    const next = []
    for (const [r, c, k] of frontier) {
      if (r === R - 1 && c === C - 1) return steps
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc
        if (nr < 0 || nc < 0 || nr >= R || nc >= C) continue
        const nk = grid[nr][nc] === '#' ? k - 1 : k
        if (nk < 0) continue
        const key = nr + ',' + nc + ',' + nk
        if (seen.has(key)) continue
        seen.add(key)
        next.push([nr, nc, nk])
      }
    }
    frontier = next
    steps++
  }
  return -1
}

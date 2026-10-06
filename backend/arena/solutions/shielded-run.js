function shieldedRun(grid) {
  const R = grid.length, C = grid[0].length
  const NEG = -Infinity
  // a[c]: best without using the shield, b[c]: best with the shield used
  let a = new Array(C).fill(NEG), b = new Array(C).fill(NEG)
  for (let r = 0; r < R; r++) {
    const na = new Array(C).fill(NEG), nb = new Array(C).fill(NEG)
    for (let c = 0; c < C; c++) {
      const v = grid[r][c]
      let pa, pb
      if (r === 0 && c === 0) { pa = 0; pb = NEG }
      else {
        pa = Math.max(r > 0 ? a[c] : NEG, c > 0 ? na[c - 1] : NEG)
        pb = Math.max(r > 0 ? b[c] : NEG, c > 0 ? nb[c - 1] : NEG)
      }
      na[c] = pa + v
      nb[c] = Math.max(pb + v, v < 0 ? pa : NEG)
    }
    a = na; b = nb
  }
  return Math.max(a[C - 1], b[C - 1])
}

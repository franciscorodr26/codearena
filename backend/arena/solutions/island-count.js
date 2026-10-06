function countIslands(map) {
  const R = map.length, C = R ? map[0].length : 0
  const seen = Array.from({ length: R }, () => new Array(C).fill(false))
  let islands = 0
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (map[r][c] !== '#' || seen[r][c]) continue
      islands++
      const stack = [[r, c]]
      seen[r][c] = true
      while (stack.length) {
        const [y, x] = stack.pop()
        for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ny = y + dy, nx = x + dx
          if (ny >= 0 && nx >= 0 && ny < R && nx < C && !seen[ny][nx] && map[ny][nx] === '#') {
            seen[ny][nx] = true
            stack.push([ny, nx])
          }
        }
      }
    }
  }
  return islands
}

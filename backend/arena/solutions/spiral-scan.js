function spiralScan(grid) {
  const out = []
  if (!grid.length) return out
  let top = 0, bottom = grid.length - 1, left = 0, right = grid[0].length - 1
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) out.push(grid[top][c])
    for (let r = top + 1; r <= bottom; r++) out.push(grid[r][right])
    if (top < bottom) for (let c = right - 1; c >= left; c--) out.push(grid[bottom][c])
    if (left < right) for (let r = bottom - 1; r > top; r--) out.push(grid[r][left])
    top++; bottom--; left++; right--
  }
  return out
}

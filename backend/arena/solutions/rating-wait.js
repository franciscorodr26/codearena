function daysUntilHigher(ratings) {
  const wait = new Array(ratings.length).fill(0)
  const stack = []
  ratings.forEach((r, i) => {
    while (stack.length && ratings[stack[stack.length - 1]] < r) {
      const j = stack.pop()
      wait[j] = i - j
    }
    stack.push(i)
  })
  return wait
}

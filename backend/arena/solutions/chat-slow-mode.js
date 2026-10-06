function rejectedMessages(times, limit, window) {
  const accepted = []
  let head = 0
  const rejected = []
  times.forEach((t, i) => {
    while (head < accepted.length && accepted[head] <= t - window) head++
    if (accepted.length - head < limit) accepted.push(t)
    else rejected.push(i)
  })
  return rejected
}

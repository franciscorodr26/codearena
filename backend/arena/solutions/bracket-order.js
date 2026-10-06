function bracketOrder(n) {
  let order = [1, 2]
  while (order.length < n) {
    const size = order.length * 2
    order = order.flatMap(s => [s, size + 1 - s])
  }
  return order
}

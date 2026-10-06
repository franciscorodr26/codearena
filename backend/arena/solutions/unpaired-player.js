function unpairedPlayer(ids) {
  let x = 0
  for (const id of ids) x ^= id
  return x
}

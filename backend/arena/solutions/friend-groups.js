function countFriendGroups(n, friendships) {
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  let groups = n
  for (const [a, b] of friendships) {
    const ra = find(a), rb = find(b)
    if (ra !== rb) { parent[ra] = rb; groups-- }
  }
  return groups
}

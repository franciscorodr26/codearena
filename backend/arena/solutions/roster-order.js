function rosterOrder(names) {
  return names
    .map((name, i) => ({ name, i, key: name.toLowerCase() }))
    .sort((a, b) => a.name.length - b.name.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i))
    .map(e => e.name)
}

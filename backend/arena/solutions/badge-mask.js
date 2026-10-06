function badgeMask(earned) {
  let mask = 0
  for (const id of earned) mask |= (1 << id)
  return mask >>> 0
}

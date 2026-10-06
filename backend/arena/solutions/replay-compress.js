function compressReplay(moves) {
  let out = ''
  for (let i = 0; i < moves.length;) {
    let j = i
    while (j < moves.length && moves[j] === moves[i]) j++
    out += moves[i] + (j - i)
    i = j
  }
  return out
}

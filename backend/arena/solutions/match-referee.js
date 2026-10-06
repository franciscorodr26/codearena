function refereeMatch(events) {
  let state = 'waiting', a = 0, b = 0
  for (const e of events) {
    if (state === 'over') break
    if (e === 'start' && state === 'waiting') state = 'running'
    else if (e === 'pause' && state === 'running') state = 'paused'
    else if (e === 'resume' && state === 'paused') state = 'running'
    else if (e === 'end' && (state === 'running' || state === 'paused')) state = 'over'
    else if (e === 'goal A' && state === 'running') a++
    else if (e === 'goal B' && state === 'running') b++
  }
  return [a, b, state]
}

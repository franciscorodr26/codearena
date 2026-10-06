function countSpikes(pings) {
  let spikes = 0
  for (let i = 1; i + 1 < pings.length; i++) {
    if (pings[i] > pings[i - 1] && pings[i] > pings[i + 1]) spikes++
  }
  return spikes
}

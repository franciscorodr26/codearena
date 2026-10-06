function countEmotes(message) {
  if (!message) return 0
  return message.split(' ').filter(w => /^:[a-z]+:$/.test(w)).length
}

// Socket.IO emits reconnection lifecycle events on the Manager, not the Socket.
// Each fresh connection must rejoin its room, including after a network drop.
export function bindBattleConnection(socket, { getContext, joinedBattleRef, onStatus, onError }) {
  const connect = () => {
    onStatus('connected')
    onError('')
    const { battleId, playerId, language, battleState } = getContext()
    if (battleId && playerId && ['waiting', 'ready', 'coding'].includes(battleState) && joinedBattleRef.current !== battleId) {
      joinedBattleRef.current = battleId
      socket.emit('join-battle', { battleId, playerId, language })
    }
  }
  const disconnect = reason => {
    joinedBattleRef.current = null
    onStatus('disconnected')
    if (reason !== 'io client disconnect' && ['waiting', 'ready', 'coding'].includes(getContext().battleState)) {
      onError('Connection lost. Attempting to reconnect...')
    }
  }
  const reconnectAttempt = attempt => {
    onStatus('reconnecting')
    onError(`Reconnecting... (attempt ${attempt}/5)`)
  }
  const reconnectFailed = () => {
    onStatus('error')
    onError('Unable to reconnect. Please refresh the page to continue.')
  }
  const connectError = error => {
    onStatus('error')
    onError('Connection failed: ' + (error?.message || 'Please check your connection.'))
  }
  socket.on('connect', connect)
  socket.on('disconnect', disconnect)
  socket.on('connect_error', connectError)
  socket.io.on('reconnect_attempt', reconnectAttempt)
  socket.io.on('reconnect_failed', reconnectFailed)
  return () => {
    socket.off('connect', connect)
    socket.off('disconnect', disconnect)
    socket.off('connect_error', connectError)
    socket.io.off('reconnect_attempt', reconnectAttempt)
    socket.io.off('reconnect_failed', reconnectFailed)
  }
}

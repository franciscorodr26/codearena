import { EventEmitter } from 'events'
import { bindBattleConnection } from '../battleConnection'

function setup() {
  const socket = new EventEmitter()
  socket.io = new EventEmitter()
  const emit = jest.spyOn(socket, 'emit')
  const joinedBattleRef = { current: null }
  const context = { battleId: 'battle-1', playerId: 'player-1', language: 'python', battleState: 'coding' }
  const onStatus = jest.fn()
  const onError = jest.fn()
  const cleanup = bindBattleConnection(socket, { getContext: () => context, joinedBattleRef, onStatus, onError })
  return { socket, emit, joinedBattleRef, context, onStatus, onError, cleanup }
}

test('a transport reconnect rejoins the room exactly once per connection', () => {
  const { socket, emit, joinedBattleRef } = setup()
  socket.emit('connect')
  expect(joinedBattleRef.current).toBe('battle-1')
  socket.emit('disconnect', 'transport close')
  expect(joinedBattleRef.current).toBeNull()
  socket.io.emit('reconnect', 1)
  socket.emit('connect')
  socket.emit('connect')
  expect(emit.mock.calls.filter(([event]) => event === 'join-battle')).toEqual([
    ['join-battle', { battleId: 'battle-1', playerId: 'player-1', language: 'python' }],
    ['join-battle', { battleId: 'battle-1', playerId: 'player-1', language: 'python' }]
  ])
})

test('reconnection status events are handled on the Socket.IO Manager', () => {
  const { socket, onStatus, onError } = setup()
  socket.io.emit('reconnect_attempt', 2)
  expect(onStatus).toHaveBeenLastCalledWith('reconnecting')
  expect(onError).toHaveBeenLastCalledWith('Reconnecting... (attempt 2/5)')
  socket.io.emit('reconnect_failed')
  expect(onStatus).toHaveBeenLastCalledWith('error')
  expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('Please refresh'))
})

test('reconnect uses current rematch identifiers and language', () => {
  const { socket, emit, context } = setup()
  socket.emit('connect')
  socket.emit('disconnect', 'ping timeout')
  Object.assign(context, { battleId: 'rematch', playerId: 'new-player', language: 'javascript' })
  socket.emit('connect')
  expect(emit).toHaveBeenLastCalledWith('join-battle', { battleId: 'rematch', playerId: 'new-player', language: 'javascript' })
})

test('finished battles are not rejoined', () => {
  const { socket, emit, context } = setup()
  context.battleState = 'finished'
  socket.emit('connect')
  expect(emit.mock.calls.some(([event]) => event === 'join-battle')).toBe(false)
})

test('cleanup removes both Socket and Manager listeners without removing unrelated listeners', () => {
  const { socket, cleanup, onStatus } = setup()
  const unrelated = jest.fn()
  socket.io.on('reconnect_attempt', unrelated)
  cleanup()
  socket.io.emit('reconnect_attempt', 1)
  socket.emit('connect')
  expect(onStatus).not.toHaveBeenCalled()
  expect(unrelated).toHaveBeenCalledWith(1)
  expect(socket.listenerCount('disconnect')).toBe(0)
})

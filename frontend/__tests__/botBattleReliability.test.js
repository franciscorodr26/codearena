import React from 'react'
import { EventEmitter } from 'events'
import { act, fireEvent, render, screen } from '@testing-library/react'
import BotBattle from '../pages/bot-battle'
import io from 'socket.io-client'

const mockRouter = { push: jest.fn() }
const mockUser = { id: 7, username: 'player' }
jest.mock('next/router', () => ({ useRouter: () => mockRouter }))
jest.mock('socket.io-client', () => jest.fn())
jest.mock('../components/withAuth', () => ({ withAuth: Component => Component }))
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser, token: 'test-token' }) }))
jest.mock('../components/ui/Logo', () => () => null)
jest.mock('../components/ui/FloatingOrbs', () => () => null)
jest.mock('../utils/fetch', () => ({ fetchWithTimeout: jest.fn().mockResolvedValue({ ok: false }) }))
jest.mock('framer-motion', () => {
  const React = require('react')
  const motion = {}
  for (const tag of ['div', 'span', 'button', 'header']) {
    motion[tag] = ({ children, initial, animate, exit, transition, whileHover, whileTap, layoutId, ...props }) => React.createElement(tag, props, children)
  }
  return { motion, AnimatePresence: ({ children }) => children }
})

let socket
beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  socket = new EventEmitter()
  socket.connected = true
  socket.disconnect = jest.fn()
  jest.spyOn(socket, 'emit')
  io.mockReturnValue(socket)
  mockRouter.push.mockResolvedValue(true)
})
afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
})

function start() {
  fireEvent.click(screen.getByRole('button', { name: 'Start Medium Battle' }))
  return socket.emit.mock.calls.find(([event]) => event === 'request-bot-battle')?.[1]
}

test('does not buffer a start request while disconnected', () => {
  socket.connected = false
  render(<BotBattle />)
  expect(start()).toBeUndefined()
  expect(screen.getByText(/Not connected to server/)).toBeInTheDocument()
  expect(screen.queryByText('Initializing Battle')).not.toBeInTheDocument()
})

test('silent creation requests time out and re-enable the form', () => {
  render(<BotBattle />)
  start()
  expect(screen.getByText('Initializing Battle')).toBeInTheDocument()
  act(() => jest.advanceTimersByTime(30000))
  expect(screen.queryByText('Initializing Battle')).not.toBeInTheDocument()
  expect(screen.getByText(/Creating the battle took too long/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start Medium Battle' })).toBeEnabled()
})

test.each(['disconnect', 'connect_error'])('%s clears a pending loading overlay', event => {
  render(<BotBattle />)
  start()
  act(() => socket.emit(event, 'transport close'))
  expect(screen.queryByText('Initializing Battle')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start Medium Battle' })).toBeEnabled()
})

test('matching bot creation response opens the coding battle with server identifiers', async () => {
  render(<BotBattle />)
  const request = start()
  expect(request).toMatchObject({ language: 'python', difficulty: 'medium', userId: 7 })
  await act(async () => socket.emit('bot-battle-created', {
    battleId: 'battle-123', playerId: request.playerId, bot: { difficulty: 'medium', name: 'Code Bot' }
  }))
  const destination = new URL(mockRouter.push.mock.calls[0][0], 'https://codearena.co')
  expect(destination.pathname).toBe('/battle')
  expect(Object.fromEntries(destination.searchParams)).toEqual({
    id: 'battle-123', playerId: request.playerId, isAgainstBot: 'true', botDifficulty: 'medium', opponent: 'Code Bot'
  })
})

test('late response from a timed-out request does not unexpectedly navigate', () => {
  render(<BotBattle />)
  const request = start()
  act(() => jest.advanceTimersByTime(30000))
  act(() => socket.emit('bot-battle-created', { battleId: 'late', playerId: request.playerId, bot: { difficulty: 'medium', name: 'Bot' } }))
  expect(mockRouter.push).not.toHaveBeenCalled()
})

test('navigation failure clears the overlay and shows a retryable error', async () => {
  mockRouter.push.mockRejectedValue(new Error('Route load failed'))
  render(<BotBattle />)
  const request = start()
  await act(async () => socket.emit('bot-battle-created', { battleId: 'battle', playerId: request.playerId, bot: { difficulty: 'medium', name: 'Bot' } }))
  expect(screen.queryByText('Initializing Battle')).not.toBeInTheDocument()
  expect(screen.getByText(/battle could not be opened/)).toBeInTheDocument()
})

test('unmount clears pending requests and socket listeners', () => {
  const { unmount } = render(<BotBattle />)
  start()
  unmount()
  expect(socket.listenerCount('bot-battle-created')).toBe(0)
  expect(socket.disconnect).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
})

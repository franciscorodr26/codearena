import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import PromptBattlePage from '../pages/prompt-battle'

const mockHandlers = {}
let mockReplies = {}
const mockSocket = {
  connected: true,
  on: jest.fn((event, handler) => { mockHandlers[event] = handler }),
  once: jest.fn(),
  emit: jest.fn((event, payload, reply) => { if (mockReplies[event]) reply?.(mockReplies[event]) }),
  removeAllListeners: jest.fn(),
  disconnect: jest.fn()
}
jest.mock('socket.io-client', () => ({ io: () => mockSocket }))
jest.mock('next/router', () => ({ useRouter: () => ({ isReady: true, query: {} }) }))
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ token: 'test-token', user: { id: 1 }, loading: false }) }))
jest.mock('../components/withAuth', () => ({ withAuth: Component => Component }))
jest.mock('../components/ui/Button', () => function Button({ children, onClick, disabled }) { return <button onClick={onClick} disabled={disabled}>{children}</button> })
jest.mock('../components/ui/Card', () => ({ Card: ({ children }) => <section>{children}</section> }))
jest.mock('../components/PromptBattleHistory', () => () => null)

const room = {
  code: 'ABC123', modelId: 'test-model', previewEnabled: false,
  players: [{ userId: '1', username: 'Me', submitCount: 1 }, { userId: '2', username: 'Friend' }],
  problem: { title: 'Write a clear prompt', scenario: 'A test scenario', description: 'Instructions', targetOutput: 'Output' }
}

function startBattle() {
  act(() => {
    mockHandlers['pb-config']({ availableModels: [{ id: 'test-model', label: 'Test model' }], defaultModelId: 'test-model', previewEnabled: false })
    mockHandlers['pb-match-found']({ room, roomCode: room.code, endsAt: Date.now() + 60000 })
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockReplies = {}
  mockSocket.connected = true
})

test('a successful submission with previews disabled never shows a running preview', () => {
  render(<PromptBattlePage />)
  startBattle()
  mockReplies['pb-submit'] = { ok: true, room, previewEnabled: false }
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My original prompt' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit prompt' }))
  expect(screen.getByText(/Prompts are scored when the round ends/)).toBeInTheDocument()
  expect(screen.queryByText('Running preview…')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Submit again' })).toBeEnabled()
})

test('playing renders the battle at the top, without an empty full-height setup shell', () => {
  const { container } = render(<PromptBattlePage />)
  startBattle()
  expect(container.querySelectorAll('.min-h-screen')).toHaveLength(1)
  expect(screen.getAllByRole('link', { name: 'Back' })).toHaveLength(1)
  expect(screen.getByText('Write a clear prompt')).toBeInTheDocument()
})

test('reconnect restores room membership while preserving the unsent draft', () => {
  render(<PromptBattlePage />)
  startBattle()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep my unsent work' } })
  mockSocket.connected = false
  act(() => { mockHandlers.disconnect() })
  fireEvent.click(screen.getByRole('button', { name: 'Submit prompt' }))
  expect(mockSocket.emit).not.toHaveBeenCalledWith('pb-submit', expect.anything(), expect.anything())
  mockReplies['pb-rejoin-running-room'] = { ok: true, room, phase: 'playing', endsAt: Date.now() + 50000 }
  mockSocket.connected = true
  act(() => { mockHandlers.connect() })
  expect(mockSocket.emit).toHaveBeenCalledWith('pb-rejoin-running-room', { roomCode: 'ABC123' }, expect.any(Function))
  expect(screen.getByRole('textbox')).toHaveValue('Keep my unsent work')
  expect(screen.getByRole('button', { name: 'Submit again' })).toBeEnabled()
  expect(screen.queryByText(/Connection lost/)).not.toBeInTheDocument()
})

test('reconnect recovers results when scoring finished while disconnected', () => {
  render(<PromptBattlePage />)
  startBattle()
  mockReplies['pb-rejoin-running-room'] = { ok: true, room, phase: 'results', results: { results: [], tie: true, winnerUserId: null } }
  act(() => { mockHandlers.disconnect(); mockHandlers.connect() })
  expect(screen.getByRole('heading', { name: 'Results' })).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

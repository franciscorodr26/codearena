import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import GalleryGame from '../pages/gallery/[id]'
import Tournament from '../pages/tournaments/[id]'

const mockRouter = { query: { id: '1' }, push: jest.fn(), back: jest.fn() }
const mockAuth = { token: 'context-token', user: { id: 7 } }
const mockTournaments = {
  fetchBracket: jest.fn(), joinTournamentRoom: jest.fn(), leaveTournamentRoom: jest.fn(),
  readyForMatch: jest.fn(), matchReadyPlayers: {}, registerForTournament: jest.fn(),
  unregisterFromTournament: jest.fn()
}
jest.mock('next/router', () => ({ useRouter: () => mockRouter }))
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))
jest.mock('../contexts/TournamentContext', () => ({ useTournaments: () => mockTournaments }))
jest.mock('../components/withAuth', () => ({ withAuth: component => component }))
jest.mock('../components/Logo', () => () => null)
jest.mock('../components/SearchBar', () => () => null)
jest.mock('../components/NotificationBell', () => () => null)
jest.mock('../components/ui/AvatarDisplay', () => () => null)
jest.mock('../utils/analytics', () => ({
  trackViewTournament: jest.fn(), trackTournamentRegister: jest.fn(), trackTournamentUnregister: jest.fn()
}))

function response(body, ok = true) {
  return { ok, json: async () => body }
}
function game(id) {
  return { id, title: `Game ${id}`, creator_username: 'builder', game_type: 'browser',
    html_content: `<h1>Playable game ${id}</h1>`, vote_score: 0, created_at: '2026-01-01' }
}
function tournament(id) {
  return { id, name: `Tournament ${id}`, status: 'registration_open', participant_count: 0,
    max_players: 8, start_time: '2026-10-01', registration_deadline: '2026-09-30' }
}
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  jest.restoreAllMocks()
  jest.clearAllMocks()
  mockRouter.query = { id: '1' }
  mockTournaments.fetchBracket.mockResolvedValue({ bracket: {}, matches: [] })
  global.fetch = jest.fn(async url => {
    if (url.endsWith('/comments')) return response({ comments: [] })
    if (url.endsWith('/participants')) return response({ participants: [] })
    const id = url.split('/').pop()
    return url.includes('/api/games/') ? response({ game: game(id) }) : response({ tournament: tournament(id) })
  })
})

test('gallery route changes replace the sandboxed game and discard a late old response', async () => {
  const oldRequest = deferred()
  const normalFetch = global.fetch.getMockImplementation()
  global.fetch.mockImplementation((url, options) => url.endsWith('/games/1') ? oldRequest.promise : normalFetch(url, options))
  const { rerender } = render(<GalleryGame />)
  mockRouter.query = { id: '2' }
  rerender(<GalleryGame />)
  expect(await screen.findByRole('heading', { name: 'Game 2' })).toBeInTheDocument()
  await act(async () => { oldRequest.resolve(response({ game: game('1') })) })
  expect(screen.queryByRole('heading', { name: 'Game 1' })).not.toBeInTheDocument()
  const frame = screen.getByTitle('Game 2')
  expect(frame).toHaveAttribute('srcdoc', '<h1>Playable game 2</h1>')
  expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
})

test('gallery can recover from a failed game load by opening another game', async () => {
  const normalFetch = global.fetch.getMockImplementation()
  global.fetch.mockImplementation((url, options) => url.endsWith('/games/1')
    ? Promise.resolve(response({ error: 'Game missing' }, false)) : normalFetch(url, options))
  const { rerender } = render(<GalleryGame />)
  expect(await screen.findByText('Game missing')).toBeInTheDocument()
  mockRouter.query = { id: '2' }
  rerender(<GalleryGame />)
  expect(await screen.findByRole('heading', { name: 'Game 2' })).toBeInTheDocument()
  expect(screen.queryByText('Game missing')).not.toBeInTheDocument()
})

test('a failed new gallery load never leaves the previous game playable', async () => {
  const { rerender } = render(<GalleryGame />)
  expect(await screen.findByTitle('Game 1')).toBeInTheDocument()
  global.fetch.mockResolvedValue(response({}, false))
  mockRouter.query = { id: '2' }
  rerender(<GalleryGame />)
  expect(await screen.findByText('Failed to load game')).toBeInTheDocument()
  expect(screen.queryByTitle('Game 1')).not.toBeInTheDocument()
})

test('tournament loads with the AuthContext token even when browser storage is blocked', async () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked storage') })
  render(<Tournament />)
  expect(await screen.findByRole('heading', { name: 'Tournament 1' })).toBeInTheDocument()
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/tournaments/1'), {
    headers: { Authorization: 'Bearer context-token' }
  })
  expect(mockTournaments.fetchBracket).toHaveBeenCalledWith('1')
  expect(mockTournaments.joinTournamentRoom).toHaveBeenCalledWith(1)
})

test('a failed tournament navigation clears the previous tournament', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  const { rerender } = render(<Tournament />)
  expect(await screen.findByRole('heading', { name: 'Tournament 1' })).toBeInTheDocument()
  global.fetch.mockResolvedValue(response({}, false))
  mockRouter.query = { id: '2' }
  rerender(<Tournament />)
  expect(await screen.findByRole('heading', { name: 'Failed to load tournament' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Tournament 1' })).not.toBeInTheDocument()
})

test('late tournament responses cannot replace the current tournament', async () => {
  const oldRequest = deferred()
  const normalFetch = global.fetch.getMockImplementation()
  global.fetch.mockImplementation((url, options) => url.endsWith('/tournaments/1') ? oldRequest.promise : normalFetch(url, options))
  const { rerender } = render(<Tournament />)
  mockRouter.query = { id: '2' }
  rerender(<Tournament />)
  expect(await screen.findByRole('heading', { name: 'Tournament 2' })).toBeInTheDocument()
  await act(async () => { oldRequest.resolve(response({ tournament: tournament('1') })) })
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Tournament 1' })).not.toBeInTheDocument())
})

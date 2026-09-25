import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import GameModes from '../pages/modes'
import { trackSelectGameMode, trackViewModes } from '../utils/analytics'

const mockRouter = { push: jest.fn() }
const mockUser = { id: 7, username: 'player' }
jest.mock('next/router', () => ({ useRouter: () => mockRouter }))
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))
jest.mock('../components/withAuth', () => ({ withAuth: Component => Component }))
jest.mock('../components/Logo', () => function MockLogo() { return <span>CodeArena</span> })
jest.mock('../utils/analytics', () => ({ trackViewModes: jest.fn(), trackSelectGameMode: jest.fn() }))

beforeEach(() => {
  jest.clearAllMocks()
  mockRouter.push.mockReset().mockResolvedValue(true)
})

test.each([
  ['Start practicing', '/practice', 'practice'],
  ['Play against a bot', '/bot-battle', 'bot-battle'],
  ['Find a match', '/matchmaking', 'matchmaking'],
  ['Challenge a friend', '/battle', 'private'],
  ['View tournaments', '/tournaments', 'tournaments'],
  ['Open CreatorArena', '/create', 'create'],
])('%s preserves its canonical route', async (label, destination, modeId) => {
  render(<GameModes />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: label })))
  expect(mockRouter.push).toHaveBeenCalledTimes(1)
  expect(mockRouter.push).toHaveBeenCalledWith(destination)
  expect(trackSelectGameMode).toHaveBeenCalledWith(modeId, mockUser)
})

test('renders one page heading and all six modes without duplicate navigation cards', () => {
  render(<GameModes />)
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('What do you want to play?')
  expect(screen.getAllByRole('article')).toHaveLength(6)
  expect(screen.getAllByRole('button')).toHaveLength(6)
  expect(trackViewModes).toHaveBeenCalledWith(mockUser)
})

test('bot battles are visible alongside solo practice in the main mode grid', () => {
  render(<GameModes />)
  const botCard = screen.getByRole('heading', { level: 2, name: 'Practice vs Bot' }).closest('article')
  const practiceCard = screen.getByRole('heading', { level: 2, name: 'Solo Practice' }).closest('article')
  expect(botCard).toBeVisible()
  expect(botCard.parentElement).toBe(practiceCard.parentElement)
  expect(within(botCard).getByRole('button', { name: 'Play against a bot' })).toBeEnabled()
})

test('retains community gallery, friends, and dashboard links', () => {
  render(<GameModes />)
  const community = screen.getByRole('complementary', { name: 'Explore the community' })
  expect(within(community).getByRole('link', { name: /Community gallery/ })).toHaveAttribute('href', '/gallery')
  expect(within(community).getByRole('link', { name: /Find your people/ })).toHaveAttribute('href', '/friends')
  expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard')
})

test.each(['rejected', 'cancelled'])('%s navigation shows an error and allows a successful retry', async failure => {
  if (failure === 'rejected') mockRouter.push.mockRejectedValueOnce(new Error('Route failed'))
  else mockRouter.push.mockResolvedValueOnce(false)
  render(<GameModes />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start practicing' })))
  expect(screen.getByRole('alert')).toHaveTextContent('That page did not open. Please try again.')
  expect(screen.getByRole('button', { name: 'Start practicing' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Find a match' })).toBeEnabled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start practicing' })))
  expect(mockRouter.push).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('duplicate and cross-card clicks are single-flight while navigation is pending', async () => {
  let completeNavigation
  mockRouter.push.mockImplementationOnce(() => new Promise(resolve => { completeNavigation = resolve }))
  render(<GameModes />)
  const practice = screen.getByRole('button', { name: 'Start practicing' })
  const matchmaking = screen.getByRole('button', { name: 'Find a match' })
  act(() => {
    fireEvent.click(practice)
    fireEvent.click(practice)
    fireEvent.click(matchmaking)
  })
  expect(mockRouter.push).toHaveBeenCalledTimes(1)
  expect(trackSelectGameMode).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Opening…' })).toBeDisabled()
  screen.getAllByRole('button').forEach(button => expect(button).toBeDisabled())
  await act(async () => completeNavigation(true))
  expect(screen.getByRole('button', { name: 'Start practicing' })).toBeEnabled()
})

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import Home from '../pages/index'

const mockRouter = { push: jest.fn(), replace: jest.fn() }
const mockAuth = { isAuthenticated: false, loading: false }
jest.mock('next/router', () => ({ useRouter: () => mockRouter }))
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))
jest.mock('../utils/analytics', () => ({ trackViewHome: jest.fn(), trackHomeCtaClick: jest.fn() }))
jest.mock('../components/Header', () => () => null)
jest.mock('../components/Footer', () => () => null)
jest.mock('../components/PasswordReminderBanner', () => () => null)
jest.mock('../components/EnhancedFeedbackForm', () => () => null)
jest.mock('../components/BugReportModal', () => () => null)
jest.mock('../components/FeatureRequestModal', () => () => null)

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.isAuthenticated = false
  mockAuth.loading = false
})

test.each([
  ['Create free account', '/register'],
  ['Browse problems', '/problems'],
  ['Start practicing', '/practice'],
  ['Practice prompting', '/practice?mode=prompting'],
  ['Find a match', '/matchmaking'],
  [/Friends and messages/, '/friends'],
  [/CreatorArena/, '/create'],
  [/Community gallery/, '/gallery'],
  [/Tournaments/, '/tournaments'],
])('keeps the %s entry point working', (name, destination) => {
  render(<Home />)
  fireEvent.click(screen.getByRole('button', { name }))
  expect(mockRouter.push).toHaveBeenCalledWith(destination)
})

test('signed-in members still go directly to their dashboard', () => {
  mockAuth.isAuthenticated = true
  render(<Home />)
  expect(mockRouter.replace).toHaveBeenCalledWith('/dashboard')
  expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
})

test('does not show the public homepage while authentication is loading', () => {
  mockAuth.loading = true
  render(<Home />)
  expect(mockRouter.replace).not.toHaveBeenCalled()
  expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
})

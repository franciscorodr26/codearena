import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Register from '../pages/register'

const mockGoogleLogin = jest.fn()
const mockComplete2FA = jest.fn()
const mockCheckUsername = jest.fn()
const mockRouter = { query: {}, isReady: true, push: jest.fn(), replace: jest.fn() }
const mockAuth = { loading: false, isAuthenticated: false, user: null }
jest.mock('next/router', () => ({ useRouter: () => mockRouter }))
jest.mock('../config/env', () => ({ config: { google_client_id: 'test-client', backend_url: 'http://localhost:3999' } }))
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({
  ...mockAuth, loginWithGoogle: mockGoogleLogin, complete2FALogin: mockComplete2FA,
  checkUsernameAvailability: mockCheckUsername
}) }))
jest.mock('../utils/analytics', () => ({ trackViewRegisterForm: jest.fn(), trackSignupError: jest.fn() }))
jest.mock('../components/GoogleSignInButton', () => function MockGoogle({ onSuccess }) { return (
  <button type="button" onClick={() => onSuccess('google-credential')}>Google test sign-in</button>
) })
jest.mock('../components/GitHubSignInButton', () => () => null)
jest.mock('../components/TwoFactorLogin', () => function MockTwoFactor({ onSuccess, onCancel }) { return (
  <div><button onClick={() => onSuccess({ token: 'verified-token', user: { id: 'google-user' } })}>Verify test code</button><button onClick={onCancel}>Cancel verification</button></div>
) })

beforeEach(() => {
  jest.clearAllMocks()
  sessionStorage.clear()
  mockRouter.query = {}
  mockAuth.isAuthenticated = false
  mockAuth.user = null
})

test('Google registration handles an existing account with two-factor auth instead of redirecting early', async () => {
  sessionStorage.setItem('redirectAfterLogin', '/friends')
  mockGoogleLogin.mockResolvedValue({ requires2FA: true, tempToken: 'pending-token' })
  mockComplete2FA.mockResolvedValue({})
  render(<Register />)
  fireEvent.click(screen.getByRole('button', { name: 'Google test sign-in' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Verify test code' }))
  await waitFor(() => expect(mockComplete2FA).toHaveBeenCalledWith('verified-token', { id: 'google-user' }, true))
  expect(mockRouter.push).not.toHaveBeenCalled()
  expect(mockRouter.replace).not.toHaveBeenCalled()
  expect(sessionStorage.getItem('redirectAfterLogin')).toBe('/friends')
})

test('two-factor cancellation returns to the registration form', async () => {
  mockGoogleLogin.mockResolvedValue({ requires2FA: true, tempToken: 'pending-token' })
  render(<Register />)
  fireEvent.click(screen.getByRole('button', { name: 'Google test sign-in' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel verification' }))
  expect(screen.getByRole('button', { name: 'Google test sign-in' })).toBeInTheDocument()
})

test('new OAuth users finish their profile before resuming an invite', () => {
  mockAuth.isAuthenticated = true
  mockAuth.user = { username_chosen: 0, email_verified: true }
  mockRouter.query = { redirect: '/battle/invite/test-code' }
  render(<Register />)
  expect(mockRouter.replace).toHaveBeenCalledWith('/complete-profile')
  expect(sessionStorage.getItem('redirectAfterLogin')).toBe('/battle/invite/test-code')
})

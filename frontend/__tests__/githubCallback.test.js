import React, { StrictMode } from 'react'
import { fireEvent, render, waitFor, screen } from '@testing-library/react'
import GitHubCallback from '../pages/auth/github/callback'
import { createGitHubAuthorizationUrl } from '../utils/githubOAuth'

const mockLogin = jest.fn()
const mockComplete2FA = jest.fn()
const mockRouter = { isReady: true, query: {}, push: jest.fn() }
jest.mock('next/router', () => ({ useRouter: () => mockRouter }))
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ loginWithGitHub: mockLogin, complete2FALogin: mockComplete2FA })
}))
jest.mock('../components/ui/FloatingOrbs', () => () => null)
jest.mock('../components/TwoFactorLogin', () => function MockTwoFactor({ onSuccess }) { return (
  <button onClick={() => onSuccess({ token: 'verified-token', user: { id: 'github-user', email_verified: true } })}>Two-factor challenge</button>
) })

beforeEach(() => {
  jest.clearAllMocks()
  window.sessionStorage.clear()
  mockRouter.query = {}
})

function setValidQuery() {
  const url = new URL(createGitHubAuthorizationUrl('client', {
    location: { origin: 'https://codearena.co' },
    crypto: window.crypto,
    sessionStorage: window.sessionStorage
  }))
  mockRouter.query = { code: 'provider-code', state: url.searchParams.get('state') }
}

test('StrictMode callback exchanges a valid code exactly once', async () => {
  setValidQuery()
  mockLogin.mockResolvedValue({ isNewUser: false })
  render(<StrictMode><GitHubCallback /></StrictMode>)
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/dashboard'))
  expect(mockLogin).toHaveBeenCalledTimes(1)
  expect(mockLogin).toHaveBeenCalledWith('provider-code')
})

test('rejects an unsolicited callback without exchanging the code', () => {
  jest.useFakeTimers()
  mockRouter.query = { code: 'unsolicited-code', state: 'a'.repeat(64) }
  render(<GitHubCallback />)
  expect(screen.getByText(/request is missing, expired, or invalid/)).toBeInTheDocument()
  expect(mockLogin).not.toHaveBeenCalled()
  jest.clearAllTimers()
  jest.useRealTimers()
})

test('valid callback still supports required two-factor authentication', async () => {
  setValidQuery()
  mockLogin.mockResolvedValue({ requires2FA: true, tempToken: 'temporary' })
  render(<GitHubCallback />)
  expect(await screen.findByText('Two-factor challenge')).toBeInTheDocument()
  expect(mockRouter.push).not.toHaveBeenCalled()
})

test('two-factor completion passes the token and user separately, then resumes the destination', async () => {
  setValidQuery()
  sessionStorage.setItem('redirectAfterLogin', '/friends')
  mockLogin.mockResolvedValue({ requires2FA: true, tempToken: 'temporary' })
  mockComplete2FA.mockResolvedValue({})
  render(<GitHubCallback />)
  fireEvent.click(await screen.findByRole('button', { name: 'Two-factor challenge' }))
  await waitFor(() => expect(mockComplete2FA).toHaveBeenCalledWith('verified-token', { id: 'github-user', email_verified: true }, false))
  expect(mockRouter.push).toHaveBeenCalledWith('/friends')
})

test('OAuth callback rejects an external post-login destination', async () => {
  setValidQuery()
  sessionStorage.setItem('redirectAfterLogin', 'https://example.com')
  mockLogin.mockResolvedValue({ isNewUser: false })
  render(<GitHubCallback />)
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/dashboard'))
})

import React, { StrictMode, useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { withAuth, withOptionalAuth } from '../components/withAuth'

let mockAuth
const mockRouter = { isReady: true, pathname: '/practice', asPath: '/practice?problem=win-streak', replace: jest.fn() }
const mockMount = jest.fn()

jest.mock('next/router', () => ({ useRouter: () => mockRouter }))
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

function PrivatePage({ title = 'Private content' }) {
  useEffect(() => { mockMount() }, [])
  return <div>{title}</div>
}

const ProtectedPage = withAuth(PrivatePage)
const PublicPage = withOptionalAuth(PrivatePage)

beforeEach(() => {
  jest.restoreAllMocks()
  jest.clearAllMocks()
  sessionStorage.clear()
  mockAuth = { loading: true, isAuthenticated: false, user: null }
  Object.assign(mockRouter, { isReady: true, pathname: '/practice', asPath: '/practice?problem=win-streak' })
  mockRouter.replace.mockResolvedValue(true)
})

test('does not mount private data consumers until authentication finishes', () => {
  const { rerender } = render(<ProtectedPage title="Your practice" />)
  expect(screen.getByRole('status')).toHaveTextContent('Checking your session')
  expect(mockMount).not.toHaveBeenCalled()
  expect(mockRouter.replace).not.toHaveBeenCalled()

  mockAuth = { loading: false, isAuthenticated: true, user: { id: 1, email_verified: true } }
  rerender(<ProtectedPage title="Your practice" />)
  expect(screen.getByText('Your practice')).toBeInTheDocument()
  expect(mockMount).toHaveBeenCalledTimes(1)
})

test('waits for router readiness before saving the destination and redirects once', () => {
  mockAuth.loading = false
  mockRouter.isReady = false
  const { rerender } = render(<StrictMode><ProtectedPage /></StrictMode>)
  expect(mockRouter.replace).not.toHaveBeenCalled()
  expect(mockMount).not.toHaveBeenCalled()
  expect(sessionStorage.getItem('redirectAfterLogin')).toBeNull()

  mockRouter.isReady = true
  rerender(<StrictMode><ProtectedPage /></StrictMode>)
  expect(mockRouter.replace).toHaveBeenCalledTimes(1)
  expect(mockRouter.replace).toHaveBeenCalledWith('/login')
  expect(sessionStorage.getItem('redirectAfterLogin')).toBe('/practice?problem=win-streak')
  expect(mockMount).not.toHaveBeenCalled()
})

test('a pending redirect does not leave a subsequently authenticated user stuck', () => {
  mockAuth.loading = false
  const { rerender } = render(<ProtectedPage />)
  expect(mockRouter.replace).toHaveBeenCalledWith('/login')
  mockAuth = { loading: false, isAuthenticated: true, user: { id: 1, email_verified: true } }
  rerender(<ProtectedPage />)
  expect(screen.getByText('Private content')).toBeInTheDocument()

  mockAuth = { loading: false, isAuthenticated: false, user: null }
  rerender(<ProtectedPage />)
  expect(screen.queryByText('Private content')).not.toBeInTheDocument()
  expect(mockRouter.replace).toHaveBeenCalledTimes(2)
})

test('unverified users without an invite never mount the protected page', () => {
  mockAuth = { loading: false, isAuthenticated: true, user: { id: 1, email_verified: false } }
  const { rerender } = render(<ProtectedPage />)
  expect(mockMount).not.toHaveBeenCalled()
  expect(mockRouter.replace).toHaveBeenCalledWith('/verify-required')

  mockAuth = { ...mockAuth, user: { ...mockAuth.user, email_verified: true } }
  rerender(<ProtectedPage />)
  expect(screen.getByText('Private content')).toBeInTheDocument()
})

test('preserves the battle invite query allowance, but not on other routes', () => {
  mockAuth = { loading: false, isAuthenticated: true, user: { id: 1, email_verified: false } }
  Object.assign(mockRouter, { pathname: '/battle', asPath: '/battle?playerId=2' })
  const { rerender } = render(<ProtectedPage />)
  expect(screen.getByText('Private content')).toBeInTheDocument()
  expect(mockRouter.replace).not.toHaveBeenCalled()

  Object.assign(mockRouter, { pathname: '/practice', asPath: '/practice?playerId=2' })
  rerender(<ProtectedPage />)
  expect(screen.queryByText('Private content')).not.toBeInTheDocument()
  expect(mockRouter.replace).toHaveBeenCalledWith('/verify-required')
})

test('preserves an existing joined-invite allowance', () => {
  sessionStorage.setItem('joinedViaInvite', 'true')
  mockAuth = { loading: false, isAuthenticated: true, user: { id: 1, email_verified: false } }
  render(<ProtectedPage />)
  expect(screen.getByText('Private content')).toBeInTheDocument()
  expect(mockRouter.replace).not.toHaveBeenCalled()
})

test('restricted session storage cannot prevent the login redirect', () => {
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked') })
  mockAuth.loading = false
  render(<ProtectedPage />)
  expect(mockRouter.replace).toHaveBeenCalledWith('/login')
  expect(mockMount).not.toHaveBeenCalled()
})

test('restricted session storage does not bypass verification', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked') })
  mockAuth = { loading: false, isAuthenticated: true, user: { id: 1, email_verified: false } }
  render(<ProtectedPage />)
  expect(mockRouter.replace).toHaveBeenCalledWith('/verify-required')
  expect(mockMount).not.toHaveBeenCalled()
})

test('a cancelled redirect is handled without mounting private content', async () => {
  mockRouter.replace.mockRejectedValue(new Error('Navigation cancelled'))
  mockAuth.loading = false
  render(<ProtectedPage />)
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/login'))
  expect(mockMount).not.toHaveBeenCalled()
})

test('optional authentication still allows public content while loading', () => {
  render(<PublicPage />)
  expect(screen.getByText('Private content')).toBeInTheDocument()
  expect(mockRouter.replace).not.toHaveBeenCalled()
})

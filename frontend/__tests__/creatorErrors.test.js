import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import Creator from '../pages/create'

const mockRouter = { query: {}, push: jest.fn(), replace: jest.fn() }
const mockAuth = { token: 'creator-token', user: { id: 1 } }
jest.mock('next/router', () => ({ useRouter: () => mockRouter }))
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))
jest.mock('../components/withAuth', () => ({ withAuth: component => component }))
jest.mock('../components/Logo', () => () => null)
jest.mock('../components/SearchBar', () => () => null)
jest.mock('../components/NotificationBell', () => () => null)
jest.mock('../components/tutorial', () => ({ useTutorial: () => ({ hasLoadedPersistedState: false }) }))
jest.mock('../utils/analytics', () => ({ trackTourStarted: jest.fn(), trackTourCompleted: jest.fn(), trackTourSkipped: jest.fn() }))

function response(body, ok = true) { return { ok, json: async () => body } }

beforeEach(() => {
  jest.clearAllMocks()
  mockRouter.query = {}
  global.fetch = jest.fn(async url => {
    if (url.endsWith('/api/ai/credits')) return response({ success: true, credits: 0, cost: 5 })
    if (url.endsWith('/api/games/mine')) return response({ games: [{ id: 9, title: 'Saved game', status: 'draft' }] })
    return response({ error: 'Game is unavailable' }, false)
  })
})

async function openCredits() {
  render(<Creator />)
  fireEvent.click(await screen.findByRole('button', { name: 'Add credits' }))
  return screen.getByRole('dialog', { name: 'CreatorArena credits' })
}

test('members with zero credits can access checkout without first generating a game', async () => {
  const dialog = await openCredits()
  expect(within(dialog).getByRole('button', { name: /100 Credits/ })).toBeEnabled()
  expect(within(dialog).getByRole('button', { name: /500 Credits/ })).toBeEnabled()
  expect(global.fetch.mock.calls.some(([url]) => url.includes('/generate-game'))).toBe(false)
})

test('checkout API errors appear inside the open modal and allow retry', async () => {
  const dialog = await openCredits()
  global.fetch.mockResolvedValueOnce(response({ error: 'Payments temporarily unavailable' }, false))
  fireEvent.click(within(dialog).getByRole('button', { name: /100 Credits/ }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Payments temporarily unavailable')
  expect(within(dialog).getByRole('button', { name: /100 Credits/ })).toBeEnabled()
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/payment/purchase-credits'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer creator-token' },
    body: JSON.stringify({ packId: 'small' })
  })
})

test('both pack buttons are disabled while one checkout request is pending', async () => {
  const dialog = await openCredits()
  let resolveCheckout
  global.fetch.mockImplementationOnce(() => new Promise(resolve => { resolveCheckout = resolve }))
  const small = within(dialog).getByRole('button', { name: /100 Credits/ })
  const large = within(dialog).getByRole('button', { name: /500 Credits/ })
  fireEvent.click(small)
  expect(small).toBeDisabled()
  expect(large).toBeDisabled()
  fireEvent.click(large)
  expect(global.fetch.mock.calls.filter(([url]) => url.endsWith('/purchase-credits'))).toHaveLength(1)
  await act(async () => { resolveCheckout(response({ error: 'Try again later' }, false)) })
  expect(small).toBeEnabled()
})

test.each([
  { url: 'https://example.com/not-checkout' },
  {},
])('checkout rejects missing or unexpected redirect URLs: %j', async body => {
  const dialog = await openCredits()
  global.fetch.mockResolvedValueOnce(response(body))
  fireEvent.click(within(dialog).getByRole('button', { name: /500 Credits/ }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/checkout/i)
  expect(within(dialog).getByRole('button', { name: /500 Credits/ })).toBeEnabled()
})

test('a failed edit link shows the API error instead of silently opening a blank editor', async () => {
  mockRouter.query = { edit: '9' }
  render(<Creator />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Game is unavailable')
  expect(screen.queryByTitle('Game Preview')).not.toBeInTheDocument()
})

test('loading an unavailable saved game displays a recoverable error', async () => {
  render(<Creator />)
  fireEvent.click(screen.getByTitle('My Games'))
  fireEvent.click(await screen.findByRole('button', { name: /Saved game/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Game is unavailable')
})

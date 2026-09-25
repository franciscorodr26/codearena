import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Admin from '../pages/admin'

let mockAuth
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

function response(data, status = 200) {
  return { ok: status === 200, status, json: async () => data }
}
const member = { id: 1, username: 'alice', email: 'alice@example.test', emailVerified: true, isOnline: false }
function memberList(members = [member], page = 1, totalPages = 1) {
  return { success: true, members, pagination: { page, limit: 25, total: members.length, totalPages } }
}
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth = { loading: false, token: 'admin-token', user: { id: 7, is_admin: true } }
  global.fetch = jest.fn(async url => {
    if (url.endsWith('/overview')) return response({ success: true, counts: { members: 1 }, generatedAt: '2026-09-06' })
    if (url.includes('/history?')) return response({ success: true, member,
      counts: { friendships: 3, directMessagesSent: 12, directMessagesReceived: 5 },
      activities: [{ id: 3, type: 'coding_practice', occurredAt: '2026-09-05', language: 'python', result: 'solved', score: 100 }],
      pagination: { page: 1, total: 1, totalPages: 1 }
    })
    return response(memberList())
  })
})

test.each([
  { loading: true, token: 'admin-token', user: { id: 7, is_admin: true } },
  { loading: false, token: null, user: null },
  { loading: false, token: 'member-token', user: { id: 7, is_admin: false } },
])('does not request admin data without resolved admin permission: %j', auth => {
  mockAuth = auth
  render(<Admin />)
  expect(global.fetch).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('Search username or email')).not.toBeInTheDocument()
})

test('admin hub displays searchable members and counts-only activity with existing tools', async () => {
  render(<Admin />)
  expect(await screen.findByText('alice@example.test')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Account audit' })).toHaveAttribute('href', '/admin/accounts')
  expect(screen.getByRole('link', { name: 'Moderation' })).toHaveAttribute('href', '/admin/moderation')
  fireEvent.click(screen.getByRole('button', { name: 'View alice activity' }))
  expect(await screen.findByRole('heading', { name: 'Member activity: alice' })).toBeInTheDocument()
  expect(screen.getByText('Direct messages sent')).toBeInTheDocument()
  expect(screen.getByText('12')).toBeInTheDocument()
  expect(screen.getByText('solved')).toBeInTheDocument()
  expect(screen.getByText(/private message content is not shown/)).toBeInTheDocument()
})

test('server rejection clears the dashboard instead of trusting the local admin flag', async () => {
  global.fetch.mockResolvedValue(response({ error: 'Admin access required' }, 403))
  render(<Admin />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Admin access required')
  expect(screen.queryByLabelText('Search username or email')).not.toBeInTheDocument()
})

test('failed member reads expose a retry without displaying an empty-success result', async () => {
  const normalFetch = global.fetch.getMockImplementation()
  let failed = false
  global.fetch.mockImplementation((url, options) => {
    if (url.includes('/members?') && !failed) { failed = true; return Promise.resolve(response({}, 500)) }
    return normalFetch(url, options)
  })
  render(<Admin />)
  fireEvent.click(await screen.findByRole('button', { name: 'Retry members' }))
  expect(await screen.findByText('alice@example.test')).toBeInTheDocument()
})

test('search is debounced and returns to the first page', async () => {
  const normalFetch = global.fetch.getMockImplementation()
  global.fetch.mockImplementation((url, options) => {
    if (url.includes('/members?')) {
      const page = Number(new URL(url).searchParams.get('page'))
      return Promise.resolve(response(memberList([member], page, 2)))
    }
    return normalFetch(url, options)
  })
  render(<Admin />)
  fireEvent.click(await screen.findByRole('button', { name: 'Next members' }))
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('page=2'), expect.any(Object)))
  const beforeSearch = global.fetch.mock.calls.length
  const input = screen.getByLabelText('Search username or email')
  fireEvent.change(input, { target: { value: 'a' } })
  fireEvent.change(input, { target: { value: 'alice@example.test' } })
  expect(global.fetch.mock.calls).toHaveLength(beforeSearch)
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('search=alice%40example.test&page=1'), expect.any(Object)))
  expect(global.fetch.mock.calls.filter(([url]) => url.includes('search=a&'))).toHaveLength(0)
})

test('late search results cannot replace results for the latest search', async () => {
  const oldRequest = deferred()
  const normalFetch = global.fetch.getMockImplementation()
  global.fetch.mockImplementation((url, options) => url.includes('/members?search=&') ? oldRequest.promise : normalFetch(url, options))
  render(<Admin />)
  fireEvent.change(screen.getByLabelText('Search username or email'), { target: { value: 'alice' } })
  expect(await screen.findByText('alice@example.test')).toBeInTheDocument()
  await act(async () => { oldRequest.resolve(response(memberList([{ ...member, username: 'outdated', email: 'old@example.test' }]))) })
  expect(screen.queryByText('old@example.test')).not.toBeInTheDocument()
})

test('switching sessions clears old data and ignores responses from the prior token', async () => {
  const oldRequest = deferred()
  const normalFetch = global.fetch.getMockImplementation()
  global.fetch.mockImplementation((url, options) => url.includes('/members?') && options.headers.Authorization === 'Bearer admin-token'
    ? oldRequest.promise : normalFetch(url, options))
  const { rerender } = render(<Admin />)
  mockAuth = { loading: false, token: 'new-admin-token', user: { id: 8, is_admin: true } }
  rerender(<Admin />)
  expect(await screen.findByText('alice@example.test')).toBeInTheDocument()
  await act(async () => { oldRequest.resolve(response(memberList([{ ...member, email: 'prior-session@example.test' }]))) })
  expect(screen.queryByText('prior-session@example.test')).not.toBeInTheDocument()

  mockAuth = { loading: false, token: null, user: null }
  rerender(<Admin />)
  expect(screen.queryByText('alice@example.test')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Admin access required')
})

test('switching selected members discards a late history response', async () => {
  const oldRequest = deferred()
  const normalFetch = global.fetch.getMockImplementation()
  global.fetch.mockImplementation((url, options) => {
    if (url.includes('/members?')) return Promise.resolve(response(memberList([member, { ...member, id: 2, username: 'bob' }])))
    if (url.includes('/members/1/history')) return oldRequest.promise
    if (url.includes('/members/2/history')) return Promise.resolve(response({ success: true, member: { ...member, id: 2, username: 'bob' }, counts: {}, activities: [], pagination: { page: 1, totalPages: 0 } }))
    return normalFetch(url, options)
  })
  render(<Admin />)
  fireEvent.click(await screen.findByRole('button', { name: 'View alice activity' }))
  fireEvent.click(screen.getByRole('button', { name: 'View bob activity' }))
  expect(await screen.findByRole('heading', { name: 'Member activity: bob' })).toBeInTheDocument()
  await act(async () => { oldRequest.resolve(response({ success: true, member, counts: {}, activities: [], pagination: {} })) })
  expect(screen.queryByRole('heading', { name: 'Member activity: alice' })).not.toBeInTheDocument()
})

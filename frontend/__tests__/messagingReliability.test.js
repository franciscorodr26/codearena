import React, { useEffect } from 'react'
import { act, render, cleanup } from '@testing-library/react'
import { MessagingProvider, useMessaging } from '../contexts/MessagingContext'
import { fetchWithTimeout } from '../utils/fetch'

const mockHandlers = {}
const mockSocket = { on: jest.fn((event, handler) => { mockHandlers[event] = handler }), emit: jest.fn(), disconnect: jest.fn(), removeAllListeners: jest.fn() }
let mockAuth = { token: 'test-token', user: { id: 1 } }
jest.mock('socket.io-client', () => ({ io: () => mockSocket }))
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))
jest.mock('../utils/fetch', () => ({ fetchWithTimeout: jest.fn() }))

let messaging
let view
function Consumer() {
  const value = useMessaging()
  useEffect(() => { messaging = value }, [value])
  return null
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve: data => resolve({ json: async () => data }) }
}

const dm = id => ({ success: true, user: { id, username: `user${id}` }, messages: [{ id: id * 10, sender_id: id, receiver_id: 1, content: `thread${id}` }] })
const group = id => ({ success: true, group: { id, name: `group${id}` }, messages: [{ id: id * 10, group_id: id, content: `group${id}` }] })

beforeEach(() => {
  jest.clearAllMocks()
  fetchWithTimeout.mockReset()
  mockAuth = { token: 'test-token', user: { id: 1 } }
  view = render(<MessagingProvider><Consumer /></MessagingProvider>)
})

afterEach(cleanup)

test('a slower DM response cannot replace the latest selected conversation', async () => {
  const first = deferred()
  const second = deferred()
  fetchWithTimeout.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  let firstOpen, secondOpen
  act(() => { firstOpen = messaging.openChat(2) })
  act(() => { secondOpen = messaging.openChat(3) })
  await act(async () => { second.resolve(dm(3)); await secondOpen })
  await act(async () => { first.resolve(dm(2)); await firstOpen })
  expect(messaging.activeChat.id).toBe(3)
  expect(messaging.messages.map(message => message.content)).toEqual(['thread3'])
})

test.each(['direct', 'group'])('closing a loading %s thread prevents it reopening', async type => {
  const request = deferred()
  fetchWithTimeout.mockReturnValueOnce(request.promise)
  let pending
  act(() => { pending = type === 'direct' ? messaging.openChat(2) : messaging.openGroupChat(2) })
  act(() => { type === 'direct' ? messaging.closeChat() : messaging.closeGroupChat() })
  await act(async () => { request.resolve(type === 'direct' ? dm(2) : group(2)); await pending })
  expect(messaging.activeChat).toBeNull()
  expect(messaging.activeGroupChat).toBeNull()
  expect(messaging.messages).toEqual([])
  expect(messaging.groupMessages).toEqual([])
})

test.each(['direct', 'group'])('switching away from a loading %s thread ignores its late response', async firstType => {
  const first = deferred()
  const second = deferred()
  fetchWithTimeout.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  let firstOpen, secondOpen
  act(() => { firstOpen = firstType === 'direct' ? messaging.openChat(2) : messaging.openGroupChat(2) })
  act(() => { secondOpen = firstType === 'direct' ? messaging.openGroupChat(3) : messaging.openChat(3) })
  await act(async () => { second.resolve(firstType === 'direct' ? group(3) : dm(3)); await secondOpen })
  await act(async () => { first.resolve(firstType === 'direct' ? dm(2) : group(2)); await firstOpen })
  if (firstType === 'direct') {
    expect(messaging.activeChat).toBeNull()
    expect(messaging.messages).toEqual([])
    expect(messaging.activeGroupChat.id).toBe(3)
    expect(messaging.groupMessages[0].content).toBe('group3')
  } else {
    expect(messaging.activeGroupChat).toBeNull()
    expect(messaging.groupMessages).toEqual([])
    expect(messaging.activeChat.id).toBe(3)
    expect(messaging.messages[0].content).toBe('thread3')
  }
})

test('late send acknowledgement never appears in another conversation', async () => {
  fetchWithTimeout.mockResolvedValueOnce({ json: async () => dm(3) })
  await act(async () => { await messaging.openChat(3) })
  act(() => { mockHandlers['message-sent']({ message: { id: 99, sender_id: 1, receiver_id: 2, content: 'For user2 only' } }) })
  expect(messaging.messages.map(message => message.id)).toEqual([30])
  act(() => { mockHandlers['message-sent']({ message: { id: 100, sender_id: 1, receiver_id: 3, content: 'For user3' } }) })
  expect(messaging.messages.map(message => message.id)).toEqual([30, 100])
})

test.each(['logout', 'switch'])('%s clears all account-owned messaging state', async action => {
  fetchWithTimeout
    .mockResolvedValueOnce({ json: async () => ({ success: true, conversations: [{ other_user_id: 2 }] }) })
    .mockResolvedValueOnce({ json: async () => ({ success: true, count: 4 }) })
    .mockResolvedValueOnce({ json: async () => ({ success: true, groups: [{ id: 7 }] }) })
    .mockResolvedValueOnce({ json: async () => dm(2) })
  await act(async () => {
    await messaging.fetchConversations()
    await messaging.fetchUnreadCount()
    await messaging.fetchGroupConversations()
    await messaging.openChat(2)
  })
  act(() => { mockHandlers['user-typing']({ userId: 2 }) })
  expect(messaging.conversations).toHaveLength(1)
  expect(messaging.unreadCount).toBe(4)
  expect(messaging.groupConversations).toHaveLength(1)
  expect(messaging.activeChat.id).toBe(2)
  mockAuth = action === 'logout' ? { token: null, user: null } : { token: 'second-token', user: { id: 10 } }
  view.rerender(<MessagingProvider><Consumer /></MessagingProvider>)
  expect(messaging.conversations).toEqual([])
  expect(messaging.unreadCount).toBe(0)
  expect(messaging.messages).toEqual([])
  expect(messaging.activeChat).toBeNull()
  expect(messaging.groupConversations).toEqual([])
  expect(messaging.groupMessages).toEqual([])
  expect(messaging.activeGroupChat).toBeNull()
  expect(messaging.typingUsers.size).toBe(0)
  expect(messaging.groupTypingUsers.size).toBe(0)
  expect(messaging.connected).toBe(false)
  expect(mockSocket.removeAllListeners).toHaveBeenCalled()
})

test('responses from the previous account cannot repopulate state after switching accounts', async () => {
  const requests = Array.from({ length: 5 }, deferred)
  requests.forEach(request => fetchWithTimeout.mockReturnValueOnce(request.promise))
  let pending
  act(() => {
    pending = [messaging.fetchConversations(), messaging.fetchUnreadCount(), messaging.fetchGroupConversations(), messaging.createGroup('Old account group', [2]), messaging.openChat(2)]
  })
  mockAuth = { token: 'second-token', user: { id: 10 } }
  view.rerender(<MessagingProvider><Consumer /></MessagingProvider>)
  await act(async () => {
    requests[0].resolve({ success: true, conversations: [{ other_user_id: 2 }] })
    requests[1].resolve({ success: true, count: 8 })
    requests[2].resolve({ success: true, groups: [{ id: 7 }] })
    requests[3].resolve({ success: true, group: { id: 8 } })
    requests[4].resolve(dm(2))
    await Promise.all(pending)
  })
  expect(messaging.conversations).toEqual([])
  expect(messaging.unreadCount).toBe(0)
  expect(messaging.groupConversations).toEqual([])
  expect(messaging.messages).toEqual([])
  expect(messaging.activeChat).toBeNull()
})

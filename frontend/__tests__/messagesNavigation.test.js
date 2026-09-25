import React from 'react'
import { render } from '@testing-library/react'
import MessagesPage from '../pages/messages'

const mockRouter = { query: { userId: '2' }, push: jest.fn(), replace: jest.fn() }
const mockMessaging = {
  connected: true,
  conversations: [],
  messages: [],
  groupConversations: [],
  groupMessages: [],
  typingUsers: new Set(),
  groupTypingUsers: new Map(),
  activeChat: null,
  activeGroupChat: null,
  fetchConversations: jest.fn(),
  openChat: jest.fn()
}

jest.mock('next/router', () => ({ useRouter: () => mockRouter }))
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 } }) }))
jest.mock('../contexts/MessagingContext', () => ({ useMessaging: () => mockMessaging }))
jest.mock('../contexts/FriendContext', () => ({ useFriends: () => ({ friends: [], isFriend: () => false }) }))
jest.mock('../contexts/ChallengeContext', () => ({ useChallenge: () => ({ sendChallenge: jest.fn() }) }))
jest.mock('../components/withAuth', () => ({ withAuth: Component => Component }))
jest.mock('../utils/analytics', () => ({ trackViewMessages: jest.fn(), trackMessageSent: jest.fn(), trackConversationOpened: jest.fn() }))
jest.mock('../components/Logo', () => () => null)
jest.mock('../components/ui/AvatarDisplay', () => () => null)
jest.mock('../components/ReportUserModal', () => ({ __esModule: true, default: () => null, BlockUserModal: () => null }))

beforeEach(() => {
  jest.clearAllMocks()
  mockRouter.query = { userId: '2' }
  mockMessaging.activeChat = null
  mockMessaging.connected = true
  Element.prototype.scrollIntoView = jest.fn()
})

test('deep link opens once and does not override a different sidebar selection', () => {
  const { rerender } = render(<MessagesPage />)
  expect(mockMessaging.openChat).toHaveBeenCalledTimes(1)
  expect(mockMessaging.openChat).toHaveBeenCalledWith(2)
  mockMessaging.activeChat = { id: 3, username: 'Other friend' }
  rerender(<MessagesPage />)
  expect(mockMessaging.openChat).toHaveBeenCalledTimes(1)
  mockMessaging.activeChat = null
  rerender(<MessagesPage />)
  expect(mockMessaging.openChat).toHaveBeenCalledTimes(1)
  mockRouter.query = { userId: '4' }
  rerender(<MessagesPage />)
  expect(mockMessaging.openChat).toHaveBeenLastCalledWith(4)
  expect(mockMessaging.openChat).toHaveBeenCalledTimes(2)
})

test('deep link waits for connectivity and ignores malformed recipient IDs', () => {
  mockMessaging.connected = false
  const { rerender } = render(<MessagesPage />)
  expect(mockMessaging.openChat).not.toHaveBeenCalled()
  mockMessaging.connected = true
  rerender(<MessagesPage />)
  expect(mockMessaging.openChat).toHaveBeenCalledWith(2)
  mockRouter.query = { userId: '4invalid' }
  rerender(<MessagesPage />)
  expect(mockMessaging.openChat).toHaveBeenCalledTimes(1)
})

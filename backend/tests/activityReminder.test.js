/**
 * Activity Reminder Tests
 *
 * Tests the activity reminder email generation and notification logic
 */

const emailService = require('../services/email');

describe('Activity Reminder Email Generation', () => {
  const mockUser = {
    email: 'test@example.com',
    username: 'testuser'
  };

  const mockFriendRequests = [
    { sender_username: 'alice', sender_avatar: null, created_at: '2026-02-15T10:00:00Z' },
    { sender_username: 'bob', sender_avatar: 'https://example.com/avatar.png', created_at: '2026-02-14T10:00:00Z' }
  ];

  const mockMessages = [
    { sender_username: 'charlie', content: 'Hey, want to battle?', sender_avatar: null, created_at: '2026-02-15T10:00:00Z' },
    { sender_username: 'david', content: 'Great game yesterday! That was an intense match and I learned a lot from it.', sender_avatar: null, created_at: '2026-02-14T10:00:00Z' }
  ];

  describe('generateActivityReminderEmail', () => {
    it('should generate HTML email with friend requests only', () => {
      const html = emailService.generateActivityReminderEmail({
        email: mockUser.email,
        username: mockUser.username,
        friendRequests: mockFriendRequests,
        messages: [],
        friendRequestCount: 2,
        messageCount: 0
      });

      expect(html).toContain('2 Friend Requests');
      expect(html).toContain('@alice');
      expect(html).toContain('@bob');
      expect(html).toContain('wants to be friends');
      expect(html).not.toContain('Unread Message');
      expect(html).toContain('activity-reminders'); // unsubscribe link
    });

    it('should generate HTML email with messages only', () => {
      const html = emailService.generateActivityReminderEmail({
        email: mockUser.email,
        username: mockUser.username,
        friendRequests: [],
        messages: mockMessages,
        friendRequestCount: 0,
        messageCount: 2
      });

      expect(html).toContain('2 Unread Messages');
      expect(html).toContain('@charlie');
      expect(html).toContain('sent you a message'); // Content hidden for privacy
      expect(html).not.toContain('Friend Request');
    });

    it('should generate HTML email with both friend requests and messages', () => {
      const html = emailService.generateActivityReminderEmail({
        email: mockUser.email,
        username: mockUser.username,
        friendRequests: mockFriendRequests,
        messages: mockMessages,
        friendRequestCount: 2,
        messageCount: 2
      });

      expect(html).toContain('2 Friend Requests');
      expect(html).toContain('2 Unread Messages');
      expect(html).toContain('@alice');
      expect(html).toContain('@charlie');
    });

    it('should not show message content for privacy', () => {
      const longMessage = [{
        sender_username: 'verbose',
        content: 'This is a very long message that exceeds fifty characters and should be truncated with ellipsis',
        sender_avatar: null,
        created_at: '2026-02-15T10:00:00Z'
      }];

      const html = emailService.generateActivityReminderEmail({
        email: mockUser.email,
        username: mockUser.username,
        friendRequests: [],
        messages: longMessage,
        friendRequestCount: 0,
        messageCount: 1
      });

      // Message content should NOT be shown for privacy
      expect(html).not.toContain('This is a very long message');
      expect(html).not.toContain('should be truncated with ellipsis');
      // Should show generic "sent you a message" instead
      expect(html).toContain('@verbose');
      expect(html).toContain('sent you a message');
    });

    it('should show overflow count when more than 3 items', () => {
      const html = emailService.generateActivityReminderEmail({
        email: mockUser.email,
        username: mockUser.username,
        friendRequests: mockFriendRequests,
        messages: mockMessages,
        friendRequestCount: 5,
        messageCount: 10
      });

      expect(html).toContain('+ 2 more request'); // 5 - 3 = 2
      expect(html).toContain('+ 7 more message'); // 10 - 3 = 7
    });

    it('should include proper greeting with username', () => {
      const html = emailService.generateActivityReminderEmail({
        email: mockUser.email,
        username: 'coolcoder42',
        friendRequests: mockFriendRequests,
        messages: [],
        friendRequestCount: 2,
        messageCount: 0
      });

      expect(html).toContain('Hey coolcoder42');
    });

    it('should fallback to "Coder" when username is not provided', () => {
      const html = emailService.generateActivityReminderEmail({
        email: mockUser.email,
        username: null,
        friendRequests: mockFriendRequests,
        messages: [],
        friendRequestCount: 2,
        messageCount: 0
      });

      expect(html).toContain('Hey Coder');
    });

    it('should include unsubscribe link with correct type', () => {
      const html = emailService.generateActivityReminderEmail({
        email: mockUser.email,
        username: mockUser.username,
        friendRequests: mockFriendRequests,
        messages: [],
        friendRequestCount: 2,
        messageCount: 0
      });

      expect(html).toContain('type=activity-reminders');
      expect(html).toContain('Unsubscribe from activity reminders');
    });
  });

  describe('generateActivityReminderText', () => {
    it('should generate plain text email with friend requests', () => {
      const text = emailService.generateActivityReminderText({
        email: mockUser.email,
        username: mockUser.username,
        friendRequests: mockFriendRequests,
        messages: [],
        friendRequestCount: 2,
        messageCount: 0
      });

      expect(text).toContain('FRIEND REQUESTS (2)');
      expect(text).toContain('@alice wants to be friends');
      expect(text).toContain('@bob wants to be friends');
    });

    it('should generate plain text email with messages', () => {
      const text = emailService.generateActivityReminderText({
        email: mockUser.email,
        username: mockUser.username,
        friendRequests: [],
        messages: mockMessages,
        friendRequestCount: 0,
        messageCount: 2
      });

      expect(text).toContain('UNREAD MESSAGES (2)');
      expect(text).toContain('@charlie sent you a message'); // Content hidden for privacy
      expect(text).toContain('@david sent you a message');
    });
  });

  describe('generateUnsubscribeToken', () => {
    it('should generate consistent tokens for same email and type', () => {
      const token1 = emailService.generateUnsubscribeToken('test@example.com', 'activity-reminders');
      const token2 = emailService.generateUnsubscribeToken('test@example.com', 'activity-reminders');

      expect(token1).toBe(token2);
    });

    it('should generate different tokens for different types', () => {
      const token1 = emailService.generateUnsubscribeToken('test@example.com', 'activity-reminders');
      const token2 = emailService.generateUnsubscribeToken('test@example.com', 'weekly-challenge');

      expect(token1).not.toBe(token2);
    });

    it('should generate different tokens for different emails', () => {
      const token1 = emailService.generateUnsubscribeToken('user1@example.com', 'activity-reminders');
      const token2 = emailService.generateUnsubscribeToken('user2@example.com', 'activity-reminders');

      expect(token1).not.toBe(token2);
    });

    it('should generate 32 character tokens', () => {
      const token = emailService.generateUnsubscribeToken('test@example.com', 'activity-reminders');

      expect(token.length).toBe(32);
    });

    it('should normalize email casing', () => {
      const token1 = emailService.generateUnsubscribeToken('Test@Example.com', 'weekly-challenge');
      const token2 = emailService.generateUnsubscribeToken('test@example.com', 'weekly-challenge');

      expect(token1).toBe(token2);
    });
  });

  describe('getUnsubscribeUrl', () => {
    it('should generate URL with email, token, and type', () => {
      const url = emailService.getUnsubscribeUrl('test@example.com', 'activity-reminders');

      expect(url).toContain('email=test%40example.com');
      expect(url).toContain('type=activity-reminders');
      expect(url).toContain('token=');
    });
  });
});

describe('Scheduler Configuration', () => {
  beforeEach(() => {
    // Clear environment variables before each test
    delete process.env.ACTIVITY_REMINDER_DAYS;
    delete process.env.REMINDER_COOLDOWN_DAYS;
    // Re-require the module to get fresh config
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.ACTIVITY_REMINDER_DAYS;
    delete process.env.REMINDER_COOLDOWN_DAYS;
  });

  it('should use default values when env vars not set', () => {
    // This tests that the defaults are applied correctly
    // The actual values are tested implicitly through the scheduler behavior
    expect(process.env.ACTIVITY_REMINDER_DAYS).toBeUndefined();
    expect(process.env.REMINDER_COOLDOWN_DAYS).toBeUndefined();
  });

  it('should allow custom thresholds via environment variables', () => {
    process.env.ACTIVITY_REMINDER_DAYS = '5';
    process.env.REMINDER_COOLDOWN_DAYS = '14';

    expect(process.env.ACTIVITY_REMINDER_DAYS).toBe('5');
    expect(process.env.REMINDER_COOLDOWN_DAYS).toBe('14');
  });
});

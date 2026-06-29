/**
 * Notification Preference Tests
 *
 * Verifies the unsubscribe end-to-end flow: a user toggle / email-link click
 * actually persists, and the send-side subscriber queries honor the result.
 *
 * Scenarios cover the bugs fixed in this branch:
 *   - unsubscribeFromWeeklyChallenge previously omitted messageDigest and the
 *     setEmailPreferences default flipped it back to opted-in.
 *   - The changelog "Unsubscribe" link (type=marketing) must surface in the
 *     settings UI: getEmailPreferences -> marketing=0 after unsub.
 */

const db = require('../db');

const TEST_EMAIL_PREFIX = 'notifprefs+';
const TEST_EMAIL = `${TEST_EMAIL_PREFIX}notification-fixture@example.test`;

async function cleanupTestUsers() {
  await db.run(
    `DELETE FROM user_email_preferences WHERE user_id IN
       (SELECT id FROM users WHERE email LIKE ?)`,
    [`${TEST_EMAIL_PREFIX}%`]
  );
  await db.run('DELETE FROM users WHERE email LIKE ?', [`${TEST_EMAIL_PREFIX}%`]);
}

describe('Notification preferences — unsubscribe flow', () => {
  let userId;

  beforeAll(async () => {
    await db.init();
    await cleanupTestUsers();
    const user = await db.createUser(TEST_EMAIL, 'hashed_password', 'notifprefs_user');
    userId = user.id;
    // Mark email_verified so changelog/marketing subscriber queries include the user.
    await db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [userId]);
  });

  afterAll(async () => {
    await cleanupTestUsers();
  });

  beforeEach(async () => {
    await db.run('DELETE FROM user_email_preferences WHERE user_id = ?', [userId]);
  });

  describe('setEmailPreferences (PUT /api/notifications/preferences)', () => {
    it('upserts every bulk field on insert', async () => {
      await db.setEmailPreferences(userId, {
        weeklyChallenge: false,
        marketing: true,
        progressDigest: false,
        tournamentNotifications: true,
        messageDigest: false
      });

      const prefs = await db.getEmailPreferences(userId);
      expect(prefs.weekly_challenge).toBe(0);
      expect(prefs.marketing).toBe(1);
      expect(prefs.progress_digest).toBe(0);
      expect(prefs.tournament_notifications).toBe(1);
      expect(prefs.message_digest).toBe(0);
    });

    it('overwrites existing row on update', async () => {
      await db.setEmailPreferences(userId, {
        weeklyChallenge: true, marketing: true, progressDigest: true,
        tournamentNotifications: true, messageDigest: true
      });
      await db.setEmailPreferences(userId, {
        weeklyChallenge: false, marketing: false, progressDigest: false,
        tournamentNotifications: false, messageDigest: false
      });

      const prefs = await db.getEmailPreferences(userId);
      expect(prefs.weekly_challenge).toBe(0);
      expect(prefs.marketing).toBe(0);
      expect(prefs.message_digest).toBe(0);
    });
  });

  describe('unsubscribeFromWeeklyChallenge (the messageDigest-wipe bug)', () => {
    it('does NOT re-enable messageDigest when user had previously unsubbed it', async () => {
      // User unsubbed message digest first.
      await db.setEmailPreferences(userId, {
        weeklyChallenge: true, marketing: true, progressDigest: true,
        tournamentNotifications: true, messageDigest: false
      });
      expect((await db.getEmailPreferences(userId)).message_digest).toBe(0);

      // Then clicks Unsubscribe in a weekly-challenge email.
      await db.unsubscribeFromWeeklyChallenge(userId);

      const prefs = await db.getEmailPreferences(userId);
      expect(prefs.weekly_challenge).toBe(0);
      expect(prefs.message_digest).toBe(0); // regression guard: must NOT be 1
    });

    it('preserves other prefs (marketing, progress, tournaments)', async () => {
      await db.setEmailPreferences(userId, {
        weeklyChallenge: true, marketing: false, progressDigest: false,
        tournamentNotifications: true, messageDigest: true
      });

      await db.unsubscribeFromWeeklyChallenge(userId);

      const prefs = await db.getEmailPreferences(userId);
      expect(prefs.weekly_challenge).toBe(0);
      expect(prefs.marketing).toBe(0);
      expect(prefs.progress_digest).toBe(0);
      expect(prefs.tournament_notifications).toBe(1);
      expect(prefs.message_digest).toBe(1);
    });
  });

  describe('unsubscribeFromMarketing (changelog email link)', () => {
    it('flips marketing to 0 and leaves other prefs untouched', async () => {
      await db.setEmailPreferences(userId, {
        weeklyChallenge: true, marketing: true, progressDigest: true,
        tournamentNotifications: true, messageDigest: true
      });

      await db.unsubscribeFromMarketing(userId);

      const prefs = await db.getEmailPreferences(userId);
      expect(prefs.marketing).toBe(0);
      expect(prefs.weekly_challenge).toBe(1);
      expect(prefs.progress_digest).toBe(1);
      expect(prefs.tournament_notifications).toBe(1);
      expect(prefs.message_digest).toBe(1);
    });

    it('creates a row with marketing=0 when no prefs exist yet', async () => {
      // No pref row at all.
      expect(await db.getEmailPreferences(userId)).toBeUndefined();

      await db.unsubscribeFromMarketing(userId);

      const prefs = await db.getEmailPreferences(userId);
      expect(prefs).toBeDefined();
      expect(prefs.marketing).toBe(0);
    });
  });

  describe('Send-side subscriber queries honor unsubscribes', () => {
    it('getWeeklyChallengeSubscribers excludes user after weekly-challenge unsub', async () => {
      await db.unsubscribeFromWeeklyChallenge(userId);
      const subs = await db.getWeeklyChallengeSubscribers();
      expect(subs.find(s => s.id === userId)).toBeUndefined();
    });

    it('getMarketingSubscribers excludes user after marketing unsub (changelog path)', async () => {
      // Required for the marketing JOIN path: user must have a row with marketing=1
      // to appear, or marketing=0 to be excluded.
      await db.setEmailPreferences(userId, {
        weeklyChallenge: true, marketing: true, progressDigest: true,
        tournamentNotifications: true, messageDigest: true
      });
      expect((await db.getMarketingSubscribers()).find(s => s.id === userId)).toBeDefined();

      await db.unsubscribeFromMarketing(userId);
      expect((await db.getMarketingSubscribers()).find(s => s.id === userId)).toBeUndefined();
    });

    it('changelog subscriber query (LEFT JOIN, NULL=opted-in) excludes after marketing=0', async () => {
      // Mirrors backend/services/email.js:sendWeeklyChangelogToAll and
      // backend/routes/notifications.js POST /send-changelog.
      const changelogQuery = `
        SELECT u.id FROM users u
        LEFT JOIN user_email_preferences uep ON u.id = uep.user_id
        WHERE u.email IS NOT NULL AND u.email != '' AND u.email_verified = 1
          AND (uep.marketing IS NULL OR uep.marketing = 1)
          AND u.id = ?
      `;

      // Before any prefs: NULL marketing -> included.
      let rows = await db.all(changelogQuery, [userId]);
      expect(rows.length).toBe(1);

      // After clicking changelog unsubscribe link: marketing=0 -> excluded.
      await db.unsubscribeFromMarketing(userId);
      rows = await db.all(changelogQuery, [userId]);
      expect(rows.length).toBe(0);
    });
  });

  describe('Settings-page reflection (GET /preferences mapping)', () => {
    // Mirrors the projection in backend/routes/notifications.js GET /preferences.
    const mapToFrontend = (prefs) => ({
      weeklyChallenge: !!prefs.weekly_challenge,
      marketing: !!prefs.marketing,
      progressDigest: prefs.progress_digest !== 0,
      tournamentNotifications: !!prefs.tournament_notifications,
      activityReminders: prefs.activity_reminders !== 0,
      creatorArenaEmails: prefs.creator_arena_emails !== 0,
      messageDigest: prefs.message_digest !== 0
    });

    it('after changelog unsub, settings shows Product Updates as OFF', async () => {
      await db.setEmailPreferences(userId, {
        weeklyChallenge: true, marketing: true, progressDigest: true,
        tournamentNotifications: true, messageDigest: true
      });

      await db.unsubscribeFromMarketing(userId);
      const ui = mapToFrontend(await db.getEmailPreferences(userId));

      expect(ui.marketing).toBe(false);
      // Sanity: nothing else flipped.
      expect(ui.weeklyChallenge).toBe(true);
      expect(ui.messageDigest).toBe(true);
    });

    it('after weekly-challenge unsub, messageDigest stays OFF if user had unsubbed it', async () => {
      await db.setEmailPreferences(userId, {
        weeklyChallenge: true, marketing: true, progressDigest: true,
        tournamentNotifications: true, messageDigest: false
      });

      await db.unsubscribeFromWeeklyChallenge(userId);
      const ui = mapToFrontend(await db.getEmailPreferences(userId));

      expect(ui.weeklyChallenge).toBe(false);
      expect(ui.messageDigest).toBe(false); // the bug we fixed
    });
  });
});

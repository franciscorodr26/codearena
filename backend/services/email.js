/**
 * Email Service for CodeArena
 * Uses Resend for transactional emails
 */

const { Resend } = require('resend');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { SECRET } = require('../config/jwt');
const { FRONTEND_URL, BACKEND_URL } = require('../config/appUrls');
const { getEmailLogoHtml, getEmailLogoInline } = require('./emailLogo');

// Initialize Resend with API key from environment
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const BASE_URL = FRONTEND_URL;

// Backend API URL, used for RFC 8058 one-click unsubscribe (the List-Unsubscribe
// header MUST resolve to an endpoint that accepts POST with no further user
// interaction). The frontend /unsubscribe page is fine for the visible footer
// link but Gmail/Outlook never render an HTML page, they POST directly.
/**
 * Generate unsubscribe token for email (one-click unsubscribe)
 * Uses HMAC to create a secure, non-guessable token
 */
function generateUnsubscribeToken(email, type = 'weekly-challenge') {
  const data = `${String(email).toLowerCase()}:${type}`;
  return crypto.createHmac('sha256', SECRET).update(data).digest('hex').substring(0, 32);
}

/**
 * Generate the human-visible unsubscribe URL for the email footer.
 * Points at the frontend so the user sees a confirmation page.
 */
function getUnsubscribeUrl(email, type = 'weekly-challenge') {
  const token = generateUnsubscribeToken(email, type);
  return `${BASE_URL}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}&type=${type}`;
}

/**
 * Generate the RFC 8058 List-Unsubscribe URL.
 * Points at the BACKEND so Gmail/Outlook's one-click POST hits an API
 * endpoint that can act on it without rendering an HTML page.
 */
function getListUnsubscribeUrl(email, type = 'weekly-challenge') {
  const token = generateUnsubscribeToken(email, type);
  return `${BACKEND_URL}/api/notifications/unsubscribe?email=${encodeURIComponent(email)}&token=${token}&type=${type}`;
}

// Default from address (must be verified in Resend)
// Production should use EMAIL_FROM=CodeArena <noreply@codearena.co>
const FROM_EMAIL = process.env.EMAIL_FROM || process.env.FROM_EMAIL || 'CodeArena <onboarding@resend.dev>';

// CAN-SPAM physical mailing address. Required by law in any commercial email footer.
// Set COMPANY_ADDRESS in env (e.g., "CodeArena, Inc., 123 Main St, San Francisco, CA 94101").
const COMPANY_ADDRESS = process.env.COMPANY_ADDRESS || 'CodeArena, Inc.';

/**
 * Returns the company address line for inclusion in email footers (CAN-SPAM compliance).
 */
function getCompanyAddressLine() {
  return COMPANY_ADDRESS;
}

// Startup diagnostics
if (resend) {
  logger.info(`[EMAIL] Resend configured. FROM: ${FROM_EMAIL}`);
  if (FROM_EMAIL.includes('onboarding@resend.dev')) {
    logger.warn('[EMAIL] WARNING: Using Resend sandbox (onboarding@resend.dev) - emails will ONLY deliver to the account owner email. Set EMAIL_FROM to a verified domain for production.');
  }
} else {
  logger.warn('[EMAIL] Resend NOT configured - RESEND_API_KEY missing. Emails will not be sent.');
}

/**
 * Send an email using Resend.
 * Pass `listUnsubscribe` (a fully qualified URL) to set RFC 2369 / RFC 8058 headers
 *, required for Gmail/Yahoo bulk-sender compliance. Callers should pass the
 * backend API URL (see getListUnsubscribeUrl) so the one-click POST from
 * Gmail/Outlook lands on an endpoint that can act on it without rendering HTML.
 * The visible footer link (getUnsubscribeUrl) can still point at the SPA.
 */
async function sendEmail({ to, subject, html, text, attachments, listUnsubscribe }) {
  if (!resend) {
    logger.warn('[EMAIL] Resend not configured - RESEND_API_KEY missing');
    return { success: false, error: 'Email service not configured' };
  }

  try {
    logger.info(`[EMAIL] Sending to: ${Array.isArray(to) ? to.join(', ') : to} | From: ${FROM_EMAIL} | Subject: ${subject}`);

    const emailOptions = {
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text: text || subject
    };

    if (attachments) {
      emailOptions.attachments = attachments;
    }

    if (listUnsubscribe) {
      // RFC 8058 one-click POST: Gmail/Outlook fire a POST against this URL
      // with body `List-Unsubscribe=One-Click` and do NOT follow redirects
      // or render HTML. If the caller passed a frontend SPA URL (the same
      // URL used in the visible email footer), rewrite it to the equivalent
      // backend API endpoint so the one-click POST actually unsubscribes the
      // user. The visible footer link in the HTML keeps the SPA URL so users
      // who click it get the friendly confirmation page.
      let oneClickUrl = listUnsubscribe;
      try {
        const parsed = new URL(listUnsubscribe);
        const isFrontendPage = parsed.pathname === '/unsubscribe';
        if (isFrontendPage) {
          parsed.host = (new URL(BACKEND_URL)).host;
          parsed.protocol = (new URL(BACKEND_URL)).protocol;
          parsed.pathname = '/api/notifications/unsubscribe';
          oneClickUrl = parsed.toString();
        }
      } catch (_) {
        // Malformed URL, fall back to whatever the caller passed in.
      }

      emailOptions.headers = {
        ...(emailOptions.headers || {}),
        'List-Unsubscribe': `<${oneClickUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      };
    }

    const { data, error } = await resend.emails.send(emailOptions);

    if (error) {
      logger.error('[EMAIL] Send error:', JSON.stringify(error));
      return { success: false, error: error.message };
    }

    logger.info('[EMAIL] Sent successfully:', data?.id);
    return { success: true, id: data?.id };
  } catch (err) {
    logger.error('[EMAIL] Exception:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Convert ISO week (2026-W02) to readable range format (January 6 - 12, 2026)
 */
function formatWeekDate(isoWeek) {
  try {
    // Parse ISO week format: YYYY-Www
    const match = isoWeek.match(/^(\d{4})-W(\d{2})$/);
    if (!match) return isoWeek;

    const year = parseInt(match[1]);
    const week = parseInt(match[2]);

    // Calculate the Monday of that week
    // Jan 4 is always in week 1, find the Monday of week 1
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7; // Convert Sunday (0) to 7
    const mondayOfWeek1 = new Date(jan4);
    mondayOfWeek1.setDate(jan4.getDate() - dayOfWeek + 1);

    // Add weeks to get to the target week
    const monday = new Date(mondayOfWeek1);
    monday.setDate(mondayOfWeek1.getDate() + (week - 1) * 7);

    // Get Sunday of the same week
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];

    // Format as "January 6 - 12, 2026" or "December 30 - January 5, 2026" if crossing months
    if (monday.getMonth() === sunday.getMonth()) {
      return `${months[monday.getMonth()]} ${monday.getDate()} - ${sunday.getDate()}, ${sunday.getFullYear()}`;
    } else {
      return `${months[monday.getMonth()]} ${monday.getDate()} - ${months[sunday.getMonth()]} ${sunday.getDate()}, ${sunday.getFullYear()}`;
    }
  } catch (e) {
    return isoWeek;
  }
}

/**
 * Generate HTML for weekly challenge email
 * Optimized for conversion: urgency, social proof, developer language
 */
function generateWeeklyChallengeEmail({ email, username, problem, week, challengeUrl, participantCount = 0 }) {
  const unsubscribeUrl = getUnsubscribeUrl(email, 'weekly-challenge');
  const difficultyColors = {
    Easy: '#22c55e',
    Medium: '#f59e0b',
    Hard: '#ef4444'
  };

  const difficultyColor = difficultyColors[problem.difficulty] || '#6366f1';
  const formattedWeek = formatWeekDate(week);

  // Calculate deadline (Sunday 11:59 PM UTC)
  // If today is Sunday, show next Sunday (7 days), otherwise show coming Sunday
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday
  const daysUntilSunday = dayOfWeek === 0 ? 7 : (7 - dayOfWeek);
  const deadline = new Date(now);
  deadline.setUTCDate(now.getUTCDate() + daysUntilSunday);
  const deadlineStr = deadline.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  // Social proof text
  const socialProofText = participantCount > 0
    ? `${participantCount}+ developers competing this week`
    : 'Be among the first to compete this week';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Challenge - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">

          <!-- CodeArena Logo -->
          ${getEmailLogoHtml({ align: 'center', padding: '32px 40px 0' })}

          <!-- Header with Urgency -->
          <tr>
            <td style="padding: 16px 40px 24px; text-align: center; border-bottom: 1px solid #2d2d44;">
              <div style="display: inline-block; background-color: #f59e0b20; color: #f59e0b; font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 20px; margin-bottom: 16px;">
                &#x23F0; Closes ${deadlineStr} at 11:59 PM UTC
              </div>
              <h1 style="margin: 0; font-size: 26px; font-weight: 800; color: #ffffff;">
                This Week's Challenge
              </h1>
              <p style="margin: 8px 0 0; color: #9ca3af; font-size: 14px;">
                ${formattedWeek}
              </p>
            </td>
          </tr>

          <!-- Challenge Card - Above the Fold -->
          <tr>
            <td style="padding: 24px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1e1e32; border-radius: 12px; border: 1px solid #2d2d44;">
                <tr>
                  <td style="padding: 24px; text-align: center;">
                    <div style="display: inline-block; background-color: ${difficultyColor}20; color: ${difficultyColor}; font-size: 13px; font-weight: 600; padding: 6px 16px; border-radius: 20px; margin-bottom: 16px;">
                      ${problem.difficulty} Difficulty &#x2022; One Attempt Only
                    </div>
                    <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #ffffff;">
                      Algorithm challenge. Constraints unknown.
                    </h2>
                    <p style="margin: 0; color: #9ca3af; font-size: 14px; line-height: 1.5;">
                      Problem revealed when you start. Your solution time is recorded permanently on the leaderboard.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Primary CTA -->
          <tr>
            <td style="padding: 0 40px 16px; text-align: center;">
              <a href="${challengeUrl}" style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 48px; border-radius: 12px; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4);">
                Start My Attempt &#x2192;
              </a>
            </td>
          </tr>

          <!-- Social Proof -->
          <tr>
            <td style="padding: 0 40px 32px; text-align: center;">
              <p style="margin: 0; color: #9ca3af; font-size: 13px;">
                ${socialProofText}
              </p>
            </td>
          </tr>

          <!-- What's at Stake -->
          <tr>
            <td style="padding: 24px 40px; background-color: #12121f; border-top: 1px solid #2d2d44;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="33%" style="text-align: center; padding: 8px;">
                    <div style="color: #6366f1; font-size: 20px; font-weight: 700;">&#x1F3C6;</div>
                    <div style="color: #e5e7eb; font-size: 12px; margin-top: 6px; font-weight: 600;">Leaderboard</div>
                    <div style="color: #6b7280; font-size: 11px; margin-top: 2px;">rank updates live</div>
                  </td>
                  <td width="33%" style="text-align: center; padding: 8px;">
                    <div style="color: #f59e0b; font-size: 20px; font-weight: 700;">&#x1F4CA;</div>
                    <div style="color: #e5e7eb; font-size: 12px; margin-top: 6px; font-weight: 600;">Profile stats</div>
                    <div style="color: #6b7280; font-size: 11px; margin-top: 2px;">track your progress</div>
                  </td>
                  <td width="33%" style="text-align: center; padding: 8px;">
                    <div style="color: #22c55e; font-size: 20px; font-weight: 700;">&#x23F1;</div>
                    <div style="color: #e5e7eb; font-size: 12px; margin-top: 6px; font-weight: 600;">One attempt</div>
                    <div style="color: #6b7280; font-size: 11px; margin-top: 2px;">make it count</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px; text-align: center; border-top: 1px solid #2d2d44;">
              <p style="margin: 0; color: #6b7280; font-size: 11px;">
                You're receiving this because you opted in to weekly challenge notifications.
              </p>
              <p style="margin: 6px 0 0; color: #6b7280; font-size: 11px;">
                <a href="${unsubscribeUrl}" style="color: #6366f1; text-decoration: none;">Unsubscribe</a>
                &nbsp;&middot;&nbsp;
                <a href="${BASE_URL}" style="color: #6366f1; text-decoration: none;">CodeArena</a>
                <br><span style="color:#94a3b8;font-size:12px;">${getCompanyAddressLine()}</span>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

/**
 * Generate plain text version for weekly challenge email
 * Optimized for conversion with urgency and social proof
 */
function generateWeeklyChallengeText({ email, username, problem, week, challengeUrl, participantCount = 0 }) {
  const formattedWeek = formatWeekDate(week);
  const unsubscribeUrl = getUnsubscribeUrl(email, 'weekly-challenge');

  // Calculate deadline (Sunday edge case: if today is Sunday, show next Sunday)
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 7 : (7 - dayOfWeek);
  const deadline = new Date(now);
  deadline.setUTCDate(now.getUTCDate() + daysUntilSunday);
  const deadlineStr = deadline.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  const socialProof = participantCount > 0
    ? `${participantCount}+ developers competing this week.`
    : 'Be among the first to compete.';

  return `
This Week's Challenge - ${formattedWeek}
Closes ${deadlineStr} at 11:59 PM UTC

${problem.difficulty} Difficulty | One Attempt Only

Algorithm challenge. Constraints unknown.
Problem revealed when you start. Your solution time is recorded permanently on the leaderboard.

Start your attempt: ${challengeUrl}

${socialProof}

What's at stake:
- Leaderboard rank updates live
- Track your progress on your profile
- One attempt - make it count

---
You're receiving this because you opted in to weekly challenge notifications.
Unsubscribe: ${unsubscribeUrl}
${getCompanyAddressLine()}
`.trim();
}

/**
 * Send weekly challenge notification to a user
 */
async function sendWeeklyChallengeNotification({ email, username, problem, week, participantCount = 0 }) {
  const challengeUrl = `${BASE_URL}/challenge`;
  const unsubscribeUrl = getUnsubscribeUrl(email, 'weekly-challenge');

  const html = generateWeeklyChallengeEmail({ email, username, problem, week, challengeUrl, participantCount });
  const text = generateWeeklyChallengeText({ email, username, problem, week, challengeUrl, participantCount });

  // Subject line options based on urgency
  const subjects = [
    `${problem.difficulty} Challenge: One attempt. Leaderboard closes Sunday.`,
    `New Arena Challenge (${problem.difficulty}) - ${participantCount > 0 ? `${participantCount}+ competing` : 'Prove yourself'}`,
    `This week's ${problem.difficulty} challenge is live. One shot.`
  ];

  return sendEmail({
    to: email,
    subject: subjects[0],
    html,
    text,
    listUnsubscribe: unsubscribeUrl
  });
}

/**
 * Send weekly challenge to all subscribed users
 */
async function sendWeeklyChallengeToAll(db, problem, week) {
  // Use LEFT JOIN to include users who haven't set preferences yet (default is opt-in)
  const subscribedUsers = await db.all(`
    SELECT u.id, u.email, u.username
    FROM users u
    LEFT JOIN user_email_preferences uep ON u.id = uep.user_id
    WHERE u.email IS NOT NULL AND u.email != '' AND u.email_verified = 1
      AND (uep.weekly_challenge IS NULL OR uep.weekly_challenge = 1)
  `);

  // Get participant count for social proof (use subscriber count as proxy)
  const participantCount = subscribedUsers.length;

  logger.debug(`[EMAIL] Sending weekly challenge to ${subscribedUsers.length} users`);

  const results = {
    total: subscribedUsers.length,
    sent: 0,
    failed: 0,
    errors: []
  };

  for (const user of subscribedUsers) {
    const result = await sendWeeklyChallengeNotification({
      email: user.email,
      username: user.username,
      problem,
      week,
      participantCount
    });

    if (result.success) {
      results.sent++;
    } else {
      results.failed++;
      results.errors.push({ userId: user.id, error: result.error });
    }

    // Rate limiting - wait 600ms between emails to respect Resend's 2 req/sec limit
    await new Promise(resolve => setTimeout(resolve, 600));
  }

  logger.debug(`[EMAIL] Weekly challenge sent: ${results.sent}/${results.total} successful`);
  return results;
}

/**
 * Generate HTML for weekly progress digest email (Pro users)
 */
function generateWeeklyProgressDigestEmail({ username, stats, coachUrl }) {
  const improvementColor = stats.improvement >= 0 ? '#22c55e' : '#ef4444';
  const improvementIcon = stats.improvement >= 0 ? '&#x2197;' : '&#x2198;';
  const improvementText = stats.improvement >= 0 ? `+${stats.improvement}%` : `${stats.improvement}%`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Weekly Progress - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">

          <!-- CodeArena Logo -->
          ${getEmailLogoHtml({ align: 'center', padding: '32px 40px 0' })}

          <!-- Header -->
          <tr>
            <td style="padding: 16px 40px 20px; text-align: center; border-bottom: 1px solid #2d2d44;">
              <div style="font-size: 32px; margin-bottom: 8px;">&#x1F4CA;</div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #ffffff;">
                Your Weekly Progress
              </h1>
              <p style="margin: 8px 0 0; color: #9ca3af; font-size: 14px;">
                AI Coach Summary
              </p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 40px 20px;">
              <p style="margin: 0; color: #e5e7eb; font-size: 16px; line-height: 1.6;">
                Hey ${username || 'Coder'},
              </p>
              <p style="margin: 12px 0 0; color: #9ca3af; font-size: 15px; line-height: 1.6;">
                Here's how you performed this week. Your AI Coach analyzed your coding sessions to bring you personalized insights.
              </p>
            </td>
          </tr>

          <!-- Stats Grid -->
          <tr>
            <td style="padding: 10px 40px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="padding-right: 8px;">
                    <div style="background-color: #1e1e32; border-radius: 12px; border: 1px solid #2d2d44; padding: 20px; text-align: center;">
                      <div style="color: #6366f1; font-size: 32px; font-weight: 700;">${stats.problemsSolved}</div>
                      <div style="color: #9ca3af; font-size: 13px; margin-top: 4px;">Problems Solved</div>
                    </div>
                  </td>
                  <td width="50%" style="padding-left: 8px;">
                    <div style="background-color: #1e1e32; border-radius: 12px; border: 1px solid #2d2d44; padding: 20px; text-align: center;">
                      <div style="color: #f59e0b; font-size: 32px; font-weight: 700;">${stats.battlesWon}</div>
                      <div style="color: #9ca3af; font-size: 13px; margin-top: 4px;">Battles Won</div>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top: 16px;">
                    <div style="background-color: #1e1e32; border-radius: 12px; border: 1px solid #2d2d44; padding: 20px; text-align: center;">
                      <div style="color: ${improvementColor}; font-size: 28px; font-weight: 700;">
                        ${improvementIcon} ${improvementText}
                      </div>
                      <div style="color: #9ca3af; font-size: 13px; margin-top: 4px;">vs Last Week</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- AI Insight -->
          ${stats.insight ? `
          <tr>
            <td style="padding: 10px 40px 20px;">
              <div style="background: linear-gradient(135deg, #6366f120 0%, #8b5cf620 100%); border-radius: 12px; border: 1px solid #6366f140; padding: 20px;">
                <div style="display: flex; align-items: center; margin-bottom: 12px;">
                  <span style="font-size: 20px; margin-right: 8px;">&#x1F9E0;</span>
                  <span style="color: #a5b4fc; font-size: 14px; font-weight: 600;">AI Coach Insight</span>
                </div>
                <p style="margin: 0; color: #e5e7eb; font-size: 15px; line-height: 1.6;">
                  ${stats.insight}
                </p>
              </div>
            </td>
          </tr>
          ` : ''}

          <!-- Focus Area -->
          ${stats.focusArea ? `
          <tr>
            <td style="padding: 10px 40px 20px;">
              <div style="background-color: #1e1e32; border-radius: 12px; border: 1px solid #2d2d44; padding: 20px;">
                <div style="color: #f59e0b; font-size: 13px; font-weight: 600; margin-bottom: 8px;">&#x1F3AF; THIS WEEK'S FOCUS</div>
                <p style="margin: 0; color: #e5e7eb; font-size: 15px; line-height: 1.6;">
                  ${stats.focusArea}
                </p>
              </div>
            </td>
          </tr>
          ` : ''}

          <!-- CTA Button -->
          <tr>
            <td style="padding: 10px 40px 40px; text-align: center;">
              <a href="${coachUrl}" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 40px; border-radius: 12px; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">
                View Full Analysis &#x2192;
              </a>
              <p style="margin: 16px 0 0; color: #6b7280; font-size: 13px;">
                See detailed insights from your AI Coach
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; text-align: center; border-top: 1px solid #2d2d44;">
              <p style="margin: 0; color: #6b7280; font-size: 12px;">
                You're receiving this as a CodeArena Pro member.
              </p>
              <p style="margin: 8px 0 0; color: #6b7280; font-size: 12px;">
                <a href="${BASE_URL}/settings/profile" style="color: #6366f1; text-decoration: none;">Email Preferences</a>
                &nbsp;&middot;&nbsp;
                <a href="${BASE_URL}" style="color: #6366f1; text-decoration: none;">CodeArena</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

/**
 * Generate plain text version for weekly progress digest
 */
function generateWeeklyProgressDigestText({ username, stats, coachUrl }) {
  const improvementText = stats.improvement >= 0 ? `+${stats.improvement}%` : `${stats.improvement}%`;

  return `
Your Weekly Progress - CodeArena AI Coach

Hey ${username || 'Coder'},

Here's how you performed this week:

STATS
- Problems Solved: ${stats.problemsSolved}
- Battles Won: ${stats.battlesWon}
- vs Last Week: ${improvementText}

${stats.insight ? `AI COACH INSIGHT\n${stats.insight}\n` : ''}
${stats.focusArea ? `THIS WEEK'S FOCUS\n${stats.focusArea}\n` : ''}

View your full analysis: ${coachUrl}

---
You're receiving this as a CodeArena Pro member.
Email Preferences: ${BASE_URL}/settings/profile
`.trim();
}

/**
 * Send weekly progress digest to a Pro user
 */
async function sendWeeklyProgressDigest({ email, username, stats }) {
  const coachUrl = `${BASE_URL}/coach`;

  const html = generateWeeklyProgressDigestEmail({ username, stats, coachUrl });
  const text = generateWeeklyProgressDigestText({ username, stats, coachUrl });

  return sendEmail({
    to: email,
    subject: `Your Week in Code: ${stats.problemsSolved} problems solved`,
    html,
    text
  });
}

/**
 * Generate HTML for tournament notification email
 */
function generateTournamentNotificationEmail({ email, username, tournament, registerUrl }) {
  const unsubscribeUrl = getUnsubscribeUrl(email, 'tournaments');
  const startDate = new Date(tournament.start_time);
  const formattedDate = startDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });

  const deadlineDate = new Date(tournament.registration_deadline);
  const formattedDeadline = deadlineDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Tournament - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">

          <!-- CodeArena Logo -->
          ${getEmailLogoHtml({ align: 'center', padding: '32px 40px 0' })}

          <!-- Header -->
          <tr>
            <td style="padding: 16px 40px 20px; text-align: center; border-bottom: 1px solid #2d2d44;">
              <div style="font-size: 32px; margin-bottom: 8px;">&#x1F3C6;</div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #ffffff;">
                Tournament Open!
              </h1>
              <p style="margin: 8px 0 0; color: #9ca3af; font-size: 14px;">
                Registration is now open
              </p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 40px 20px;">
              <p style="margin: 0; color: #e5e7eb; font-size: 16px; line-height: 1.6;">
                Hey ${username || 'Coder'},
              </p>
              <p style="margin: 12px 0 0; color: #9ca3af; font-size: 15px; line-height: 1.6;">
                A new tournament is open for registration! Compete against other coders in bracket-style elimination matches.
              </p>
            </td>
          </tr>

          <!-- Tournament Card -->
          <tr>
            <td style="padding: 10px 40px 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1e1e32; border-radius: 12px; border: 1px solid #2d2d44;">
                <tr>
                  <td style="padding: 24px;">
                    ${tournament.is_pro_only ? `
                    <div style="display: inline-block; background: linear-gradient(135deg, #f59e0b20, #6366f120); color: #f59e0b; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 20px; margin-bottom: 12px; border: 1px solid #f59e0b40;">
                      PRO ONLY
                    </div>
                    ` : ''}
                    <h2 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #ffffff;">
                      ${tournament.name}
                    </h2>
                    ${tournament.description ? `
                    <p style="margin: 0 0 16px; color: #9ca3af; font-size: 14px; line-height: 1.6;">
                      ${tournament.description}
                    </p>
                    ` : ''}

                    <!-- Tournament Details -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 16px;">
                      <tr>
                        <td width="50%" style="padding: 8px 0;">
                          <div style="color: #6b7280; font-size: 12px; text-transform: uppercase;">Start Time</div>
                          <div style="color: #e5e7eb; font-size: 14px; margin-top: 2px;">${formattedDate}</div>
                        </td>
                        <td width="50%" style="padding: 8px 0;">
                          <div style="color: #6b7280; font-size: 12px; text-transform: uppercase;">Players</div>
                          <div style="color: #e5e7eb; font-size: 14px; margin-top: 2px;">${tournament.participant_count || 0} / ${tournament.max_players}</div>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding: 8px 0;">
                          <div style="color: #6b7280; font-size: 12px; text-transform: uppercase;">Format</div>
                          <div style="color: #e5e7eb; font-size: 14px; margin-top: 2px;">Single Elimination</div>
                        </td>
                        <td width="50%" style="padding: 8px 0;">
                          <div style="color: #6b7280; font-size: 12px; text-transform: uppercase;">Register By</div>
                          <div style="color: #f59e0b; font-size: 14px; margin-top: 2px;">${formattedDeadline}</div>
                        </td>
                      </tr>
                    </table>

                    ${tournament.prize_description ? `
                    <div style="margin-top: 16px; padding: 12px; background-color: #f59e0b10; border-radius: 8px; border: 1px solid #f59e0b30;">
                      <div style="display: flex; align-items: center;">
                        <span style="font-size: 18px; margin-right: 8px;">&#x2B50;</span>
                        <span style="color: #f59e0b; font-size: 14px; font-weight: 500;">${tournament.prize_description}</span>
                      </div>
                    </div>
                    ` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 40px 40px; text-align: center;">
              <a href="${registerUrl}" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 40px; border-radius: 12px; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">
                Register Now &#x2192;
              </a>
              <p style="margin: 16px 0 0; color: #6b7280; font-size: 13px;">
                Spots are limited - secure your place!
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; text-align: center; border-top: 1px solid #2d2d44;">
              <p style="margin: 0; color: #6b7280; font-size: 12px;">
                You're receiving this because you opted in to tournament notifications.
              </p>
              <p style="margin: 8px 0 0; color: #6b7280; font-size: 12px;">
                <a href="${unsubscribeUrl}" style="color: #6366f1; text-decoration: none;">Unsubscribe</a>
                &nbsp;&middot;&nbsp;
                <a href="${BASE_URL}" style="color: #6366f1; text-decoration: none;">CodeArena</a>
                <br><span style="color:#94a3b8;font-size:12px;">${getCompanyAddressLine()}</span>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

/**
 * Generate plain text version for tournament notification email
 */
function generateTournamentNotificationText({ email, username, tournament, registerUrl }) {
  const unsubscribeUrl = getUnsubscribeUrl(email, 'tournaments');
  const startDate = new Date(tournament.start_time);
  const formattedDate = startDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

  return `
New Tournament Open - CodeArena

Hey ${username || 'Coder'},

A new tournament is open for registration!

${tournament.name.toUpperCase()}
${tournament.description || ''}

DETAILS
- Start: ${formattedDate}
- Format: Single Elimination
- Players: ${tournament.participant_count || 0} / ${tournament.max_players}
${tournament.prize_description ? `- Prize: ${tournament.prize_description}` : ''}
${tournament.is_pro_only ? '- PRO MEMBERS ONLY' : ''}

Register now: ${registerUrl}

Spots are limited - secure your place!

---
You're receiving this because you opted in to tournament notifications.
Unsubscribe: ${unsubscribeUrl}
${getCompanyAddressLine()}
`.trim();
}

/**
 * Send tournament notification to a single user
 */
async function sendTournamentNotification({ email, username, tournament }) {
  // Use custom_url if provided, otherwise generate default tournament URL
  const registerUrl = tournament.custom_url || `${BASE_URL}/tournaments/${tournament.id}`;
  const unsubscribeUrl = getUnsubscribeUrl(email, 'tournaments');

  const html = generateTournamentNotificationEmail({ email, username, tournament, registerUrl });
  const text = generateTournamentNotificationText({ email, username, tournament, registerUrl });

  return sendEmail({
    to: email,
    subject: `Tournament Open: ${tournament.name}`,
    html,
    text,
    listUnsubscribe: unsubscribeUrl
  });
}

/**
 * Send tournament notification to all subscribed users
 */
async function sendTournamentNotificationToAll(db, tournament) {
  const subscribedUsers = await db.getTournamentNotificationSubscribers();

  logger.debug(`[EMAIL] Sending tournament notification to ${subscribedUsers.length} users for: ${tournament.name}`);

  const results = {
    total: subscribedUsers.length,
    sent: 0,
    failed: 0,
    errors: []
  };

  for (const user of subscribedUsers) {
    const result = await sendTournamentNotification({
      email: user.email,
      username: user.username,
      tournament
    });

    if (result.success) {
      results.sent++;
    } else {
      results.failed++;
      results.errors.push({ userId: user.id, error: result.error });
    }

    // Rate limiting - wait 600ms between emails to respect Resend's 2 req/sec limit
    await new Promise(resolve => setTimeout(resolve, 600));
  }

  logger.debug(`[EMAIL] Tournament notification sent: ${results.sent}/${results.total} successful`);
  return results;
}

// ============================================
// EMAIL CHANGE FUNCTIONS
// ============================================

/**
 * Send email verification link to the NEW email address
 */
async function sendEmailChangeVerification({ to, username, verifyUrl }) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your New Email - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #1a1a2e; border-radius: 16px; overflow: hidden;">

          <!-- CodeArena Logo -->
          ${getEmailLogoHtml({ align: 'center', padding: '32px 40px 0' })}

          <!-- Header -->
          <tr>
            <td style="padding: 16px 40px 20px; text-align: center; border-bottom: 1px solid #2d2d44;">
              <div style="font-size: 48px; margin-bottom: 8px;">&#x2709;</div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #ffffff;">
                Verify Your New Email
              </h1>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 40px 20px;">
              <p style="margin: 0; color: #e5e7eb; font-size: 16px; line-height: 1.6;">
                Hey ${username || 'there'},
              </p>
              <p style="margin: 12px 0 0; color: #9ca3af; font-size: 15px; line-height: 1.6;">
                Click the button below to confirm this email address for your CodeArena account.
              </p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 20px 40px 30px; text-align: center;">
              <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" bgcolor="#06b6d4" style="background-color: #06b6d4; border-radius: 12px; mso-padding-alt: 16px 40px;">
                    <a href="${verifyUrl}" target="_blank" style="background-color: #06b6d4; color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 12px; font-weight: 600; display: inline-block; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; mso-line-height-rule: exactly; line-height: 20px;">
                      Verify Email Address &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Link Fallback -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #12121f; border-radius: 8px; border: 1px solid #2d2d44;">
                <tr>
                  <td style="padding: 16px;">
                    <p style="margin: 0 0 8px; color: #9ca3af; font-size: 12px;">
                      Or copy and paste this link:
                    </p>
                    <p style="margin: 0; color: #22d3ee; font-size: 13px; word-break: break-all;">
                      ${verifyUrl}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Warning -->
          <tr>
            <td style="padding: 0 40px 30px; text-align: center;">
              <p style="margin: 0; color: #f59e0b; font-size: 13px;">
                &#x23F1; This link expires in 1 hour
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #12121f; border-top: 1px solid #2d2d44; text-align: center;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px;">
                If you didn't request this change, you can safely ignore this email.
              </p>
              <p style="margin: 0; color: #4b5563; font-size: 11px;">
                CodeArena - Competitive Coding Battles
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Verify Your New Email

Hey ${username || 'there'}, click this link to confirm your new email for your CodeArena account:

${verifyUrl}

This link expires in 1 hour. If you didn't request this change, you can safely ignore this email.`;

  return sendEmail({
    to,
    subject: 'Verify your new CodeArena email address',
    html,
    text
  });
}

/**
 * Send security alert to the OLD email address
 */
async function sendEmailChangeAlert({ to, username, newEmail }) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Alert - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
          ${getEmailLogoHtml({ align: 'center', padding: '32px 40px 0' })}
          <tr>
            <td style="padding: 24px 40px 40px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 16px;">&#x1F6A8;</div>
              <h1 style="color: #f59e0b; margin: 0 0 20px; font-size: 24px;">Email Change Requested</h1>
              <p style="color: #e5e7eb; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
                Hey ${username || 'there'}, someone requested to change your CodeArena email to:
              </p>
              <p style="color: #22d3ee; font-size: 18px; font-weight: bold; margin: 20px 0; padding: 12px 20px; background-color: #1e293b; border-radius: 8px; display: inline-block;">
                ${newEmail}
              </p>
              <p style="color: #94a3b8; font-size: 14px; margin: 24px 0 0;">
                If this was you, no action is needed. The change will complete once the new email is verified.
              </p>
              <p style="color: #ef4444; font-size: 14px; margin: 16px 0 0;">
                If you didn't request this, please secure your account immediately by changing your password.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px; background-color: #0f172a; text-align: center; border-top: 1px solid #2d2d44;">
              <p style="color: #64748b; font-size: 12px; margin: 0;">CodeArena - Competitive Coding Battles</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Security Alert: Email Change Requested

Hey ${username || 'there'}, someone requested to change your CodeArena email to: ${newEmail}

If this was you, no action is needed. The change will complete once the new email is verified.

If you didn't request this, please change your password immediately to secure your account.`;

  return sendEmail({
    to,
    subject: 'Security Alert: Email change requested for your CodeArena account',
    html,
    text
  });
}

/**
 * Send confirmation to both old and new email after successful change
 */
async function sendEmailChangeConfirmation({ to, username, isOldEmail = false }) {
  const message = isOldEmail
    ? "Your email address has been successfully changed. This email address is no longer associated with your account."
    : "Your email address has been successfully updated. This is now your primary email for CodeArena.";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Changed - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
          ${getEmailLogoHtml({ align: 'center', padding: '32px 40px 0' })}
          <tr>
            <td style="padding: 24px 40px 40px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 16px;">&#x2705;</div>
              <h1 style="color: #22c55e; margin: 0 0 20px; font-size: 24px;">Email Changed Successfully</h1>
              <p style="color: #e5e7eb; font-size: 16px; line-height: 1.6; margin: 0;">
                Hey ${username || 'there'}, ${message}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px; background-color: #0f172a; text-align: center; border-top: 1px solid #2d2d44;">
              <p style="color: #64748b; font-size: 12px; margin: 0;">CodeArena - Competitive Coding Battles</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Email Changed Successfully

Hey ${username || 'there'}, ${message}`;

  return sendEmail({
    to,
    subject: 'Your CodeArena email has been changed',
    html,
    text
  });
}

// ============================================
// USER REPORT NOTIFICATION
// ============================================

/**
 * Send user report notification to support email
 */
async function sendReportNotification({ reportId, reporterUsername, reportedUsername, reportedUserId, reason, description }) {
  const supportEmail = process.env.SUPPORT_EMAIL || 'support@codearena.co';
  const profileUrl = `${BASE_URL}/profile/${reportedUsername}`;

  const reasonLabels = {
    harassment: 'Harassment or Bullying',
    spam: 'Spam or Scam',
    cheating: 'Cheating in Battles',
    inappropriate_content: 'Inappropriate Content',
    impersonation: 'Impersonation',
    other: 'Other'
  };

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>New User Report - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #1a1a2e; border-radius: 16px; overflow: hidden; border: 1px solid #ef4444;">

          <!-- CodeArena Logo -->
          ${getEmailLogoHtml({ align: 'center', padding: '24px 40px 0' })}

          <!-- Header -->
          <tr>
            <td style="padding: 16px 40px; background-color: #ef444420; border-bottom: 1px solid #2d2d44;">
              <div style="display: flex; align-items: center;">
                <span style="font-size: 32px; margin-right: 16px;">&#x1F6A8;</span>
                <div>
                  <h1 style="margin: 0; font-size: 24px; color: #ef4444;">New User Report</h1>
                  <p style="margin: 4px 0 0; color: #9ca3af; font-size: 14px;">Report #${reportId}</p>
                </div>
              </div>
            </td>
          </tr>

          <!-- Report Details -->
          <tr>
            <td style="padding: 30px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #2d2d44;">
                    <span style="color: #6b7280; font-size: 13px;">Reported User</span><br/>
                    <span style="color: #ffffff; font-size: 16px; font-weight: 600;">@${reportedUsername}</span>
                    <span style="color: #6b7280; font-size: 13px;">(ID: ${reportedUserId})</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #2d2d44;">
                    <span style="color: #6b7280; font-size: 13px;">Reported By</span><br/>
                    <span style="color: #ffffff; font-size: 16px;">@${reporterUsername}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #2d2d44;">
                    <span style="color: #6b7280; font-size: 13px;">Reason</span><br/>
                    <span style="color: #f59e0b; font-size: 16px; font-weight: 500;">${reasonLabels[reason] || reason}</span>
                  </td>
                </tr>
                ${description ? `
                <tr>
                  <td style="padding: 12px 0;">
                    <span style="color: #6b7280; font-size: 13px;">Description</span><br/>
                    <div style="margin-top: 8px; padding: 12px; background-color: #12121f; border-radius: 8px; color: #e5e7eb; font-size: 14px; line-height: 1.6;">
                      ${description}
                    </div>
                  </td>
                </tr>
                ` : ''}
              </table>
            </td>
          </tr>

          <!-- Actions -->
          <tr>
            <td style="padding: 0 40px 30px; text-align: center;">
              <a href="${profileUrl}" style="display: inline-block; background-color: #6366f1; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
                View Profile &rarr;
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px; background-color: #12121f; border-top: 1px solid #2d2d44; text-align: center;">
              <p style="margin: 0; color: #6b7280; font-size: 12px;">
                CodeArena Moderation System
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `New User Report (#${reportId})

Reported User: @${reportedUsername} (ID: ${reportedUserId})
Reported By: @${reporterUsername}
Reason: ${reasonLabels[reason] || reason}
${description ? `Description: ${description}` : ''}

View Profile: ${profileUrl}`;

  return sendEmail({
    to: supportEmail,
    subject: `[Report #${reportId}] ${reasonLabels[reason] || reason} - @${reportedUsername}`,
    html,
    text
  });
}

// ============================================
// STUDENT VERIFICATION EMAIL
// ============================================

/**
 * Send email with retry logic
 * Implements exponential backoff for transient failures
 * @param {Object} emailParams - Parameters for sendEmail
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} baseDelayMs - Base delay in milliseconds for exponential backoff (default: 1000)
 * @returns {Object} - Result from sendEmail
 */
async function sendEmailWithRetry(emailParams, maxRetries = 3, baseDelayMs = 1000) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await sendEmail(emailParams);

    if (result.success) {
      if (attempt > 1) {
        logger.info(`[EMAIL] Successfully sent email on attempt ${attempt} to: ${emailParams.to}`);
      }
      return result;
    }

    lastError = result.error;

    // Don't retry on the last attempt
    if (attempt < maxRetries) {
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1); // Exponential backoff: 1s, 2s, 4s
      logger.warn(`[EMAIL] Attempt ${attempt}/${maxRetries} failed for ${emailParams.to}: ${result.error}. Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // All retries exhausted
  logger.error(`[EMAIL] All ${maxRetries} attempts failed for ${emailParams.to}. Last error: ${lastError}`);
  return { success: false, error: lastError, retriesExhausted: true };
}

/**
 * Send student verification email to confirm .edu email address
 * Uses retry logic with exponential backoff to handle transient failures
 */
async function sendStudentVerificationEmail({ to, username, verifyUrl }) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Student Status - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #1a1a2e; border-radius: 16px; overflow: hidden;">

          <!-- CodeArena Logo -->
          ${getEmailLogoHtml({ align: 'center', padding: '32px 40px 0' })}

          <!-- Header -->
          <tr>
            <td style="padding: 16px 40px 20px; text-align: center; border-bottom: 1px solid #2d2d44;">
              <div style="font-size: 48px; margin-bottom: 8px;">&#x1F393;</div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #ffffff;">
                Verify Your Student Status
              </h1>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 40px 20px;">
              <p style="margin: 0; color: #e5e7eb; font-size: 16px; line-height: 1.6;">
                Hey ${username || 'there'},
              </p>
              <p style="margin: 12px 0 0; color: #9ca3af; font-size: 15px; line-height: 1.6;">
                Click the button below to verify your student email and unlock the <strong style="color: #22c55e;">Student Plan</strong> at just <strong style="color: #22c55e;">$4.99/month</strong>!
              </p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 20px 40px 30px; text-align: center;">
              <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" bgcolor="#22c55e" style="background-color: #22c55e; border-radius: 12px; mso-padding-alt: 16px 40px;">
                    <a href="${verifyUrl}" target="_blank" style="background-color: #22c55e; color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 12px; font-weight: 600; display: inline-block; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; mso-line-height-rule: exactly; line-height: 20px;">
                      Verify Student Email &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- What you get -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <div style="background-color: #22c55e10; border: 1px solid #22c55e30; border-radius: 12px; padding: 20px;">
                <p style="margin: 0 0 12px; color: #22c55e; font-size: 14px; font-weight: 600;">
                  &#x2705; Student Plan includes:
                </p>
                <ul style="margin: 0; padding-left: 20px; color: #e5e7eb; font-size: 14px; line-height: 1.8;">
                  <li>Unlimited ranked battles</li>
                  <li>AI Coach assistance</li>
                  <li>Full stats & analytics</li>
                  <li>All Pro features at a discounted rate</li>
                </ul>
              </div>
            </td>
          </tr>

          <!-- Warning -->
          <tr>
            <td style="padding: 0 40px 30px; text-align: center;">
              <p style="margin: 0; color: #f59e0b; font-size: 13px;">
                &#x23F1; This link expires in 24 hours
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #12121f; border-top: 1px solid #2d2d44; text-align: center;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px;">
                If you didn't request this, you can safely ignore this email.
              </p>
              <p style="margin: 0; color: #4b5563; font-size: 11px;">
                CodeArena - Competitive Coding Battles
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Verify Your Student Status - CodeArena

Hey ${username || 'there'},

Click this link to verify your student email and unlock the Student Plan at just $4.99/month:

${verifyUrl}

Student Plan includes:
- Unlimited ranked battles
- AI Coach assistance
- Full stats & analytics
- All Pro features at a discounted rate

This link expires in 24 hours. If you didn't request this, you can safely ignore this email.`;

  // Use retry logic for student verification emails since the token is already
  // created in the database - we need to ensure the email actually gets delivered
  return sendEmailWithRetry({
    to,
    subject: 'Verify your student status - CodeArena',
    html,
    text
  });
}

// ============================================
// ACTIVITY REMINDER EMAIL
// ============================================

/**
 * Generate HTML for activity reminder email (pending friend requests + unread messages)
 */
function generateActivityReminderEmail({ email, username, friendRequests, messages, friendRequestCount, messageCount }) {
  const unsubscribeUrl = getUnsubscribeUrl(email, 'activity-reminders');
  const friendsUrl = `${BASE_URL}/friends`;
  const messagesUrl = `${BASE_URL}/messages`;

  // Generate friend request items HTML
  const friendRequestItemsHtml = friendRequests.slice(0, 3).map(req => `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #2d2d44;">
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td width="44" style="vertical-align: top;">
              <div style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #8b5cf6); display: flex; align-items: center; justify-content: center; overflow: hidden;">
                ${req.sender_avatar
                  ? `<img src="${req.sender_avatar}" width="40" height="40" style="border-radius: 50%;" alt="${req.sender_username}"/>`
                  : `<span style="color: white; font-weight: 600; font-size: 16px;">${(req.sender_username || 'U')[0].toUpperCase()}</span>`
                }
              </div>
            </td>
            <td style="padding-left: 12px; vertical-align: middle;">
              <span style="color: #ffffff; font-weight: 600;">@${req.sender_username}</span>
              <span style="color: #9ca3af; font-size: 13px;"> wants to be friends</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `).join('');

  // Generate message items HTML (no content preview for privacy)
  const messageItemsHtml = messages.slice(0, 3).map(msg => {
    return `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #2d2d44;">
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td width="44" style="vertical-align: top;">
              <div style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #22c55e, #16a34a); display: flex; align-items: center; justify-content: center; overflow: hidden;">
                ${msg.sender_avatar
                  ? `<img src="${msg.sender_avatar}" width="40" height="40" style="border-radius: 50%;" alt="${msg.sender_username}"/>`
                  : `<span style="color: white; font-weight: 600; font-size: 16px;">${(msg.sender_username || 'U')[0].toUpperCase()}</span>`
                }
              </div>
            </td>
            <td style="padding-left: 12px; vertical-align: middle;">
              <span style="color: #ffffff; font-weight: 600;">@${msg.sender_username}</span>
              <span style="color: #9ca3af; font-size: 13px;"> sent you a message</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You have activity waiting - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">

          <!-- CodeArena Logo -->
          ${getEmailLogoHtml({ align: 'center', padding: '32px 40px 0' })}

          <!-- Header -->
          <tr>
            <td style="padding: 16px 40px 20px; text-align: center; border-bottom: 1px solid #2d2d44;">
              <div style="font-size: 32px; margin-bottom: 8px;">&#x1F514;</div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #ffffff;">
                You've got notifications
              </h1>
              <p style="margin: 8px 0 0; color: #9ca3af; font-size: 14px;">
                Activity waiting for you on CodeArena
              </p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 40px 20px;">
              <p style="margin: 0; color: #e5e7eb; font-size: 16px; line-height: 1.6;">
                Hey ${username || 'Coder'},
              </p>
              <p style="margin: 12px 0 0; color: #9ca3af; font-size: 15px; line-height: 1.6;">
                You've got activity on CodeArena - check it out!
              </p>
            </td>
          </tr>

          ${friendRequestCount > 0 ? `
          <!-- Friend Requests Section -->
          <tr>
            <td style="padding: 10px 40px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1e1e32; border-radius: 12px; border: 1px solid #2d2d44;">
                <tr>
                  <td style="padding: 20px;">
                    <div style="display: flex; align-items: center; margin-bottom: 16px;">
                      <span style="font-size: 20px; margin-right: 10px;">&#x1F91D;</span>
                      <span style="color: #ffffff; font-size: 16px; font-weight: 600;">
                        ${friendRequestCount} Friend Request${friendRequestCount > 1 ? 's' : ''}
                      </span>
                    </div>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${friendRequestItemsHtml}
                    </table>
                    ${friendRequestCount > 3 ? `
                    <p style="margin: 12px 0 0; color: #6b7280; font-size: 13px; text-align: center;">
                      + ${friendRequestCount - 3} more request${friendRequestCount - 3 > 1 ? 's' : ''}
                    </p>
                    ` : ''}
                    <div style="text-align: center; margin-top: 16px;">
                      <a href="${friendsUrl}" style="display: inline-block; background-color: #6366f1; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 10px 24px; border-radius: 8px;">
                        View Requests &rarr;
                      </a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ''}

          ${messageCount > 0 ? `
          <!-- Messages Section -->
          <tr>
            <td style="padding: 10px 40px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1e1e32; border-radius: 12px; border: 1px solid #2d2d44;">
                <tr>
                  <td style="padding: 20px;">
                    <div style="display: flex; align-items: center; margin-bottom: 16px;">
                      <span style="font-size: 20px; margin-right: 10px;">&#x1F4AC;</span>
                      <span style="color: #ffffff; font-size: 16px; font-weight: 600;">
                        ${messageCount} Unread Message${messageCount > 1 ? 's' : ''}
                      </span>
                    </div>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${messageItemsHtml}
                    </table>
                    ${messageCount > 3 ? `
                    <p style="margin: 12px 0 0; color: #6b7280; font-size: 13px; text-align: center;">
                      + ${messageCount - 3} more message${messageCount - 3 > 1 ? 's' : ''}
                    </p>
                    ` : ''}
                    <div style="text-align: center; margin-top: 16px;">
                      <a href="${messagesUrl}" style="display: inline-block; background-color: #22c55e; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 10px 24px; border-radius: 8px;">
                        Read Messages &rarr;
                      </a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ''}

          <!-- Main CTA -->
          <tr>
            <td style="padding: 10px 40px 40px; text-align: center;">
              <a href="${BASE_URL}" style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 40px; border-radius: 12px; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4);">
                Open CodeArena &rarr;
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; text-align: center; border-top: 1px solid #2d2d44;">
              <p style="margin: 0; color: #6b7280; font-size: 12px;">
                You're receiving this because you have unread activity on CodeArena.
              </p>
              <p style="margin: 8px 0 0; color: #6b7280; font-size: 12px;">
                <a href="${unsubscribeUrl}" style="color: #6366f1; text-decoration: none;">Unsubscribe from activity reminders</a>
                &nbsp;&middot;&nbsp;
                <a href="${BASE_URL}/settings/profile" style="color: #6366f1; text-decoration: none;">Email Preferences</a>
                <br><span style="color:#94a3b8;font-size:12px;">${getCompanyAddressLine()}</span>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

/**
 * Generate plain text version for activity reminder email
 */
function generateActivityReminderText({ email, username, friendRequests, messages, friendRequestCount, messageCount }) {
  const unsubscribeUrl = getUnsubscribeUrl(email, 'activity-reminders');
  const friendsUrl = `${BASE_URL}/friends`;
  const messagesUrl = `${BASE_URL}/messages`;

  let text = `You've got notifications waiting - CodeArena

Hey ${username || 'Coder'},

You've got activity on CodeArena - check it out!

`;

  if (friendRequestCount > 0) {
    text += `FRIEND REQUESTS (${friendRequestCount})
`;
    friendRequests.slice(0, 3).forEach(req => {
      text += `- @${req.sender_username} wants to be friends
`;
    });
    if (friendRequestCount > 3) {
      text += `+ ${friendRequestCount - 3} more request(s)
`;
    }
    text += `
View requests: ${friendsUrl}

`;
  }

  if (messageCount > 0) {
    text += `UNREAD MESSAGES (${messageCount})
`;
    messages.slice(0, 3).forEach(msg => {
      text += `- @${msg.sender_username} sent you a message
`;
    });
    if (messageCount > 3) {
      text += `+ ${messageCount - 3} more message(s)
`;
    }
    text += `
Read messages: ${messagesUrl}

`;
  }

  text += `---
You're receiving this because you have unread activity on CodeArena.
Unsubscribe: ${unsubscribeUrl}
${getCompanyAddressLine()}`;

  return text.trim();
}

/**
 * Send activity reminder email to a user
 */
async function sendActivityReminderEmail({ email, username, friendRequests, messages, friendRequestCount, messageCount }) {
  const unsubscribeUrl = getUnsubscribeUrl(email, 'activity-reminders');
  const html = generateActivityReminderEmail({ email, username, friendRequests, messages, friendRequestCount, messageCount });
  const text = generateActivityReminderText({ email, username, friendRequests, messages, friendRequestCount, messageCount });

  // Build subject line based on activity
  let subject = 'You have activity waiting on CodeArena';
  if (friendRequestCount > 0 && messageCount > 0) {
    subject = `${friendRequestCount} friend request${friendRequestCount > 1 ? 's' : ''} and ${messageCount} message${messageCount > 1 ? 's' : ''} waiting`;
  } else if (friendRequestCount > 0) {
    subject = `${friendRequestCount} friend request${friendRequestCount > 1 ? 's' : ''} waiting on CodeArena`;
  } else if (messageCount > 0) {
    subject = `${messageCount} unread message${messageCount > 1 ? 's' : ''} on CodeArena`;
  }

  return sendEmail({
    to: email,
    subject,
    html,
    text,
    listUnsubscribe: unsubscribeUrl
  });
}

// ============================================
// WEEKLY MESSAGE DIGEST EMAIL
// ============================================

function generateWeeklyMessageDigestEmail({ username, senders, totalMessages }) {
  const sendersHtml = senders.map(sender => {
    const previewHtml = sender.preview.map(msg => `
      <div style="background-color: #1e1e32; border-radius: 8px; padding: 10px 14px; margin-top: 8px;">
        <p style="margin: 0; color: #d1d5db; font-size: 13px; line-height: 1.5; word-break: break-word;">${escapeHtml(msg.content.length > 120 ? msg.content.slice(0, 120) + '…' : msg.content)}</p>
        <p style="margin: 4px 0 0; color: #6b7280; font-size: 11px;">${new Date(msg.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
      </div>`).join('');

    return `
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #16213e; border-radius: 12px; border: 1px solid #2d2d44; margin-bottom: 12px;">
        <tr>
          <td style="padding: 16px 20px;">
            <div style="display: flex; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 22px; margin-right: 10px;">${sender.avatar || '👤'}</span>
              <div>
                <div style="color: #a78bfa; font-size: 15px; font-weight: 600;">${escapeHtml(sender.username)}</div>
                <div style="color: #6b7280; font-size: 12px;">${sender.message_count} message${sender.message_count !== 1 ? 's' : ''} this week</div>
              </div>
            </div>
            ${previewHtml}
          </td>
        </tr>
      </table>`;
  }).join('');

  const moreSendersNote = senders.length < totalMessages
    ? `<p style="color: #6b7280; font-size: 13px; text-align: center; margin: 0 0 24px;">...and messages from other senders.</p>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Weekly Messages - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">

          <!-- CodeArena Logo -->
          ${getEmailLogoHtml({ align: 'center', padding: '32px 40px 0' })}

          <!-- Header -->
          <tr>
            <td style="padding: 16px 40px 20px; text-align: center; border-bottom: 1px solid #2d2d44;">
              <div style="font-size: 48px; margin-bottom: 8px;">&#x1F4AC;</div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #ffffff;">Your Weekly Messages</h1>
              <p style="margin: 8px 0 0; color: #9ca3af; font-size: 14px;">You received ${totalMessages} message${totalMessages !== 1 ? 's' : ''} this week</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 40px 16px;">
              <p style="margin: 0; color: #e5e7eb; font-size: 16px; line-height: 1.6;">Hey ${escapeHtml(username || 'there')},</p>
              <p style="margin: 12px 0 0; color: #9ca3af; font-size: 15px; line-height: 1.6;">Here's a summary of the messages waiting for you on CodeArena.</p>
            </td>
          </tr>

          <!-- Message previews -->
          <tr>
            <td style="padding: 0 40px 8px;">
              ${sendersHtml}
              ${moreSendersNote}
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 8px 40px 32px; text-align: center;">
              <a href="${BASE_URL}/messages" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Reply in CodeArena
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #2d2d44; text-align: center;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px;">
                You're receiving this because you have message digest emails enabled.
              </p>
              <p style="margin: 0; color: #6b7280; font-size: 12px;">
                <a href="${BASE_URL}/settings/profile" style="color: #6b7280;">Manage preferences</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateWeeklyMessageDigestText({ username, senders, totalMessages }) {
  const lines = [
    `Your Weekly Messages, CodeArena`,
    ``,
    `Hey ${username || 'there'},`,
    ``,
    `You received ${totalMessages} message${totalMessages !== 1 ? 's' : ''} this week on CodeArena.`,
    ``
  ];

  for (const sender of senders) {
    lines.push(`From ${sender.username} (${sender.message_count} message${sender.message_count !== 1 ? 's' : ''}):`);
    for (const msg of sender.preview) {
      const preview = msg.content.length > 120 ? msg.content.slice(0, 120) + '…' : msg.content;
      lines.push(`  "${preview}"`);
    }
    lines.push('');
  }

  lines.push(`Reply here: ${BASE_URL}/messages`);
  lines.push(``);
  lines.push(`Manage preferences: ${BASE_URL}/settings/profile`);
  return lines.join('\n');
}

async function sendWeeklyMessageDigest({ email, username, senders, totalMessages }) {
  const unsubscribeUrl = getUnsubscribeUrl(email, 'message-digest');
  const html = generateWeeklyMessageDigestEmail({ username, senders, totalMessages });
  const text = generateWeeklyMessageDigestText({ username, senders, totalMessages });

  return sendEmail({
    to: email,
    subject: `You have ${totalMessages} message${totalMessages !== 1 ? 's' : ''} waiting on CodeArena`,
    html,
    text,
    listUnsubscribe: unsubscribeUrl
  });
}

// ============================================
// STUDENT EXPIRATION WARNING EMAIL
// ============================================

/**
 * Generate HTML for student verification expiration warning email
 */
function generateStudentExpirationWarningEmail({ username, daysUntilExpiry, studentEmail, reverifyUrl }) {
  const urgencyColor = daysUntilExpiry <= 7 ? '#ef4444' : '#f59e0b';
  const urgencyText = daysUntilExpiry <= 7 ? 'Expires very soon!' : 'Expiring soon';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Student Verification Expiring - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">

          <!-- CodeArena Logo -->
          ${getEmailLogoHtml({ align: 'center', padding: '32px 40px 0' })}

          <!-- Header -->
          <tr>
            <td style="padding: 16px 40px 20px; text-align: center; border-bottom: 1px solid #2d2d44;">
              <div style="font-size: 48px; margin-bottom: 8px;">&#x1F393;</div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #ffffff;">
                Student Plan Expiring Soon
              </h1>
              <p style="margin: 8px 0 0; color: ${urgencyColor}; font-size: 14px; font-weight: 600;">
                ${urgencyText}
              </p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 40px 20px;">
              <p style="margin: 0; color: #e5e7eb; font-size: 16px; line-height: 1.6;">
                Hey ${username || 'there'},
              </p>
              <p style="margin: 12px 0 0; color: #9ca3af; font-size: 15px; line-height: 1.6;">
                Your student verification for CodeArena is expiring in <strong style="color: ${urgencyColor};">${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}</strong>.
              </p>
            </td>
          </tr>

          <!-- Current Status Card -->
          <tr>
            <td style="padding: 10px 40px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1e1e32; border-radius: 12px; border: 1px solid #2d2d44;">
                <tr>
                  <td style="padding: 24px;">
                    <div style="color: #6b7280; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Current Student Email</div>
                    <div style="color: #22c55e; font-size: 16px; font-weight: 600;">${studentEmail}</div>
                    <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #2d2d44;">
                      <div style="color: #6b7280; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Expires In</div>
                      <div style="color: ${urgencyColor}; font-size: 24px; font-weight: 700;">${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- What happens -->
          <tr>
            <td style="padding: 10px 40px 20px;">
              <div style="background-color: #f59e0b10; border: 1px solid #f59e0b30; border-radius: 12px; padding: 20px;">
                <p style="margin: 0 0 12px; color: #f59e0b; font-size: 14px; font-weight: 600;">
                  &#x26A0;&#xFE0F; What happens when it expires?
                </p>
                <ul style="margin: 0; padding-left: 20px; color: #e5e7eb; font-size: 14px; line-height: 1.8;">
                  <li>Your student discount will be removed</li>
                  <li>You'll be switched to regular Pro pricing ($9/month)</li>
                  <li>You can re-verify anytime with a valid .edu email</li>
                </ul>
              </div>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 10px 40px 40px; text-align: center;">
              <a href="${reverifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 40px; border-radius: 12px; box-shadow: 0 4px 14px rgba(34, 197, 94, 0.4);">
                Re-verify Student Status &rarr;
              </a>
              <p style="margin: 16px 0 0; color: #6b7280; font-size: 13px;">
                Keep your $4.99/month student rate!
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; text-align: center; border-top: 1px solid #2d2d44;">
              <p style="margin: 0; color: #6b7280; font-size: 12px;">
                Student verification is required annually to maintain student pricing.
              </p>
              <p style="margin: 8px 0 0; color: #6b7280; font-size: 12px;">
                <a href="${BASE_URL}/settings/profile" style="color: #6366f1; text-decoration: none;">Account Settings</a>
                &nbsp;&middot;&nbsp;
                <a href="${BASE_URL}" style="color: #6366f1; text-decoration: none;">CodeArena</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

/**
 * Generate plain text version for student verification expiration warning email
 */
function generateStudentExpirationWarningText({ username, daysUntilExpiry, studentEmail, reverifyUrl }) {
  return `
Student Plan Expiring Soon - CodeArena

Hey ${username || 'there'},

Your student verification for CodeArena is expiring in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}.

CURRENT STATUS
- Student Email: ${studentEmail}
- Expires In: ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}

WHAT HAPPENS WHEN IT EXPIRES?
- Your student discount will be removed
- You'll be switched to regular Pro pricing ($9/month)
- You can re-verify anytime with a valid .edu email

Re-verify your student status to keep your $4.99/month rate:
${reverifyUrl}

---
Student verification is required annually to maintain student pricing.
Account Settings: ${BASE_URL}/settings/profile
`.trim();
}

/**
 * Send student verification expiration warning email
 */
async function sendStudentExpirationWarningEmail({ email, username, daysUntilExpiry, studentEmail }) {
  const reverifyUrl = `${BASE_URL}/settings/profile`;

  const html = generateStudentExpirationWarningEmail({ username, daysUntilExpiry, studentEmail, reverifyUrl });
  const text = generateStudentExpirationWarningText({ username, daysUntilExpiry, studentEmail, reverifyUrl });

  return sendEmail({
    to: email,
    subject: `Your student verification expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'} - CodeArena`,
    html,
    text
  });
}

/**
 * Generate weekly changelog email HTML (CodeArena branded)
 * @param {object} options
 * @param {string} options.username - User's display name
 * @param {string[]} options.changes - Array of changelog entries
 * @param {string} options.unsubscribeUrl - Unsubscribe link
 */
function generateWeeklyChangelogEmail({ username, changes, unsubscribeUrl }) {
  // Check if a change starts with an emoji (category prefix)
  const startsWithEmoji = (text) => /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}]/u.test(text);

  const changesHtml = changes.map(change => {
    // If the change already has an emoji prefix, don't add the green "+"
    const prefix = startsWithEmoji(change)
      ? ''
      : '<span style="color: #22C55E; margin-right: 10px; font-weight: bold;">+</span>';

    return `
    <tr>
      <td style="padding: 12px 16px; color: #E0E0E0; font-size: 15px; line-height: 1.5;">
        ${prefix}${change}
      </td>
    </tr>
  `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>What's New in the Arena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090B; font-family: 'SF Mono', 'Fira Code', 'Monaco', 'Inconsolata', monospace;">
  <!-- Preview text (shows in inbox) -->
  <div style="display: none; max-height: 0; overflow: hidden;">
    New features just dropped: ${changes.slice(0, 2).map(c => c.replace(/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]\s*/u, '')).join(', ')}
  </div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #09090B;">
    <tr>
      <td align="center" style="padding: 48px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width: 560px;">

          <!-- Header with Logo -->
          <tr>
            <td style="padding-bottom: 40px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td>
                    ${getEmailLogoInline({ iconSize: 28, wordmarkColor: '#FAFAFA' })}
                  </td>
                  <td align="right">
                    <span style="color: #52525B; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Weekly Update</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Heading -->
          <tr>
            <td style="padding-bottom: 16px;">
              <h1 style="margin: 0; color: #FAFAFA; font-size: 28px; font-weight: 700; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
                Changelog Time!
              </h1>
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding-bottom: 28px; color: #A1A1AA; font-size: 15px; line-height: 1.6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
              Hey ${username || 'there'},<br><br>
              We've been shipping. Here's what's new this week:
            </td>
          </tr>

          <!-- Changes List (terminal-style) -->
          <tr>
            <td style="padding: 0; background-color: #18181B; border-radius: 8px; border: 1px solid #27272A; overflow: hidden;">
              <!-- Terminal header -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="padding: 12px 16px; background-color: #27272A; border-bottom: 1px solid #3F3F46;">
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #EF4444; margin-right: 6px;"></span>
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #F59E0B; margin-right: 6px;"></span>
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #22C55E; margin-right: 6px;"></span>
                    <span style="color: #71717A; font-size: 12px; margin-left: 8px;">changelog.diff</span>
                  </td>
                </tr>
              </table>
              <!-- Changes content -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                ${changesHtml}
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td align="center" style="padding: 36px 0;">
              <a href="${BASE_URL}/battle" style="display: inline-block; background-color: #FAFAFA; color: #09090B; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
                Jump into a Battle
              </a>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding-top: 24px; color: #71717A; font-size: 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
              Happy coding,<br>
              <span style="color: #A1A1AA;">The CodeArena Team</span>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top: 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <!-- Social Links -->
                <tr>
                  <td align="center" style="padding-bottom: 20px;">
                    <a href="https://www.linkedin.com/company/codearenateam/" style="display: inline-block; margin: 0 8px; text-decoration: none;">
                      <img src="https://cdn-icons-png.flaticon.com/512/174/174857.png" alt="LinkedIn" width="24" height="24" style="display: block;">
                    </a>
                    <a href="https://discord.gg/Tw7cA7YZsG" style="display: inline-block; margin: 0 8px; text-decoration: none;">
                      <img src="https://cdn-icons-png.flaticon.com/512/5968/5968756.png" alt="Discord" width="24" height="24" style="display: block;">
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="color: #71717A; font-size: 12px; line-height: 1.6;">
                    Follow us on <a href="https://www.linkedin.com/company/codearenateam/" style="color: #0A66C2; text-decoration: none; font-weight: 500;">LinkedIn</a> · Join our <a href="https://discord.gg/Tw7cA7YZsG" style="color: #5865F2; text-decoration: none; font-weight: 500;">Discord</a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 16px; color: #3F3F46; font-size: 11px;">
                    <a href="${unsubscribeUrl}" style="color: #3F3F46; text-decoration: underline;">Unsubscribe</a> &bull; CodeArena, Inc.
                    <br><span style="color:#94a3b8;font-size:12px;">${getCompanyAddressLine()}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate weekly changelog plain text email
 * @param {object} options
 * @param {string} options.username - User's display name
 * @param {string[]} options.changes - Array of changelog entries
 * @param {string} options.unsubscribeUrl - Unsubscribe link
 */
function generateWeeklyChangelogText({ username, changes, unsubscribeUrl }) {
  // Check if a change starts with an emoji (category prefix)
  const startsWithEmoji = (text) => /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}]/u.test(text);

  const changesList = changes.map(change => {
    // If the change already has an emoji prefix, don't add the "+"
    return startsWithEmoji(change) ? change : `+ ${change}`;
  }).join('\n');

  return `
CHANGELOG TIME!
===============

Hey ${username || 'there'},

Here's a summary of what we shipped this week:

${changesList}

Check it out: ${BASE_URL}/battle

---

Happy coding,
The CodeArena Team

Follow us on LinkedIn: https://www.linkedin.com/company/codearenateam/
Join our Discord: https://discord.gg/Tw7cA7YZsG

Unsubscribe: ${unsubscribeUrl}
${getCompanyAddressLine()}
`.trim();
}

/**
 * Send weekly changelog email to a single user
 * @param {object} options
 * @param {string} options.email - Recipient email address
 * @param {string} options.username - User's display name
 * @param {number} options.userId - Recipient user ID
 * @param {string[]} options.changes - Array of changelog entries
 */
async function sendWeeklyChangelogEmail({ email, username, userId, changes }) {
  // Changelog / product-update emails are marketing email under CAN-SPAM, so the
  // unsubscribe link must map to the `marketing` preference, NOT weekly-challenge.
  const unsubscribeUrl = getUnsubscribeUrl(email, 'marketing');

  const html = generateWeeklyChangelogEmail({ username, changes, unsubscribeUrl });
  const text = generateWeeklyChangelogText({ username, changes, unsubscribeUrl });

  // Generate short, punchy subject line
  const cleanChanges = changes.slice(0, 2).map(c => {
    let clean = c.replace(/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]\s*/u, '').trim();
    // Extract first key phrase (before comma)
    clean = clean.split(',')[0].trim();
    if (clean.length > 20) clean = clean.substring(0, 20).replace(/\s+\S*$/, '');
    return clean;
  });
  const subject = `What's new: ${cleanChanges.join(', ')}${changes.length > 2 ? ' & more' : ''}`;

  return sendEmail({
    to: email,
    subject: subject,
    html,
    text,
    listUnsubscribe: unsubscribeUrl
  });
}

/**
 * Send weekly changelog to all marketing subscribers
 * @param {object} db - Database module with getMarketingSubscribers()
 * @param {string[]} changes - Array of change descriptions
 * @param {boolean} dryRun - If true, just return count without sending
 */
async function sendWeeklyChangelogToAll(db, changes, dryRun = false) {
  // Send to all verified users EXCEPT those who explicitly opted out of marketing.
  // Changelog is a marketing/product-update email, so marketing = 0 must be excluded.
  // NULL = no preference set yet = include (preserves reach for users without prefs).
  const subscribers = await db.all(`
    SELECT u.id, u.email, u.username
    FROM users u
    LEFT JOIN user_email_preferences uep ON u.id = uep.user_id
    WHERE u.email IS NOT NULL AND u.email != '' AND u.email_verified = 1
      AND (uep.marketing IS NULL OR uep.marketing = 1)
  `);

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      subscriberCount: subscribers.length,
      changes
    };
  }

  // Per-changelog idempotency: derive a stable notification_type from the
  // content hash of `changes`. tryRecordOneTimeNotification(userId, type)
  // uses INSERT OR IGNORE against the (user_id, notification_type) unique
  // index, returns true iff the row was new, so we send to each user at
  // most once per identical changelog content. A retried admin call with
  // the same changes is a no-op; a new changelog produces a different hash
  // and sends again.
  const changesHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(changes))
    .digest('hex')
    .substring(0, 16);
  const notificationType = `changelog:${changesHash}`;

  const results = {
    total: subscribers.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    changesHash,
    errors: []
  };

  for (const subscriber of subscribers) {
    // Atomic claim, only one caller across any number of cron ticks or
    // admin retries can win this for each (user, changelog).
    const isFirstSend = await db.tryRecordOneTimeNotification(
      subscriber.id,
      notificationType,
      { changesHash, sentAt: new Date().toISOString() }
    );
    if (!isFirstSend) {
      results.skipped++;
      continue;
    }

    try {
      await sendWeeklyChangelogEmail({
        email: subscriber.email,
        username: subscriber.username,
        userId: subscriber.id,
        changes
      });
      results.sent++;
      // Rate limit: 600ms between emails to respect Resend's 2 req/sec limit
      await new Promise(resolve => setTimeout(resolve, 600));
    } catch (error) {
      results.failed++;
      results.errors.push({ email: subscriber.email, error: error.message });
    }
  }

  return results;
}

// ============================================
// TWO-FACTOR AUTHENTICATION EMAILS
// ============================================

/**
 * Send email notification when 2FA is enabled
 */
async function send2FAEnabledEmail({ to, username, ipAddress, deviceInfo }) {
  const settingsUrl = `${BASE_URL}/settings/security`;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>2FA Enabled - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">

          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #2d2d44;">
              <div style="font-size: 48px; margin-bottom: 8px;">&#x1F512;</div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #22c55e;">
                Two-Factor Authentication Enabled
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 30px 40px;">
              <p style="margin: 0 0 20px; color: #e5e7eb; font-size: 16px; line-height: 1.6;">
                Hey ${username || 'there'},
              </p>
              <p style="margin: 0 0 20px; color: #9ca3af; font-size: 15px; line-height: 1.6;">
                Two-factor authentication has been <strong style="color: #22c55e;">successfully enabled</strong> on your CodeArena account. Your account is now more secure!
              </p>

              <!-- Details Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1e1e32; border-radius: 12px; border: 1px solid #2d2d44; margin-bottom: 20px;">
                <tr>
                  <td style="padding: 20px;">
                    <div style="color: #6b7280; font-size: 12px; text-transform: uppercase; margin-bottom: 12px;">Security Details</div>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 8px 0; color: #9ca3af; font-size: 14px;">Date & Time</td>
                        <td style="padding: 8px 0; color: #e5e7eb; font-size: 14px; text-align: right;">${dateStr}</td>
                      </tr>
                      ${ipAddress ? `
                      <tr>
                        <td style="padding: 8px 0; color: #9ca3af; font-size: 14px;">IP Address</td>
                        <td style="padding: 8px 0; color: #e5e7eb; font-size: 14px; text-align: right;">${ipAddress}</td>
                      </tr>
                      ` : ''}
                      ${deviceInfo ? `
                      <tr>
                        <td style="padding: 8px 0; color: #9ca3af; font-size: 14px;">Device</td>
                        <td style="padding: 8px 0; color: #e5e7eb; font-size: 14px; text-align: right;">${deviceInfo}</td>
                      </tr>
                      ` : ''}
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; color: #9ca3af; font-size: 14px; line-height: 1.6;">
                Make sure to save your backup codes in a secure place. You'll need them if you lose access to your authenticator app.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 40px 30px; text-align: center;">
              <a href="${settingsUrl}" style="display: inline-block; background-color: #6366f1; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
                View Security Settings &rarr;
              </a>
            </td>
          </tr>

          <!-- Warning -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <div style="background-color: #f59e0b10; border: 1px solid #f59e0b30; border-radius: 8px; padding: 16px;">
                <p style="margin: 0; color: #f59e0b; font-size: 13px;">
                  &#x26A0;&#xFE0F; If you didn't enable 2FA, someone may have access to your account. Please change your password immediately and contact support.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px; background-color: #12121f; border-top: 1px solid #2d2d44; text-align: center;">
              <p style="margin: 0; color: #6b7280; font-size: 12px;">CodeArena - Competitive Coding Battles</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Two-Factor Authentication Enabled

Hey ${username || 'there'},

Two-factor authentication has been successfully enabled on your CodeArena account.

SECURITY DETAILS
- Date & Time: ${dateStr}
${ipAddress ? `- IP Address: ${ipAddress}` : ''}
${deviceInfo ? `- Device: ${deviceInfo}` : ''}

Make sure to save your backup codes in a secure place. You'll need them if you lose access to your authenticator app.

If you didn't enable 2FA, someone may have access to your account. Please change your password immediately and contact support.

Security Settings: ${settingsUrl}`;

  return sendEmail({
    to,
    subject: 'Two-Factor Authentication Enabled - CodeArena',
    html,
    text
  });
}

/**
 * Send email notification when 2FA is disabled
 */
async function send2FADisabledEmail({ to, username, ipAddress, deviceInfo }) {
  const settingsUrl = `${BASE_URL}/settings/security`;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>2FA Disabled - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">

          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #2d2d44;">
              <div style="font-size: 48px; margin-bottom: 8px;">&#x1F513;</div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #f59e0b;">
                Two-Factor Authentication Disabled
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 30px 40px;">
              <p style="margin: 0 0 20px; color: #e5e7eb; font-size: 16px; line-height: 1.6;">
                Hey ${username || 'there'},
              </p>
              <p style="margin: 0 0 20px; color: #9ca3af; font-size: 15px; line-height: 1.6;">
                Two-factor authentication has been <strong style="color: #f59e0b;">disabled</strong> on your CodeArena account.
              </p>

              <!-- Warning Card -->
              <div style="background-color: #ef444420; border: 1px solid #ef444440; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                <p style="margin: 0 0 12px; color: #ef4444; font-size: 16px; font-weight: 600;">
                  &#x26A0;&#xFE0F; Security Warning
                </p>
                <p style="margin: 0; color: #fca5a5; font-size: 14px; line-height: 1.6;">
                  Your account is now protected only by your password. We strongly recommend re-enabling 2FA for enhanced security.
                </p>
              </div>

              <!-- Details Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1e1e32; border-radius: 12px; border: 1px solid #2d2d44; margin-bottom: 20px;">
                <tr>
                  <td style="padding: 20px;">
                    <div style="color: #6b7280; font-size: 12px; text-transform: uppercase; margin-bottom: 12px;">Security Details</div>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 8px 0; color: #9ca3af; font-size: 14px;">Date & Time</td>
                        <td style="padding: 8px 0; color: #e5e7eb; font-size: 14px; text-align: right;">${dateStr}</td>
                      </tr>
                      ${ipAddress ? `
                      <tr>
                        <td style="padding: 8px 0; color: #9ca3af; font-size: 14px;">IP Address</td>
                        <td style="padding: 8px 0; color: #e5e7eb; font-size: 14px; text-align: right;">${ipAddress}</td>
                      </tr>
                      ` : ''}
                      ${deviceInfo ? `
                      <tr>
                        <td style="padding: 8px 0; color: #9ca3af; font-size: 14px;">Device</td>
                        <td style="padding: 8px 0; color: #e5e7eb; font-size: 14px; text-align: right;">${deviceInfo}</td>
                      </tr>
                      ` : ''}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 40px 30px; text-align: center;">
              <a href="${settingsUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
                Re-enable 2FA &rarr;
              </a>
            </td>
          </tr>

          <!-- Warning -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <div style="background-color: #ef444410; border: 1px solid #ef444430; border-radius: 8px; padding: 16px;">
                <p style="margin: 0; color: #ef4444; font-size: 13px;">
                  &#x1F6A8; If you didn't disable 2FA, your account may be compromised. Change your password immediately and contact support.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px; background-color: #12121f; border-top: 1px solid #2d2d44; text-align: center;">
              <p style="margin: 0; color: #6b7280; font-size: 12px;">CodeArena - Competitive Coding Battles</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Two-Factor Authentication Disabled

Hey ${username || 'there'},

Two-factor authentication has been disabled on your CodeArena account.

SECURITY WARNING
Your account is now protected only by your password. We strongly recommend re-enabling 2FA for enhanced security.

SECURITY DETAILS
- Date & Time: ${dateStr}
${ipAddress ? `- IP Address: ${ipAddress}` : ''}
${deviceInfo ? `- Device: ${deviceInfo}` : ''}

If you didn't disable 2FA, your account may be compromised. Change your password immediately and contact support.

Re-enable 2FA: ${settingsUrl}`;

  return sendEmail({
    to,
    subject: 'Security Alert: Two-Factor Authentication Disabled - CodeArena',
    html,
    text
  });
}

/**
 * Send email notification when a new device is trusted
 */
async function sendNewTrustedDeviceEmail({ to, username, deviceName, browser, os, ipAddress }) {
  const settingsUrl = `${BASE_URL}/settings/security`;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });

  const deviceDisplay = deviceName || [browser, os].filter(Boolean).join(' on ') || 'Unknown device';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Trusted Device - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">

          <!-- CodeArena Logo -->
          ${getEmailLogoHtml({ align: 'center', padding: '32px 40px 0' })}

          <!-- Header -->
          <tr>
            <td style="padding: 16px 40px 20px; text-align: center; border-bottom: 1px solid #2d2d44;">
              <div style="font-size: 48px; margin-bottom: 8px;">&#x1F4F1;</div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #22d3ee;">
                New Trusted Device Added
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 30px 40px;">
              <p style="margin: 0 0 20px; color: #e5e7eb; font-size: 16px; line-height: 1.6;">
                Hey ${username || 'there'},
              </p>
              <p style="margin: 0 0 20px; color: #9ca3af; font-size: 15px; line-height: 1.6;">
                A new device has been added to your trusted devices list. You won't need to enter a 2FA code when logging in from this device for the next 30 days.
              </p>

              <!-- Device Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1e1e32; border-radius: 12px; border: 1px solid #2d2d44; margin-bottom: 20px;">
                <tr>
                  <td style="padding: 20px;">
                    <div style="color: #6b7280; font-size: 12px; text-transform: uppercase; margin-bottom: 12px;">Device Details</div>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 8px 0; color: #9ca3af; font-size: 14px;">Device</td>
                        <td style="padding: 8px 0; color: #22d3ee; font-size: 14px; font-weight: 600; text-align: right;">${deviceDisplay}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #9ca3af; font-size: 14px;">Date & Time</td>
                        <td style="padding: 8px 0; color: #e5e7eb; font-size: 14px; text-align: right;">${dateStr}</td>
                      </tr>
                      ${ipAddress ? `
                      <tr>
                        <td style="padding: 8px 0; color: #9ca3af; font-size: 14px;">IP Address</td>
                        <td style="padding: 8px 0; color: #e5e7eb; font-size: 14px; text-align: right;">${ipAddress}</td>
                      </tr>
                      ` : ''}
                      <tr>
                        <td style="padding: 8px 0; color: #9ca3af; font-size: 14px;">Trusted Until</td>
                        <td style="padding: 8px 0; color: #22c55e; font-size: 14px; text-align: right;">30 days</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 40px 30px; text-align: center;">
              <a href="${settingsUrl}" style="display: inline-block; background-color: #6366f1; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
                Manage Trusted Devices &rarr;
              </a>
            </td>
          </tr>

          <!-- Warning -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <div style="background-color: #f59e0b10; border: 1px solid #f59e0b30; border-radius: 8px; padding: 16px;">
                <p style="margin: 0; color: #f59e0b; font-size: 13px;">
                  &#x26A0;&#xFE0F; If this wasn't you, revoke this device immediately from your security settings and change your password.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px; background-color: #12121f; border-top: 1px solid #2d2d44; text-align: center;">
              <p style="margin: 0; color: #6b7280; font-size: 12px;">CodeArena - Competitive Coding Battles</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `New Trusted Device Added

Hey ${username || 'there'},

A new device has been added to your trusted devices list. You won't need to enter a 2FA code when logging in from this device for the next 30 days.

DEVICE DETAILS
- Device: ${deviceDisplay}
- Date & Time: ${dateStr}
${ipAddress ? `- IP Address: ${ipAddress}` : ''}
- Trusted Until: 30 days

If this wasn't you, revoke this device immediately from your security settings and change your password.

Manage Trusted Devices: ${settingsUrl}`;

  return sendEmail({
    to,
    subject: 'New Trusted Device Added - CodeArena',
    html,
    text
  });
}

/**
 * Send email notification when backup codes are regenerated
 */
async function sendBackupCodesRegeneratedEmail({ to, username, ipAddress, deviceInfo }) {
  const settingsUrl = `${BASE_URL}/settings/security`;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Backup Codes Regenerated - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">

          <!-- CodeArena Logo -->
          ${getEmailLogoHtml({ align: 'center', padding: '32px 40px 0' })}

          <!-- Header -->
          <tr>
            <td style="padding: 16px 40px 20px; text-align: center; border-bottom: 1px solid #2d2d44;">
              <div style="font-size: 48px; margin-bottom: 8px;">&#x1F511;</div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #22d3ee;">
                Backup Codes Regenerated
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 30px 40px;">
              <p style="margin: 0 0 20px; color: #e5e7eb; font-size: 16px; line-height: 1.6;">
                Hey ${username || 'there'},
              </p>
              <p style="margin: 0 0 20px; color: #9ca3af; font-size: 15px; line-height: 1.6;">
                Your two-factor authentication backup codes have been regenerated. Your old backup codes are no longer valid.
              </p>

              <!-- Important Note -->
              <div style="background-color: #6366f120; border: 1px solid #6366f140; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                <p style="margin: 0 0 12px; color: #a5b4fc; font-size: 16px; font-weight: 600;">
                  &#x1F4DD; Important
                </p>
                <p style="margin: 0; color: #c7d2fe; font-size: 14px; line-height: 1.6;">
                  Make sure to save your new backup codes in a secure place. You'll need them if you lose access to your authenticator app.
                </p>
              </div>

              <!-- Details Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1e1e32; border-radius: 12px; border: 1px solid #2d2d44; margin-bottom: 20px;">
                <tr>
                  <td style="padding: 20px;">
                    <div style="color: #6b7280; font-size: 12px; text-transform: uppercase; margin-bottom: 12px;">Security Details</div>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 8px 0; color: #9ca3af; font-size: 14px;">Date & Time</td>
                        <td style="padding: 8px 0; color: #e5e7eb; font-size: 14px; text-align: right;">${dateStr}</td>
                      </tr>
                      ${ipAddress ? `
                      <tr>
                        <td style="padding: 8px 0; color: #9ca3af; font-size: 14px;">IP Address</td>
                        <td style="padding: 8px 0; color: #e5e7eb; font-size: 14px; text-align: right;">${ipAddress}</td>
                      </tr>
                      ` : ''}
                      ${deviceInfo ? `
                      <tr>
                        <td style="padding: 8px 0; color: #9ca3af; font-size: 14px;">Device</td>
                        <td style="padding: 8px 0; color: #e5e7eb; font-size: 14px; text-align: right;">${deviceInfo}</td>
                      </tr>
                      ` : ''}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 40px 30px; text-align: center;">
              <a href="${settingsUrl}" style="display: inline-block; background-color: #6366f1; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
                View Security Settings &rarr;
              </a>
            </td>
          </tr>

          <!-- Warning -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <div style="background-color: #f59e0b10; border: 1px solid #f59e0b30; border-radius: 8px; padding: 16px;">
                <p style="margin: 0; color: #f59e0b; font-size: 13px;">
                  &#x26A0;&#xFE0F; If you didn't regenerate your backup codes, your account may be compromised. Change your password and 2FA settings immediately.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px; background-color: #12121f; border-top: 1px solid #2d2d44; text-align: center;">
              <p style="margin: 0; color: #6b7280; font-size: 12px;">CodeArena - Competitive Coding Battles</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Backup Codes Regenerated

Hey ${username || 'there'},

Your two-factor authentication backup codes have been regenerated. Your old backup codes are no longer valid.

IMPORTANT
Make sure to save your new backup codes in a secure place. You'll need them if you lose access to your authenticator app.

SECURITY DETAILS
- Date & Time: ${dateStr}
${ipAddress ? `- IP Address: ${ipAddress}` : ''}
${deviceInfo ? `- Device: ${deviceInfo}` : ''}

If you didn't regenerate your backup codes, your account may be compromised. Change your password and 2FA settings immediately.

Security Settings: ${settingsUrl}`;

  return sendEmail({
    to,
    subject: 'Backup Codes Regenerated - CodeArena',
    html,
    text
  });
}

/**
 * Send email notification when a payment fails
 * @param {Object} params
 * @param {string} params.to - User email
 * @param {string} params.username - Username
 * @param {number} params.attemptCount - Number of payment attempts
 * @param {boolean} params.proRevoked - Whether Pro was revoked due to this failure
 */
async function sendPaymentFailedEmail({ to, username, attemptCount, proRevoked = false }) {
  const billingUrl = `${BASE_URL}/settings/subscription`;

  const emoji = proRevoked ? '😢' : '⚠️';
  const title = proRevoked
    ? 'Your Pro Subscription Has Been Cancelled'
    : 'Payment Failed - Action Required';

  const subject = proRevoked
    ? 'Pro Subscription Cancelled - CodeArena'
    : 'Payment Failed - CodeArena';

  const mainMessage = proRevoked
    ? `We were unable to process your payment after multiple attempts, and your Pro subscription has been cancelled. You'll still have access to all free features.`
    : `We had trouble processing your payment for your Pro subscription. This was attempt ${attemptCount} of 3.`;

  const ctaText = proRevoked
    ? 'Resubscribe to Pro'
    : 'Update Payment Method';

  const urgencyMessage = proRevoked
    ? ''
    : `<p style="margin: 20px 0 0; color: #f59e0b; font-size: 14px; font-weight: 500;">
        ⏰ Please update your payment method to avoid losing Pro access.
      </p>`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - CodeArena</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f23; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f0f23; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">

          <!-- CodeArena Logo -->
          ${getEmailLogoHtml({ align: 'center', padding: '32px 40px 0' })}

          <!-- Header -->
          <tr>
            <td style="padding: 16px 40px 20px; text-align: center; border-bottom: 1px solid #2d2d44;">
              <div style="font-size: 48px; margin-bottom: 8px;">${emoji}</div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: ${proRevoked ? '#ef4444' : '#f59e0b'};">
                ${title}
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 30px 40px;">
              <p style="margin: 0 0 20px; color: #e5e7eb; font-size: 16px; line-height: 1.6;">
                Hey ${username || 'there'},
              </p>
              <p style="margin: 0 0 20px; color: #9ca3af; font-size: 15px; line-height: 1.6;">
                ${mainMessage}
              </p>
              ${urgencyMessage}
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 40px 30px; text-align: center;">
              <a href="${billingUrl}" style="display: inline-block; background-color: #6366f1; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 14px 28px; border-radius: 8px;">
                ${ctaText} &rarr;
              </a>
            </td>
          </tr>

          <!-- Help -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <div style="background-color: #1e1e32; border-radius: 8px; padding: 16px; border: 1px solid #2d2d44;">
                <p style="margin: 0; color: #9ca3af; font-size: 13px;">
                  Need help? Reply to this email or contact us at <a href="mailto:support@codearena.co" style="color: #22d3ee;">support@codearena.co</a>
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px; background-color: #12121f; border-top: 1px solid #2d2d44; text-align: center;">
              <p style="margin: 0; color: #6b7280; font-size: 12px;">CodeArena - Competitive Coding Battles</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `${title}

Hey ${username || 'there'},

${mainMessage}

${proRevoked ? '' : 'Please update your payment method to avoid losing Pro access.'}

${ctaText}: ${billingUrl}

Need help? Contact us at support@codearena.co`;

  return sendEmail({
    to,
    subject,
    html,
    text
  });
}






// ============================================
// REFERRAL EMAILS
// ============================================

/**
 * Send email when a referral is completed (friend created their first game)
 */
async function sendReferralCompletedEmail({ to, referrerUsername, refereeUsername, creditsEarned, totalCredits }) {
  const createUrl = `${FRONTEND_URL}/create`;
  const referralUrl = `${FRONTEND_URL}/create`; // Referral section is in upgrade modal

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a;">
      <div style="background: linear-gradient(135deg, #0f172a 0%, #581c87 100%); padding: 30px; text-align: center;">
        ${getEmailLogoInline({ iconSize: 32, wordmarkColor: '#FAFAFA' })}
      </div>
      <div style="padding: 30px; background: #1e293b; color: #e2e8f0;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #22c55e, #10b981); border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 32px;">🎉</span>
          </div>
          <h1 style="color: #22c55e; margin: 0 0 8px; font-size: 24px;">You Earned Credits!</h1>
        </div>

        <p style="color: #e2e8f0; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
          Hey <strong>${referrerUsername}</strong>,
        </p>

        <p style="color: #e2e8f0; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
          Great news! Your friend <strong style="color: #22d3ee;">${refereeUsername}</strong> just created their first game on CodeArena.
        </p>

        <div style="background: linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(16, 185, 129, 0.1)); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
          <div style="color: #94a3b8; font-size: 14px; margin-bottom: 8px;">Referral Reward</div>
          <div style="color: #22c55e; font-size: 36px; font-weight: bold;">+${creditsEarned} Credits</div>
          <div style="color: #94a3b8; font-size: 14px; margin-top: 8px;">Your balance: ${totalCredits} credits</div>
        </div>

        <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
          Keep inviting friends to earn more free credits. Each friend who signs up and creates a game earns you 10 credits!
        </p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${createUrl}" style="background: linear-gradient(135deg, #22c55e, #10b981); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px;">
            Use Your Credits
          </a>
        </div>

        <div style="border-top: 1px solid #334155; padding-top: 20px; margin-top: 24px; text-align: center;">
          <p style="color: #64748b; font-size: 13px; margin: 0;">
            Want more credits? <a href="${referralUrl}" style="color: #22d3ee; text-decoration: none;">Invite more friends</a>
          </p>
        </div>
      </div>
      <div style="padding: 20px; background: #0f172a; text-align: center; color: #64748b; font-size: 12px;">
        <p style="margin: 0;">CodeArena - Create Games with AI</p>
      </div>
    </div>
  `;

  const text = `You Earned Credits!

Hey ${referrerUsername},

Great news! Your friend ${refereeUsername} just created their first game on CodeArena.

Referral Reward: +${creditsEarned} Credits
Your balance: ${totalCredits} credits

Keep inviting friends to earn more free credits. Each friend who signs up and creates a game earns you 10 credits!

Use your credits: ${createUrl}`;

  return sendEmail({
    to,
    subject: `🎉 You earned ${creditsEarned} credits! ${refereeUsername} created their first game`,
    html,
    text
  });
}



/**
 * Send a CreatorArena milestone email (e.g., "Your game hit 10 likes!")
 * milestone: { kind: 'likes' | 'first_comment', threshold?: number }
 * game: { id, title }
 * to: creator's email address; username: creator's username
 */
async function sendCreatorMilestoneEmail({ to, username, game, milestone }) {
  const gameUrl = `${BASE_URL}/gallery/${game.id}`;
  const unsubscribeUrl = getUnsubscribeUrl(to, 'creator-arena-emails');
  const addressLine = getCompanyAddressLine();
  const safeTitle = String(game.title || 'your game').replace(/</g, '&lt;');

  let headline;
  let blurb;
  let subject;
  if (milestone.kind === 'likes') {
    headline = `Your game just hit ${milestone.threshold} likes!`;
    blurb = `"${safeTitle}" just crossed ${milestone.threshold} upvotes on CreatorArena. People are loving what you built.`;
    subject = `🎉 ${milestone.threshold} likes on "${safeTitle}"`;
  } else if (milestone.kind === 'first_comment') {
    headline = `Someone just left the first comment on your game`;
    blurb = `"${safeTitle}" got its first comment on CreatorArena. Hop in and reply to keep the conversation going.`;
    subject = `💬 First comment on "${safeTitle}"`;
  } else {
    headline = `New activity on your game`;
    blurb = `"${safeTitle}" has new activity on CreatorArena.`;
    subject = `New activity on "${safeTitle}"`;
  }

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#1e293b;border-radius:12px;overflow:hidden;">
        ${getEmailLogoHtml({ align: 'center', padding: '32px 40px 0' })}
        <tr><td style="padding:16px 40px 24px 40px;text-align:center;">
          <h1 style="margin:0 0 12px 0;font-size:26px;color:#ffffff;">${headline}</h1>
          <p style="margin:0;color:#cbd5e1;font-size:16px;line-height:1.5;">Hi ${username || 'there'},</p>
          <p style="margin:12px 0 0 0;color:#cbd5e1;font-size:16px;line-height:1.5;">${blurb}</p>
        </td></tr>
        <tr><td style="padding:0 40px 32px 40px;text-align:center;">
          <a href="${gameUrl}" style="display:inline-block;background:#6366f1;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;">View your game</a>
        </td></tr>
        <tr><td style="padding:24px 40px;border-top:1px solid #334155;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
            You're getting this because you have CreatorArena milestone emails turned on.<br>
            <a href="${unsubscribeUrl}" style="color:#94a3b8;">Unsubscribe</a> &middot;
            <a href="${BASE_URL}/settings/profile" style="color:#94a3b8;">Manage preferences</a><br>
            <span style="color:#64748b;">${addressLine}</span>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = `${headline}

Hi ${username || 'there'},

${blurb}

View your game: ${gameUrl}

---
You're getting this because you have CreatorArena milestone emails turned on.
Unsubscribe: ${unsubscribeUrl}
Manage preferences: ${BASE_URL}/settings/profile
${addressLine}`;

  return sendEmail({ to, subject, html, text, listUnsubscribe: unsubscribeUrl });
}

module.exports = {
  sendEmail,
  sendCreatorMilestoneEmail,
  sendWeeklyChallengeNotification,
  sendWeeklyChallengeToAll,
  generateWeeklyChallengeEmail,
  generateWeeklyChallengeText,
  sendWeeklyProgressDigest,
  generateWeeklyProgressDigestEmail,
  generateWeeklyProgressDigestText,
  sendTournamentNotification,
  sendTournamentNotificationToAll,
  generateTournamentNotificationEmail,
  generateTournamentNotificationText,
  // Email change
  sendEmailChangeVerification,
  sendEmailChangeAlert,
  sendEmailChangeConfirmation,
  // User reports
  sendReportNotification,
  // Student verification
  sendStudentVerificationEmail,
  sendEmailWithRetry,
  // Student expiration warning
  sendStudentExpirationWarningEmail,
  generateStudentExpirationWarningEmail,
  generateStudentExpirationWarningText,
  // Activity reminders
  sendActivityReminderEmail,
  generateActivityReminderEmail,
  generateActivityReminderText,
  // Weekly message digest
  sendWeeklyMessageDigest,
  generateWeeklyMessageDigestEmail,
  generateWeeklyMessageDigestText,
  generateUnsubscribeToken,
  getUnsubscribeUrl,
  // Weekly changelog
  sendWeeklyChangelogEmail,
  sendWeeklyChangelogToAll,
  generateWeeklyChangelogEmail,
  generateWeeklyChangelogText,
  // Two-Factor Authentication
  send2FAEnabledEmail,
  send2FADisabledEmail,
  sendNewTrustedDeviceEmail,
  sendBackupCodesRegeneratedEmail,
  // Payment notifications
  sendPaymentFailedEmail,
  // Referral notifications
  sendReferralCompletedEmail,
  // Team invitations
};

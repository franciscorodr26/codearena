#!/usr/bin/env node
/**
 * One-off script to send a curated weekly changelog to all verified users.
 * Run: node scripts/sendCuratedChangelog.js [--dry-run]
 */

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../db');
const emailService = require('../services/email');

const CHANGES = [
  '✨ Launched AI Critique where users find and fix bugs in AI-generated code. 18 templates with Python support and autosave.',
  '✨ Built the Weekly Prompt Challenge with LLM-as-judge scoring and a one-shot format.',
  '⚡ Overhauled Creator Arena game generation so games actually work on first try. Added validation and a repair pass.',
  '✨ Added B2B hiring workflow with candidate profiles and messaging.',
  '🔧 General polish: profile pics in DMs, live member count, dark mode only, and a handful of bug fixes.',
];

const EDITION = '2026-05-02';

async function getAllVerifiedUsers() {
  return db.all(`
    SELECT u.id, u.email, u.username
    FROM users u
    WHERE u.email IS NOT NULL
      AND u.email != ''
      AND u.email_verified = 1
  `);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) console.log('\n[DRY RUN] No emails will be sent\n');

  console.log('Changes to send:');
  CHANGES.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));

  const users = await getAllVerifiedUsers();
  console.log(`\nRecipients: ${users.length} verified users`);

  if (dryRun) {
    console.log('\n[DRY RUN] Done.\n');
    process.exit(0);
  }

  // Ensure tracking table exists
  await db.run(`
    CREATE TABLE IF NOT EXISTS changelog_sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      edition TEXT NOT NULL,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, edition)
    )
  `);

  let sent = 0, skipped = 0, failed = 0;

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    process.stdout.write(`\rSending... ${i + 1}/${users.length} [sent: ${sent}, skipped: ${skipped}, failed: ${failed}]`);

    try {
      const insertResult = await db.run(
        `INSERT OR IGNORE INTO changelog_sends (user_id, edition) VALUES (?, ?)`,
        [user.id, EDITION]
      );

      if (insertResult.changes === 0) { skipped++; continue; }

      const result = await emailService.sendWeeklyChangelogEmail({
        email: user.email,
        username: user.username,
        userId: user.id,
        changes: CHANGES,
      });

      if (result.success) {
        sent++;
      } else {
        failed++;
        await db.run(`DELETE FROM changelog_sends WHERE user_id = ? AND edition = ?`, [user.id, EDITION]).catch(() => {});
      }
    } catch (err) {
      failed++;
      await db.run(`DELETE FROM changelog_sends WHERE user_id = ? AND edition = ?`, [user.id, EDITION]).catch(() => {});
    }

    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n\nDone! Sent: ${sent} | Skipped: ${skipped} | Failed: ${failed}\n`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });

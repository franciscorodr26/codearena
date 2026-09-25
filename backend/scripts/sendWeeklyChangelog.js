#!/usr/bin/env node
/**
 * Send Weekly Changelog Script
 *
 * Sends weekly product update emails to subscribers.
 * Run this every Friday to keep users informed of new features.
 *
 * Usage:
 *   node scripts/sendWeeklyChangelog.js             # Interactive mode with generated changes
 *   node scripts/sendWeeklyChangelog.js --auto      # Auto-generate from git commits
 *   node scripts/sendWeeklyChangelog.js --dry-run   # Preview without sending
 *   node scripts/sendWeeklyChangelog.js --force     # Skip Friday check
 *
 * Recommended: Run every Friday afternoon
 *   0 14 * * 5 cd /path/to/backend && node scripts/sendWeeklyChangelog.js --auto
 */

const path = require('path');
const readline = require('readline');
const { execSync, spawnSync } = require('child_process');

// Change to backend directory for proper module resolution
process.chdir(path.join(__dirname, '..'));

const { generateChangelog } = require('./generateChangelog');
const db = require('../db');
const emailService = require('../services/email');

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m',
};

function c(color, text) {
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Display formatted changelog preview in terminal
 */
function displayChangelogPreview(changes) {
  console.log('\n' + c('bgBlue', c('white', c('bold', ' CHANGELOG PREVIEW '))));
  console.log(c('dim', '─'.repeat(60)));
  console.log();

  if (changes.length === 0) {
    console.log(c('yellow', '  No changes to display'));
  } else {
    changes.forEach((change, i) => {
      console.log(`  ${c('cyan', `${i + 1}.`)} ${change}`);
    });
  }

  console.log();
  console.log(c('dim', '─'.repeat(60)));
  console.log(`  ${c('bold', 'Total:')} ${changes.length} change${changes.length !== 1 ? 's' : ''}`);
  console.log();
}

/**
 * Get subscribers count who will receive the changelog
 * Uses marketing preference since changelog is marketing-type content.
 * Excludes users who opted out (marketing = 0). NULL = no preference set = include.
 */
async function getChangelogSubscribers() {
  return db.all(`
    SELECT u.id, u.email, u.username
    FROM users u
    LEFT JOIN user_email_preferences uep ON u.id = uep.user_id
    WHERE u.email IS NOT NULL AND u.email != '' AND u.email_verified = 1
      AND (uep.marketing IS NULL OR uep.marketing = 1)
  `);
}

/**
 * Display subscriber count
 */
async function displaySubscriberCount() {
  const subscribers = await getChangelogSubscribers();
  console.log(`${c('bold', 'Subscribers:')} ${c('green', subscribers.length.toString())} users will receive this email`);
  return subscribers;
}

/**
 * Create readline interface for user input
 */
function createReadline() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Prompt user for input
 */
function question(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

/**
 * Edit changes using $EDITOR or manual entry
 */
async function editChanges(currentChanges) {
  const rl = createReadline();

  console.log('\n' + c('bgYellow', c('bold', ' EDIT MODE ')));
  console.log(c('dim', 'Options:'));
  console.log('  1. Enter new changes manually');
  console.log('  2. Open in $EDITOR (vim/nano)');
  console.log('  3. Cancel\n');

  const choice = await question(rl, 'Choose option (1-3): ');

  if (choice === '1') {
    console.log('\nEnter new changelog entries (one per line). Empty line to finish:\n');
    const newChanges = [];
    let index = 1;

    while (true) {
      const entry = await question(rl, `${index}. `);
      if (!entry.trim()) break;
      newChanges.push(entry.trim());
      index++;
    }

    rl.close();
    return newChanges.length > 0 ? newChanges : currentChanges;
  } else if (choice === '2') {
    rl.close();

    // Write current changes to temp file
    const fs = require('fs');
    const os = require('os');
    const tempFile = path.join(os.tmpdir(), 'changelog-edit.txt');

    const content = currentChanges.join('\n') + '\n\n# Enter one change per line. Lines starting with # are ignored.';
    fs.writeFileSync(tempFile, content);

    // Open in editor
    const editor = process.env.EDITOR || 'vim';
    try {
      spawnSync(editor, [tempFile], { stdio: 'inherit' });

      // Read back the edited content
      const edited = fs.readFileSync(tempFile, 'utf-8');
      const newChanges = edited
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

      fs.unlinkSync(tempFile);
      return newChanges.length > 0 ? newChanges : currentChanges;
    } catch (err) {
      console.error(c('red', `Failed to open editor: ${err.message}`));
      return currentChanges;
    }
  } else {
    rl.close();
    return currentChanges;
  }
}

/**
 * Send changelog email to all subscribers with duplicate prevention
 * @param {string[]} changes - Array of changelog entries
 * @param {object[]} subscribers - Array of subscriber objects with email, username, id
 * @param {string} edition - Edition identifier for tracking (defaults to today's date)
 */
async function sendChangelogEmails(changes, subscribers, edition = null) {
  console.log('\n' + c('bgGreen', c('bold', ' SENDING EMAILS ')));
  console.log(c('dim', '─'.repeat(60)));

  // Use date-based edition if not provided
  const editionId = edition || new Date().toISOString().split('T')[0];
  console.log(`  ${c('dim', 'Edition:')} ${editionId}`);

  // Ensure tracking table exists
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS changelog_sends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        edition TEXT NOT NULL,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, edition)
      )
    `);
  } catch (err) {
    console.error(c('red', `Failed to create tracking table: ${err.message}`));
  }

  const results = {
    total: subscribers.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  for (let i = 0; i < subscribers.length; i++) {
    const user = subscribers[i];
    const progress = Math.round(((i + 1) / subscribers.length) * 100);

    process.stdout.write(`\r  Sending... ${progress}% (${i + 1}/${subscribers.length}) [sent: ${results.sent}, skipped: ${results.skipped}]`);

    try {
      // TRACK FIRST to prevent duplicates from concurrent runs
      const insertResult = await db.run(
        `INSERT OR IGNORE INTO changelog_sends (user_id, edition) VALUES (?, ?)`,
        [user.id, editionId]
      );

      // If insert was ignored (already exists), skip
      if (insertResult.changes === 0) {
        results.skipped++;
        continue;
      }

      // Send the email
      const result = await emailService.sendWeeklyChangelogEmail({
        email: user.email,
        username: user.username,
        userId: user.id,
        changes
      });

      if (result.success) {
        results.sent++;
      } else {
        results.failed++;
        results.errors.push({ userId: user.id, email: user.email, error: result.error });
        // Remove tracking on failure so they can receive on retry
        await db.run(
          `DELETE FROM changelog_sends WHERE user_id = ? AND edition = ?`,
          [user.id, editionId]
        ).catch(() => {});
      }
    } catch (err) {
      results.failed++;
      results.errors.push({ userId: user.id, email: user.email, error: err.message });
      // Remove tracking on failure so they can receive on retry
      await db.run(
        `DELETE FROM changelog_sends WHERE user_id = ? AND edition = ?`,
        [user.id, editionId]
      ).catch(() => {});
    }

    // Rate limiting - wait 100ms between emails
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('\n');
  return results;
}

/**
 * Display send results
 */
function displayResults(results) {
  console.log(c('dim', '─'.repeat(60)));
  console.log('\n' + c('bold', 'Results:'));
  console.log(`  ${c('green', 'Sent:')}     ${results.sent}`);
  if (results.skipped > 0) {
    console.log(`  ${c('yellow', 'Skipped:')}  ${results.skipped} (already received this edition)`);
  }
  console.log(`  ${c('red', 'Failed:')}   ${results.failed}`);
  console.log(`  ${c('dim', 'Total:')}    ${results.total}`);

  if (results.errors.length > 0 && results.errors.length <= 10) {
    console.log('\n' + c('yellow', 'Errors:'));
    results.errors.forEach(err => {
      console.log(`  - ${err.email}: ${err.error}`);
    });
  } else if (results.errors.length > 10) {
    console.log(`\n${c('yellow', `${results.errors.length} errors occurred. First 5:`)}`);
    results.errors.slice(0, 5).forEach(err => {
      console.log(`  - ${err.email}: ${err.error}`);
    });
  }

  console.log();
}

/**
 * Check if today is Friday
 */
function isFriday() {
  return new Date().getDay() === 5;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const autoMode = args.includes('--auto');
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  console.log('\n' + c('bgBlue', c('white', c('bold', '  WEEKLY CHANGELOG SENDER  '))));
  console.log(c('dim', '═'.repeat(60)));

  // Check if it's Friday (unless --force is used)
  if (!isFriday() && !force) {
    console.log(c('yellow', '\n  WARNING: Today is not Friday!'));
    console.log(c('dim', '  Changelog emails are typically sent on Fridays.'));
    console.log(c('dim', '  Use --force to send anyway.\n'));

    const rl = createReadline();
    const answer = await question(rl, `Continue anyway? (${c('green', 'yes')}/${c('red', 'no')}): `);
    rl.close();

    if (answer.toLowerCase().trim() !== 'yes' && answer.toLowerCase().trim() !== 'y') {
      console.log(c('yellow', '\nAborted. Run on Friday or use --force.\n'));
      process.exit(0);
    }
  }

  if (dryRun) {
    console.log(c('yellow', '\n  DRY RUN MODE - No emails will be sent\n'));
  }

  // Step 1: Generate changelog
  console.log(c('bold', '\nStep 1: Generating changelog...\n'));
  let changes = await generateChangelog({ auto: autoMode });

  // Step 2: Display preview
  displayChangelogPreview(changes);

  // Step 3: Get subscriber count
  const subscribers = await displaySubscriberCount();

  if (subscribers.length === 0) {
    console.log(c('yellow', '\nNo subscribers found. Exiting.\n'));
    process.exit(0);
  }

  if (changes.length === 0) {
    console.log(c('yellow', '\nNo changes to send. Use edit mode to add changes.\n'));
  }

  // Step 4: Confirmation prompt
  const rl = createReadline();
  console.log();

  while (true) {
    const answer = await question(
      rl,
      `Send to ${c('cyan', subscribers.length.toString())} subscribers? (${c('green', 'yes')}/${c('red', 'no')}/${c('yellow', 'edit')}): `
    );

    const normalized = answer.toLowerCase().trim();

    if (normalized === 'yes' || normalized === 'y') {
      rl.close();

      if (dryRun) {
        console.log(c('green', '\n[DRY RUN] Would have sent to ' + subscribers.length + ' subscribers.\n'));
        displayResults({ total: subscribers.length, sent: subscribers.length, failed: 0, errors: [] });
      } else {
        // Send emails
        const results = await sendChangelogEmails(changes, subscribers);
        displayResults(results);
      }
      break;
    } else if (normalized === 'no' || normalized === 'n') {
      rl.close();
      console.log(c('yellow', '\nAborted. No emails sent.\n'));
      break;
    } else if (normalized === 'edit' || normalized === 'e') {
      rl.close();
      changes = await editChanges(changes);
      displayChangelogPreview(changes);
      // Re-prompt after editing (create new readline since we closed the previous one)
      const rl2 = createReadline();
      const answer2 = await question(
        rl2,
        `Send to ${c('cyan', subscribers.length.toString())} subscribers? (${c('green', 'yes')}/${c('red', 'no')}/${c('yellow', 'edit')}): `
      );
      rl2.close();

      if (answer2.toLowerCase().trim() === 'yes' || answer2.toLowerCase().trim() === 'y') {
        if (dryRun) {
          console.log(c('green', '\n[DRY RUN] Would have sent to ' + subscribers.length + ' subscribers.\n'));
          displayResults({ total: subscribers.length, sent: subscribers.length, failed: 0, errors: [] });
        } else {
          const results = await sendChangelogEmails(changes, subscribers);
          displayResults(results);
        }
      } else {
        console.log(c('yellow', '\nAborted. No emails sent.\n'));
      }
      break;
    } else {
      console.log(c('red', 'Invalid option. Please enter yes, no, or edit.'));
    }
  }

  process.exit(0);
}

// Run main function
main().catch(err => {
  console.error(c('red', `\nError: ${err.message}\n`));
  console.error(err.stack);
  process.exit(1);
});

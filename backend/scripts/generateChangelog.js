#!/usr/bin/env node
/**
 * Generate Changelog Script
 *
 * Generates a list of changes for the weekly changelog email.
 * Can be used standalone or imported by sendWeeklyChangelog.js
 *
 * Usage:
 *   node scripts/generateChangelog.js          # Interactive mode
 *   node scripts/generateChangelog.js --auto   # Auto-generate from git commits
 *
 * When imported:
 *   const { generateChangelog, getRecentCommits } = require('./generateChangelog');
 */

const { execSync } = require('child_process');
const readline = require('readline');


/**
 * Get recent git commits from the last week
 * @param {number} days - Number of days to look back (default: 7)
 * @returns {string[]} Array of commit messages
 */
function getRecentCommits(days = 7) {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];

    const output = execSync(
      `git log --since="${sinceStr}" --pretty=format:"%s" --no-merges`,
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    return output.split('\n').filter(line => line.trim());
  } catch (err) {
    console.error('Failed to get git commits:', err.message);
    return [];
  }
}

/**
 * Filter commits to only include user-facing changes
 * Excludes: merge commits, version bumps, internal refactoring, etc.
 */
function filterUserFacingCommits(commits) {
  const excludePatterns = [
    /^merge/i,
    /^bump/i,
    /^chore/i,
    /^refactor/i,
    /^test/i,
    /^ci/i,
    /^build/i,
    /^docs/i,
    /^style/i,
    /generated with/i,
    /^wip\b/i,
    /^temp/i,
    /^empty commit/i,
    /^trigger rebuild/i,
    /^\d+\.\d+(\.\d+)?$/, // Version numbers only (e.g., "1.0.0", "2.1")
    /^v?\d+\.\d+(\.\d+)?$/, // Version numbers with optional v prefix
    /LLM/i, // Internal AI-related fixes
  ];

  return commits.filter(commit => {
    // Exclude if commit is too short (less than 10 characters)
    if (commit.trim().length < 10) {
      return false;
    }
    // Exclude if matches any exclude pattern
    if (excludePatterns.some(pattern => pattern.test(commit))) {
      return false;
    }
    return true;
  });
}

/**
 * Categorize a commit message and return the appropriate emoji prefix
 * @param {string} commit - Original commit message
 * @returns {string} Emoji prefix or empty string
 */
function getCategoryEmoji(commit) {
  const lowerCommit = commit.toLowerCase();

  // Features: add, new, implement, feat
  if (/\b(add|new|implement|feat)\b/.test(lowerCommit)) {
    return '✨ ';
  }

  // Fixes: fix, bug, issue, resolve
  if (/\b(fix|bug|issue|resolve)\b/.test(lowerCommit)) {
    return '🐛 ';
  }

  // Improvements: improve, enhance, update, better, optimize, perf
  if (/\b(improve|enhance|update|better|optimize|perf)\b/.test(lowerCommit)) {
    return '⚡ ';
  }

  // Other - no prefix
  return '';
}

/**
 * Shorten a changelog entry to be punchy like Railway's style
 * @param {string} text - The text to shorten
 * @returns {string} Shortened text
 */
function shortenEntry(text) {
  // Clean up the text first
  let clean = text
    .replace(/^(with|the|a|an)\s+/i, '')
    .replace(/\s+and\s+/gi, ', ')
    .replace(/,\s*,/g, ',')  // Remove double commas
    .trim();

  // If still long, take just the first part before comma
  if (clean.length > 45) {
    const parts = clean.split(/,\s*/);
    clean = parts[0];
    if (parts.length > 1 && parts[1].length < 25) {
      clean += ', ' + parts[1].trim();
    }
  }

  // Final trim - cut at word boundary
  if (clean.length > 50) {
    clean = clean.substring(0, 50).replace(/\s+\S*$/, '');
  }

  return clean;
}

/**
 * Format commit messages into user-friendly changelog entries
 * @param {string[]} commits - Raw commit messages
 * @returns {string[]} Formatted changelog entries with category emoji prefixes
 */
function formatCommitsForChangelog(commits) {
  return commits.map(commit => {
    // Get category emoji before stripping prefixes
    const emoji = getCategoryEmoji(commit);

    // Remove conventional commit prefixes
    let formatted = commit
      .replace(/^(feat|fix|add|update|improve|enhance|new)[\s:(\[]*/i, '')
      .replace(/^\[.*?\]\s*/, '')
      .replace(/\(#\d+\)$/, '')
      .replace(/^README\s*/i, '') // Remove README prefix
      .trim();

    // Shorten to Railway-style punchy entries
    formatted = shortenEntry(formatted);

    // Capitalize first letter
    formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);

    // Remove trailing period if present
    formatted = formatted.replace(/\.$/, '');

    // Add emoji prefix
    return emoji + formatted;
  }).filter(entry => entry.length > 5); // Filter out very short entries
}

/**
 * Generate changelog from git commits
 * @param {Object} options
 * @param {number} options.days - Number of days to look back
 * @param {number} options.maxEntries - Maximum number of entries
 * @returns {string[]} Array of changelog entries
 */
function generateChangelogFromGit(options = {}) {
  const { days = 7, maxEntries = 5 } = options;

  const commits = getRecentCommits(days);
  const filtered = filterUserFacingCommits(commits);
  const formatted = formatCommitsForChangelog(filtered);

  // Remove duplicates
  const unique = [...new Set(formatted)];

  // If we have more changes than maxEntries, show top (maxEntries-1) + catch-all
  if (unique.length > maxEntries) {
    const topChanges = unique.slice(0, maxEntries - 1);
    topChanges.push(`✨ Custom test cases in practice mode`);
    return topChanges;
  }

  return unique.slice(0, maxEntries);
}

/**
 * Interactive mode - prompt user to enter changelog entries
 */
async function interactiveMode() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

  console.log('\n=== Weekly Changelog Generator ===\n');
  console.log('Enter changelog entries (one per line). Enter empty line when done.\n');

  const entries = [];
  let index = 1;

  while (true) {
    const entry = await question(`${index}. `);
    if (!entry.trim()) break;
    entries.push(entry.trim());
    index++;
  }

  rl.close();
  return entries;
}

/**
 * Main function - generates changelog
 * @param {Object} options
 * @param {boolean} options.auto - Auto-generate from git commits
 * @param {boolean} options.interactive - Run in interactive mode
 * @returns {Promise<string[]>} Array of changelog entries
 */
async function generateChangelog(options = {}) {
  const { auto = false, interactive = false } = options;

  if (auto) {
    return generateChangelogFromGit();
  }

  if (interactive) {
    return interactiveMode();
  }

  // Default: try git first, fall back to interactive
  const gitEntries = generateChangelogFromGit();
  if (gitEntries.length > 0) {
    return gitEntries;
  }

  return interactiveMode();
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const auto = args.includes('--auto');
  const interactive = args.includes('--interactive') || args.includes('-i');

  generateChangelog({ auto, interactive })
    .then(entries => {
      console.log('\n=== Generated Changelog ===\n');
      entries.forEach((entry, i) => {
        console.log(`${i + 1}. ${entry}`);
      });
      console.log(`\nTotal: ${entries.length} entries`);
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = {
  generateChangelog,
  generateChangelogFromGit,
  getRecentCommits,
  filterUserFacingCommits,
  formatCommitsForChangelog,
  getCategoryEmoji
};

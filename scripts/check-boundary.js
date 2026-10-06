#!/usr/bin/env node
'use strict';

// Fails when anything that must not be published is in the tree: traces of the
// hiring product this codebase once shared a repository with, private problem
// data, credentials, or personal details. Run it before every push; CI runs it
// on every pull request. Scans tracked text files plus the untracked ones git
// would add (node_modules, build output and coverage are never scanned).

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const FORBIDDEN_PATHS = [
  /^backend\/data\/problems\//, /^backend\/scripts\/generatedSolutions\//, /^backend\/calibration\//,
  /^backend\/routes\/company\.js$/, /^backend\/services\/(aiCritique|findingsJudge|systemDesignJudge|codepairSocket|codeWrapper|inputParser|validateSolutionLegacy)\.js$/,
  /(^|\/)\.env(\.|$)(?!example$)/, /\.(sqlite|sqlite3|db)$/, /\.(pem|key|p12)$/, /^frontend\/\.vercel\//,
  /(^|\/)coverage\//, /^backend\/uploads\//
];

// Words that only the other product used. Generic words (candidate, interview)
// are allowed because the consumer product uses them in ordinary sentences.
const FORBIDDEN_TEXT = [
  /deveval/i, /recruiter/i, /take-?home assessment/i, /codepair/i, /hiring manager/i,
  /assessment_sessions?/i, /ats_connections?/i, /aiCritiqueTemplates/, /findingsJudge/, /systemDesignJudge/,
  /discernment engine/i
];

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{20,}/, /sk_(live|test)_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  /xox[abp]-[A-Za-z0-9-]{10,}/, /ghp_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{30,}/, /AIza[0-9A-Za-z_-]{30,}/,
  /https:\/\/[0-9a-f]{32}@[a-z0-9.]+\.ingest\.sentry\.io/, /(postgres|postgresql|redis|mongodb):\/\/[^\s'"]*:[^\s'"]*@/
];

// Addresses on these domains are fine; anything else is probably a person,
// unless the local part is an obvious fixture word.
const EMAIL_ALLOWED_DOMAINS = /@(codearena\.co|example\.(com|org|net|test)|example|test\.com|codearena\.(test|local)|anthropic\.com|resend\.dev|users\.noreply\.github\.com|[a-z.-]*\.edu(\.com)?|university\.edu)$/i;
const EMAIL_FIXTURE_LOCAL = /^(user|users?\d*|bob|jo|alice|old|test|tester|student|fixture|literal|a|b|c|dev|your|prior-session|fake|admin|hello|support|noreply|security|someone|nobody|player\d*|demo[a-z.]*)\d*$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Files that legitimately contain the forbidden words (they are the guards).
const TEXT_ALLOWLIST = new Set([
  'scripts/check-boundary.js',
  'backend/tests/codearenaProductBoundary.test.js',
  'backend/migrations.lock.json'
]);

const TEXT_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|json|md|txt|yml|yaml|css|html|sql|sh|toml|conf|example)$/;

function trackedFiles() {
  const out = execSync('git ls-files --cached --others --exclude-standard', { cwd: root, encoding: 'utf8' });
  return out.split('\n').filter(Boolean)
    .filter(f => !f.startsWith('node_modules/') && !f.includes('/node_modules/') && !f.startsWith('frontend/.next/'))
    // The index may still list files deleted in the working tree; only what exists gets published.
    .filter(f => fs.existsSync(path.join(root, f)));
}

function main() {
  const files = trackedFiles();
  const problems = [];
  let scanned = 0;

  for (const file of files) {
    if (FORBIDDEN_PATHS.some(re => re.test(file))) problems.push(`${file}: forbidden path`);
    if (!TEXT_EXT.test(file) || /package-lock\.json$/.test(file)) continue;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    scanned += 1;

    for (const re of SECRET_PATTERNS) {
      const match = text.match(re);
      if (match) problems.push(`${file}: looks like a credential (${match[0].slice(0, 8)}...)`);
    }
    if (!TEXT_ALLOWLIST.has(file)) {
      for (const re of FORBIDDEN_TEXT) {
        const match = text.match(re);
        if (match) problems.push(`${file}: forbidden text "${match[0]}"`);
      }
    }
    for (const address of text.match(EMAIL) || []) {
      const local = address.split('@')[0];
      if (EMAIL_ALLOWED_DOMAINS.test(address) || EMAIL_FIXTURE_LOCAL.test(local)) continue;
      if (/\.(png|svg|jpg|js|json|md|ts)$/.test(address)) continue;
      problems.push(`${file}: email address ${address}`);
    }
    if (/\/Users\/[a-z]+\//.test(text) && !file.endsWith('.md')) problems.push(`${file}: local home directory path`);
  }

  if (scanned < 100) {
    problems.push(`only ${scanned} text files scanned; the file listing looks wrong`);
  }

  if (problems.length) {
    console.error(`Boundary check FAILED (${problems.length} problems in ${scanned} files):`);
    for (const p of problems.slice(0, 200)) console.error('  ' + p);
    process.exit(1);
  }
  console.log(`Boundary check passed: ${files.length} files listed, ${scanned} text files scanned, nothing forbidden found.`);
}

main();

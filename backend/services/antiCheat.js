'use strict';

// Battle integrity check for the open edition.
//
// Deliberately small: the only automatic signal is an exact copy of an
// earlier winning solution to the same problem, after comments, string
// contents and whitespace are removed. Everything else (pastes, typing
// rhythm, focus changes) is left to player reports and admin review, so the
// rules are easy to understand and an honest fast solver is never flagged.

const crypto = require('crypto');

const MAX_CODE_LENGTH = 50000;

// Remove comments, the contents of string literals and all whitespace so that
// renaming nothing but reformatting a copied solution still matches it.
function canonicalize(code, language) {
  let text = String(code || '').slice(0, MAX_CODE_LENGTH);
  if (language === 'python') {
    text = text.replace(/("""|''')[\s\S]*?\1/g, '""').replace(/#[^\n]*/g, '');
  } else {
    text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }
  text = text.replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
  return text.replace(/\s+/g, '');
}

function fingerprint(code, language) {
  const canonical = canonicalize(code, language);
  if (canonical.length < 40) return null; // too short to say anything about copying
  return crypto.createHash('sha256').update(`${language}:${canonical}`).digest('hex');
}

/**
 * @returns {{ violations: object[], totalSuspicion: number, recommendation: string,
 *             fingerprint: string|null, ngramFingerprints: string[] }}
 */
function analyzeSubmission({ code, language, storedFingerprints = [] }) {
  const ownPrint = fingerprint(code, language);
  const violations = [];
  if (ownPrint) {
    const match = storedFingerprints.find(stored => stored && stored.fingerprint === ownPrint);
    if (match) {
      violations.push({
        type: 'exact_match',
        severity: 'critical',
        details: `Identical to an earlier winning solution${match.battleId ? ` (battle ${match.battleId})` : ''}`,
        suspicionWeight: 1
      });
    }
  }
  const totalSuspicion = violations.reduce((sum, v) => sum + v.suspicionWeight, 0);
  return {
    violations,
    totalSuspicion,
    recommendation: totalSuspicion >= 1 ? 'flag' : 'clean',
    fingerprint: ownPrint,
    ngramFingerprints: []
  };
}

function generateViolationExplanation(violations) {
  if (!Array.isArray(violations) || violations.length === 0) return null;
  return {
    summary: 'Your solution is identical to a solution submitted in an earlier battle, so it was sent for review.',
    violations: violations.map(v => ({
      type: v.type,
      userMessage: 'Identical to an earlier winning solution for this problem.',
      baselineComparison: null
    })),
    appealable: true
  };
}

module.exports = {
  canonicalize,
  fingerprint,
  analyzeSubmission,
  generateViolationExplanation
};

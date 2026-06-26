/**
 * Content Filter, shared profanity/inappropriate content detection
 * Reuses the same word list and leetspeak normalization as the username filter in auth.js
 */

const leoProfanity = require('leo-profanity');

// Load dictionary
leoProfanity.loadDictionary();

const BAD_WORDS = new Set([
  ...leoProfanity.list(),
  'nazi', 'hitler', 'kill', 'murder', 'suicide',
  'terrorist', 'bomb', 'shooting', 'massacre', 'rape',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'kike',
  'spic', 'chink', 'gook', 'wetback', 'beaner',
  'penis', 'vagina', 'dick', 'cock', 'pussy', 'tits', 'boobs',
  'cum', 'jizz', 'dildo', 'boner', 'erection',
  'damn', 'stfu', 'wtf', 'lmfao',
  'asshole', 'ahole'
]);

function normalizeLeetspeak(str) {
  const lower = str.toLowerCase().replace(/_/g, '').replace(/\*+/g, '*');

  const normalized = lower
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
    .replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't')
    .replace(/8/g, 'b').replace(/@/g, 'a').replace(/\$/g, 's')
    .replace(/\*/g, '').replace(/!/g, 'i').replace(/\+/g, 't');

  const altNormalized = lower
    .replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e')
    .replace(/4/g, 'u').replace(/5/g, 's').replace(/7/g, 't')
    .replace(/8/g, 'b').replace(/@/g, 'a').replace(/\$/g, 's')
    .replace(/\*/g, '').replace(/!/g, 'i').replace(/\+/g, 't');

  // Additional normalizations: * as different vowels
  const results = [normalized, altNormalized];
  for (const vowel of ['a', 'e', 'i', 'o', 'u']) {
    results.push(lower
      .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
      .replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't')
      .replace(/8/g, 'b').replace(/@/g, 'a').replace(/\$/g, 's')
      .replace(/\*/g, vowel).replace(/!/g, 'i').replace(/\+/g, 't'));
  }
  return results;
}

const SAFE_PATTERNS = [
  'assassin', 'classic', 'bass', 'mass', 'pass', 'grass', 'class',
  'compass', 'bypass', 'harass', 'amass', 'carcass', 'molasses',
  'cockpit', 'cocktail', 'peacock', 'hancock', 'woodcock', 'stopcock',
  'scunthorpe', 'penistone', 'arsenal', 'therapist', 'shitake',
  'dickens', 'dickson', 'sussex', 'essex', 'middlesex', 'assume',
  'assess', 'assist', 'associate', 'assure', 'assignment', 'asset',
  'killed', 'killer', 'overkill', 'skill', 'skilled'
];

/**
 * Check if text contains profanity or inappropriate content
 * Works for any text, prompts, titles, descriptions, comments
 */
function containsProfanity(text) {
  if (!text) return false;

  // For longer text, check each word cluster rather than the whole string
  // This prevents false positives from word boundaries in sentences
  const words = text.toLowerCase().split(/\s+/);

  for (const word of words) {
    let testStr = word.replace(/[_.\-]/g, '').replace(/\*+/g, '*').toLowerCase();
    const normalizations = normalizeLeetspeak(word);

    // Remove safe patterns
    for (const safe of SAFE_PATTERNS) {
      testStr = testStr.replace(new RegExp(safe, 'g'), '');
      for (let i = 0; i < normalizations.length; i++) {
        normalizations[i] = normalizations[i].replace(new RegExp(safe, 'g'), '');
      }
    }

    // Check bad words
    for (const badWord of BAD_WORDS) {
      if (badWord.length >= 3) {
        if (testStr.includes(badWord)) return true;
        for (const norm of normalizations) {
          if (norm.includes(badWord)) return true;
        }
      }
    }
  }

  return false;
}

/**
 * Game-context word filter, only catches slurs, sexual terms, and hate speech.
 * Leaves gameplay words (kill, bomb, shoot, etc.) to the AI moderation layer
 * which can evaluate them in context.
 */
const GAME_BAD_WORDS = new Set([
  // Slurs and hate speech, never acceptable
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'kike',
  'spic', 'chink', 'gook', 'wetback', 'beaner', 'nazi', 'hitler',
  // Sexual terms, not appropriate for game prompts
  'penis', 'vagina', 'dick', 'cock', 'pussy', 'tits', 'boobs',
  'cum', 'jizz', 'dildo', 'boner', 'erection', 'porn', 'hentai',
  'nude', 'naked', 'orgasm', 'masturbat',
  // Core profanity
  'fuck', 'shit', 'bitch', 'asshole', 'ahole',
  // Explicit violence against real groups
  'rape', 'molest', 'genocide', 'holocaust',
]);

function containsProfanityForGames(text) {
  if (!text) return false;

  const words = text.toLowerCase().split(/\s+/);

  for (const word of words) {
    let testStr = word.replace(/[_.\-]/g, '').replace(/\*+/g, '*').toLowerCase();
    const normalizations = normalizeLeetspeak(word);

    for (const safe of SAFE_PATTERNS) {
      testStr = testStr.replace(new RegExp(safe, 'g'), '');
      for (let i = 0; i < normalizations.length; i++) {
        normalizations[i] = normalizations[i].replace(new RegExp(safe, 'g'), '');
      }
    }

    for (const badWord of GAME_BAD_WORDS) {
      if (badWord.length >= 3) {
        if (testStr.includes(badWord)) return true;
        for (const norm of normalizations) {
          if (norm.includes(badWord)) return true;
        }
      }
    }
  }

  return false;
}

module.exports = { containsProfanity, containsProfanityForGames };

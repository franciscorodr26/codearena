/**
 * Time complexity ranking utilities
 * Maps Big-O notation to numeric ranks for percentile comparison
 */

// Complexity rank ordering (lower = better/faster)
const COMPLEXITY_RANKS = {
  'O(1)': 1,
  'O(log n)': 2,
  'O(sqrt(n))': 3,
  'O(n)': 4,
  'O(n log n)': 5,
  'O(n sqrt(n))': 6,
  'O(n^2)': 7,
  'O(n^2 log n)': 8,
  'O(n^3)': 9,
  'O(2^n)': 10,
  'O(n * 2^n)': 11,
  'O(n!)': 12,
};

function getComplexityRank(complexity) {
  if (!complexity) return null;
  const normalized = complexity.replace(/\s+/g, '').toLowerCase();

  for (const [key, rank] of Object.entries(COMPLEXITY_RANKS)) {
    if (normalized === key.replace(/\s+/g, '').toLowerCase()) return rank;
  }

  // Fuzzy matching for common variations
  if (/n!/.test(normalized)) return 12;
  if (/n\s*\*?\s*2\^n/.test(normalized)) return 11;
  if (/2\^n|2\^/.test(normalized)) return 10;
  if (/n\^3/.test(normalized)) return 9;
  if (/n\^2\s*log/.test(normalized)) return 8;
  if (/n\^2/.test(normalized)) return 7;
  if (/n\s*sqrt|n\s*√/.test(normalized)) return 6;
  if (/n\s*log|nlog/.test(normalized)) return 5;
  if (/^o\(n\)$/.test(normalized)) return 4;
  if (/sqrt|√/.test(normalized)) return 3;
  if (/log/.test(normalized)) return 2;
  if (/^o\(1\)$/.test(normalized)) return 1;

  return null;
}

function getComplexityPercentile(userComplexity, optimalComplexity) {
  const userRank = getComplexityRank(userComplexity);
  const optimalRank = getComplexityRank(optimalComplexity);

  if (userRank === null || optimalRank === null) return 50;

  const diff = userRank - optimalRank;
  if (diff <= 0) return 100;
  if (diff === 1) return 75;
  if (diff === 2) return 50;
  if (diff === 3) return 25;
  return 10;
}

module.exports = { getComplexityRank, getComplexityPercentile, COMPLEXITY_RANKS };

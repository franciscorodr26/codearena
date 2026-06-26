/**
 * Performance rating utilities for battle results
 * Based on time complexity analysis, optimal solutions get 100%
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

  // Fuzzy matching
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

/**
 * Get performance rating from complexity comparison
 * @param {string} userComplexity - User's solution Big-O
 * @param {string} optimalComplexity - Optimal Big-O for the problem
 * @param {string} explanation - Brief explanation
 * @returns {Object} Rating object with percentile, rating, message, color, and complexity info
 */
export const getComplexityPerformance = (userComplexity, optimalComplexity, explanation) => {
  const userRank = getComplexityRank(userComplexity);
  const optimalRank = getComplexityRank(optimalComplexity);

  if (userRank === null || optimalRank === null) {
    return {
      percentile: 50,
      rating: "Solved",
      message: "Solution accepted!",
      color: "text-warning",
      userComplexity: userComplexity || 'Unknown',
      optimalComplexity: optimalComplexity || 'Unknown',
      explanation: explanation || ''
    };
  }

  const diff = userRank - optimalRank;
  let percentile, rating, message, color;

  if (diff <= 0) {
    percentile = 100;
    rating = "Optimal";
    message = `Your ${userComplexity} solution matches the optimal time complexity!`;
    color = "text-accent-400";
  } else if (diff === 1) {
    percentile = 75;
    rating = "Near Optimal";
    message = `Your ${userComplexity} is close; the optimal is ${optimalComplexity}.`;
    color = "text-success-light";
  } else if (diff === 2) {
    percentile = 50;
    rating = "Good";
    message = `Your ${userComplexity} works, but ${optimalComplexity} is achievable.`;
    color = "text-warning";
  } else if (diff === 3) {
    percentile = 25;
    rating = "Suboptimal";
    message = `Your ${userComplexity} could be improved to ${optimalComplexity}.`;
    color = "text-warning-dark";
  } else {
    percentile = 10;
    rating = "Brute Force";
    message = `Your ${userComplexity} is far from the optimal ${optimalComplexity}. Try a different approach!`;
    color = "text-danger";
  }

  return { percentile, rating, message, color, userComplexity, optimalComplexity, explanation: explanation || '' };
};

/**
 * Fallback time-based rating (used when complexity analysis is unavailable)
 */
export const getPerformanceRating = (solveTime) => {
  if (solveTime <= 30) return { percentile: 100, rating: "Lightning Fast", message: "Record time!", color: "text-accent-400" };
  if (solveTime <= 60) return { percentile: 90, rating: "Very Fast", message: "Outstanding speed!", color: "text-success-light" };
  if (solveTime <= 120) return { percentile: 80, rating: "Fast", message: "Top tier performance.", color: "text-success" };
  if (solveTime <= 240) return { percentile: 70, rating: "Strong", message: "Faster than most!", color: "text-primary-400" };
  if (solveTime <= 360) return { percentile: 60, rating: "Above Average", message: "Great work!", color: "text-primary-300" };
  if (solveTime <= 480) return { percentile: 50, rating: "Steady", message: "Solid performance.", color: "text-warning" };
  if (solveTime <= 600) return { percentile: 40, rating: "Thoughtful", message: "Improving with each solve.", color: "text-warning-dark" };
  if (solveTime <= 900) return { percentile: 30, rating: "Determined", message: "You solved it!", color: "text-danger-light" };
  if (solveTime <= 1200) return { percentile: 20, rating: "Persistent", message: "Every solve makes you better.", color: "text-danger" };
  return { percentile: 10, rating: "Completed", message: "First step is completing the challenge!", color: "text-surface-400" };
};

/**
 * Formatting utilities for consistent display across the app
 */

/**
 * Format seconds as timer display (mm:ss)
 * Used for countdown timers and elapsed time displays
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string like "5:30" or "0:05"
 */
export const formatTimer = (seconds) => {
  if (!seconds && seconds !== 0) return '--:--';
  // Clamp negative input to 0 so we always render a valid mm:ss
  // (e.g. drift past a deadline previously produced "-1:-5").
  const safeSeconds = seconds < 0 ? 0 : seconds;
  const mins = Math.floor(safeSeconds / 60);
  const secs = Math.floor(safeSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Format seconds as human-readable duration
 * Used for displaying solve times, practice durations, etc.
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted duration like "30s", "2m 15s", or "1h 30m"
 */
export const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);

  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hrs}h ${remainingMins}m`;
  }

  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
};

/**
 * Format a date string for display
 * @param {string} dateString - ISO date string
 * @param {string} format - Format preset: 'short', 'medium', 'long', 'datetime'
 * @returns {string} Formatted date string
 */
export const formatDate = (dateString, format = 'medium') => {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);

  const formats = {
    // "Jan 5" - compact
    short: { month: 'short', day: 'numeric' },
    // "Jan 5, 2024" - standard
    medium: { month: 'short', day: 'numeric', year: 'numeric' },
    // "January 5, 2024" - formal
    long: { month: 'long', day: 'numeric', year: 'numeric' },
    // "Jan 5, 10:30 AM" - with time
    datetime: { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
    // "Sat, Jan 5, 10:30 AM" - with weekday
    full: { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
    // "Saturday, January 5, 10:30 AM" - verbose
    verbose: { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }
  };

  return date.toLocaleDateString('en-US', formats[format] || formats.medium);
};

/**
 * Format a date for message timestamps
 * Shows relative time for recent messages
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted time like "10:30 AM", "Yesterday", "Mon", or "Jan 5"
 */
export const formatMessageTime = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
};

/**
 * Format relative time (e.g., "2h ago", "3d ago")
 * @param {string} dateString - ISO date string
 * @returns {string} Relative time string
 */
export const formatRelativeTime = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/**
 * Format active status for chat (e.g., "Active now", "Active 2h ago")
 * @param {boolean} isOnline - Whether user is currently online
 * @param {string} lastSeen - ISO date string of last activity
 * @returns {string} Active status string
 */
export const formatActiveStatus = (isOnline, lastSeen) => {
  if (isOnline) return 'Active now';
  if (!lastSeen) return '';

  const date = new Date(lastSeen);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 5) return 'Active now';
  if (diffMins < 60) return `Active ${diffMins}m ago`;
  if (diffHours < 24) return `Active ${diffHours}h ago`;
  if (diffDays === 1) return 'Active yesterday';
  if (diffDays < 7) return `Active ${diffDays}d ago`;
  return '';
};

/**
 * Format ISO week string (e.g., "2026-W03") to human-readable format
 * @param {string} weekString - ISO week string like "2026-W03"
 * @returns {string} Formatted string like "Jan 13-19"
 */
export const formatWeekLabel = (weekString) => {
  if (!weekString) return '';

  // Parse "2026-W03" format
  const match = weekString.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return weekString;

  const year = parseInt(match[1]);
  const week = parseInt(match[2]);

  // Calculate the Monday of the given ISO week
  // Jan 4 is always in week 1, so we start from there
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // Convert Sunday (0) to 7
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const monthStart = monday.toLocaleDateString('en-US', { month: 'short' });
  const monthEnd = sunday.toLocaleDateString('en-US', { month: 'short' });
  const dayStart = monday.getDate();
  const dayEnd = sunday.getDate();

  // Same month: "Jan 13-19, 2026"
  // Different months: "Jan 27 - Feb 2, 2026"
  if (monthStart === monthEnd) {
    return `${monthStart} ${dayStart}-${dayEnd}, ${year}`;
  } else {
    return `${monthStart} ${dayStart} - ${monthEnd} ${dayEnd}, ${year}`;
  }
};

/**
 * Count plus a correctly pluralized noun: pluralize(1, 'session') is "1 session".
 *
 * Several counters interpolated the count next to a hardcoded plural, so a new member's
 * dashboard read "1 problems in 1 days" and a language with one attempt read "1 sessions".
 * Pass an explicit plural for nouns that are not formed by adding s.
 */
export const pluralize = (count, singular, plural) => {
  const value = Number(count);
  const safeCount = Number.isFinite(value) ? value : 0;
  const word = Math.abs(safeCount) === 1 ? singular : (plural || `${singular}s`);
  return `${safeCount} ${word}`;
};

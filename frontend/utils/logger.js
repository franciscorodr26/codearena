/**
 * Frontend Logger Utility
 * Only logs in development mode to keep production console clean
 */

const isDev = process.env.NODE_ENV !== 'production';

const logger = {
  log: (...args) => {
    if (isDev) console.log(...args);
  },
  error: (...args) => {
    if (isDev) console.error(...args);
  },
  warn: (...args) => {
    if (isDev) console.warn(...args);
  },
  debug: (...args) => {
    if (isDev) console.log('[DEBUG]', ...args);
  },
  info: (...args) => {
    if (isDev) console.info(...args);
  }
};

export default logger;

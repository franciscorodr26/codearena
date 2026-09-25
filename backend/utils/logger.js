/**
 * Logger module for CodeArena backend
 * Replaces console.log with environment-aware logging
 */

const LOG_LEVELS = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error'
};

const LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

// Colors for terminal output
const COLORS = {
  reset: '\x1b[0m',
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
  dim: '\x1b[2m'
};

function getMinLogLevel() {
  const env = process.env.NODE_ENV || 'development';
  const customLevel = process.env.LOG_LEVEL;

  if (customLevel && LEVEL_PRIORITY[customLevel] !== undefined) {
    return customLevel;
  }

  // In production, only show warnings and errors by default
  return env === 'production' ? LOG_LEVELS.WARN : LOG_LEVELS.DEBUG;
}

function shouldLog(level) {
  const minLevel = getMinLogLevel();
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function formatTimestamp() {
  return new Date().toISOString();
}

function formatMessage(level, message, context, data) {
  const timestamp = formatTimestamp();
  const color = COLORS[level] || COLORS.reset;
  const prefix = `${COLORS.dim}[${timestamp}]${COLORS.reset} ${color}[${level.toUpperCase()}]${COLORS.reset}`;

  let output = `${prefix} ${message}`;

  if (context) {
    output += ` ${COLORS.dim}(${context})${COLORS.reset}`;
  }

  return { output, data };
}

function log(level, message, contextOrData, data) {
  if (!shouldLog(level)) return;

  let context = null;
  let logData = data;

  // Handle overloaded parameters. The null check matters: logger.error builds
  // logData from an Error object then calls log(level, msg, null, logData).
  // Without the `!== null` guard, the third arg (null context) was clobbering
  // logData back to null, so every "Global error handler:" line on prod
  // printed literal "null" instead of the actual SQLite error body.
  if (typeof contextOrData === 'string') {
    context = contextOrData;
  } else if (contextOrData !== undefined && contextOrData !== null) {
    logData = contextOrData;
  }

  const { output } = formatMessage(level, message, context, logData);

  const logFn = level === 'error' ? console.error :
                level === 'warn' ? console.warn :
                console.log;

  logFn(output);

  if (logData !== undefined) {
    // In production, limit data output for security
    if (process.env.NODE_ENV === 'production') {
      // Redact sensitive fields
      const sanitized = sanitizeData(logData);
      console.log(COLORS.dim + JSON.stringify(sanitized, null, 2) + COLORS.reset);
    } else {
      console.log(logData);
    }
  }
}

function sanitizeData(data) {
  if (typeof data !== 'object' || data === null) return data;

  const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'authorization', 'cookie'];
  const sanitized = Array.isArray(data) ? [...data] : { ...data };

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeData(sanitized[key]);
    }
  }

  return sanitized;
}

const logger = {
  debug(message, contextOrData, data) {
    log(LOG_LEVELS.DEBUG, message, contextOrData, data);
  },

  info(message, contextOrData, data) {
    log(LOG_LEVELS.INFO, message, contextOrData, data);
  },

  warn(message, contextOrData, data) {
    log(LOG_LEVELS.WARN, message, contextOrData, data);
  },

  error(message, contextOrDataOrError, dataOrError) {
    let context = null;
    let logData = dataOrError;
    let errorObj = null;

    // Handle Error objects
    if (contextOrDataOrError instanceof Error) {
      errorObj = contextOrDataOrError;
      logData = {
        message: errorObj.message,
        stack: errorObj.stack,
        name: errorObj.name
      };
    } else if (typeof contextOrDataOrError === 'string') {
      context = contextOrDataOrError;
      if (dataOrError instanceof Error) {
        errorObj = dataOrError;
        logData = {
          message: errorObj.message,
          stack: errorObj.stack,
          name: errorObj.name
        };
      }
    } else {
      logData = contextOrDataOrError;
    }

    log(LOG_LEVELS.ERROR, message, context, logData);
  },

  // Create a child logger with a preset context
  child(context) {
    return {
      debug: (message, data) => logger.debug(message, context, data),
      info: (message, data) => logger.info(message, context, data),
      warn: (message, data) => logger.warn(message, context, data),
      error: (message, data) => logger.error(message, context, data)
    };
  }
};

module.exports = logger;
module.exports.LOG_LEVELS = LOG_LEVELS;

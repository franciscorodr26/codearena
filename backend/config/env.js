/**
 * Environment configuration for CodeArena MVP Backend
 *
 * Centralized configuration for environment-specific settings
 */

// Get environment from NODE_ENV
const getEnvironment = () => {
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
};

const environment = getEnvironment();

// Type-safe environment constants
const environments = {
  production: 'production',
  development: 'development'
};

// Type-safe log level constants
const logLevels = {
  INFO: 'INFO',
  VERBOSE: 'VERBOSE'
};

// Configuration object
const config = {
  environment,
  logLevel: logLevels.INFO
};

module.exports = {
  config,
  environments,
  logLevels
};

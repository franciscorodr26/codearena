module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    '**/*.js',
    '!coverage/**',
    '!jest.config.js',
    '!node_modules/**',
    '!tests/**'
  ],
  testMatch: [
    '**/tests/**/*.test.js',
    '**/__tests__/**/*.test.js'
  ],
  // Initialize the shared default SQLite DB once before any suite runs, so the
  // many suites that use it (without their own temp DB_PATH) are order-independent.
  globalSetup: '<rootDir>/tests/globalSetup.js',
  verbose: true,
  testTimeout: 10000,
  forceExit: true
};
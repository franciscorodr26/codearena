/**
 * Jest global setup.
 *
 * Many test suites use the shared default SQLite DB (backend/data.sqlite)
 * without setting their own temp DB_PATH and without calling db.init(). They
 * only pass when some earlier test (or the CI boot step) happened to initialize
 * that file first, so under jest's nondeterministic file order they would
 * intermittently fail with "SQLITE_ERROR: no such table: users / ...".
 *
 * Initializing the default DB exactly once here, before any test file runs,
 * makes those suites deterministic regardless of order. Suites that DO set their
 * own temp DB_PATH are unaffected (they open a different file).
 */
module.exports = async () => {
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  // Require db here (not at file top) so it binds to the default DB_PATH at the
  // moment global setup runs, matching what the default-DB suites will open.
  const db = require('../db');
  if (typeof db.init === 'function') {
    await db.init();
  }
};

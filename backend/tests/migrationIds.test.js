/**
 * Guardrail against the two ways a schema migration gets silently shadowed (and
 * later surfaces as a production `no such column` / `no such table` 500):
 *
 *   1. Duplicate id  — two migrations in db.js share an id; the 2nd never runs.
 *   2. Recycled id   — an id already applied in prod (under migration A) is
 *                      reassigned in source to a different migration B. B's id is
 *                      unique in source, so a plain uniqueness check can't see it,
 *                      but prod has the id marked applied so B is skipped forever.
 *
 * migrations.lock.json is an append-only ledger of every id ever used -> its
 * migration name (including retired ids no longer in source, e.g. 707/798/809,
 * which were recycled and re-issued under fresh ids). This test asserts the
 * db.js migrations array agrees with the ledger. When you add a migration, run
 * `npm run migrations:ledger` to register it.
 */
const { parseSourceMigrations, loadLedger, auditMigrations } = require('../scripts/migrationLedger');

describe('db.js migration ids', () => {
  const source = parseSourceMigrations();
  const ledger = loadLedger();
  const { duplicates, recycled, unregistered } = auditMigrations(source, ledger);

  it('parses a sane number of migrations (guards against a no-op test)', () => {
    expect(source.length).toBeGreaterThan(100);
    expect(Object.keys(ledger).length).toBeGreaterThanOrEqual(source.length);
  });

  it('has no duplicate ids within db.js', () => {
    const msg = duplicates.map(d => `id ${d.id} used by '${d.names[0]}' and '${d.names[1]}'`);
    expect(msg).toEqual([]);
  });

  it('does not recycle an id owned by a different migration', () => {
    // A non-empty list here means an id was reused for a new migration. Give the
    // new migration a fresh (unused) id instead — see the *_demo / prompt-fields
    // re-issues for the pattern.
    const msg = recycled.map(r => `id ${r.id}: ledger owns it as '${r.ledgerName}', db.js now uses it for '${r.sourceName}'`);
    expect(msg).toEqual([]);
  });

  it('registers every migration in migrations.lock.json', () => {
    // New migration not yet in the ledger. Run `npm run migrations:ledger`.
    const msg = unregistered.map(u => `id ${u.id} ('${u.name}') is not in the ledger`);
    expect(msg).toEqual([]);
  });
});

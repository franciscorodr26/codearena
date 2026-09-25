/**
 * Shared helpers for the migration-id ledger (migrations.lock.json).
 *
 * Why this exists: the migration runner keys "already applied" off the numeric
 * id. Two failure modes silently shadow a migration so it never runs in prod
 * (surfacing months later as a `no such column` 500):
 *   1. Duplicate id in source, two migrations share an id; the 2nd is shadowed.
 *   2. Recycled id, an id that was already applied in prod (under migration A)
 *      gets reassigned in source to a different migration B. B's id is unique in
 *      source, so a source-only uniqueness check can't see it, but prod has the
 *      id marked applied, so B is skipped forever.
 *
 * The ledger is an append-only record of every id ever used -> its migration
 * name, INCLUDING retired ids no longer in source. The test (migrationIds.test.js)
 * asserts source agrees with the ledger; update-migration-ledger.js registers new
 * migrations. Together they make both failure modes impossible to ship.
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'db.js');
const LEDGER_PATH = path.join(__dirname, '..', 'migrations.lock.json');

/** Parse the `const migrations = [ ... ];` array out of db.js -> [{id, name}]. */
function parseSourceMigrations(source) {
  if (source === undefined) source = fs.readFileSync(DB_PATH, 'utf8');
  // Slice out just the migrations array so we never pick up `id:`/`name:` keys
  // from unrelated object literals elsewhere in db.js.
  const start = source.indexOf('const migrations = [');
  const end = source.indexOf('\n];', start);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Could not locate the `const migrations = [ ... ];` array in db.js');
  }
  const block = source.slice(start, end);
  // Each entry is `{ ... id: <n>, name: '<name>' ... }`; comments may sit between.
  const re = /\bid:\s*(\d+),\s*(?:\/\/[^\n]*\n\s*)*name:\s*'([^']+)'/g;
  const out = [];
  let m;
  while ((m = re.exec(block)) !== null) {
    out.push({ id: Number(m[1]), name: m[2] });
  }
  return out;
}

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return {};
  return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
}

/** Write the ledger back, stably sorted by numeric id. */
function saveLedger(ledger) {
  const sorted = {};
  for (const id of Object.keys(ledger).map(Number).sort((a, b) => a - b)) {
    sorted[id] = ledger[id];
  }
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(sorted, null, 2) + '\n');
}

/**
 * Audit source migrations against the ledger.
 * @returns {{duplicates: Array, recycled: Array, unregistered: Array}}
 *   duplicates   - id used by more than one migration in source
 *   recycled     - source id whose name differs from the ledger (id reused for a
 *                  different migration than the one that owns it)
 *   unregistered - source id not present in the ledger (new migration not yet
 *                  recorded via update-migration-ledger.js)
 */
function auditMigrations(sourceMigs, ledger) {
  if (sourceMigs === undefined) sourceMigs = parseSourceMigrations();
  if (ledger === undefined) ledger = loadLedger();

  const duplicates = [];
  const recycled = [];
  const unregistered = [];
  const seen = new Map();

  for (const { id, name } of sourceMigs) {
    if (seen.has(id)) {
      duplicates.push({ id, names: [seen.get(id), name] });
    } else {
      seen.set(id, name);
    }
    const owner = ledger[id];
    if (owner === undefined) {
      unregistered.push({ id, name });
    } else if (owner !== name) {
      recycled.push({ id, ledgerName: owner, sourceName: name });
    }
  }
  return { duplicates, recycled, unregistered };
}

module.exports = {
  DB_PATH,
  LEDGER_PATH,
  parseSourceMigrations,
  loadLedger,
  saveLedger,
  auditMigrations,
};

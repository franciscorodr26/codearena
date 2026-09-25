#!/usr/bin/env node
/**
 * Registers db.js migrations into migrations.lock.json.
 *
 * Run this after adding a migration:  npm run migrations:ledger
 *
 * It is append-only and refuses to do anything dangerous:
 *  - bails if db.js has duplicate ids,
 *  - bails if a source id is already owned in the ledger by a DIFFERENT migration
 *    (that is a recycled id, give the new migration a fresh id instead),
 *  - never removes existing entries (retired ids stay locked so they can't be reused).
 *
 * The only time you hand-edit migrations.lock.json is a deliberate rename of an
 * already-shipped migration (rare), change just that entry's value.
 */
const { parseSourceMigrations, loadLedger, saveLedger, LEDGER_PATH } = require('./migrationLedger');

const source = parseSourceMigrations();
const ledger = loadLedger();

// 1) reject duplicate ids in source
const seen = new Map();
const dups = [];
for (const { id, name } of source) {
  if (seen.has(id)) dups.push(`id ${id}: '${seen.get(id)}' and '${name}'`);
  else seen.set(id, name);
}
if (dups.length) {
  console.error('Duplicate migration ids in db.js, fix these before updating the ledger:');
  dups.forEach(d => console.error('  ' + d));
  process.exit(1);
}

// 2) merge: add new ids; refuse to silently re-own an existing id
const recycles = [];
let added = 0;
for (const { id, name } of source) {
  if (ledger[id] === undefined) {
    ledger[id] = name;
    added++;
  } else if (ledger[id] !== name) {
    recycles.push(`  id ${id}: ledger owns it as '${ledger[id]}', db.js now uses it for '${name}'`);
  }
}
if (recycles.length) {
  console.error('Refusing to update, these ids are already owned by a different migration.');
  console.error('Recycling an id silently shadows the migration in production. Give the new migration a fresh id');
  console.error(`(or, for a deliberate rename, hand-edit ${LEDGER_PATH}):`);
  recycles.forEach(r => console.error(r));
  process.exit(1);
}

saveLedger(ledger);
console.log(`Migration ledger updated: ${added} new id(s) registered, ${Object.keys(ledger).length} total.`);

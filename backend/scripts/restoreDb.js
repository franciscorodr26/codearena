#!/usr/bin/env node
/**
 * restoreDb.js - Restore the CodeArena SQLite DB from a backup file.
 *
 * SAFETY MODEL:
 *   1. Decompress (if .gz) the backup into a temp staging file.
 *   2. Open the staged DB READONLY and run PRAGMA integrity_check. Abort if
 *      it does not return "ok". We never overwrite the live DB with a corrupt
 *      backup.
 *   3. Refuse to proceed without --force (destructive operation guard).
 *   4. Snapshot the current live DB to <DB_PATH>.pre-restore-<ts> before
 *      swapping, so a bad restore is itself reversible.
 *   5. Remove stale WAL/SHM sidecars and atomically move the verified backup
 *      into place.
 *
 * USAGE:
 *   node scripts/restoreDb.js <backupFile> --force
 *   node scripts/restoreDb.js <backupFile> --dry-run   # verify only, no swap
 *
 * ENV:
 *   DB_PATH   Target live DB path (matches db.js resolution).
 *
 * IMPORTANT: Stop the backend before restoring. SQLite restore swaps the file
 * on disk; a running process holding the old DB handle will not see the new
 * data and may rewrite the WAL. See docs/DB_BACKUP_RESTORE.md.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

const sqlite3 = require('sqlite3').verbose();

// --- DB_PATH resolution mirrors backend/db.js exactly ---------------------
const DB_PATH = process.env.DB_PATH || (process.env.RAILWAY_ENVIRONMENT
  ? '/data/data.sqlite'
  : path.join(__dirname, '..', 'data.sqlite'));

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const DRY_RUN = argv.includes('--dry-run');
const backupArg = argv.find((a) => !a.startsWith('--'));

function log(...args) {
  console.log(`[restoreDb] ${new Date().toISOString()}`, ...args);
}
function fail(msg, err) {
  console.error(`[restoreDb] ERROR: ${msg}`, err ? (err.stack || err) : '');
  process.exit(1);
}

function timestamp() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\..+/, 'Z');
}

async function gunzipTo(srcPath, destPath) {
  await pipeline(
    fs.createReadStream(srcPath),
    zlib.createGunzip(),
    fs.createWriteStream(destPath)
  );
}

// Open READONLY and confirm PRAGMA integrity_check === 'ok'.
function integrityCheck(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(new Error(`backup does not open: ${err.message}`));
      db.get('PRAGMA integrity_check', (qErr, row) => {
        const result = row && (row.integrity_check || row['integrity_check']);
        db.close(() => {
          if (qErr) return reject(new Error(`integrity_check failed: ${qErr.message}`));
          if (result !== 'ok') return reject(new Error(`integrity_check returned: ${result}`));
          resolve(result);
        });
      });
    });
  });
}

function usage() {
  console.error('Usage: node scripts/restoreDb.js <backupFile> --force [--dry-run]');
}

async function main() {
  if (!backupArg) {
    usage();
    fail('no backup file specified.');
  }
  const backupFile = path.resolve(backupArg);
  if (!fs.existsSync(backupFile)) {
    fail(`backup file not found: ${backupFile}`);
  }

  log(`Backup file = ${backupFile}`);
  log(`Target DB_PATH = ${DB_PATH}`);

  // 1. Stage: decompress if needed.
  const staged = path.join(os.tmpdir(), `cadb-restore-${timestamp()}-${process.pid}.sqlite`);
  const isGz = backupFile.endsWith('.gz');
  if (isGz) {
    log('Decompressing gzip backup to staging ...');
    await gunzipTo(backupFile, staged);
  } else {
    fs.copyFileSync(backupFile, staged);
  }

  // 2. Verify BEFORE touching the live DB.
  log('Verifying staged backup (PRAGMA integrity_check) ...');
  await integrityCheck(staged);
  log('integrity_check = ok');

  if (DRY_RUN) {
    fs.unlinkSync(staged);
    log('Dry run only. Backup is valid and restorable. No changes made.');
    return;
  }

  // 3. Destructive-operation guard.
  if (!FORCE) {
    fs.unlinkSync(staged);
    console.error('');
    console.error('[restoreDb] REFUSING to overwrite the live DB without --force.');
    console.error(`[restoreDb] This will REPLACE ${DB_PATH} with the backup contents.`);
    console.error('[restoreDb] Stop the backend first, then re-run with --force:');
    console.error(`[restoreDb]     node scripts/restoreDb.js ${backupArg} --force`);
    process.exit(2);
  }

  // 4. Snapshot the current live DB (if any) so the restore is reversible.
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    const preRestore = `${DB_PATH}.pre-restore-${timestamp()}`;
    fs.copyFileSync(DB_PATH, preRestore);
    log(`Snapshotted current live DB to: ${preRestore}`);
  } else {
    log('No existing live DB found; creating fresh from backup.');
  }

  // 5. Clear stale WAL/SHM sidecars so they cannot resurrect old data,
  //    then atomically move the verified backup into place.
  for (const sidecar of ['-wal', '-shm']) {
    const p = DB_PATH + sidecar;
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      log(`Removed stale sidecar: ${path.basename(p)}`);
    }
  }

  // rename is atomic only within the same filesystem; fall back to copy.
  try {
    fs.renameSync(staged, DB_PATH);
  } catch (e) {
    if (e.code === 'EXDEV') {
      fs.copyFileSync(staged, DB_PATH);
      fs.unlinkSync(staged);
    } else {
      throw e;
    }
  }

  // 6. Final confidence check on the now-live DB.
  log('Re-verifying restored live DB ...');
  await integrityCheck(DB_PATH);
  log('integrity_check = ok');

  log('Restore complete. Start the backend now.');
}

main().catch((e) => fail('restore failed', e));

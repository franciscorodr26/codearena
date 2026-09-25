#!/usr/bin/env node
/**
 * backupDb.js - Consistent backup of the CodeArena SQLite database.
 *
 * WHY: There is no backup today. On Railway the DB lives on a volume at
 * process.env.DB_PATH (default /data/data.sqlite). A volume loss = total data
 * loss. This script produces a consistent, point-in-time snapshot using
 * SQLite's online backup API (the same semantics as the `.backup` command),
 * which is WAL-safe - it does NOT just `cp` a live database file.
 *
 * USAGE:
 *   node scripts/backupDb.js [outputDir]
 *
 * ENV:
 *   DB_PATH            Path to the live DB (matches db.js resolution).
 *   BACKUP_DIR         Output directory (default ./backups under backend, or arg).
 *   BACKUP_RETENTION   Keep last N backups, prune older (default 14, 0 = keep all).
 *   BACKUP_GZIP        "0"/"false" to skip gzip (default: gzip on).
 *
 * OPTIONAL OFFSITE (all no-op unless their envs are present):
 *   BACKUP_WEBHOOK_URL          POST the backup file to this URL.
 *   BACKUP_S3_BUCKET            Upload to S3 (requires @aws-sdk/client-s3 + creds).
 *   BACKUP_S3_PREFIX            Key prefix within the bucket (default "db-backups/").
 *   BACKUP_S3_ENDPOINT          Custom endpoint (e.g. R2 / MinIO).
 *   BACKUP_S3_REGION            AWS region (default us-east-1).
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  Standard AWS creds.
 *
 * EXIT CODES: 0 success, non-zero on failure (safe for cron alerting).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const crypto = require('crypto');

const sqlite3 = require('sqlite3').verbose();

// --- DB_PATH resolution mirrors backend/db.js exactly ---------------------
const DB_PATH = process.env.DB_PATH || (process.env.RAILWAY_ENVIRONMENT
  ? '/data/data.sqlite'
  : path.join(__dirname, '..', 'data.sqlite'));

// --- Config ---------------------------------------------------------------
const OUTPUT_DIR = process.argv[2] || process.env.BACKUP_DIR
  || path.join(__dirname, '..', 'backups');
const RETENTION = parseInt(process.env.BACKUP_RETENTION || '14', 10);
const GZIP = !['0', 'false', 'no'].includes(String(process.env.BACKUP_GZIP || '').toLowerCase());

const FILE_PREFIX = 'data-';
const RAW_SUFFIX = '.sqlite';
const GZ_SUFFIX = '.sqlite.gz';

function log(...args) {
  console.log(`[backupDb] ${new Date().toISOString()}`, ...args);
}
function fail(msg, err) {
  console.error(`[backupDb] ERROR: ${msg}`, err ? (err.stack || err) : '');
  process.exit(1);
}

// Timestamp like 2026-06-21T14-03-09Z (filesystem-safe, sortable).
function timestamp() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\..+/, 'Z');
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('error', reject);
    s.on('data', (d) => hash.update(d));
    s.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Consistent online backup of `srcPath` into `destPath` using sqlite3's
 * backup API. Opens the source READONLY so we never mutate the live DB.
 */
function onlineBackup(srcPath, destPath) {
  return new Promise((resolve, reject) => {
    const src = new sqlite3.Database(srcPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(new Error(`cannot open source DB: ${err.message}`));

      // db.backup(filename) creates the destination and streams pages.
      // step(-1) copies all remaining pages in one shot; finish() releases.
      let backup;
      try {
        backup = src.backup(destPath);
      } catch (e) {
        src.close(() => {});
        return reject(new Error(`backup init failed: ${e.message}`));
      }

      backup.step(-1, (stepErr) => {
        if (stepErr) {
          try { backup.finish(() => {}); } catch (_) { /* ignore */ }
          src.close(() => {});
          return reject(new Error(`backup step failed: ${stepErr.message}`));
        }
        backup.finish((finErr) => {
          src.close(() => {});
          if (finErr) return reject(new Error(`backup finish failed: ${finErr.message}`));
          resolve();
        });
      });
    });
  });
}

// Verify a freshly created raw backup opens and passes integrity_check.
function verifyBackup(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(new Error(`backup does not open: ${err.message}`));
      db.get('PRAGMA integrity_check', (qErr, row) => {
        const result = row && (row.integrity_check || row['integrity_check']);
        db.close(() => {
          if (qErr) return reject(new Error(`integrity_check failed: ${qErr.message}`));
          if (result !== 'ok') return reject(new Error(`integrity_check returned: ${result}`));
          resolve();
        });
      });
    });
  });
}

async function gzipFile(srcPath, destPath) {
  await pipeline(
    fs.createReadStream(srcPath),
    zlib.createGzip({ level: 9 }),
    fs.createWriteStream(destPath)
  );
}

// Keep the most recent RETENTION backups; delete older ones.
function pruneOldBackups(dir, retention) {
  if (!retention || retention <= 0) {
    log('Retention disabled (BACKUP_RETENTION=0); keeping all backups.');
    return;
  }
  const entries = fs.readdirSync(dir)
    .filter((f) => f.startsWith(FILE_PREFIX) && (f.endsWith(RAW_SUFFIX) || f.endsWith(GZ_SUFFIX)))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime); // newest first

  const toDelete = entries.slice(retention);
  for (const e of toDelete) {
    fs.unlinkSync(path.join(dir, e.name));
    log(`Pruned old backup: ${e.name}`);
  }
  if (toDelete.length === 0) {
    log(`Retention OK (${entries.length}/${retention} kept).`);
  }
}

// --- Optional offsite upload (guarded; no-op without envs) -----------------
async function maybeUploadWebhook(filePath) {
  const url = process.env.BACKUP_WEBHOOK_URL;
  if (!url) return false;
  log(`Uploading backup to webhook ${url} ...`);
  const data = fs.readFileSync(filePath);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Backup-Filename': path.basename(filePath),
    },
    body: data,
  });
  if (!res.ok) throw new Error(`webhook upload failed: HTTP ${res.status}`);
  log('Webhook upload OK.');
  return true;
}

async function maybeUploadS3(filePath) {
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) return false;
  let S3;
  try {
    // Lazy require so the script does not hard-depend on the AWS SDK.
    S3 = require('@aws-sdk/client-s3');
  } catch (_) {
    throw new Error(
      'BACKUP_S3_BUCKET is set but @aws-sdk/client-s3 is not installed. '
      + 'Run `npm i @aws-sdk/client-s3` in backend/, or unset BACKUP_S3_BUCKET.'
    );
  }
  const prefix = process.env.BACKUP_S3_PREFIX || 'db-backups/';
  const key = prefix.replace(/\/$/, '') + '/' + path.basename(filePath);
  const client = new S3.S3Client({
    region: process.env.BACKUP_S3_REGION || 'us-east-1',
    endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,
  });
  log(`Uploading backup to s3://${bucket}/${key} ...`);
  await client.send(new S3.PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fs.readFileSync(filePath),
  }));
  log('S3 upload OK.');
  return true;
}

async function main() {
  log(`DB_PATH = ${DB_PATH}`);
  if (!fs.existsSync(DB_PATH)) {
    fail(`Source DB does not exist at ${DB_PATH}. Set DB_PATH correctly.`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  log(`Output dir = ${OUTPUT_DIR}`);

  const ts = timestamp();
  // Always produce the raw backup first (in a temp staging file), verify it,
  // then optionally gzip and finally move into place atomically.
  const stagingRaw = path.join(os.tmpdir(), `cadb-backup-${ts}-${process.pid}.sqlite`);

  log('Running online backup (WAL-safe, READONLY source) ...');
  await onlineBackup(DB_PATH, stagingRaw);

  log('Verifying backup integrity (PRAGMA integrity_check) ...');
  await verifyBackup(stagingRaw);
  log('integrity_check = ok');

  const rawSize = fs.statSync(stagingRaw).size;
  const checksum = await sha256(stagingRaw);

  let finalPath;
  if (GZIP) {
    const stagingGz = stagingRaw + '.gz';
    await gzipFile(stagingRaw, stagingGz);
    fs.unlinkSync(stagingRaw);
    finalPath = path.join(OUTPUT_DIR, `${FILE_PREFIX}${ts}${GZ_SUFFIX}`);
    fs.renameSync(stagingGz, finalPath);
  } else {
    finalPath = path.join(OUTPUT_DIR, `${FILE_PREFIX}${ts}${RAW_SUFFIX}`);
    fs.renameSync(stagingRaw, finalPath);
  }

  const finalSize = fs.statSync(finalPath).size;
  log(`Backup written: ${finalPath}`);
  log(`  raw size: ${rawSize} bytes | stored size: ${finalSize} bytes | sha256(raw): ${checksum}`);

  // Optional offsite copies (guarded; silently skipped without envs).
  try {
    const wh = await maybeUploadWebhook(finalPath);
    const s3 = await maybeUploadS3(finalPath);
    if (!wh && !s3) log('No offsite target configured (BACKUP_WEBHOOK_URL / BACKUP_S3_BUCKET unset); local backup only.');
  } catch (e) {
    // Offsite failure should not destroy the local backup, but must be loud.
    fail(`offsite upload failed (local backup is intact at ${finalPath})`, e);
  }

  // Prune AFTER a successful new backup so we never drop coverage on failure.
  pruneOldBackups(OUTPUT_DIR, RETENTION);

  log('Backup complete.');
}

main().catch((e) => fail('backup failed', e));

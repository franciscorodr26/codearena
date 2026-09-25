'use strict';

/**
 * Nightly offsite database backup scheduler.
 *
 * Runs scripts/backupDb.js (snapshot + gzip + offsite upload) on a cron. It is a
 * deliberate NO-OP unless an offsite destination is configured (BACKUP_S3_BUCKET),
 * because a backup that only lands on the same single Railway volume as the live DB
 * does not protect against the failure mode that matters (a volume loss). So this is
 * safe to ship before the bucket exists; it activates on the next restart after
 * BACKUP_S3_BUCKET (+ creds) are set on the host.
 *
 * The backup runs in a forked child process so a slow snapshot/upload never blocks
 * the event loop, and an overlapping tick is skipped rather than piling up.
 *
 * Env:
 *   BACKUP_S3_BUCKET   Required to enable scheduling (and by backupDb.js to upload).
 *   BACKUP_CRON        Optional cron expression (default '0 3 * * *' = 03:00 daily).
 */
const path = require('path');
const { fork } = require('child_process');
const cron = require('node-cron');
const logger = require('../utils/logger');

function startBackupScheduler() {
  if (!process.env.BACKUP_S3_BUCKET) {
    logger.info('[Backup] Nightly backup not scheduled (BACKUP_S3_BUCKET unset; backups would not be offsite)');
    return null;
  }

  const expr = process.env.BACKUP_CRON || '0 3 * * *';
  if (!cron.validate(expr)) {
    logger.error(`[Backup] Invalid BACKUP_CRON "${expr}" - nightly backup not scheduled`);
    return null;
  }

  const scriptPath = path.join(__dirname, '..', 'scripts', 'backupDb.js');
  let running = false;

  const task = cron.schedule(expr, () => {
    if (running) {
      logger.warn('[Backup] Previous backup still running - skipping this tick');
      return;
    }
    running = true;
    logger.info('[Backup] Starting scheduled DB backup');

    let child;
    try {
      child = fork(scriptPath, [], { stdio: 'inherit' });
    } catch (err) {
      running = false;
      logger.error(`[Backup] Failed to launch backup process: ${err.message}`);
      return;
    }

    child.on('exit', (code) => {
      running = false;
      if (code === 0) logger.info('[Backup] Scheduled DB backup completed');
      else logger.error(`[Backup] Scheduled DB backup failed (exit code ${code})`);
    });
    child.on('error', (err) => {
      running = false;
      logger.error(`[Backup] Backup process error: ${err.message}`);
    });
  });

  logger.info(`[Backup] Nightly DB backup scheduled (${expr}); offsite upload via BACKUP_S3_BUCKET`);
  return task;
}

module.exports = { startBackupScheduler };

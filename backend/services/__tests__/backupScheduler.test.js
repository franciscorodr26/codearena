const cron = require('node-cron');

jest.mock('node-cron', () => ({
  schedule: jest.fn(() => ({ stop: jest.fn() })),
  validate: jest.fn(() => true),
}));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { startBackupScheduler } = require('../backupScheduler');

describe('startBackupScheduler', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    cron.validate.mockReturnValue(true);
    process.env = { ...ORIGINAL_ENV };
    delete process.env.BACKUP_S3_BUCKET;
    delete process.env.BACKUP_CRON;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('does not schedule (no-op) when BACKUP_S3_BUCKET is unset', () => {
    const task = startBackupScheduler();
    expect(task).toBeNull();
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  it('schedules a 03:00 daily backup when BACKUP_S3_BUCKET is set', () => {
    process.env.BACKUP_S3_BUCKET = 'my-bucket';
    const task = startBackupScheduler();
    expect(task).not.toBeNull();
    expect(cron.schedule).toHaveBeenCalledWith('0 3 * * *', expect.any(Function));
  });

  it('honors a BACKUP_CRON override', () => {
    process.env.BACKUP_S3_BUCKET = 'my-bucket';
    process.env.BACKUP_CRON = '30 4 * * *';
    startBackupScheduler();
    expect(cron.schedule).toHaveBeenCalledWith('30 4 * * *', expect.any(Function));
  });

  it('does not schedule when the cron expression is invalid', () => {
    process.env.BACKUP_S3_BUCKET = 'my-bucket';
    process.env.BACKUP_CRON = 'not-a-cron';
    cron.validate.mockReturnValue(false);
    const task = startBackupScheduler();
    expect(task).toBeNull();
    expect(cron.schedule).not.toHaveBeenCalled();
  });
});

const path = require('path');
const fs = require('fs');
const os = require('os');

// Use a dedicated temp SQLite file so we don't collide with dev data.
const TEST_DB_PATH = path.join(os.tmpdir(), `codearena-webhook-events-${Date.now()}-${process.pid}.sqlite`);
process.env.DB_PATH = TEST_DB_PATH;

const db = require('../db');

describe('startWebhookEventProcessing', () => {
  beforeAll(async () => {
    await db.init();
  });

  afterAll(async () => {
    try {
      fs.unlinkSync(TEST_DB_PATH);
      fs.existsSync(TEST_DB_PATH + '-wal') && fs.unlinkSync(TEST_DB_PATH + '-wal');
      fs.existsSync(TEST_DB_PATH + '-shm') && fs.unlinkSync(TEST_DB_PATH + '-shm');
    } catch (_) {}
  });

  beforeEach(async () => {
    await db.run('DELETE FROM webhook_events');
  });

  it('inserts a new pending row and allows processing on first call', async () => {
    const result = await db.startWebhookEventProcessing('evt_first', 'checkout.session.completed');
    expect(result).toEqual({ canProcess: true });

    const row = await db.get('SELECT id, event_type, status FROM webhook_events WHERE id = ?', ['evt_first']);
    expect(row).toMatchObject({
      id: 'evt_first',
      event_type: 'checkout.session.completed',
      status: 'pending'
    });
  });

  it('skips an event already marked completed', async () => {
    await db.run(
      `INSERT INTO webhook_events (id, event_type, processed_at, status)
       VALUES (?, ?, ?, 'completed')`,
      ['evt_done', 'invoice.paid', new Date().toISOString()]
    );

    const result = await db.startWebhookEventProcessing('evt_done', 'invoice.paid');
    expect(result).toEqual({ canProcess: false, reason: 'completed' });

    const row = await db.get('SELECT status FROM webhook_events WHERE id = ?', ['evt_done']);
    expect(row.status).toBe('completed');
  });

  it('skips an event another worker is currently processing (pending)', async () => {
    await db.run(
      `INSERT INTO webhook_events (id, event_type, processed_at, status)
       VALUES (?, ?, ?, 'pending')`,
      ['evt_inflight', 'checkout.session.completed', new Date().toISOString()]
    );

    const result = await db.startWebhookEventProcessing('evt_inflight', 'checkout.session.completed');
    expect(result).toEqual({ canProcess: false, reason: 'pending' });

    const row = await db.get('SELECT status FROM webhook_events WHERE id = ?', ['evt_inflight']);
    expect(row.status).toBe('pending');
  });

  it('allows retry of a failed event and clears the stale error_message', async () => {
    await db.run(
      `INSERT INTO webhook_events (id, event_type, processed_at, status, error_message)
       VALUES (?, ?, ?, 'failed', ?)`,
      ['evt_failed', 'invoice.paid', new Date().toISOString(), 'transient handler error']
    );

    const result = await db.startWebhookEventProcessing('evt_failed', 'invoice.paid');
    expect(result).toEqual({ canProcess: true });

    const row = await db.get(
      'SELECT status, error_message FROM webhook_events WHERE id = ?',
      ['evt_failed']
    );
    expect(row.status).toBe('pending');
    expect(row.error_message).toBeNull();
  });

  it('failed -> completed via the full lifecycle still records the final status', async () => {
    // Simulate the deadlock-recovery path end-to-end.
    await db.run(
      `INSERT INTO webhook_events (id, event_type, processed_at, status, error_message)
       VALUES (?, ?, ?, 'failed', ?)`,
      ['evt_cycle', 'invoice.paid', new Date().toISOString(), 'boom']
    );

    const start = await db.startWebhookEventProcessing('evt_cycle', 'invoice.paid');
    expect(start.canProcess).toBe(true);

    await db.completeWebhookEvent('evt_cycle');

    const row = await db.get('SELECT status, error_message FROM webhook_events WHERE id = ?', ['evt_cycle']);
    expect(row.status).toBe('completed');
    expect(row.error_message).toBeNull();

    // A subsequent retry from Stripe must now be treated as duplicate.
    const second = await db.startWebhookEventProcessing('evt_cycle', 'invoice.paid');
    expect(second).toEqual({ canProcess: false, reason: 'completed' });
  });
});

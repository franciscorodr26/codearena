/**
 * Tests for handleChargeRefunded (Bug M1 regression):
 *   A full refund of a one-time credit-pack charge must NOT revoke Pro from
 *   an active subscriber. This consumer service ignores all subscription
 *   charges and only reverses its own customer-bound CreatorArena purchases.
 */

// Mock db before requiring the route under test.
jest.mock('../db', () => ({
  get: jest.fn(),
  getUserById: jest.fn(),
  setUserProStatus: jest.fn(),
  revokePurchasedCredits: jest.fn(),
  init: jest.fn()
}));

// Auth middleware isn't exercised here, but the route file requires it.
jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => next()
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../services/email', () => ({
  sendStudentVerificationEmail: jest.fn(),
  sendPaymentFailedEmail: jest.fn()
}));

jest.mock('../services/eduEmailValidator', () => ({
  validateEduEmail: jest.fn()
}));

jest.mock('../middleware/validation', () => ({
  chains: {}
}));

// Avoid initializing the real Stripe client.
const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY;
beforeAll(() => {
  delete process.env.STRIPE_SECRET_KEY;
});
afterAll(() => {
  if (ORIGINAL_KEY !== undefined) process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY;
});

const db = require('../db');
const paymentRouter = require('../routes/payment');
const handleChargeRefunded = paymentRouter.handleChargeRefunded;
const creatorMetadata = {
  product: 'codearena', codearenaUserId: '42', type: 'codearena_credit_purchase',
  packId: 'small', credits: '100'
};

describe('handleChargeRefunded — Bug M1', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: user lookup succeeds.
    db.get.mockResolvedValue({ id: 42 });
    db.getUserById.mockResolvedValue({ id: 42, stripe_customer_id: 'cus_active_subscriber' });
    db.revokePurchasedCredits.mockResolvedValue({ revoked: 100, credits: { balance: 0 } });
  });

  it('exports handleChargeRefunded for direct invocation', () => {
    expect(typeof handleChargeRefunded).toBe('function');
  });

  it('ignores shared-account subscription refunds, preserving the shared account billing ownership', async () => {
    const charge = {
      id: 'ch_sub_1',
      customer: 'cus_active_subscriber',
      invoice: 'in_sub_renewal_1',
      refunded: true,
      amount_refunded: 900,
      metadata: {}
    };

    await handleChargeRefunded(charge);

    expect(db.setUserProStatus).not.toHaveBeenCalled();
    expect(db.revokePurchasedCredits).not.toHaveBeenCalled();
  });

  it('does NOT revoke Pro when a one-time charge (no charge.invoice) is fully refunded', async () => {
    // This is the bug case: an active subscriber buys a $5 credit pack via a
    // mode:'payment' checkout and later gets it refunded. The refund's charge
    // has no `invoice` field. Pro must remain intact.
    const charge = {
      id: 'ch_credit_pack_1',
      customer: 'cus_active_subscriber',
      invoice: null,
      refunded: true,
      amount_refunded: 500,
      metadata: {}
    };

    await handleChargeRefunded(charge);

    expect(db.setUserProStatus).not.toHaveBeenCalled();
  });

  it('does NOT revoke Pro on a credit_purchase one-time charge, and deducts the granted credits', async () => {
    const charge = {
      id: 'ch_credit_pack_2',
      customer: 'cus_active_subscriber',
      invoice: null,
      refunded: true,
      currency: 'usd',
      amount: 500,
      amount_refunded: 500,
      metadata: creatorMetadata
    };

    await handleChargeRefunded(charge);

    expect(db.setUserProStatus).not.toHaveBeenCalled();
    expect(db.revokePurchasedCredits).toHaveBeenCalledTimes(1);
    expect(db.revokePurchasedCredits).toHaveBeenCalledWith(
      42,
      100,
      'creator-credit-reversal:ch_credit_pack_2',
      expect.stringContaining('ch_credit_pack_2')
    );
  });

  it('does NOT revoke Pro even if metadata claims credit_purchase and invoice happens to be set', async () => {
    // Defense in depth: if a charge is tagged as a credit purchase via metadata
    // we should never strip Pro, regardless of the invoice field.
    const charge = {
      id: 'ch_weird',
      customer: 'cus_active_subscriber',
      invoice: 'in_should_be_ignored',
      refunded: true,
      amount_refunded: 500,
      metadata: { type: 'credit_purchase', credits: '100' }
    };

    await handleChargeRefunded(charge);

    expect(db.setUserProStatus).not.toHaveBeenCalled();
  });

  it('ignores partial refunds on unrelated one-time charges', async () => {
    const charge = {
      id: 'ch_partial_one_time',
      customer: 'cus_active_subscriber',
      invoice: null,
      refunded: false,
      amount_refunded: 250,
      metadata: {}
    };

    await handleChargeRefunded(charge);

    expect(db.setUserProStatus).not.toHaveBeenCalled();
    expect(db.revokePurchasedCredits).not.toHaveBeenCalled();
  });

  it('reverses the proportional credits for a partial credit-pack refund', async () => {
    const charge = {
      id: 'ch_partial_credit_pack',
      customer: 'cus_active_subscriber',
      invoice: null,
      refunded: false,
      currency: 'usd',
      amount: 500,
      amount_refunded: 125,
      metadata: creatorMetadata
    };

    await handleChargeRefunded(charge);

    expect(db.setUserProStatus).not.toHaveBeenCalled();
    expect(db.revokePurchasedCredits).toHaveBeenCalledWith(
      42,
      25,
      'creator-credit-reversal:ch_partial_credit_pack',
      expect.stringContaining('ch_partial_credit_pack')
    );
  });

  it('logs partial refunds on subscription charges without revoking Pro', async () => {
    const charge = {
      id: 'ch_partial_sub',
      customer: 'cus_active_subscriber',
      invoice: 'in_sub_1',
      refunded: false,
      amount_refunded: 200,
      metadata: {}
    };

    await handleChargeRefunded(charge);

    expect(db.setUserProStatus).not.toHaveBeenCalled();
  });

  it('returns early if charge has no customer id', async () => {
    await handleChargeRefunded({
      id: 'ch_no_customer',
      customer: null,
      invoice: 'in_1',
      refunded: true,
      amount_refunded: 900,
      metadata: {}
    });
    expect(db.get).not.toHaveBeenCalled();
    expect(db.setUserProStatus).not.toHaveBeenCalled();
  });

  it('returns early if user is not found for the customer id', async () => {
    db.getUserById.mockResolvedValueOnce(null);
    await handleChargeRefunded({
      id: 'ch_orphan',
      customer: 'cus_unknown',
      invoice: 'in_1',
      refunded: true,
      amount_refunded: 900,
      metadata: creatorMetadata
    });
    expect(db.setUserProStatus).not.toHaveBeenCalled();
  });

  it('propagates credit reversal failures so Stripe can retry the webhook', async () => {
    db.revokePurchasedCredits.mockRejectedValueOnce(new Error('boom'));
    const charge = {
      id: 'ch_credit_pack_fail',
      customer: 'cus_active_subscriber',
      invoice: null,
      refunded: true,
      currency: 'usd',
      amount: 500,
      amount_refunded: 500,
      metadata: creatorMetadata
    };

    await expect(handleChargeRefunded(charge)).rejects.toThrow('boom');
    expect(db.setUserProStatus).not.toHaveBeenCalled();
  });
});

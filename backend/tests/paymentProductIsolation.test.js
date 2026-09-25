const mockStripe = {
  customers: { create: jest.fn(), retrieve: jest.fn() },
  checkout: { sessions: { create: jest.fn(), retrieve: jest.fn() } },
  charges: { retrieve: jest.fn() },
  webhooks: { constructEvent: jest.fn() },
  subscriptions: { retrieve: jest.fn(), update: jest.fn(), list: jest.fn() },
  billingPortal: { sessions: { create: jest.fn() } }
}
jest.mock('stripe', () => () => mockStripe)
jest.mock('../db', () => ({
  getUserById: jest.fn(), get: jest.fn(), run: jest.fn(),
  addPurchasedCredits: jest.fn(), revokePurchasedCredits: jest.fn(),
  setUserProStatus: jest.fn(), getUserSubscription: jest.fn(),
  startWebhookEventProcessing: jest.fn(), completeWebhookEvent: jest.fn(), failWebhookEvent: jest.fn()
}))
jest.mock('../routes/auth', () => ({ authMiddleware: (req, res, next) => next() }))
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }))
jest.mock('../services/email', () => ({ sendStudentVerificationEmail: jest.fn(), sendPaymentFailedEmail: jest.fn() }))
jest.mock('../services/eduEmailValidator', () => ({ validateEduEmail: jest.fn() }))
jest.mock('express-rate-limit', () => {
  const limiter = () => (req, res, next) => next()
  limiter.ipKeyGenerator = ip => ip
  return limiter
})

process.env.STRIPE_SECRET_KEY = 'sk_test_product_isolation_fixture'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_product_isolation_fixture'
const router = require('../routes/payment')
const db = require('../db')

const metadata = () => ({
  product: 'codearena', codearenaUserId: '7', type: 'codearena_credit_purchase',
  packId: 'small', credits: '100'
})
const session = (overrides = {}) => ({
  id: 'cs_codearena', customer: 'cus_codearena', payment_intent: 'pi_codearena',
  metadata: metadata(), mode: 'payment', status: 'complete', payment_status: 'paid',
  currency: 'usd', amount_total: 500, ...overrides
})
const charge = (overrides = {}) => ({
  id: 'ch_codearena', customer: 'cus_codearena', metadata: metadata(),
  currency: 'usd', amount: 500, amount_refunded: 500, refunded: true, ...overrides
})
function response() {
  return { statusCode: 200, sent: false,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; this.sent = true; return this },
    send(body) { this.body = body; this.sent = true; return this }
  }
}
async function route(path, body = {}, method = 'post') {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method])
  const req = { body, user: { sub: 7 }, ip: '127.0.0.1' }
  const res = response()
  for (const handler of layer.route.stack) {
    await handler.handle(req, res, () => {})
    if (res.sent) break
  }
  return res
}
async function webhook(type, object) {
  mockStripe.webhooks.constructEvent.mockReturnValue({ id: 'evt_fixture', type, data: { object } })
  const res = response()
  await router.handleWebhook({ headers: { 'stripe-signature': 'signature_fixture' }, body: Buffer.from('{}') }, res)
  return res
}

beforeEach(() => {
  jest.clearAllMocks()
  db.getUserById.mockResolvedValue({ id: 7, email: 'fixture@example.test', stripe_customer_id: 'cus_codearena' })
  db.get.mockResolvedValue({ id: 7 })
  db.addPurchasedCredits.mockResolvedValue({ credited: true, credits: { balance: 100 } })
  db.revokePurchasedCredits.mockResolvedValue({ revoked: 100 })
  db.startWebhookEventProcessing.mockResolvedValue({ canProcess: true })
  mockStripe.customers.retrieve.mockResolvedValue({ id: 'cus_codearena', metadata: metadata() })
  mockStripe.customers.create.mockResolvedValue({ id: 'cus_fresh_codearena' })
  mockStripe.checkout.sessions.create.mockResolvedValue({ id: 'cs_fixture', url: 'https://checkout.stripe.com/fixture' })
  mockStripe.checkout.sessions.retrieve.mockResolvedValue(session())
  mockStripe.charges.retrieve.mockResolvedValue(charge())
})

test('new purchases use metadata that legacy checkout handlers cannot claim', async () => {
  const res = await route('/purchase-credits', { packId: 'small' })
  expect(res.statusCode).toBe(200)
  const checkout = mockStripe.checkout.sessions.create.mock.calls[0][0]
  for (const value of [checkout.metadata, checkout.payment_intent_data.metadata]) {
    expect(value).toMatchObject(metadata())
    expect(value).not.toHaveProperty('userId')
    expect(value).not.toHaveProperty('companyId')
    expect(value.type).not.toBe('credit_purchase')
  }
})

test('a foreign customer pointer is replaced locally without modifying its Stripe customer', async () => {
  mockStripe.customers.retrieve.mockResolvedValue({ id: 'cus_other_product', metadata: { userId: '7' } })
  await route('/purchase-credits', { packId: 'small' })
  expect(mockStripe.customers.create).toHaveBeenCalledWith({
    email: 'fixture@example.test', metadata: { product: 'codearena', codearenaUserId: '7' }
  }, { idempotencyKey: 'codearena:customer:v1:7' })
  expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_fresh_codearena' }))
  expect(db.run).toHaveBeenCalledWith(expect.any(String), ['cus_fresh_codearena', 7])
})

test.each([
  { metadata: { userId: '7', type: 'credit_purchase', packId: 'small', credits: '100' } },
  { metadata: { ...metadata(), product: 'other' } },
  { metadata: { ...metadata(), codearenaUserId: '8' } },
  { metadata: { ...metadata(), codearenaUserId: '7junk' } },
  { metadata: { ...metadata(), userId: '7' } },
  { customer: 'cus_other_product' }
])('verification rejects foreign or mismatched ownership: %j', async (overrides) => {
  mockStripe.checkout.sessions.retrieve.mockResolvedValue(session(overrides))
  const res = await route('/verify-credit-purchase', { sessionId: 'cs_fixture' })
  expect(res.statusCode).toBe(403)
  expect(db.addPurchasedCredits).not.toHaveBeenCalled()
})

test.each([{ currency: 'eur' }, { amount_total: 499 }, { mode: 'subscription' }])('verification validates purchase economics: %j', async (overrides) => {
  mockStripe.checkout.sessions.retrieve.mockResolvedValue(session(overrides))
  const res = await route('/verify-credit-purchase', { sessionId: 'cs_fixture' })
  expect(res.statusCode).toBe(400)
  expect(db.addPurchasedCredits).not.toHaveBeenCalled()
})

test('verification waits for payment completion', async () => {
  mockStripe.checkout.sessions.retrieve.mockResolvedValue(session({ payment_status: 'unpaid' }))
  const res = await route('/verify-credit-purchase', { sessionId: 'cs_fixture' })
  expect(res.body.verified).toBe(false)
  expect(db.addPurchasedCredits).not.toHaveBeenCalled()
})

test('own paid checkout verifies and grants the configured pack', async () => {
  const res = await route('/verify-credit-purchase', { sessionId: 'cs_fixture' })
  expect(res.body.verified).toBe(true)
  expect(db.addPurchasedCredits).toHaveBeenCalledWith(7, 100, 'pi_codearena', expect.any(String))
})

test.each(['customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'])('shared-account %s does not touch billing or event tables', async (type) => {
  const res = await webhook(type, { id: 'sub_other_product', customer: 'cus_codearena', metadata: { userId: '7' } })
  expect(res.body.ignored).toBe(true)
  expect(db.startWebhookEventProcessing).not.toHaveBeenCalled()
  expect(db.setUserProStatus).not.toHaveBeenCalled()
  expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled()
})

test.each(['checkout.session.completed', 'charge.refunded'])('foreign %s with a colliding user ID is ignored', async (type) => {
  const res = await webhook(type, session({ metadata: { userId: '7', type: 'credit_purchase' } }))
  expect(res.body.ignored).toBe(true)
  expect(db.addPurchasedCredits).not.toHaveBeenCalled()
  expect(db.revokePurchasedCredits).not.toHaveBeenCalled()
})

test('own checkout webhook credits the customer-bound user', async () => {
  const res = await webhook('checkout.session.completed', session())
  expect(res.statusCode).toBe(200)
  expect(db.addPurchasedCredits).toHaveBeenCalledWith(7, 100, 'pi_codearena', expect.any(String))
})

test('own metadata with a foreign customer cannot credit through webhook', async () => {
  await webhook('checkout.session.completed', session({ customer: 'cus_other_product' }))
  expect(db.addPurchasedCredits).not.toHaveBeenCalled()
})

test('a partial refund reverses only the proportional configured pack credits', async () => {
  await webhook('charge.refunded', charge({ amount_refunded: 125, refunded: false, metadata: { ...metadata(), credits: '99999' } }))
  expect(db.revokePurchasedCredits).toHaveBeenCalledWith(7, 25, 'creator-credit-reversal:ch_codearena', expect.any(String))
  expect(db.setUserProStatus).not.toHaveBeenCalled()
})

test('own dispute reverses the configured pack and never changes subscriptions', async () => {
  await webhook('charge.dispute.created', { charge: 'ch_codearena' })
  expect(db.revokePurchasedCredits).toHaveBeenCalledWith(7, 100, 'creator-credit-reversal:ch_codearena', expect.any(String))
  expect(db.setUserProStatus).not.toHaveBeenCalled()
})

test.each([
  { metadata: { userId: '7', type: 'credit_purchase' } },
  { customer: 'cus_other_product' }, { currency: 'eur' }, { amount: 1000 }
])('foreign or invalid disputed charge is inert: %j', async (overrides) => {
  mockStripe.charges.retrieve.mockResolvedValue(charge(overrides))
  await webhook('charge.dispute.created', { charge: 'ch_foreign' })
  expect(db.revokePurchasedCredits).not.toHaveBeenCalled()
  expect(db.setUserProStatus).not.toHaveBeenCalled()
})

test('failed dispute retrieval is retryable rather than silently marked complete', async () => {
  mockStripe.charges.retrieve.mockRejectedValue(new Error('Provider unavailable'))
  const res = await webhook('charge.dispute.created', { charge: 'ch_codearena' })
  expect(res.statusCode).toBe(500)
  expect(db.failWebhookEvent).toHaveBeenCalled()
  expect(db.completeWebhookEvent).not.toHaveBeenCalled()
})

test.each([
  ['/portal', 'post'], ['/cancel', 'post'],
  ['/reactivate', 'post'], ['/create-checkout', 'post'], ['/verify-checkout', 'post']
])('retired subscription route %s cannot access shared billing', async (path, method) => {
  const res = await route(path, {}, method)
  expect(res.statusCode).toBe(410)
  expect(mockStripe.subscriptions.list).not.toHaveBeenCalled()
  expect(mockStripe.subscriptions.update).not.toHaveBeenCalled()
  expect(mockStripe.billingPortal.sessions.create).not.toHaveBeenCalled()
  expect(db.getUserSubscription).not.toHaveBeenCalled()
})

test('free billing settings return a healthy status without reading shared legacy billing', async () => {
  const res = await route('/subscription', {}, 'get')
  expect(res.statusCode).toBe(200)
  expect(res.body).toMatchObject({
    success: true, isPro: false,
    subscription: { status: 'free', stripeCustomerId: null, stripeSubscriptionId: null }
  })
  expect(db.getUserSubscription).not.toHaveBeenCalled()
  expect(mockStripe.subscriptions.list).not.toHaveBeenCalled()
  expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled()
})

test('exported legacy billing sync is inert for free CodeArena', async () => {
  expect(await router.syncProStatusFromStripe(7)).toBe(false)
  expect(db.getUserSubscription).not.toHaveBeenCalled()
  expect(db.get).not.toHaveBeenCalled()
  expect(mockStripe.subscriptions.list).not.toHaveBeenCalled()
  expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled()
  expect(db.setUserProStatus).not.toHaveBeenCalled()
})

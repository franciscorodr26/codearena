const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const logger = require('../utils/logger');
const router = express.Router();
const db = require('../db');
const { FRONTEND_URL } = require('../config/appUrls');
const { CODEARENA_PRODUCT_MODE } = require('../../shared/codearenaProductMode');

// Import Stripe - will be initialized if keys are present
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

// Import auth middleware
const authRouter = require('./auth');
const authMiddleware = authRouter.authMiddleware;

// Rate limiter for payment endpoints: 10 requests per minute per user
// Prevents abuse of Stripe API and checkout session creation
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many payment requests. Please try again later.', success: false },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || ipKeyGenerator(req.ip),
  validate: false // Disable all validations - we use user ID as primary key, IP is just fallback
});

// Separate higher limit for verify-checkout (polled repeatedly after payment)
const verifyCheckoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many verification requests. Please try again later.', success: false },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || ipKeyGenerator(req.ip),
  validate: false
});

// Price IDs from environment
const MONTHLY_PRICE_ID = process.env.STRIPE_MONTHLY_PRICE_ID;
const ANNUAL_PRICE_ID = process.env.STRIPE_ANNUAL_PRICE_ID;
const STUDENT_MONTHLY_PRICE_ID = process.env.STRIPE_STUDENT_MONTHLY_PRICE_ID;
const STUDENT_ANNUAL_PRICE_ID = process.env.STRIPE_STUDENT_ANNUAL_PRICE_ID;
// Credit pack configuration (one-time purchases)
const CREDIT_PACKS = {
  small: { credits: 100, priceInCents: 500, name: '100 Credits' },
  large: { credits: 500, priceInCents: 2000, name: '500 Credits' }
};

// Stripe accounts deliver events to every subscribed endpoint. Deliberately do
// not reuse the generic userId/type metadata older handlers on a shared account accept.
const CREDIT_PURCHASE_TYPE = 'codearena_credit_purchase';
function creditMetadata(userId, extra = {}) {
  return { ...extra, product: 'codearena', codearenaUserId: String(userId) };
}

function ownsCreditPurchase(object) {
  return object?.metadata?.product === 'codearena'
    && object.metadata.type === CREDIT_PURCHASE_TYPE
    && /^[1-9]\d*$/.test(object.metadata.codearenaUserId || '')
    && Number.isSafeInteger(Number(object.metadata.codearenaUserId))
    && !object.metadata.userId && !object.metadata.companyId;
}

async function creditPurchaseUser(object) {
  if (!ownsCreditPurchase(object)) return null;
  const user = await db.getUserById(Number(object.metadata.codearenaUserId));
  const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id;
  return user && Number(user.id) === Number(object.metadata.codearenaUserId)
    && customerId && user.stripe_customer_id === customerId ? user : null;
}

function paidCreditPack(session) {
  const pack = CREDIT_PACKS[session.metadata?.packId];
  return pack && session.mode === 'payment' && session.status === 'complete'
    && session.payment_status === 'paid' && session.currency === 'usd'
    && session.amount_total === pack.priceInCents ? pack : null;
}

// Import crypto for token generation
const crypto = require('crypto');

// Import email service for student verification and payment notifications
const { sendStudentVerificationEmail, sendPaymentFailedEmail } = require('../services/email');

// Import EDU email validator service
const { validateEduEmail } = require('../services/eduEmailValidator');

// Rate limiter for student verification: 3 requests per hour per user
const studentVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: { error: 'Too many verification requests. Please try again later.', success: false },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || ipKeyGenerator(req.ip),
  validate: false // Disable all validations - we use user ID as primary key, IP is just fallback
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function isStripeConfigured() {
  return stripe && MONTHLY_PRICE_ID && ANNUAL_PRICE_ID;
}

function rejectRetiredConsumerSubscription(req, res, next) {
  if (CODEARENA_PRODUCT_MODE.consumer.paidSubscriptionsEnabled) return next();
  return res.status(410).json({
    error: 'CodeArena core access is now free; recurring consumer subscriptions are no longer offered.',
    success: false,
    code: 'consumer_subscriptions_retired'
  });
}

/**
 * Audit log for payment operations
 * Logs critical payment events for forensics and dispute resolution
 */
function auditLog(operation, data) {
  const auditEntry = {
    timestamp: new Date().toISOString(),
    operation,
    ...data
  };
  // Use structured logging for easy parsing
  logger.info(`[PAYMENT AUDIT] ${JSON.stringify(auditEntry)}`);
}

// ============================================
// STUDENT VERIFICATION
// ============================================

/**
 * Send student verification email
 * Validates .edu email and sends verification link
 */
router.post('/send-student-verification', studentVerificationLimiter, authMiddleware, rejectRetiredConsumerSubscription, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { eduEmail } = req.body;

    // Validate .edu email with MX record verification
    const validationResult = await validateEduEmail(eduEmail, {
      checkMx: true,
      mxTimeout: 5000
    });

    if (!validationResult.valid) {
      logger.warn('[PAYMENT] Invalid .edu email attempted:', eduEmail, validationResult.error);
      return res.status(400).json({
        error: validationResult.error,
        success: false
      });
    }

    const emailLower = validationResult.email;

    // Get user info
    const user = await db.get('SELECT id, username FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found', success: false });
    }

    // Check if already Pro
    const isPro = await db.isUserPro(userId);
    if (isPro) {
      return res.status(400).json({
        error: 'You already have an active Pro subscription',
        success: false
      });
    }

    // Generate verification token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24 hours

    // Store verification
    await db.createStudentVerification(userId, emailLower, tokenHash, expiresAt);

    // Build verification URL
    const verifyUrl = `${FRONTEND_URL}/verify-student?token=${rawToken}`;

    // Send verification email
    logger.info('[PAYMENT] Attempting to send student verification email to:', emailLower);
    const emailResult = await sendStudentVerificationEmail({
      to: emailLower,
      username: user.username,
      verifyUrl
    });
    logger.info('[PAYMENT] Email result:', JSON.stringify(emailResult));

    if (emailResult.success) {
      logger.info('[PAYMENT] Sent student verification email to:', emailLower);
    } else {
      logger.error('[PAYMENT] Failed to send student verification email:', emailResult.error);
      return res.status(500).json({
        error: `Failed to send verification email: ${emailResult.error || 'Unknown error'}`,
        success: false
      });
    }

    res.json({
      success: true,
      message: 'Verification email sent! Please check your student email inbox.'
    });

  } catch (error) {
    logger.error('[PAYMENT] Send student verification error:', error);
    res.status(500).json({
      error: `Failed to send verification email: ${error.message || 'Unknown error'}`,
      success: false
    });
  }
});

/**
 * Verify student email token
 * Marks user as student-verified so they can purchase student plan
 */
router.post('/verify-student-email', paymentLimiter, rejectRetiredConsumerSubscription, async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Verification token is required', success: false });
    }

    // Hash the token to look up
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find valid verification
    const verification = await db.findValidStudentVerificationByTokenHash(tokenHash);
    if (!verification) {
      return res.status(400).json({
        error: 'Invalid or expired verification link',
        success: false
      });
    }

    // Mark user as student verified
    await db.markStudentVerified(verification.user_id, verification.edu_email);
    await db.markStudentVerificationUsed(verification.id);

    logger.info('[PAYMENT] Student verified:', verification.user_id, verification.edu_email);

    res.json({
      success: true,
      verified: true,
      message: 'Student status verified! You can now subscribe to the Student plan.'
    });

  } catch (error) {
    logger.error('[PAYMENT] Verify student email error:', error);
    res.status(500).json({
      error: `Failed to verify student email: ${error.message || 'Unknown error'}`,
      success: false
    });
  }
});

/**
 * Get student verification status
 */
router.get('/student-status', authMiddleware, rejectRetiredConsumerSubscription, async (req, res) => {
  try {
    const userId = req.user.sub;
    const status = await db.getStudentVerificationStatus(userId);
    res.json({ success: true, ...status });
  } catch (error) {
    logger.error('[PAYMENT] Get student status error:', error);
    res.status(500).json({ error: 'Failed to get student status', success: false });
  }
});

// ============================================
// CREATE CHECKOUT SESSION
// ============================================

router.post('/create-checkout', paymentLimiter, authMiddleware, rejectRetiredConsumerSubscription, async (req, res) => {
  logger.info('[PAYMENT] Create checkout session request');

  if (!isStripeConfigured()) {
    logger.error('[PAYMENT] Stripe not configured');
    return res.status(503).json({
      error: 'Payment system not configured',
      success: false
    });
  }

  try {
    const userId = req.user.sub;
    const { plan } = req.body; // 'monthly', 'annual', or 'student'

    const validPlans = ['monthly', 'annual', 'student-monthly', 'student-annual'];
    if (!plan || !validPlans.includes(plan)) {
      return res.status(400).json({
        error: 'Invalid plan',
        success: false
      });
    }

    // For student plans, verify price IDs are configured
    if (plan === 'student-monthly' && !STUDENT_MONTHLY_PRICE_ID) {
      return res.status(503).json({
        error: 'Student monthly plan not configured',
        success: false
      });
    }
    if (plan === 'student-annual' && !STUDENT_ANNUAL_PRICE_ID) {
      return res.status(503).json({
        error: 'Student annual plan not configured',
        success: false
      });
    }

    // Get user info
    const user = await db.get('SELECT id, username, email, stripe_customer_id FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found', success: false });
    }

    // For student plans, verify user has valid student verification
    if (plan.startsWith('student-')) {
      const studentVerified = await db.isStudentVerified(userId);
      if (!studentVerified) {
        return res.status(400).json({
          error: 'Please verify your student email first',
          success: false,
          requiresStudentVerification: true
        });
      }
    }

    // Check if already Pro in our database
    const isPro = await db.isUserPro(userId);
    if (isPro) {
      return res.status(400).json({
        error: 'You already have an active Pro subscription',
        success: false
      });
    }

    // Select price ID based on plan
    const priceMap = {
      'monthly': MONTHLY_PRICE_ID,
      'annual': ANNUAL_PRICE_ID,
      'student-monthly': STUDENT_MONTHLY_PRICE_ID,
      'student-annual': STUDENT_ANNUAL_PRICE_ID
    };
    const priceId = priceMap[plan];

    // Create or retrieve Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: userId.toString(),
          username: user.username
        }
      });
      customerId = customer.id;

      // Save customer ID to database
      await db.run(
        'UPDATE users SET stripe_customer_id = ? WHERE id = ?',
        [customerId, userId]
      );
      logger.info('[PAYMENT] Created Stripe customer:', customerId);
    }

    // CRITICAL: Check Stripe directly for existing subscriptions (prevents race conditions)
    const existingSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all', // Check all statuses
      limit: 10
    });

    // Block if user has any active or trialing subscription
    // Note: past_due is NOT blocked - allows users to retry with new payment method
    const activeStatuses = ['active', 'trialing'];
    const hasActiveSubscription = existingSubscriptions.data.some(
      sub => activeStatuses.includes(sub.status)
    );

    if (hasActiveSubscription) {
      logger.warn('[PAYMENT] User already has active Stripe subscription:', customerId);
      return res.status(400).json({
        error: 'You already have an active subscription. Please manage it from your account settings.',
        success: false
      });
    }

    // If user has past_due subscription, cancel it first so they can start fresh
    const pastDueSubscription = existingSubscriptions.data.find(sub => sub.status === 'past_due');
    if (pastDueSubscription) {
      logger.info('[PAYMENT] Canceling past_due subscription to allow new checkout:', pastDueSubscription.id);
      await stripe.subscriptions.cancel(pastDueSubscription.id);
    }

    // Check for open/pending checkout sessions (prevents multiple tabs issue)
    const openSessions = await stripe.checkout.sessions.list({
      customer: customerId,
      limit: 10
    });

    const hasPendingCheckout = openSessions.data.some(
      session => session.status === 'open' &&
                 session.mode === 'subscription' &&
                 // Only block if session was created in last 30 minutes
                 (Date.now() / 1000 - session.created) < 1800
    );

    if (hasPendingCheckout) {
      logger.warn('[PAYMENT] User has pending checkout session:', customerId);
      return res.status(400).json({
        error: 'You have a pending checkout. Please complete or cancel it before starting a new one.',
        success: false
      });
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/payment/cancel`,
      metadata: {
        userId: userId.toString(),
        plan: plan
      },
      subscription_data: {
        metadata: {
          userId: userId.toString(),
          plan: plan
        }
      },
      allow_promotion_codes: true
    });

    logger.info('[PAYMENT] Created checkout session:', session.id);

    // Audit log for checkout creation
    auditLog('CHECKOUT_CREATED', {
      userId,
      plan,
      sessionId: session.id,
      customerId,
      ip: req.ip
    });

    res.json({
      success: true,
      sessionId: session.id,
      url: session.url
    });

  } catch (error) {
    logger.error('[PAYMENT] Create checkout error:', error);
    auditLog('CHECKOUT_FAILED', {
      userId: req.user?.sub,
      error: error.message,
      ip: req.ip
    });
    res.status(500).json({
      error: 'Failed to create checkout session',
      success: false
    });
  }
});

// ============================================
// CREDIT PACK PURCHASE (One-time payment)
// ============================================

router.get('/credit-packs', (req, res) => {
  res.json({
    success: true,
    packs: Object.entries(CREDIT_PACKS).map(([id, pack]) => ({
      id,
      credits: pack.credits,
      price: pack.priceInCents / 100,
      priceFormatted: `$${(pack.priceInCents / 100).toFixed(2)}`,
      name: pack.name
    }))
  });
});

router.post('/purchase-credits', authMiddleware, paymentLimiter, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      error: 'Payment system not configured',
      success: false
    });
  }

  try {
    const userId = req.user.sub;
    const { packId } = req.body;

    // Validate pack
    const pack = CREDIT_PACKS[packId];
    if (!pack) {
      return res.status(400).json({
        error: 'Invalid credit pack',
        success: false
      });
    }

    // Get user
    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found', success: false });
    }

    // Get or create Stripe customer
    let customerId = user.stripe_customer_id;
    if (customerId) {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.deleted || customer.metadata?.product !== 'codearena'
          || customer.metadata?.codearenaUserId !== String(userId)) {
        customerId = null;
      }
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: creditMetadata(userId)
      }, { idempotencyKey: `codearena:customer:v1:${userId}` });
      customerId = customer.id;
      await db.run(
        'UPDATE users SET stripe_customer_id = ? WHERE id = ?',
        [customerId, userId]
      );
    }

    // Create one-time checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: pack.name,
            description: `${pack.credits} credits for game creation`
          },
          unit_amount: pack.priceInCents
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${FRONTEND_URL}/create?credits_purchased=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/create?credits_cancelled=true`,
      metadata: creditMetadata(userId, {
        type: CREDIT_PURCHASE_TYPE,
        packId,
        credits: pack.credits.toString()
      }),
      payment_intent_data: {
        metadata: creditMetadata(userId, {
          type: CREDIT_PURCHASE_TYPE,
          packId,
          credits: pack.credits.toString()
        })
      }
    });

    logger.info('[PAYMENT] Created credit purchase session:', session.id, 'pack:', packId);

    auditLog('CREDIT_PURCHASE_CHECKOUT_CREATED', {
      userId,
      packId,
      credits: pack.credits,
      amount: pack.priceInCents,
      sessionId: session.id,
      ip: req.ip
    });

    res.json({
      success: true,
      sessionId: session.id,
      url: session.url
    });

  } catch (error) {
    logger.error('[PAYMENT] Credit purchase error:', error);
    res.status(500).json({
      error: 'Failed to create checkout session',
      success: false
    });
  }
});

router.post('/verify-credit-purchase', authMiddleware, verifyCheckoutLimiter, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Payment system not configured', success: false });
  }

  try {
    const userId = req.user.sub;
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required', success: false });
    }

    // Retrieve session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Verify ownership
    const purchaseUser = await creditPurchaseUser(session);
    if (!purchaseUser || String(purchaseUser.id) !== String(userId)) {
      return res.status(403).json({ error: 'Unauthorized', success: false });
    }

    // Check if payment is complete
    if (session.status !== 'complete' || session.payment_status !== 'paid') {
      return res.json({
        success: true,
        verified: false,
        message: 'Payment not yet completed'
      });
    }

    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
    const pack = paidCreditPack(session);
    if (!paymentIntentId || !pack) {
      return res.status(400).json({ error: 'Invalid credit purchase session', success: false });
    }

    const creditResult = await db.addPurchasedCredits(
      userId,
      pack.credits,
      paymentIntentId,
      `Purchased ${session.metadata.packId} pack (${paymentIntentId})`
    );

    if (creditResult.credited) {
      logger.info('[PAYMENT] Credits added via verify:', userId, 'credits:', pack.credits);
      auditLog('CREDITS_ADDED_VIA_VERIFY', {
        userId,
        credits: pack.credits,
        packId: session.metadata.packId,
        sessionId,
        paymentIntentId
      });
    }

    res.json({
      success: true,
      verified: true,
      alreadyCredited: !creditResult.credited,
      creditsAdded: creditResult.credited ? pack.credits : 0,
      credits: creditResult.credits.balance
    });

  } catch (error) {
    logger.error('[PAYMENT] Verify credit purchase error:', error);
    res.status(500).json({ error: 'Verification failed', success: false });
  }
});

// ============================================
// VERIFY CHECKOUT SESSION & ACTIVATE PRO
// This endpoint verifies checkout completion and activates Pro
// even if the webhook hasn't fired yet - ensures smooth post-payment UX
// Uses atomic operation to prevent race conditions
// ============================================

router.post('/verify-checkout', authMiddleware, verifyCheckoutLimiter, rejectRetiredConsumerSubscription, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      error: 'Payment system not configured',
      success: false
    });
  }

  try {
    const userId = req.user.sub;
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        error: 'Session ID required',
        success: false
      });
    }

    // Fast path: if user is already Pro (webhook or previous poll activated it), return immediately
    const alreadyPro = await db.isUserPro(userId);
    if (alreadyPro) {
      return res.json({
        success: true,
        verified: true,
        isPro: true,
        message: 'Pro already active'
      });
    }

    // Retrieve the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription']
    });

    // Verify this session belongs to this user. Require metadata.userId to be PRESENT and match:
    // a `&&` here previously skipped the check when it was missing, which would let any
    // complete+paid session reachable by id grant the CALLER Pro. Legit checkout sessions always
    // stamp metadata.userId (see create-checkout), so requiring it is safe. Mirrors verify-credit-purchase.
    const sessionUserId = session.metadata?.userId;
    if (!sessionUserId || parseInt(sessionUserId, 10) !== userId) {
      logger.error('[PAYMENT] Session userId mismatch:', sessionUserId, 'vs', userId);
      return res.status(403).json({
        error: 'Session does not belong to this user',
        success: false
      });
    }

    // Check if the checkout was completed
    if (session.status !== 'complete' || session.payment_status !== 'paid') {
      return res.json({
        success: true,
        verified: false,
        isPro: false,
        message: 'Payment not yet completed'
      });
    }

    // Payment is complete! Get subscription details from Stripe for accurate expiration
    const subscriptionId = session.subscription?.id || session.subscription;
    const customerId = session.customer;

    // Use Stripe's actual subscription period end for accurate expiration
    let expiresAt;
    if (session.subscription?.current_period_end) {
      expiresAt = new Date(session.subscription.current_period_end * 1000);
    } else if (subscriptionId) {
      // Fetch subscription if not expanded
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (!subscription.current_period_end) {
        logger.error('[PAYMENT] Subscription missing current_period_end:', subscriptionId);
        throw new Error('Subscription missing expiration date');
      }
      expiresAt = new Date(subscription.current_period_end * 1000);
    } else {
      // Fallback: calculate based on plan
      const plan = session.metadata?.plan || 'monthly';
      expiresAt = new Date();
      if (plan === 'annual') {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      } else {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
      }
    }

    // Use atomic activation to prevent race conditions
    const wasActivated = await db.activateProIfNotAlready(userId, expiresAt.toISOString(), {
      customerId,
      subscriptionId
    });

    // Get plan type from session metadata
    const plan = session.metadata?.plan || 'monthly';

    if (wasActivated) {
      // Set subscription type (student vs pro)
      const subscriptionType = plan.startsWith('student-') ? 'student' : 'pro';
      await db.setUserSubscriptionType(parseInt(userId), subscriptionType);

      logger.info('[PAYMENT] Pro activated via verify-checkout for user:', userId, 'plan:', plan);
      auditLog('PRO_ACTIVATED', {
        userId,
        method: 'verify-checkout',
        subscriptionId,
        customerId,
        plan,
        subscriptionType,
        expiresAt: expiresAt.toISOString(),
        sessionId,
        ip: req.ip
      });
    }

    res.json({
      success: true,
      verified: true,
      isPro: true,
      message: 'Payment verified and Pro activated'
    });

  } catch (error) {
    logger.error('[PAYMENT] Verify checkout error:', error.message, error.stack);

    // Fallback: try to sync Pro status directly from Stripe
    // This handles cases where the primary verification path fails
    // but the user actually has an active subscription
    try {
      const userId = req.user.sub;
      const synced = await syncProStatusFromStripe(userId);
      if (synced) {
        logger.info('[PAYMENT] Pro activated via Stripe sync fallback for user:', userId);
        return res.json({
          success: true,
          verified: true,
          isPro: true,
          message: 'Payment verified via Stripe sync'
        });
      }
    } catch (syncErr) {
      logger.error('[PAYMENT] Stripe sync fallback also failed:', syncErr.message);
    }

    res.status(500).json({
      error: `Failed to verify checkout: ${error.message || 'Unknown error'}`,
      success: false
    });
  }
});

// ============================================
// GET SUBSCRIPTION STATUS
// ============================================

router.get('/subscription', paymentLimiter, authMiddleware, async (req, res) => {
  if (!CODEARENA_PRODUCT_MODE.consumer.paidSubscriptionsEnabled) {
    return res.json({
      success: true,
      isPro: false,
      subscription: {
        status: 'free',
        plan: 'free',
        expiresAt: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        cancelAtPeriodEnd: false
      }
    });
  }
  try {
    const userId = req.user.sub;

    const [isPro, subscription] = await Promise.all([
      db.isUserPro(userId),
      db.getUserSubscription(userId)
    ]);

    // If user has Stripe subscription, get more details
    let stripeDetails = null;
    let resolvedSubscriptionId = subscription?.stripe_subscription_id;

    if (stripe && subscription?.stripe_customer_id && !resolvedSubscriptionId) {
      // DB is missing the subscription ID, look it up from Stripe by customer
      try {
        const subs = await stripe.subscriptions.list({
          customer: subscription.stripe_customer_id,
          status: 'all',
          limit: 5
        });
        const activeSub = subs.data.find(s => ['active', 'trialing', 'past_due'].includes(s.status));
        if (activeSub) {
          resolvedSubscriptionId = activeSub.id;
          // Backfill the DB so future requests work
          const backfillExpiry = activeSub.current_period_end
            ? new Date(activeSub.current_period_end * 1000).toISOString()
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // fallback: 30 days
          await db.setUserProStatus(userId, true, backfillExpiry, {
            customerId: subscription.stripe_customer_id,
            subscriptionId: activeSub.id
          });
          logger.info('[PAYMENT] Backfilled missing stripe_subscription_id for user', userId);
        }
      } catch (err) {
        logger.error('[PAYMENT] Error looking up Stripe subscription by customer:', err.message);
      }
    }

    if (stripe && resolvedSubscriptionId) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(resolvedSubscriptionId);

        // Check if subscription is truly cancelled (either status is 'canceled' or period has ended while cancel_at_period_end is true)
        const now = Math.floor(Date.now() / 1000);
        const isTrulyCancelled = stripeSub.status === 'canceled' ||
          (stripeSub.cancel_at_period_end && stripeSub.current_period_end && stripeSub.current_period_end < now);

        if (!isTrulyCancelled) {
          // Safely get period end date (use cancel_at if cancelling, otherwise current_period_end)
          let periodEnd = null;
          if (stripeSub.cancel_at) {
            periodEnd = new Date(stripeSub.cancel_at * 1000).toISOString();
          } else if (stripeSub.current_period_end) {
            periodEnd = new Date(stripeSub.current_period_end * 1000).toISOString();
          } else if (stripeSub.billing_cycle_anchor) {
            // Fallback to billing cycle + 1 month
            const anchor = new Date(stripeSub.billing_cycle_anchor * 1000);
            anchor.setMonth(anchor.getMonth() + 1);
            periodEnd = anchor.toISOString();
          }

          stripeDetails = {
            status: stripeSub.status,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
            plan: stripeSub.items.data[0]?.price?.id === ANNUAL_PRICE_ID ? 'annual' : 'monthly'
          };
        }
      } catch (err) {
        logger.error('[PAYMENT] Error fetching Stripe subscription:', err.message);
      }
    }

    res.json({
      success: true,
      isPro,
      subscription: {
        expiresAt: subscription?.pro_expires_at,
        stripeCustomerId: subscription?.stripe_customer_id,
        stripeSubscriptionId: resolvedSubscriptionId,
        ...stripeDetails
      }
    });

  } catch (error) {
    logger.error('[PAYMENT] Get subscription error:', error);
    res.status(500).json({
      error: 'Failed to get subscription status',
      success: false
    });
  }
});

// ============================================
// CREATE CUSTOMER PORTAL SESSION
// ============================================

router.post('/portal', paymentLimiter, authMiddleware, rejectRetiredConsumerSubscription, async (req, res) => {
  logger.info('[PAYMENT] Create portal session request');

  if (!stripe) {
    return res.status(503).json({
      error: 'Payment system not configured',
      success: false
    });
  }

  try {
    const userId = req.user.sub;
    const subscription = await db.getUserSubscription(userId);

    if (!subscription?.stripe_customer_id) {
      return res.status(400).json({
        error: 'No billing account found',
        success: false
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${FRONTEND_URL}/settings/subscription`
    });

    logger.info('[PAYMENT] Created portal session');

    res.json({
      success: true,
      url: session.url
    });

  } catch (error) {
    logger.error('[PAYMENT] Create portal error:', error);
    res.status(500).json({
      error: 'Failed to create billing portal session',
      success: false
    });
  }
});

// ============================================
// CANCEL SUBSCRIPTION
// ============================================

router.post('/cancel', paymentLimiter, authMiddleware, rejectRetiredConsumerSubscription, async (req, res) => {
  logger.info('[PAYMENT] Cancel subscription request');

  if (!stripe) {
    return res.status(503).json({
      error: 'Payment system not configured',
      success: false
    });
  }

  try {
    const userId = req.user.sub;
    const subscription = await db.getUserSubscription(userId);

    let subscriptionId = subscription?.stripe_subscription_id;

    // If DB is missing subscription ID, look it up from Stripe by customer
    if (!subscriptionId && subscription?.stripe_customer_id) {
      const subs = await stripe.subscriptions.list({
        customer: subscription.stripe_customer_id,
        status: 'all',
        limit: 5
      });
      const activeSub = subs.data.find(s => ['active', 'trialing', 'past_due'].includes(s.status));
      if (activeSub) {
        subscriptionId = activeSub.id;
        const cancelExpiry = activeSub.current_period_end
          ? new Date(activeSub.current_period_end * 1000).toISOString()
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // fallback: 30 days
        await db.setUserProStatus(userId, true, cancelExpiry, {
          customerId: subscription.stripe_customer_id,
          subscriptionId: activeSub.id
        });
      }
    }

    if (!subscriptionId) {
      return res.status(400).json({
        error: 'No active subscription found',
        success: false
      });
    }

    // Cancel at period end (user keeps access until current period ends)
    const updated = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true
    });

    logger.info('[PAYMENT] Subscription set to cancel at period end');

    // Get the cancel date from the response (Stripe uses cancel_at when cancel_at_period_end is true)
    let cancelAt = null;
    if (updated.cancel_at) {
      cancelAt = new Date(updated.cancel_at * 1000).toISOString();
    } else if (updated.current_period_end) {
      cancelAt = new Date(updated.current_period_end * 1000).toISOString();
    }

    // Update database to reflect the cancellation date
    if (cancelAt) {
      await db.setUserProStatus(userId, true, cancelAt, {
        customerId: subscription.stripe_customer_id,
        subscriptionId: subscriptionId
      });
    }

    // Audit log for subscription cancellation
    auditLog('SUBSCRIPTION_CANCELLED', {
      userId,
      subscriptionId: subscriptionId,
      cancelAt,
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Subscription will be cancelled at the end of the current billing period',
      cancelAt
    });

  } catch (error) {
    logger.error('[PAYMENT] Cancel subscription error:', error);
    res.status(500).json({
      error: 'Failed to cancel subscription',
      success: false
    });
  }
});

// ============================================
// REACTIVATE SUBSCRIPTION
// ============================================

router.post('/reactivate', paymentLimiter, authMiddleware, rejectRetiredConsumerSubscription, async (req, res) => {
  logger.info('[PAYMENT] Reactivate subscription request');

  if (!stripe) {
    return res.status(503).json({
      error: 'Payment system not configured',
      success: false
    });
  }

  try {
    const userId = req.user.sub;
    const subscription = await db.getUserSubscription(userId);

    if (!subscription?.stripe_subscription_id) {
      return res.status(400).json({
        error: 'No subscription found',
        success: false
      });
    }

    // Remove cancellation
    const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: false
    });

    logger.info('[PAYMENT] Subscription reactivated');

    // Update database with the current period end from the reactivated Stripe subscription
    const reactivateExpiry = updated.current_period_end
      ? new Date(updated.current_period_end * 1000).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // fallback: 30 days
    await db.setUserProStatus(userId, true, reactivateExpiry, {
      customerId: subscription.stripe_customer_id,
      subscriptionId: subscription.stripe_subscription_id
    });

    // Audit log for subscription reactivation
    auditLog('SUBSCRIPTION_REACTIVATED', {
      userId,
      subscriptionId: subscription.stripe_subscription_id,
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Subscription reactivated successfully'
    });

  } catch (error) {
    logger.error('[PAYMENT] Reactivate subscription error:', error);
    res.status(500).json({
      error: 'Failed to reactivate subscription',
      success: false
    });
  }
});

// ============================================
// STRIPE WEBHOOK HANDLER
// ============================================

// Note: This needs raw body, so it's exported separately
// and mounted with express.raw() middleware in server.js
async function handleWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    logger.error('[WEBHOOK] Stripe not configured');
    return res.status(503).send('Webhook not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.error('[WEBHOOK] Signature verification failed:', err.message);
    // Don't expose internal error details - return generic message
    return res.status(400).send('Webhook signature verification failed');
  }

  logger.info('[WEBHOOK] Received event:', event.type, 'ID:', event.id);

  // This endpoint only owns CreatorArena one-time purchases. In particular,
  // subscription and invoice events from a shared Stripe account are inert.
  const supportedEvents = ['checkout.session.completed', 'charge.refunded', 'charge.dispute.created'];
  if (!supportedEvents.includes(event.type)
      || (event.type !== 'charge.dispute.created' && !ownsCreditPurchase(event.data.object))) {
    return res.json({ received: true, ignored: true });
  }

  // Wrap entire processing in try-catch to handle DB errors
  let processingResult;
  try {
    // CRITICAL: Atomically claim this event for processing
    // Returns { canProcess: true } or { canProcess: false, reason: 'completed'|'pending'|'failed' }
    processingResult = await db.startWebhookEventProcessing(event.id, event.type);
  } catch (dbError) {
    logger.error('[WEBHOOK] Failed to start processing event:', event.id, dbError);
    // Return 500 so Stripe retries - we couldn't even check the event status
    return res.status(500).json({ received: false, error: 'Database error' });
  }

  if (!processingResult.canProcess) {
    if (processingResult.reason === 'completed') {
      logger.info('[WEBHOOK] Event already completed, skipping:', event.id);
      return res.json({ received: true, duplicate: true });
    }
    if (processingResult.reason === 'pending') {
      // Another process is actively working on it - return 200 to avoid duplicate processing
      logger.info('[WEBHOOK] Event being processed by another worker, skipping:', event.id);
      return res.json({ received: true, status: 'pending' });
    }
    // Unknown status - return 500 so Stripe retries
    logger.info('[WEBHOOK] Event in unexpected state, will retry:', event.id, processingResult.reason);
    return res.status(500).json({ received: false, error: 'Event in unexpected state - will retry' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutComplete(session);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionUpdate(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        await handleInvoicePaid(invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handlePaymentFailed(invoice);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        await handleChargeRefunded(charge);
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object;
        await handleDisputeCreated(dispute);
        break;
      }

      default:
        logger.info('[WEBHOOK] Unhandled event type:', event.type);
    }

    // SUCCESS: Mark event as completed
    try {
      await db.completeWebhookEvent(event.id);
    } catch (dbError) {
      // Handler succeeded but DB update failed - log but still return 200
      // The event is processed, we just couldn't mark it. Next retry will see 'pending' and skip.
      logger.error('[WEBHOOK] Failed to mark event completed (handler succeeded):', event.id, dbError);
    }
    return res.json({ received: true });

  } catch (error) {
    logger.error('[WEBHOOK] Error handling event:', event.id, error);

    // FAILURE: Mark event as failed and return 500 so Stripe will retry
    try {
      await db.failWebhookEvent(event.id, error.message);
    } catch (dbError) {
      // Can't even mark as failed - just log and return 500
      logger.error('[WEBHOOK] Failed to mark event as failed:', event.id, dbError);
    }
    return res.status(500).json({
      received: false,
      error: 'Handler failed - will retry'
    });
  }
}

// ============================================
// WEBHOOK EVENT HANDLERS
// ============================================

async function handleCheckoutComplete(session) {
  logger.info('[WEBHOOK] Checkout completed:', session.id);

  const purchaseUser = await creditPurchaseUser(session);
  if (!purchaseUser) return;

  // Legacy company payments are intentionally outside CodeArena's Stripe
  // boundary. A shared or misconfigured webhook secret must never mutate
  // company billing records from this service.
  if (session.metadata?.type === 'company_challenge') {
    logger.warn('[WEBHOOK] Ignoring legacy company challenge checkout:', session.id);
    return;
  }

  if (session.metadata?.companyId) {
    logger.warn('[WEBHOOK] Ignoring legacy company checkout:', session.id);
    return;
  }

  const userId = session.metadata?.codearenaUserId;
  if (!userId) {
    logger.error('[WEBHOOK] No userId in session metadata');
    return;
  }

  // Validate user exists before activating
  const user = await db.get('SELECT id FROM users WHERE id = ?', [parseInt(userId)]);
  if (!user) {
    logger.error('[WEBHOOK] User not found for checkout:', userId);
    return;
  }

  // Handle credit purchase (one-time payment)
  if (session.metadata?.type === CREDIT_PURCHASE_TYPE) {
    const packId = session.metadata.packId;
    const pack = paidCreditPack(session);
    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
    if (!paymentIntentId || !pack) {
      throw new Error('Invalid credit purchase checkout payload');
    }

    const creditResult = await db.addPurchasedCredits(
      parseInt(userId),
      pack.credits,
      paymentIntentId,
      `Purchased ${packId} pack (${paymentIntentId})`
    );
    if (!creditResult.credited) {
      logger.info('[WEBHOOK] Credits already added for this payment:', paymentIntentId);
      return;
    }

    logger.info('[WEBHOOK] Credits added for user:', userId, 'credits:', pack.credits);
    auditLog('CREDITS_ADDED_VIA_WEBHOOK', {
      userId,
      credits: pack.credits,
      packId,
      sessionId: session.id,
      paymentIntentId
    });
    return;
  }

  if (!CODEARENA_PRODUCT_MODE.consumer.paidSubscriptionsEnabled) {
    logger.warn('[WEBHOOK] Ignoring retired consumer subscription checkout:', session.id);
    return;
  }

  // Get subscription details
  let currentPeriodEnd;
  const subscriptionId = session.subscription;

  if (subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    } catch (err) {
      logger.warn('[WEBHOOK] Could not retrieve subscription, using fallback expiry:', err.message);
    }
  }

  // Fallback: calculate expiry from plan type if subscription retrieval failed
  if (!currentPeriodEnd) {
    const plan = session.metadata?.plan || 'monthly';
    currentPeriodEnd = new Date();
    if (plan.includes('annual')) {
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
    } else {
      currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
    }
  }

  // Use atomic activation to prevent race conditions with verify-checkout
  const wasActivated = await db.activateProIfNotAlready(
    parseInt(userId),
    currentPeriodEnd.toISOString(),
    {
      customerId: session.customer,
      subscriptionId: subscriptionId
    }
  );

  // Get plan type from session metadata
  const plan = session.metadata?.plan || 'monthly';

  if (wasActivated) {
    // Set subscription type (student vs pro)
    const subscriptionType = plan.startsWith('student-') ? 'student' : 'pro';
    await db.setUserSubscriptionType(parseInt(userId), subscriptionType);

    logger.info('[WEBHOOK] Pro activated for user:', userId, 'plan:', plan);
  } else {
    logger.info('[WEBHOOK] User already Pro (via verify-checkout):', userId);
  }
}

async function handleSubscriptionUpdate(subscription) {
  logger.info('[WEBHOOK] Subscription updated:', subscription.id);

  if (subscription.metadata?.companyId) {
    logger.warn('[WEBHOOK] Ignoring legacy company subscription update:', subscription.id);
    return;
  }

  const userId = subscription.metadata?.userId;
  if (!userId) {
    // Try to find user by customer ID
    const user = await db.get(
      'SELECT id FROM users WHERE stripe_customer_id = ?',
      [subscription.customer]
    );
    if (!user) {
      logger.error('[WEBHOOK] Could not find user for subscription');
      return;
    }
  }

  const targetUserId = userId || (await db.get(
    'SELECT id FROM users WHERE stripe_customer_id = ?',
    [subscription.customer]
  ))?.id;

  if (!targetUserId) return;

  if (subscription.status === 'active') {
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    await db.setUserProStatus(
      parseInt(targetUserId),
      true,
      currentPeriodEnd.toISOString(),
      {
        customerId: subscription.customer,
        subscriptionId: subscription.id
      }
    );

    // Preserve/set subscription type based on price ID
    // Check if this is a student plan by examining the subscription's price
    const priceId = subscription.items?.data?.[0]?.price?.id;
    const isStudentPlan = priceId === STUDENT_MONTHLY_PRICE_ID || priceId === STUDENT_ANNUAL_PRICE_ID;
    const subscriptionType = isStudentPlan ? 'student' : 'pro';
    await db.setUserSubscriptionType(parseInt(targetUserId), subscriptionType);

    logger.info('[WEBHOOK] Pro status updated for user:', targetUserId, 'type:', subscriptionType);
  } else if (['canceled', 'unpaid'].includes(subscription.status)) {
    await db.setUserProStatus(parseInt(targetUserId), false);
    logger.info('[WEBHOOK] Pro status removed for user:', targetUserId);
  }
}

async function handleSubscriptionDeleted(subscription) {
  logger.info('[WEBHOOK] Subscription deleted:', subscription.id);

  if (subscription.metadata?.companyId) {
    logger.warn('[WEBHOOK] Ignoring legacy company subscription deletion:', subscription.id);
    return;
  }

  // Try to find user by subscription_id first
  let user = await db.get(
    'SELECT id FROM users WHERE stripe_subscription_id = ?',
    [subscription.id]
  );

  // Fallback: find by customer_id if subscription_id lookup fails
  if (!user && subscription.customer) {
    user = await db.get(
      'SELECT id FROM users WHERE stripe_customer_id = ?',
      [subscription.customer]
    );
    if (user) {
      logger.info('[WEBHOOK] Found user via customer_id fallback:', user.id);
    }
  }

  if (user) {
    await db.setUserProStatus(user.id, false);
    logger.info('[WEBHOOK] Pro status removed for user:', user.id);
  } else {
    logger.warn('[WEBHOOK] Could not find user for deleted subscription:', subscription.id);
  }
}

async function handlePaymentFailed(invoice) {
  logger.info('[WEBHOOK] Payment failed for invoice:', invoice.id);

  // Find the user by customer ID
  const customerId = invoice.customer;
  if (!customerId) return;

  const user = await db.get('SELECT id, email, username FROM users WHERE stripe_customer_id = ?', [customerId]);
  if (!user) {
    logger.error('[WEBHOOK] Could not find user for failed payment:', customerId);
    return;
  }

  // Check if this is a recurring payment failure (not first attempt)
  const attemptCount = invoice.attempt_count || 1;
  let proRevoked = false;

  if (attemptCount >= 3) {
    // After 3 failed attempts, revoke Pro access
    logger.warn('[WEBHOOK] Revoking Pro after 3 failed payments for user:', user.id);
    await db.setUserProStatus(user.id, false);
    proRevoked = true;
  }

  // Send email notification about failed payment
  try {
    await sendPaymentFailedEmail({
      to: user.email,
      username: user.username,
      attemptCount,
      proRevoked
    });
    logger.info('[WEBHOOK] Payment failed email sent to user:', user.id);
  } catch (emailErr) {
    logger.error('[WEBHOOK] Failed to send payment failed email:', emailErr.message);
  }

  logger.info('[WEBHOOK] Payment failed for user:', user.id, 'Attempt:', attemptCount, 'Pro revoked:', proRevoked);
}

async function handleChargeRefunded(charge) {
  logger.info('[WEBHOOK] Charge refunded:', charge.id);

  const purchaseUser = await creditPurchaseUser(charge);
  const pack = CREDIT_PACKS[charge.metadata?.packId];
  if (!purchaseUser || !pack || charge.currency !== 'usd' || charge.amount !== pack.priceInCents) return;

  // Find user by customer ID
  const customerId = charge.customer;
  if (!customerId) return;

  const user = purchaseUser;
  if (!user) {
    logger.error('[WEBHOOK] Could not find user for refund:', customerId);
    return;
  }

  // Bug M1 fix: distinguish subscription charges from one-time charges (e.g. credit packs).
  // Subscription charges always have `charge.invoice` set (the invoice that drove the payment);
  // one-time `mode: 'payment'` checkouts (like our credit packs) have invoice == null.
  // Previously we revoked Pro on any fully-refunded charge, which stripped Pro from an
  // active subscriber when they got a refund on a separate $5 credit-pack purchase.
  const isSubscriptionCharge = Boolean(charge.invoice)
    && charge.metadata?.type !== CREDIT_PURCHASE_TYPE;

  if (!isSubscriptionCharge) {
    // One-time charge (credit pack or other ad-hoc). Do NOT revoke legacy Pro.
    if (charge.metadata?.type === CREDIT_PURCHASE_TYPE
        && charge.amount_refunded > 0) {
      const purchasedCredits = pack.credits;
      const chargeAmount = Number(charge.amount);
      const refundAmount = Number(charge.amount_refunded);
      const creditsToRevoke = charge.refunded || !Number.isFinite(chargeAmount) || chargeAmount <= 0
        ? purchasedCredits
        : Math.min(purchasedCredits, Math.ceil(purchasedCredits * refundAmount / chargeAmount));

      if (Number.isFinite(creditsToRevoke) && creditsToRevoke > 0) {
        const reversal = await db.revokePurchasedCredits(
          user.id,
          creditsToRevoke,
          `creator-credit-reversal:${charge.id}`,
          `Refund of CreatorArena credit pack (charge ${charge.id})`
        );
        logger.info(
          '[WEBHOOK] Reversed', reversal.revoked,
          'CreatorArena credits for user', user.id, 'charge:', charge.id
        );
      }
    }
    return;
  }

  // Subscription charge: keep the original behavior.
  if (charge.refunded) {
    logger.warn('[WEBHOOK] Full refund of subscription charge - revoking Pro for user:', user.id);
    await db.setUserProStatus(user.id, false);
  } else if (charge.amount_refunded > 0) {
    // Partial refund - log but don't revoke
    logger.info('[WEBHOOK] Partial refund for user:', user.id, 'Amount:', charge.amount_refunded);
  }
}

async function handleDisputeCreated(dispute) {
  logger.info('[WEBHOOK] Dispute created:', dispute.id);

  // Find user by payment intent or charge
  const chargeId = dispute.charge;
  if (!chargeId) return;

  try {
    const charge = await stripe.charges.retrieve(chargeId);
    const purchaseUser = await creditPurchaseUser(charge);
    const pack = CREDIT_PACKS[charge.metadata?.packId];
    if (!purchaseUser || !pack || charge.currency !== 'usd' || charge.amount !== pack.priceInCents) return;
    const customerId = charge.customer;

    if (customerId) {
      const user = purchaseUser;
      if (user) {
        if (charge.metadata?.type === CREDIT_PURCHASE_TYPE) {
          const purchasedCredits = pack.credits;
          if (Number.isFinite(purchasedCredits) && purchasedCredits > 0) {
            await db.revokePurchasedCredits(
              user.id,
              purchasedCredits,
              `creator-credit-reversal:${charge.id}`,
              `Disputed CreatorArena credit pack (charge ${charge.id})`
            );
          }
        } else {
          // Legacy subscription disputes still revoke legacy access.
          logger.warn('[WEBHOOK] Subscription dispute filed - revoking Pro for user:', user.id);
          await db.setUserProStatus(user.id, false);
        }
      }
    }
  } catch (err) {
    logger.error('[WEBHOOK] Error handling dispute:', err.message);
    throw err;
  }
}

// ============================================
// INVOICE PAID - handles subscription renewals
// ============================================

async function handleInvoicePaid(invoice) {
  logger.info('[WEBHOOK] Invoice paid:', invoice.id);

  // Only process subscription invoices
  if (!invoice.subscription) return;

  const customerId = invoice.customer;
  if (!customerId) return;

  // Fetch the subscription to get the new period end and metadata
  const sub = await stripe.subscriptions.retrieve(invoice.subscription);
  const expiresAt = new Date(sub.current_period_end * 1000).toISOString();

  if (sub.metadata?.companyId) {
    logger.warn('[WEBHOOK] Ignoring legacy company invoice:', invoice.id);
    return;
  }

  const user = await db.get('SELECT id FROM users WHERE stripe_customer_id = ?', [customerId]);
  if (!user) {
    logger.warn('[WEBHOOK] Could not find user for paid invoice:', customerId);
    return;
  }

  await db.setUserProStatus(user.id, true, expiresAt, {
    customerId: customerId,
    subscriptionId: invoice.subscription
  });

  logger.info('[WEBHOOK] Pro renewed for user:', user.id, 'expires:', expiresAt);
}

// ============================================
// STRIPE SYNC HELPER (used by other routes)
// ============================================

/**
 * Check Stripe directly for an active subscription and sync the DB.
 * Returns true if the user has an active Stripe subscription.
 */
async function syncProStatusFromStripe(userId) {
  if (!CODEARENA_PRODUCT_MODE.consumer.paidSubscriptionsEnabled) return false;
  if (!stripe) return false;

  const user = await db.get(
    'SELECT stripe_customer_id, stripe_subscription_id FROM users WHERE id = ?',
    [userId]
  );

  // Try subscription ID first (faster)
  if (user?.stripe_subscription_id) {
    try {
      const sub = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
      if (['active', 'trialing'].includes(sub.status) && sub.current_period_end) {
        const expiresAt = new Date(sub.current_period_end * 1000).toISOString();
        await db.setUserProStatus(userId, true, expiresAt, {
          customerId: sub.customer,
          subscriptionId: sub.id
        });
        logger.info('[SYNC] Pro status synced from Stripe for user:', userId);
        return true;
      }
    } catch (err) {
      logger.warn('[SYNC] Could not retrieve subscription:', err.message);
    }
  }

  // Fall back to customer lookup
  if (user?.stripe_customer_id) {
    try {
      const subs = await stripe.subscriptions.list({
        customer: user.stripe_customer_id,
        status: 'all',
        limit: 5
      });
      const activeSub = subs.data.find(s => ['active', 'trialing'].includes(s.status));
      if (activeSub && activeSub.current_period_end) {
        const expiresAt = new Date(activeSub.current_period_end * 1000).toISOString();
        await db.setUserProStatus(userId, true, expiresAt, {
          customerId: user.stripe_customer_id,
          subscriptionId: activeSub.id
        });
        logger.info('[SYNC] Pro status backfilled from Stripe for user:', userId);
        return true;
      }
    } catch (err) {
      logger.warn('[SYNC] Could not list subscriptions:', err.message);
    }
  }

  return false;
}

// ============================================
// EXPORTS
// ============================================

router.handleWebhook = handleWebhook;
router.syncProStatusFromStripe = syncProStatusFromStripe;
router.handleChargeRefunded = handleChargeRefunded;
router.handleDisputeCreated = handleDisputeCreated;

module.exports = router;

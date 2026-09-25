/**
 * Student Verification Tests
 *
 * Tests the student verification functionality including:
 * - Email validation (.edu requirement)
 * - MX record validation
 * - Blocklist enforcement
 * - Token generation and hashing
 * - Token expiration logic
 * - The isStudentVerified function
 * - The verification flow
 */

const crypto = require('crypto');

// Import the actual validator service
const {
  validateEduEmail,
  validateEduEmailSync,
  checkMxRecords,
  clearMxCache,
  getBlockedDomains,
  BLOCKED_DOMAINS
} = require('../services/eduEmailValidator');

describe('Student Email Validation', () => {
  // Replicate the email validation logic from payment.js
  function validateStudentEmail(email) {
    if (!email) {
      return { valid: false, error: 'Student email is required' };
    }

    const emailLower = email.toLowerCase().trim();

    // Check .edu suffix
    if (!emailLower.endsWith('.edu')) {
      return { valid: false, error: 'Please use a valid .edu email address' };
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailLower)) {
      return { valid: false, error: 'Invalid email format' };
    }

    return { valid: true, email: emailLower };
  }

  describe('.edu email requirement', () => {
    test('accepts valid .edu email addresses', () => {
      const result = validateStudentEmail('student@university.edu');
      expect(result.valid).toBe(true);
      expect(result.email).toBe('student@university.edu');
    });

    test('accepts .edu email with subdomains', () => {
      const result = validateStudentEmail('student@cs.stanford.edu');
      expect(result.valid).toBe(true);
      expect(result.email).toBe('student@cs.stanford.edu');
    });

    test('rejects non-.edu email addresses', () => {
      const result = validateStudentEmail('student@gmail.com');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Please use a valid .edu email address');
    });

    test('rejects .edu.fake domains', () => {
      const result = validateStudentEmail('student@fake.edu.com');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Please use a valid .edu email address');
    });

    test('rejects empty email', () => {
      const result = validateStudentEmail('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Student email is required');
    });

    test('rejects null email', () => {
      const result = validateStudentEmail(null);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Student email is required');
    });

    test('rejects undefined email', () => {
      const result = validateStudentEmail(undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Student email is required');
    });
  });

  describe('email format validation', () => {
    test('rejects email without @ symbol', () => {
      const result = validateStudentEmail('studentuniversity.edu');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid email format');
    });

    test('rejects email with spaces', () => {
      const result = validateStudentEmail('student @university.edu');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid email format');
    });

    test('rejects email without domain', () => {
      const result = validateStudentEmail('student@.edu');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid email format');
    });

    test('rejects email without local part', () => {
      const result = validateStudentEmail('@university.edu');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid email format');
    });
  });

  describe('email normalization', () => {
    test('converts email to lowercase', () => {
      const result = validateStudentEmail('Student@University.EDU');
      expect(result.valid).toBe(true);
      expect(result.email).toBe('student@university.edu');
    });

    test('trims whitespace from email', () => {
      const result = validateStudentEmail('  student@university.edu  ');
      expect(result.valid).toBe(true);
      expect(result.email).toBe('student@university.edu');
    });

    test('handles mixed case and whitespace', () => {
      const result = validateStudentEmail('  STUDENT@UNIVERSITY.EDU  ');
      expect(result.valid).toBe(true);
      expect(result.email).toBe('student@university.edu');
    });
  });
});

// ============================================
// EDU EMAIL VALIDATOR SERVICE TESTS
// ============================================

describe('EDU Email Validator Service - Synchronous Validation', () => {
  describe('basic validation', () => {
    test('accepts valid .edu email', () => {
      const result = validateEduEmailSync('student@mit.edu');
      expect(result.valid).toBe(true);
      expect(result.email).toBe('student@mit.edu');
    });

    test('accepts .edu email with subdomains', () => {
      const result = validateEduEmailSync('student@cs.stanford.edu');
      expect(result.valid).toBe(true);
      expect(result.email).toBe('student@cs.stanford.edu');
    });

    test('rejects empty email', () => {
      const result = validateEduEmailSync('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Student email is required');
    });

    test('rejects null email', () => {
      const result = validateEduEmailSync(null);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Student email is required');
    });

    test('rejects non-.edu email', () => {
      const result = validateEduEmailSync('student@gmail.com');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Please use a valid .edu email address');
    });

    test('rejects .edu.com domains', () => {
      const result = validateEduEmailSync('student@fake.edu.com');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Please use a valid .edu email address');
    });

    test('rejects invalid email format', () => {
      const result = validateEduEmailSync('invalid-email.edu');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid email format');
    });

    test('normalizes email to lowercase', () => {
      const result = validateEduEmailSync('STUDENT@HARVARD.EDU');
      expect(result.valid).toBe(true);
      expect(result.email).toBe('student@harvard.edu');
    });
  });

  describe('blocklist enforcement', () => {
    test('rejects emails from blocked domains', () => {
      const blockedDomains = getBlockedDomains();
      for (const domain of blockedDomains) {
        const result = validateEduEmailSync(`test@${domain}`);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('not accepted');
      }
    });

    test('rejects mail.edu', () => {
      const result = validateEduEmailSync('user@mail.edu');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('This .edu domain is not accepted. Please use your official university email.');
    });

    test('rejects fake.edu', () => {
      const result = validateEduEmailSync('user@fake.edu');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('This .edu domain is not accepted. Please use your official university email.');
    });

    test('rejects subdomains of blocked domains', () => {
      const result = validateEduEmailSync('user@sub.fake.edu');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('This .edu domain is not accepted. Please use your official university email.');
    });

    test('blocklist contains expected domains', () => {
      const blocklist = getBlockedDomains();
      expect(blocklist).toContain('mail.edu');
      expect(blocklist).toContain('fake.edu');
      expect(blocklist).toContain('test.edu');
      expect(blocklist).toContain('example.edu');
    });
  });
});

describe('EDU Email Validator Service - Async Validation with MX', () => {
  beforeEach(() => {
    // Clear cache before each test to ensure consistent behavior
    clearMxCache();
  });

  describe('MX record validation', () => {
    test('accepts email from domain with valid MX records', async () => {
      const mxResolver = jest.fn().mockResolvedValue([{ exchange: 'mail.example.edu' }]);

      const result = await validateEduEmail('test@mit.edu', {
        checkMx: true,
        mxTimeout: 10000,
        mxResolver
      });

      expect(result.valid).toBe(true);
      expect(result.email).toBe('test@mit.edu');
      expect(result.details.mxVerified).toBe(true);
      expect(mxResolver).toHaveBeenCalledWith('mit.edu');
    });

    test('rejects email from domain without MX records', async () => {
      const mxResolver = jest.fn().mockRejectedValue(Object.assign(new Error('No MX records found'), {
        code: 'ENOTFOUND'
      }));

      const result = await validateEduEmail('test@thisisnotarealdomain12345.edu', {
        checkMx: true,
        mxTimeout: 5000,
        mxResolver
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot receive emails');
      expect(result.details.domain).toBe('thisisnotarealdomain12345.edu');
      expect(mxResolver).toHaveBeenCalledWith('thisisnotarealdomain12345.edu');
    });

    test('can skip MX validation when disabled', async () => {
      const result = await validateEduEmail('test@anyuniversity.edu', { checkMx: false });
      expect(result.valid).toBe(true);
      expect(result.details.mxVerified).toBe(false);
    });

    test('still enforces blocklist even with MX check disabled', async () => {
      const result = await validateEduEmail('user@fake.edu', { checkMx: false });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not accepted');
    });
  });

  describe('basic validation in async function', () => {
    test('rejects empty email', async () => {
      const result = await validateEduEmail('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Student email is required');
    });

    test('rejects non-.edu email', async () => {
      const result = await validateEduEmail('user@gmail.com');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Please use a valid .edu email address');
    });

    test('rejects invalid format', async () => {
      const result = await validateEduEmail('not-an-email');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid email format');
    });
  });
});

describe('MX Record Checker', () => {
  beforeEach(() => {
    clearMxCache();
  });

  test('returns hasMx: true for valid domain with MX records', async () => {
    const mxResolver = jest.fn().mockResolvedValue([{ exchange: 'mail.example.edu' }]);
    const result = await checkMxRecords('mit.edu', 10000, { resolveMxFn: mxResolver });

    expect(result.hasMx).toBe(true);
    expect(result.records).toEqual(['mail.example.edu']);
    expect(mxResolver).toHaveBeenCalledTimes(1);
    expect(mxResolver).toHaveBeenCalledWith('mit.edu');
  });

  test('returns hasMx: false for non-existent domain', async () => {
    const mxResolver = jest.fn().mockRejectedValue(Object.assign(new Error('No MX records found'), {
      code: 'ENOTFOUND'
    }));
    const result = await checkMxRecords('thisdomaindefinitelydoesnotexist12345.edu', 5000, {
      resolveMxFn: mxResolver
    });

    expect(result.hasMx).toBe(false);
    expect(result.error).toBe('No MX records found');
    expect(mxResolver).toHaveBeenCalledWith('thisdomaindefinitelydoesnotexist12345.edu');
  });

  test('caches MX lookup results', async () => {
    const mxResolver = jest.fn().mockResolvedValue([{ exchange: 'mail.example.edu' }]);
    const result1 = await checkMxRecords('mit.edu', 10000, { resolveMxFn: mxResolver });
    expect(result1.cached).toBeUndefined(); // First call is not cached

    const result2 = await checkMxRecords('mit.edu', 10000, { resolveMxFn: mxResolver });
    expect(result2.cached).toBe(true);
    expect(result2.hasMx).toBe(result1.hasMx);
    expect(mxResolver).toHaveBeenCalledTimes(1);
  });

  test('clearMxCache clears the cache', async () => {
    const mxResolver = jest.fn().mockResolvedValue([{ exchange: 'mail.example.edu' }]);
    await checkMxRecords('mit.edu', 10000, { resolveMxFn: mxResolver });

    clearMxCache();

    const result = await checkMxRecords('mit.edu', 10000, { resolveMxFn: mxResolver });
    expect(result.cached).toBeUndefined();
    expect(mxResolver).toHaveBeenCalledTimes(2);
  });
});

describe('Blocklist Management', () => {
  test('getBlockedDomains returns an array', () => {
    const domains = getBlockedDomains();
    expect(Array.isArray(domains)).toBe(true);
  });

  test('blocklist is not empty', () => {
    const domains = getBlockedDomains();
    expect(domains.length).toBeGreaterThan(0);
  });

  test('getBlockedDomains returns a copy (immutable)', () => {
    const domains1 = getBlockedDomains();
    const domains2 = getBlockedDomains();
    // Should be equal but not the same reference
    expect(domains1).toEqual(domains2);
    expect(domains1).not.toBe(domains2);
  });

  test('BLOCKED_DOMAINS constant is exported', () => {
    expect(Array.isArray(BLOCKED_DOMAINS)).toBe(true);
    expect(BLOCKED_DOMAINS.length).toBeGreaterThan(0);
  });
});

describe('Token Generation and Hashing', () => {
  // Replicate the token generation logic from payment.js
  function generateVerificationToken() {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    return { rawToken, tokenHash };
  }

  function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  describe('token generation', () => {
    test('generates 64 character hex token', () => {
      const { rawToken } = generateVerificationToken();
      expect(rawToken.length).toBe(64);
      expect(/^[0-9a-f]+$/.test(rawToken)).toBe(true);
    });

    test('generates 64 character hex hash', () => {
      const { tokenHash } = generateVerificationToken();
      expect(tokenHash.length).toBe(64);
      expect(/^[0-9a-f]+$/.test(tokenHash)).toBe(true);
    });

    test('generates unique tokens each time', () => {
      const token1 = generateVerificationToken();
      const token2 = generateVerificationToken();
      expect(token1.rawToken).not.toBe(token2.rawToken);
      expect(token1.tokenHash).not.toBe(token2.tokenHash);
    });
  });

  describe('token hashing', () => {
    test('produces consistent hash for same input', () => {
      const rawToken = 'test-token-123';
      const hash1 = hashToken(rawToken);
      const hash2 = hashToken(rawToken);
      expect(hash1).toBe(hash2);
    });

    test('produces different hash for different inputs', () => {
      const hash1 = hashToken('token-1');
      const hash2 = hashToken('token-2');
      expect(hash1).not.toBe(hash2);
    });

    test('hash is SHA-256 (64 hex characters)', () => {
      const hash = hashToken('any-token');
      expect(hash.length).toBe(64);
    });

    test('raw token and hash are different', () => {
      const { rawToken, tokenHash } = generateVerificationToken();
      expect(rawToken).not.toBe(tokenHash);
    });

    test('hashing the raw token produces the stored hash', () => {
      const { rawToken, tokenHash } = generateVerificationToken();
      const computedHash = hashToken(rawToken);
      expect(computedHash).toBe(tokenHash);
    });
  });
});

describe('Token Expiration Logic', () => {
  // Replicate the expiration logic from payment.js and db.js
  function generateExpirationTimestamp(hoursFromNow = 24) {
    return Math.floor(Date.now() / 1000) + hoursFromNow * 60 * 60;
  }

  function isTokenExpired(expiresAt) {
    const now = Math.floor(Date.now() / 1000);
    return expiresAt <= now;
  }

  describe('expiration timestamp generation', () => {
    test('generates timestamp 24 hours in future by default', () => {
      const expiresAt = generateExpirationTimestamp();
      const now = Math.floor(Date.now() / 1000);
      const twentyFourHours = 24 * 60 * 60;

      // Allow 1 second tolerance for test execution time
      expect(expiresAt).toBeGreaterThanOrEqual(now + twentyFourHours - 1);
      expect(expiresAt).toBeLessThanOrEqual(now + twentyFourHours + 1);
    });

    test('generates timestamp for custom hours', () => {
      const expiresAt = generateExpirationTimestamp(1); // 1 hour
      const now = Math.floor(Date.now() / 1000);
      const oneHour = 60 * 60;

      expect(expiresAt).toBeGreaterThanOrEqual(now + oneHour - 1);
      expect(expiresAt).toBeLessThanOrEqual(now + oneHour + 1);
    });

    test('generates Unix timestamp (seconds, not milliseconds)', () => {
      const expiresAt = generateExpirationTimestamp();
      // Unix timestamps in seconds are ~10 digits, in milliseconds they're ~13 digits
      expect(expiresAt.toString().length).toBeLessThanOrEqual(10);
    });
  });

  describe('expiration checking', () => {
    test('token with future expiration is not expired', () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      expect(isTokenExpired(futureTimestamp)).toBe(false);
    });

    test('token with past expiration is expired', () => {
      const pastTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      expect(isTokenExpired(pastTimestamp)).toBe(true);
    });

    test('token expiring right now is considered expired', () => {
      const nowTimestamp = Math.floor(Date.now() / 1000);
      expect(isTokenExpired(nowTimestamp)).toBe(true);
    });

    test('token expiring 1 second in the future is not expired', () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 1;
      expect(isTokenExpired(futureTimestamp)).toBe(false);
    });
  });
});

describe('isStudentVerified Function Logic', () => {
  // Replicate the isStudentVerified logic from db.js
  function isStudentVerified(user) {
    if (!user || !user.student_verified_at) return false;

    // Check if verification is still valid (within 12 months)
    const verifiedAt = new Date(user.student_verified_at);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    return verifiedAt > oneYearAgo;
  }

  describe('user verification status', () => {
    test('returns false for null user', () => {
      expect(isStudentVerified(null)).toBe(false);
    });

    test('returns false for undefined user', () => {
      expect(isStudentVerified(undefined)).toBe(false);
    });

    test('returns false for user without student_verified_at', () => {
      expect(isStudentVerified({ id: 1, username: 'test' })).toBe(false);
    });

    test('returns false for user with null student_verified_at', () => {
      expect(isStudentVerified({ id: 1, student_verified_at: null })).toBe(false);
    });

    test('returns false for user with empty string student_verified_at', () => {
      expect(isStudentVerified({ id: 1, student_verified_at: '' })).toBe(false);
    });
  });

  describe('verification expiration (12 months)', () => {
    test('returns true for recently verified user', () => {
      const now = new Date().toISOString();
      expect(isStudentVerified({ student_verified_at: now })).toBe(true);
    });

    test('returns true for user verified 6 months ago', () => {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      expect(isStudentVerified({ student_verified_at: sixMonthsAgo.toISOString() })).toBe(true);
    });

    test('returns true for user verified 11 months ago', () => {
      const elevenMonthsAgo = new Date();
      elevenMonthsAgo.setMonth(elevenMonthsAgo.getMonth() - 11);
      expect(isStudentVerified({ student_verified_at: elevenMonthsAgo.toISOString() })).toBe(true);
    });

    test('returns false for user verified exactly 1 year ago', () => {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      // Exactly 1 year ago should be expired (verifiedAt <= oneYearAgo)
      expect(isStudentVerified({ student_verified_at: oneYearAgo.toISOString() })).toBe(false);
    });

    test('returns false for user verified more than 1 year ago', () => {
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      expect(isStudentVerified({ student_verified_at: twoYearsAgo.toISOString() })).toBe(false);
    });

    test('returns true for user verified 364 days ago', () => {
      const almostOneYearAgo = new Date();
      almostOneYearAgo.setDate(almostOneYearAgo.getDate() - 364);
      expect(isStudentVerified({ student_verified_at: almostOneYearAgo.toISOString() })).toBe(true);
    });

    test('returns false for user verified 366 days ago', () => {
      const overOneYearAgo = new Date();
      overOneYearAgo.setDate(overOneYearAgo.getDate() - 366);
      expect(isStudentVerified({ student_verified_at: overOneYearAgo.toISOString() })).toBe(false);
    });
  });
});

describe('getStudentVerificationStatus Function Logic', () => {
  // Replicate the getStudentVerificationStatus logic from db.js
  function getStudentVerificationStatus(user) {
    if (!user || !user.student_verified_at) {
      return { verified: false, expired: false, email: null };
    }

    const verifiedAt = new Date(user.student_verified_at);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    return {
      verified: true,
      expired: verifiedAt <= oneYearAgo,
      email: user.student_email,
      verifiedAt: user.student_verified_at,
      subscriptionType: user.subscription_type
    };
  }

  describe('unverified users', () => {
    test('returns correct status for null user', () => {
      const status = getStudentVerificationStatus(null);
      expect(status).toEqual({ verified: false, expired: false, email: null });
    });

    test('returns correct status for user without verification', () => {
      const status = getStudentVerificationStatus({ id: 1, username: 'test' });
      expect(status).toEqual({ verified: false, expired: false, email: null });
    });
  });

  describe('verified users', () => {
    test('returns correct status for recently verified user', () => {
      const now = new Date().toISOString();
      const status = getStudentVerificationStatus({
        student_verified_at: now,
        student_email: 'student@university.edu',
        subscription_type: 'student'
      });
      expect(status.verified).toBe(true);
      expect(status.expired).toBe(false);
      expect(status.email).toBe('student@university.edu');
      expect(status.verifiedAt).toBe(now);
      expect(status.subscriptionType).toBe('student');
    });

    test('returns expired status for user verified over 1 year ago', () => {
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      const status = getStudentVerificationStatus({
        student_verified_at: twoYearsAgo.toISOString(),
        student_email: 'student@university.edu',
        subscription_type: 'student'
      });
      expect(status.verified).toBe(true);
      expect(status.expired).toBe(true);
      expect(status.email).toBe('student@university.edu');
    });
  });
});

describe('Complete Verification Flow', () => {
  // Simulate the full verification flow
  function simulateVerificationFlow(email) {
    // Step 1: Validate email
    const emailLower = email?.toLowerCase().trim();
    if (!emailLower || !emailLower.endsWith('.edu')) {
      return { success: false, step: 'validation', error: 'Invalid .edu email' };
    }

    // Step 2: Generate token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

    // Step 3: Simulate storing verification record
    const verificationRecord = {
      user_id: 1,
      edu_email: emailLower,
      token_hash: tokenHash,
      expires_at: expiresAt,
      used: 0,
      created_at: new Date().toISOString()
    };

    // Return the state that would be used for verification
    return {
      success: true,
      step: 'token_generated',
      rawToken,
      verificationRecord
    };
  }

  function simulateTokenVerification(rawToken, storedRecord) {
    // Hash the provided token
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Check if hash matches
    if (tokenHash !== storedRecord.token_hash) {
      return { success: false, error: 'Invalid token' };
    }

    // Check if already used
    if (storedRecord.used === 1) {
      return { success: false, error: 'Token already used' };
    }

    // Check if expired
    const now = Math.floor(Date.now() / 1000);
    if (storedRecord.expires_at <= now) {
      return { success: false, error: 'Token expired' };
    }

    return { success: true, email: storedRecord.edu_email };
  }

  describe('end-to-end verification', () => {
    test('successful verification flow with valid .edu email', () => {
      // Step 1 & 2: Send verification request
      const sendResult = simulateVerificationFlow('student@university.edu');
      expect(sendResult.success).toBe(true);
      expect(sendResult.verificationRecord.edu_email).toBe('student@university.edu');

      // Step 3: Verify the token
      const verifyResult = simulateTokenVerification(
        sendResult.rawToken,
        sendResult.verificationRecord
      );
      expect(verifyResult.success).toBe(true);
      expect(verifyResult.email).toBe('student@university.edu');
    });

    test('verification fails with wrong token', () => {
      const sendResult = simulateVerificationFlow('student@university.edu');
      expect(sendResult.success).toBe(true);

      // Try to verify with wrong token
      const wrongToken = crypto.randomBytes(32).toString('hex');
      const verifyResult = simulateTokenVerification(
        wrongToken,
        sendResult.verificationRecord
      );
      expect(verifyResult.success).toBe(false);
      expect(verifyResult.error).toBe('Invalid token');
    });

    test('verification fails with used token', () => {
      const sendResult = simulateVerificationFlow('student@university.edu');
      expect(sendResult.success).toBe(true);

      // Mark token as used
      const usedRecord = { ...sendResult.verificationRecord, used: 1 };
      const verifyResult = simulateTokenVerification(
        sendResult.rawToken,
        usedRecord
      );
      expect(verifyResult.success).toBe(false);
      expect(verifyResult.error).toBe('Token already used');
    });

    test('verification fails with expired token', () => {
      const sendResult = simulateVerificationFlow('student@university.edu');
      expect(sendResult.success).toBe(true);

      // Set expiration to the past
      const expiredRecord = {
        ...sendResult.verificationRecord,
        expires_at: Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
      };
      const verifyResult = simulateTokenVerification(
        sendResult.rawToken,
        expiredRecord
      );
      expect(verifyResult.success).toBe(false);
      expect(verifyResult.error).toBe('Token expired');
    });

    test('verification fails with non-.edu email', () => {
      const sendResult = simulateVerificationFlow('student@gmail.com');
      expect(sendResult.success).toBe(false);
      expect(sendResult.step).toBe('validation');
      expect(sendResult.error).toBe('Invalid .edu email');
    });
  });
});

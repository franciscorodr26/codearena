const { body, param, query, validationResult } = require('express-validator');

// Middleware to check validation results
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
};

// Common validation rules
const rules = {
  // Auth validations
  email: body('email')
    .trim()
    .isEmail().withMessage('Valid email is required')
    .normalizeEmail()
    .isLength({ max: 255 }).withMessage('Email too long'),

  password: body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .isLength({ max: 128 }).withMessage('Password too long')
    .matches(/[a-zA-Z]/).withMessage('Password must contain a letter')
    .matches(/[0-9]/).withMessage('Password must contain a number'),

  username: body('username')
    .trim()
    .isLength({ min: 3, max: 20 }).withMessage('Username must be 3-20 characters')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores')
    .escape(),

  usernameParam: param('username')
    .trim()
    .isLength({ min: 3, max: 20 }).withMessage('Invalid username')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Invalid username format'),

  // Message/content validations
  message: body('message')
    .trim()
    .isLength({ min: 1, max: 5000 }).withMessage('Message must be 1-5000 characters')
    .escape(),

  bio: body('bio')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Bio must be under 500 characters'),

  // ID validations
  odUserId: body('userId')
    .isInt({ min: 1 }).withMessage('Invalid user ID'),

  userIdParam: param('userId')
    .isInt({ min: 1 }).withMessage('Invalid user ID'),

  odBattleId: body('battleId')
    .optional()
    .isUUID().withMessage('Invalid battle ID'),

  // Code validations
  code: body('code')
    .isLength({ max: 50000 }).withMessage('Code too long (max 50KB)'),

  language: body('language')
    .isIn(['javascript', 'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'typescript', 'sql'])
    .withMessage('Invalid language'),

  // Report/moderation
  reason: body('reason')
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Reason must be 1-100 characters')
    .escape(),

  description: body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 }).withMessage('Description too long')
    .escape(),

  // Search
  searchQuery: query('q')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 }).withMessage('Search query must be 2-50 characters')
    .escape(),

  // Pagination
  limit: query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100')
    .toInt(),

  offset: query('offset')
    .optional()
    .isInt({ min: 0 }).withMessage('Offset must be non-negative')
    .toInt(),
};

// Pre-built validation chains for common endpoints
const chains = {
  register: [
    rules.email,
    rules.password,
    rules.username,
    body('avatar').optional().matches(/^[a-z0-9-]+$/).withMessage('Invalid avatar'),
    validate
  ],

  login: [
    body('username').trim().notEmpty().withMessage('Username or email required').escape(),
    body('password').notEmpty().withMessage('Password required'),
    validate
  ],

  forgotPassword: [
    rules.email,
    validate
  ],

  resetPassword: [
    body('token').notEmpty().withMessage('Reset token required'),
    rules.password,
    validate
  ],

  changePassword: [
    body('currentPassword').notEmpty().withMessage('Current password required'),
    body('newPassword')
      .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
      .isLength({ max: 128 }).withMessage('Password too long'),
    validate
  ],

  updateProfile: [
    body('username').optional().trim()
      .isLength({ min: 3, max: 20 }).withMessage('Username must be 3-20 characters')
      .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, underscores'),
    body('avatar').optional().matches(/^[a-z0-9-]+$/).withMessage('Invalid avatar'),
    body('bio').optional().trim().isLength({ max: 500 }).withMessage('Bio too long'),
    validate
  ],

  report: [
    body('userId').isInt({ min: 1 }).withMessage('Invalid user ID').toInt(),
    body('reason').trim().isLength({ min: 1, max: 100 }).withMessage('Reason must be 1-100 characters'),
    body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description too long'),
    validate
  ],

  block: [
    body('userId').isInt({ min: 1 }).withMessage('Invalid user ID').toInt(),
    validate
  ],

  sendMessage: [
    body('recipientId').isInt({ min: 1 }).withMessage('Invalid recipient'),
    body('content').trim().isLength({ min: 1, max: 5000 }).withMessage('Message must be 1-5000 characters'),
    validate
  ],
};

module.exports = {
  validate,
  rules,
  chains,
  body,
  param,
  query,
  validationResult
};

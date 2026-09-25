const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const logger = require('../utils/logger');
const { SECRET } = require('../config/jwt');
const heicConvert = require('heic-convert');
const sharp = require('sharp');
const { BACKEND_URL } = require('../config/appUrls');

// Magic bytes for image validation (prevents MIME spoofing)
const IMAGE_MAGIC_BYTES = {
  'image/jpeg': [
    [0xFF, 0xD8, 0xFF] // JPEG
  ],
  'image/png': [
    [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] // PNG
  ],
  'image/gif': [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]  // GIF89a
  ],
  'image/webp': [
    [0x52, 0x49, 0x46, 0x46] // RIFF (WebP starts with RIFF)
  ],
  'image/heic': [
    // HEIC files are based on ISOBMFF format (ftyp box)
    // Check for 'ftyp' at offset 4, followed by heic/heix/hevc/hevx/mif1
  ],
  'image/heif': [
    // Same as HEIC - both use ISOBMFF container
  ]
};

// Verify file magic bytes match declared MIME type
function verifyImageMagicBytes(filePath, declaredMimeType) {
  try {
    const buffer = Buffer.alloc(24);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 24, 0);
    fs.closeSync(fd);

    // Special handling for HEIC/HEIF files (ISOBMFF format)
    if (declaredMimeType === 'image/heic' || declaredMimeType === 'image/heif') {
      return isHeicFile(buffer);
    }

    const signatures = IMAGE_MAGIC_BYTES[declaredMimeType];
    if (!signatures) return false;

    return signatures.some(sig => {
      for (let i = 0; i < sig.length; i++) {
        if (buffer[i] !== sig[i]) return false;
      }
      return true;
    });
  } catch (err) {
    logger.error('[BUG REPORT] Error verifying magic bytes:', err);
    return false;
  }
}

// Check if buffer contains HEIC/HEIF file signature
// HEIC files use ISOBMFF container with 'ftyp' box followed by brand identifier
function isHeicFile(buffer) {
  // Check for 'ftyp' at offset 4
  const ftyp = buffer.toString('ascii', 4, 8);
  if (ftyp !== 'ftyp') return false;

  // Check brand identifier at offset 8 (heic, heix, hevc, hevx, mif1, msf1)
  const brand = buffer.toString('ascii', 8, 12);
  const validBrands = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif'];
  return validBrands.includes(brand);
}

// Configure multer for screenshot uploads
const uploadsDir = path.join(__dirname, '../uploads/screenshots');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit (HEIC files can be larger)
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
    // Also check for common HEIC MIME type variations that browsers might send
    const heicVariants = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
    const isHeic = heicVariants.includes(file.mimetype) ||
                   file.originalname.toLowerCase().endsWith('.heic') ||
                   file.originalname.toLowerCase().endsWith('.heif');

    if (allowedTypes.includes(file.mimetype) || isHeic) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and HEIC are allowed.'));
    }
  }
});

// ============================================
// MIDDLEWARE
// ============================================

// Required auth middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const authenticatedUserRateLimitKey = (req) => `user:${req.user.sub}`;

// Uploads reach persistent disk, so authenticate and throttle before multer
// parses or writes any multipart data.
const bugReportUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: authenticatedUserRateLimitKey,
  message: { error: 'Too many screenshot uploads. Please try again later.', success: false },
  standardHeaders: true,
  legacyHeaders: false
});

const bugReportSubmissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: authenticatedUserRateLimitKey,
  message: { error: 'Too many bug reports. Please try again later.', success: false },
  standardHeaders: true,
  legacyHeaders: false
});

// Admin middleware
// SECURITY: Only uses database is_admin flag - email-based bypass removed
const adminMiddleware = async (req, res, next) => {
  try {
    const user = await db.getUserById(req.user.sub);
    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }

    // Only allow users with is_admin flag set in database
    if (user.is_admin === 1) {
      return next();
    }

    return res.status(403).json({ error: 'Admin access required' });
  } catch (err) {
    next(err);
  }
};

// ============================================
// IMAGE COMPRESSION (Sharp)
// ============================================

// Compress and resize images if needed
// - Resize if width > 1920px (maintaining aspect ratio)
// - Compress JPEGs to 85% quality if file > 1MB
async function compressImageIfNeeded(filePath, mimeType) {
  try {
    const stats = await fs.promises.stat(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);

    // Get image metadata
    const metadata = await sharp(filePath).metadata();

    // Check if we need to process this image
    const needsResize = metadata.width > 1920;
    const needsCompress = fileSizeMB > 1 && (mimeType === 'image/jpeg' || mimeType === 'image/jpg');

    if (!needsResize && !needsCompress) {
      return { processed: false, filePath };
    }

    let pipeline = sharp(filePath);

    // Resize if too wide
    if (needsResize) {
      pipeline = pipeline.resize(1920, null, {
        fit: 'inside',
        withoutEnlargement: true
      });
      logger.info(`[BUG REPORT] Resizing image from ${metadata.width}px to 1920px width`);
    }

    // Apply format-specific optimizations
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      // Compress JPEG with quality based on file size
      const quality = fileSizeMB > 2 ? 80 : 85;
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    } else if (mimeType === 'image/png') {
      // Optimize PNG
      pipeline = pipeline.png({ compressionLevel: 9, palette: true });
    } else if (mimeType === 'image/webp') {
      // Optimize WebP
      pipeline = pipeline.webp({ quality: 85 });
    }

    // Create new filename for compressed image
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    const compressedPath = path.join(dir, `${basename}_compressed${ext}`);

    // Process and save
    await pipeline.toFile(compressedPath);

    // Get new file size
    const newStats = await fs.promises.stat(compressedPath);
    const newSizeMB = newStats.size / (1024 * 1024);

    // Only use compressed version if it's actually smaller
    if (newStats.size < stats.size) {
      // Delete original and rename compressed
      await fs.promises.unlink(filePath);
      await fs.promises.rename(compressedPath, filePath);

      logger.info(`[BUG REPORT] Compressed image: ${fileSizeMB.toFixed(2)}MB -> ${newSizeMB.toFixed(2)}MB (${Math.round((1 - newStats.size / stats.size) * 100)}% reduction)`);
      return { processed: true, filePath, reduction: Math.round((1 - newStats.size / stats.size) * 100) };
    } else {
      // Keep original, delete compressed version
      await fs.promises.unlink(compressedPath);
      logger.info(`[BUG REPORT] Compression skipped - original was smaller`);
      return { processed: false, filePath };
    }
  } catch (err) {
    logger.error('[BUG REPORT] Image compression error:', err);
    // Return original file if compression fails
    return { processed: false, filePath, error: err.message };
  }
}

// ============================================
// HEIC CONVERSION
// ============================================

// Check if file is a HEIC/HEIF file based on extension or MIME type
function isHeicOrHeif(file) {
  const heicMimeTypes = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
  const ext = path.extname(file.originalname).toLowerCase();
  return heicMimeTypes.includes(file.mimetype) || ext === '.heic' || ext === '.heif';
}

// Convert HEIC file to JPEG
async function convertHeicToJpeg(filePath) {
  try {
    const inputBuffer = await fs.promises.readFile(filePath);
    const outputBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 0.92
    });

    // Generate new filename with .jpg extension
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath, path.extname(filePath));
    const newFilePath = path.join(dir, `${basename}.jpg`);

    // Write converted file
    await fs.promises.writeFile(newFilePath, Buffer.from(outputBuffer));

    // Delete original HEIC file
    await fs.promises.unlink(filePath);

    return {
      success: true,
      newPath: newFilePath,
      newFilename: `${basename}.jpg`
    };
  } catch (err) {
    logger.error('[BUG REPORT] HEIC conversion failed:', err);
    return {
      success: false,
      error: err.message
    };
  }
}

// ============================================
// CONSUMER ROUTES
// ============================================

// Upload screenshots (max 5 images). Authentication and rate limiting must run
// before multer so rejected requests never write files to disk.
router.post('/upload', authMiddleware, bugReportUploadLimiter, upload.array('screenshots', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded', success: false });
    }

    // Process files: validate magic bytes and convert HEIC if needed
    const processedFiles = [];
    const invalidFiles = [];
    const conversionErrors = [];

    for (const file of req.files) {
      // Check if it's a HEIC/HEIF file
      if (isHeicOrHeif(file)) {
        // Verify it's actually a HEIC file by checking magic bytes
        const buffer = Buffer.alloc(24);
        const fd = fs.openSync(file.path, 'r');
        fs.readSync(fd, buffer, 0, 24, 0);
        fs.closeSync(fd);

        if (!isHeicFile(buffer)) {
          invalidFiles.push(file);
          try {
            fs.unlinkSync(file.path);
            logger.warn(`[BUG REPORT] Rejected invalid HEIC file: ${file.originalname}`);
          } catch (unlinkErr) {
            logger.error('[BUG REPORT] Failed to delete invalid file:', unlinkErr);
          }
          continue;
        }

        // Convert HEIC to JPEG
        const result = await convertHeicToJpeg(file.path);
        if (result.success) {
          processedFiles.push({
            ...file,
            path: result.newPath,
            filename: result.newFilename,
            mimetype: 'image/jpeg',
            converted: true
          });
          logger.info(`[BUG REPORT] Converted HEIC to JPEG: ${file.originalname}`);
        } else {
          conversionErrors.push({ file: file.originalname, error: result.error });
          try {
            fs.unlinkSync(file.path);
          } catch (unlinkErr) {
            logger.error('[BUG REPORT] Failed to delete unconverted file:', unlinkErr);
          }
        }
      } else {
        // Standard image validation
        if (verifyImageMagicBytes(file.path, file.mimetype)) {
          processedFiles.push(file);
        } else {
          invalidFiles.push(file);
          try {
            fs.unlinkSync(file.path);
            logger.warn(`[BUG REPORT] Rejected file with invalid magic bytes: ${file.originalname}`);
          } catch (unlinkErr) {
            logger.error('[BUG REPORT] Failed to delete invalid file:', unlinkErr);
          }
        }
      }
    }

    if (processedFiles.length === 0) {
      const errorMsg = conversionErrors.length > 0
        ? `Failed to process images. ${conversionErrors.map(e => e.file).join(', ')} could not be converted.`
        : 'No valid image files uploaded. Files must be actual JPEG, PNG, GIF, WebP, or HEIC images.';
      return res.status(400).json({
        error: errorMsg,
        success: false
      });
    }

    // Apply server-side compression to all processed files
    let totalCompressed = 0;
    for (const file of processedFiles) {
      // Skip GIFs (animated images)
      if (file.mimetype === 'image/gif') continue;

      const result = await compressImageIfNeeded(file.path, file.mimetype);
      if (result.processed) {
        totalCompressed++;
      }
    }

    if (totalCompressed > 0) {
      logger.info(`[BUG REPORT] Server-side compression applied to ${totalCompressed} image(s)`);
    }

    // Return the URLs for the processed files
    const baseUrl = BACKEND_URL;
    const urls = processedFiles.map(file => `${baseUrl}/uploads/screenshots/${file.filename}`);

    const convertedCount = processedFiles.filter(f => f.converted).length;
    logger.info(`[BUG REPORT] ${processedFiles.length} screenshot(s) uploaded` +
      (convertedCount > 0 ? ` (${convertedCount} converted from HEIC)` : '') +
      (totalCompressed > 0 ? `, ${totalCompressed} compressed` : '') +
      (invalidFiles.length > 0 ? `, ${invalidFiles.length} rejected` : ''));

    res.json({
      success: true,
      urls,
      rejected: invalidFiles.length,
      converted: convertedCount,
      compressed: totalCompressed
    });
  } catch (err) {
    logger.error('[BUG REPORT] Error uploading screenshots:', err);
    res.status(500).json({ error: 'Failed to upload screenshots', success: false });
  }
});

// Submit a bug report. Signed-in users retain the existing auto-filled profile
// behavior, with both an endpoint burst limit and a persistent daily limit.
router.post('/', authMiddleware, bugReportSubmissionLimiter, async (req, res) => {
  try {
    const { title, description, email, screenshotUrl, pageUrl } = req.body;

    // Rate limiting: 10 bug reports per day per user/IP
    const identifier = req.user.sub;
    const todayCount = await db.getBugReportCountToday(identifier);
    if (todayCount >= 10) {
      return res.status(429).json({
        error: 'Daily limit reached. You can submit up to 10 bug reports per day.',
        success: false
      });
    }

    // Validate required fields
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required', success: false });
    }

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Description is required', success: false });
    }

    if (title.length > 200) {
      return res.status(400).json({ error: 'Title must be 200 characters or less', success: false });
    }

    if (description.length > 5000) {
      return res.status(400).json({ error: 'Description must be 5000 characters or less', success: false });
    }

    // Get user info from the authenticated session
    let userId = req.user.sub;
    let username = req.user.username;
    let userEmail = email || null;

    if (!userEmail) {
      userEmail = req.user.email;
    }

    // Validate email format if provided
    if (userEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
      return res.status(400).json({ error: 'Invalid email format', success: false });
    }

    // Save bug report
    const reportId = uuidv4();
    await db.saveBugReport({
      id: reportId,
      userId,
      username,
      email: userEmail,
      title: title.trim(),
      description: description.trim(),
      screenshotUrl: screenshotUrl || null,
      pageUrl: pageUrl || null,
      submitterIp: req.ip
    });

    logger.info(`[BUG REPORT] New report submitted: ${reportId} by ${username || 'anonymous'}`);

    res.json({
      success: true,
      message: 'Bug report submitted successfully. Thank you for your feedback!',
      reportId
    });

  } catch (err) {
    logger.error('[BUG REPORT] Error submitting report:', err);
    res.status(500).json({ error: 'Failed to submit bug report', success: false });
  }
});

// ============================================
// ADMIN ROUTES
// ============================================

// Get all bug reports (admin only)
router.get('/admin', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    const reports = await db.getAllBugReports(status || null);
    const count = await db.getBugReportCount('new');

    res.json({
      success: true,
      reports,
      newCount: count
    });
  } catch (err) {
    logger.error('[BUG REPORT] Error fetching reports:', err);
    res.status(500).json({ error: 'Failed to fetch bug reports', success: false });
  }
});

// Get bug report count (admin only)
router.get('/admin/count', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const newCount = await db.getBugReportCount('new');
    const totalCount = await db.getBugReportCount('all');

    res.json({
      success: true,
      newCount,
      totalCount
    });
  } catch (err) {
    logger.error('[BUG REPORT] Error fetching count:', err);
    res.status(500).json({ error: 'Failed to fetch count', success: false });
  }
});

// Update bug report status (admin only)
router.put('/admin/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    if (!status || !['new', 'in_progress', 'resolved', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status', success: false });
    }

    const report = await db.getBugReportById(id);
    if (!report) {
      return res.status(404).json({ error: 'Bug report not found', success: false });
    }

    await db.updateBugReportStatus(id, status, adminNotes || null);

    logger.info(`[BUG REPORT] Report ${id} updated to status: ${status} by admin ${req.user.sub}`);

    res.json({
      success: true,
      message: 'Bug report updated successfully'
    });
  } catch (err) {
    logger.error('[BUG REPORT] Error updating report:', err);
    res.status(500).json({ error: 'Failed to update bug report', success: false });
  }
});

// Create bug report (admin only - bypasses rate limit)
router.post('/admin', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { title, description, email } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required', success: false });
    }

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Description is required', success: false });
    }

    const reportId = uuidv4();
    await db.saveBugReport({
      id: reportId,
      userId: null,
      username: 'Admin',
      email: email || 'feedback@codearena.co',
      title: title.trim(),
      description: description.trim(),
      screenshotUrl: null,
      pageUrl: null,
      submitterIp: req.ip
    });

    logger.info(`[BUG REPORT] Admin created report: ${reportId}`);

    res.json({
      success: true,
      message: 'Bug report created successfully',
      reportId
    });
  } catch (err) {
    logger.error('[BUG REPORT] Error creating report:', err);
    res.status(500).json({ error: 'Failed to create bug report', success: false });
  }
});

// Delete bug report (admin only)
router.delete('/admin/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const report = await db.getBugReportById(id);
    if (!report) {
      return res.status(404).json({ error: 'Bug report not found', success: false });
    }

    await db.deleteBugReport(id);

    logger.info(`[BUG REPORT] Report ${id} deleted by admin ${req.user.sub}`);

    res.json({
      success: true,
      message: 'Bug report deleted successfully'
    });
  } catch (err) {
    logger.error('[BUG REPORT] Error deleting report:', err);
    res.status(500).json({ error: 'Failed to delete bug report', success: false });
  }
});

module.exports = router;

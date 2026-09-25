const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const db = require('../db');
const { moderateImage } = require('../services/imageModeration');
const { BACKEND_URL } = require('../config/appUrls');
const { cloudinaryAvatarUploadOptions, ownedCloudinaryAvatarId } = require('../utils/avatarStorage');

// Cloudinary setup (optional - falls back to local storage if not configured)
let cloudinary = null;
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
  logger.info('[AVATAR] Cloudinary configured for cloud storage');
} else {
  logger.warn('[AVATAR] Cloudinary not configured - using local storage (not recommended for production)');
}

// Magic bytes for image validation
const IMAGE_MAGIC_BYTES = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  'image/heic': [] // HEIC validated via heic-convert
};

function verifyMagicBytes(buffer, mimeType) {
  const signatures = IMAGE_MAGIC_BYTES[mimeType];
  if (!signatures || signatures.length === 0) return true; // Allow HEIC through
  return signatures.some(sig => {
    for (let i = 0; i < sig.length; i++) {
      if (buffer[i] !== sig[i]) return false;
    }
    return true;
  });
}

// Ensure avatars directory exists (for local fallback)
const avatarsDir = path.join(__dirname, '../uploads/avatars');
if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}

// Multer config - memory storage so we can process with sharp before saving
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Supported: JPEG, PNG, GIF, WebP, HEIC.'));
    }
  }
});

// Rate limit: 10 uploads per hour
const avatarUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many upload attempts. Please try again later.' }
});

// Helper to upload to Cloudinary
async function uploadToCloudinary(buffer, userId) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      cloudinaryAvatarUploadOptions(userId),
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
}

// Helper to delete from Cloudinary
async function deleteFromCloudinary(url, userId) {
  try {
    const publicId = ownedCloudinaryAvatarId(url, userId, CLOUDINARY_CLOUD_NAME);
    if (publicId) {
      await cloudinary.uploader.destroy(publicId);
    }
  } catch (err) {
    logger.warn('[AVATAR] Failed to delete from Cloudinary:', err.message);
  }
}

// POST /auth/avatar - Upload profile photo
router.post('/', avatarUploadLimiter, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const userId = req.user.sub;
    let imageBuffer = req.file.buffer;

    // Verify magic bytes
    if (!verifyMagicBytes(imageBuffer, req.file.mimetype)) {
      return res.status(400).json({ error: 'Invalid image file' });
    }

    // Convert HEIC to JPEG if needed
    if (req.file.mimetype === 'image/heic' || req.file.mimetype === 'image/heif') {
      try {
        const heicConvert = require('heic-convert');
        imageBuffer = await heicConvert({
          buffer: imageBuffer,
          format: 'JPEG',
          quality: 0.9
        });
      } catch (err) {
        logger.error('[AVATAR] HEIC conversion failed:', err.message);
        return res.status(400).json({ error: 'Failed to process HEIC image' });
      }
    }

    // Resize and optimize with sharp
    const processedBuffer = await sharp(imageBuffer)
      .resize(256, 256, { fit: 'cover', position: 'centre' })
      .webp({ quality: 85 })
      .toBuffer();

    // Run content moderation
    const moderation = await moderateImage(processedBuffer);
    if (!moderation.safe) {
      return res.status(400).json({ error: moderation.reason || 'Image contains inappropriate content' });
    }

    // Get current user to check for existing avatar
    const user = await db.getUserById(userId);

    let avatarUrl;

    if (cloudinary) {
      // Use Cloudinary for cloud storage

      // Upload new avatar
      const result = await uploadToCloudinary(processedBuffer, userId);
      avatarUrl = result.secure_url;

      logger.info(`[AVATAR] User ${userId} uploaded to Cloudinary: ${avatarUrl}`);
    } else {
      // Fallback to local storage

      // Delete old avatar file if exists
      if (user?.avatar_url && !user.avatar_url.includes('cloudinary')) {
        const oldFilename = path.basename(user.avatar_url);
        const oldPath = path.join(avatarsDir, oldFilename);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }

      // Save to disk
      const filename = `${userId}-${uuidv4().slice(0, 8)}.webp`;
      const filePath = path.join(avatarsDir, filename);
      fs.writeFileSync(filePath, processedBuffer);

      // Build URL
      const baseUrl = BACKEND_URL;
      avatarUrl = `${baseUrl}/uploads/avatars/${filename}`;

      logger.info(`[AVATAR] User ${userId} uploaded locally: ${avatarUrl}`);
    }

    // Update database
    await db.run('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, userId]);

    // Only remove an owned CodeArena asset after its replacement is saved.
    if (cloudinary && user?.avatar_url) {
      await deleteFromCloudinary(user.avatar_url, userId);
    }

    res.json({ success: true, avatar_url: avatarUrl });
  } catch (err) {
    logger.error('[AVATAR] Upload failed:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// DELETE /auth/avatar - Remove profile photo
router.delete('/', async (req, res) => {
  try {
    const userId = req.user.sub;
    const user = await db.getUserById(userId);

    if (user?.avatar_url) {
      if (cloudinary && user.avatar_url.includes('cloudinary')) {
        // Delete from Cloudinary
        await deleteFromCloudinary(user.avatar_url, userId);
      } else if (!user.avatar_url.includes('cloudinary')) {
        // Delete from local storage
        const filename = path.basename(user.avatar_url);
        const filePath = path.join(avatarsDir, filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      // Clear from database
      await db.run('UPDATE users SET avatar_url = NULL WHERE id = ?', [userId]);
    }

    logger.info(`[AVATAR] User ${userId} removed profile photo`);

    res.json({ success: true });
  } catch (err) {
    logger.error('[AVATAR] Delete failed:', err);
    res.status(500).json({ error: 'Failed to remove image' });
  }
});

module.exports = router;

const logger = require('../utils/logger');

/**
 * Image moderation service using Sightengine API.
 * Falls back to allowing uploads if moderation service is unavailable
 * (but logs the failure for monitoring).
 */

const SIGHTENGINE_API_USER = process.env.SIGHTENGINE_API_USER;
const SIGHTENGINE_API_SECRET = process.env.SIGHTENGINE_API_SECRET;

// Thresholds - reject if any score exceeds these
const THRESHOLDS = {
  nudity: 0.5,
  weapon: 0.7,
  alcohol: 0.8,
  drugs: 0.7,
  offensive: 0.7,
  gore: 0.5
};

/**
 * Moderate an image buffer for inappropriate content.
 * @param {Buffer} imageBuffer - The image data to check
 * @returns {Promise<{ safe: boolean, reason?: string }>}
 */
async function moderateImage(imageBuffer) {
  // If no API keys configured, allow with warning
  if (!SIGHTENGINE_API_USER || !SIGHTENGINE_API_SECRET) {
    logger.warn('[IMAGE_MODERATION] Sightengine API not configured - skipping moderation');
    return { safe: true };
  }

  try {
    const blob = new Blob([imageBuffer], { type: 'image/webp' });
    const form = new FormData();
    form.append('media', blob, 'avatar.webp');
    form.append('models', 'nudity-2.1,offensive-2.0,gore-2.0,weapon,alcohol');
    form.append('api_user', SIGHTENGINE_API_USER);
    form.append('api_secret', SIGHTENGINE_API_SECRET);

    const response = await fetch('https://api.sightengine.com/1.0/check.json', {
      method: 'POST',
      body: form
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      logger.error(`[IMAGE_MODERATION] Sightengine API returned ${response.status}: ${errorBody}`);
      // Fail open - allow upload but log for review
      return { safe: true };
    }

    const result = await response.json();

    if (result.status !== 'success') {
      logger.error('[IMAGE_MODERATION] Sightengine returned error:', result);
      return { safe: true };
    }

    // Check nudity
    const nudityScore = Math.max(
      result.nudity?.sexual_activity || 0,
      result.nudity?.sexual_display || 0,
      result.nudity?.erotica || 0
    );
    if (nudityScore > THRESHOLDS.nudity) {
      return { safe: false, reason: 'Image contains inappropriate content' };
    }

    // Check weapon
    const weaponScore = Math.max(...Object.values(result.weapon || { none: 0 }));
    if (weaponScore > THRESHOLDS.weapon) {
      return { safe: false, reason: 'Image contains inappropriate content' };
    }

    // Check offensive content
    const offensiveScore = result.offensive?.prob || 0;
    if (offensiveScore > THRESHOLDS.offensive) {
      return { safe: false, reason: 'Image contains offensive content' };
    }

    // Check gore
    const goreScore = result.gore?.prob || 0;
    if (goreScore > THRESHOLDS.gore) {
      return { safe: false, reason: 'Image contains inappropriate content' };
    }

    // Check alcohol
    const alcoholScore = result.alcohol || 0;
    if (alcoholScore > THRESHOLDS.alcohol) {
      return { safe: false, reason: 'Image contains inappropriate content' };
    }

    return { safe: true };
  } catch (err) {
    logger.error('[IMAGE_MODERATION] Moderation check failed:', err.message);
    // Fail open - allow upload but log
    return { safe: true };
  }
}

module.exports = { moderateImage };

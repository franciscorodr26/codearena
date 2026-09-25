const { v4: uuidv4 } = require('uuid')

// Keep assets isolated even when CodeArena shares a Cloudinary account.
const AVATAR_FOLDER = 'codearena-consumer-avatars'
const USER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const AVATAR_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function cloudinaryAvatarUploadOptions(userId) {
  if (!USER_ID_PATTERN.test(String(userId))) throw new Error('Invalid avatar owner')

  return {
    folder: AVATAR_FOLDER,
    public_id: `user_${userId}_${uuidv4()}`,
    transformation: [
      { width: 256, height: 256, crop: 'fill', gravity: 'face' },
      { quality: 'auto:good', fetch_format: 'auto' }
    ],
    overwrite: false,
    invalidate: true
  }
}

function ownedCloudinaryAvatarId(value, userId, cloudName) {
  if (typeof value !== 'string' || !cloudName || !USER_ID_PATTERN.test(String(userId))) return null

  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' ||
      url.username || url.password || url.port || url.search || url.hash) return null

    const segments = url.pathname.split('/').slice(1)
    if (segments.shift() !== cloudName || segments.shift() !== 'image' || segments.shift() !== 'upload') return null
    if (/^v[0-9]+$/.test(segments[0])) segments.shift()
    if (segments.length !== 2 || segments[0] !== AVATAR_FOLDER) return null

    const filename = segments[1].replace(/\.(?:jpg|jpeg|png|gif|webp|avif)$/, '')
    const prefix = `user_${userId}_`
    if (!filename.startsWith(prefix) || !AVATAR_UUID_PATTERN.test(filename.slice(prefix.length))) return null

    return `${AVATAR_FOLDER}/${filename}`
  } catch {
    return null
  }
}

module.exports = { AVATAR_FOLDER, cloudinaryAvatarUploadOptions, ownedCloudinaryAvatarId }

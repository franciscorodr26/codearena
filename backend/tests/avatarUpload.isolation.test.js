jest.mock('../db', () => ({ getUserById: jest.fn(), run: jest.fn() }))
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }))
jest.mock('../services/imageModeration', () => ({ moderateImage: jest.fn().mockResolvedValue({ safe: true }) }))
jest.mock('../config/appUrls', () => ({ BACKEND_URL: 'https://api.codearena.co' }))
jest.mock('express-rate-limit', () => () => (req, res, next) => next())
jest.mock('sharp', () => jest.fn(() => ({
  resize: jest.fn().mockReturnThis(),
  webp: jest.fn().mockReturnThis(),
  toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed avatar'))
})))
jest.mock('cloudinary', () => ({ v2: {
  config: jest.fn(),
  uploader: { destroy: jest.fn().mockResolvedValue({ result: 'ok' }), upload_stream: jest.fn() }
} }))

const originalEnv = { ...process.env }
process.env.CLOUDINARY_CLOUD_NAME = 'shared-cloud'
process.env.CLOUDINARY_API_KEY = 'test-only-key'
process.env.CLOUDINARY_API_SECRET = 'test-only-secret'
const router = require('../routes/avatarUpload')
const db = require('../db')
const { v2: cloudinary } = require('cloudinary')
const upload = router.stack.find(layer => layer.route?.methods.post).route.stack.at(-1).handle
const remove = router.stack.find(layer => layer.route?.methods.delete).route.stack.at(-1).handle
const assetId = 'codearena-consumer-avatars/user_42_2aee67f0-45d6-4aab-a4c3-366727d15e98'
const ownedUrl = `https://res.cloudinary.com/shared-cloud/image/upload/v1/${assetId}.webp`

function response() {
  return { json: jest.fn(), status: jest.fn().mockReturnThis() }
}

beforeEach(() => {
  jest.clearAllMocks()
  db.getUserById.mockResolvedValue({ id: 42, avatar_url: ownedUrl })
  db.run.mockResolvedValue({ changes: 1 })
  cloudinary.uploader.upload_stream.mockImplementation((options, callback) => ({
    end: () => callback(null, { secure_url: 'https://res.cloudinary.com/shared-cloud/image/upload/new.webp' })
  }))
})

afterAll(() => { process.env = originalEnv })

describe('avatar routes protect shared Cloudinary assets', () => {
  test('deletes only the authenticated user’s CodeArena asset', async () => {
    const res = response()
    await remove({ user: { sub: 42 } }, res)
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(assetId)
    expect(db.run).toHaveBeenCalledWith('UPDATE users SET avatar_url = NULL WHERE id = ?', [42])
    expect(res.json).toHaveBeenCalledWith({ success: true })
  })

  test.each([
    ownedUrl.replace('codearena-consumer-avatars', 'avatars'),
    ownedUrl.replace('user_42_', 'user_43_'),
    ownedUrl.replace('shared-cloud', 'other-cloud'),
    ownedUrl.replace('res.cloudinary.com', 'evil.cloudinary.example')
  ])('clears the profile but preserves an unowned provider asset: %s', async avatarUrl => {
    db.getUserById.mockResolvedValue({ id: 42, avatar_url: avatarUrl })
    await remove({ user: { sub: 42 } }, response())
    expect(cloudinary.uploader.destroy).not.toHaveBeenCalled()
    expect(db.run).toHaveBeenCalledWith('UPDATE users SET avatar_url = NULL WHERE id = ?', [42])
  })

  test('replacement upload cannot overwrite and deletes the old avatar only after saving', async () => {
    await upload({ user: { sub: 42 }, file: { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg' } }, response())
    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(expect.objectContaining({
      folder: 'codearena-consumer-avatars', overwrite: false
    }), expect.any(Function))
    expect(db.run.mock.invocationCallOrder[0]).toBeLessThan(cloudinary.uploader.destroy.mock.invocationCallOrder[0])
  })

  test('a failed replacement never deletes the existing avatar', async () => {
    cloudinary.uploader.upload_stream.mockImplementation((options, callback) => ({ end: () => callback(new Error('provider unavailable')) }))
    const res = response()
    await upload({ user: { sub: 42 }, file: { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg' } }, res)
    expect(cloudinary.uploader.destroy).not.toHaveBeenCalled()
    expect(db.run).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

const { AVATAR_FOLDER, cloudinaryAvatarUploadOptions, ownedCloudinaryAvatarId } = require('../utils/avatarStorage')

const cloudName = 'shared-provider-account'
const owner = '42'
const uuid = '2aee67f0-45d6-4aab-a4c3-366727d15e98'
const publicId = `${AVATAR_FOLDER}/user_${owner}_${uuid}`
const url = `https://res.cloudinary.com/${cloudName}/image/upload/v123/${publicId}.webp`

describe('CodeArena avatar storage isolation', () => {
  test('uploads use a dedicated namespace, unique full UUIDs and cannot overwrite assets', () => {
    const first = cloudinaryAvatarUploadOptions(owner)
    const second = cloudinaryAvatarUploadOptions(owner)
    expect(first.folder).toBe('codearena-consumer-avatars')
    expect(first.overwrite).toBe(false)
    expect(first.public_id).toMatch(/^user_42_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(first.public_id).not.toBe(second.public_id)
    expect(ownedCloudinaryAvatarId(`https://res.cloudinary.com/${cloudName}/image/upload/${first.folder}/${first.public_id}.webp`, owner, cloudName))
      .toBe(`${first.folder}/${first.public_id}`)
  })

  test('recognizes an owned image in the configured cloud', () => {
    expect(ownedCloudinaryAvatarId(url, owner, cloudName)).toBe(publicId)
    expect(ownedCloudinaryAvatarId(url.replace('/v123/', '/'), Number(owner), cloudName)).toBe(publicId)
  })

  test.each([
    ['legacy avatar namespace', url.replace(AVATAR_FOLDER, 'avatars')],
    ['another user', url.replace('user_42_', 'user_43_')],
    ['overlapping user ID prefix', url.replace('user_42_', 'user_420_')],
    ['another cloud', url.replace(cloudName, 'other-cloud')],
    ['HTTP', url.replace('https:', 'http:')],
    ['lookalike host', url.replace('res.cloudinary.com', 'res.cloudinary.com.attacker.test')],
    ['untrusted URL containing Cloudinary', `https://attacker.test/${url}`],
    ['credentials', url.replace('https://', 'https://user@')],
    ['port', url.replace('res.cloudinary.com', 'res.cloudinary.com:444')],
    ['query', `${url}?other_asset=avatars/user_42_old`],
    ['fragment', `${url}#anything`],
    ['video asset', url.replace('/image/', '/video/')],
    ['fetch delivery', url.replace('/upload/', '/fetch/')],
    ['nested folder', url.replace(AVATAR_FOLDER, `extra/${AVATAR_FOLDER}`)],
    ['encoded path', url.replace(AVATAR_FOLDER, 'codearena%2dconsumer-avatars')],
    ['short UUID', url.replace(uuid, '2aee67f0')],
    ['trailing path', `${url}/extra`],
    ['invalid URL', 'not-a-url'],
    ['missing avatar', null]
  ])('never deletes %s', (_, value) => {
    expect(ownedCloudinaryAvatarId(value, owner, cloudName)).toBeNull()
  })

  test('requires configured cloud and a safe owner ID', () => {
    expect(ownedCloudinaryAvatarId(url, owner, '')).toBeNull()
    expect(ownedCloudinaryAvatarId(url, '../42', cloudName)).toBeNull()
    expect(() => cloudinaryAvatarUploadOptions('../42')).toThrow('Invalid avatar owner')
  })
})

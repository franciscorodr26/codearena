import { safeAuthRedirect, saveAuthRedirect, readAuthRedirect, postAuthDestination } from '../authRedirect'

beforeEach(() => sessionStorage.clear())
afterEach(() => jest.restoreAllMocks())

test.each([
  'https://example.com', '//example.com', '/\\example.com', '/%2f%2fexample.com',
  '/%5cexample.com', '/login', '/register?redirect=/practice', '/auth/github/callback',
  '/complete-profile', '/verify-required', '/%zz', '/\n/example.com', ['/', '/friends'], null,
])('rejects unsafe or looping redirect %s', value => {
  expect(safeAuthRedirect(value)).toBeNull()
})

test('retains local path, query and anchor, then consumes it once', () => {
  saveAuthRedirect('/practice?mode=prompting#history')
  expect(readAuthRedirect(true)).toBe('/practice?mode=prompting#history')
  expect(readAuthRedirect()).toBeNull()
})

test('onboarding and email verification preserve the intended destination', () => {
  saveAuthRedirect('/friends')
  expect(postAuthDestination({ username_chosen: 0, email_verified: false })).toBe('/complete-profile')
  expect(postAuthDestination({ username_chosen: 1, email_verified: false })).toBe('/verify-required')
  expect(postAuthDestination({ username_chosen: 1, email_verified: true })).toBe('/friends')
  expect(readAuthRedirect()).toBeNull()
})

test('retains the existing battle invite exception for email verification', () => {
  saveAuthRedirect('/battle/invite/test-code')
  expect(postAuthDestination({ email_verified: false })).toBe('/battle/invite/test-code')
})

test('blocked storage does not prevent default navigation', () => {
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked') })
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked') })
  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Blocked') })
  expect(() => saveAuthRedirect('/friends')).not.toThrow()
  expect(postAuthDestination({ email_verified: true })).toBe('/dashboard')
})

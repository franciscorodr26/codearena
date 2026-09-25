const express = require('express')
const request = require('supertest')

jest.mock('../db', () => ({ getUserById: jest.fn(), get: jest.fn(), all: jest.fn(), run: jest.fn() }))
jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => {
    if (req.headers.authorization !== 'Bearer test-member') return res.status(401).json({ error: 'Unauthorized' })
    req.user = { sub: 7 }
    next()
  }
}))
jest.mock('../services/communityAdmin', () => ({ overview: jest.fn(), members: jest.fn(), history: jest.fn() }))

const db = require('../db')
const service = require('../services/communityAdmin')
const router = require('../routes/admin')
const app = express()
app.use('/api/admin', router)
app.use((error, req, res, next) => res.status(500).json({ error: 'Internal error' }))

beforeEach(() => {
  jest.clearAllMocks()
  db.getUserById.mockResolvedValue({ id: 7, is_admin: 1 })
  service.overview.mockResolvedValue({ counts: { members: 2 } })
  service.members.mockResolvedValue({ members: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 0 } })
  service.history.mockResolvedValue({ member: { id: 7 }, counts: {}, activities: [] })
})

const endpoints = ['/overview', '/members', '/members/7/history']
test.each(endpoints)('%s requires authentication before querying member data', async path => {
  const result = await request(app).get(`/api/admin/community${path}`)
  expect(result.status).toBe(401)
  expect(db.getUserById).not.toHaveBeenCalled()
  expect(service.overview).not.toHaveBeenCalled()
  expect(service.members).not.toHaveBeenCalled()
  expect(service.history).not.toHaveBeenCalled()
})

test.each(endpoints)('%s rejects authenticated non-admins', async path => {
  db.getUserById.mockResolvedValue({ id: 7, is_admin: 0 })
  const result = await request(app).get(`/api/admin/community${path}`).set('Authorization', 'Bearer test-member')
  expect(result.status).toBe(403)
  expect(service.overview).not.toHaveBeenCalled()
  expect(service.members).not.toHaveBeenCalled()
  expect(service.history).not.toHaveBeenCalled()
})

test.each(endpoints)('%s allows DB-confirmed admins and prevents response caching', async path => {
  const result = await request(app).get(`/api/admin/community${path}`).set('Authorization', 'Bearer test-member')
  expect(result.status).toBe(200)
  expect(result.body.success).toBe(true)
  expect(result.headers['cache-control']).toBe('private, no-store')
  expect(db.getUserById).toHaveBeenCalledWith(7)
})

test('rechecks the DB admin flag rather than trusting a cached role or header', async () => {
  db.getUserById.mockResolvedValue(null)
  const result = await request(app).get('/api/admin/community/members').set('Authorization', 'Bearer test-member').set('x-admin-key', 'pretend-admin')
  expect(result.status).toBe(403)
  expect(service.members).not.toHaveBeenCalled()
})

test('passes bounded pagination and trimmed search to the service', async () => {
  await request(app).get('/api/admin/community/members?page=2&limit=50&search=%20alice%20').set('Authorization', 'Bearer test-member').expect(200)
  expect(service.members).toHaveBeenCalledWith({ page: 2, limit: 50, search: 'alice' })
})

test.each(['page=0', 'page=-1', 'page=10001', 'page=1.5', 'page=1&page=2', 'limit=101', 'limit=0', 'limit=all', 'search=' + 'a'.repeat(101), 'search=a&search=b'])('rejects invalid query %s', async query => {
  await request(app).get(`/api/admin/community/members?${query}`).set('Authorization', 'Bearer test-member').expect(400)
  expect(service.members).not.toHaveBeenCalled()
})

test.each(['0', '-1', 'not-an-id', '9007199254740992'])('rejects invalid member ID %s', async id => {
  await request(app).get(`/api/admin/community/members/${id}/history`).set('Authorization', 'Bearer test-member').expect(400)
  expect(service.history).not.toHaveBeenCalled()
})

test('missing members return 404', async () => {
  service.history.mockResolvedValue(null)
  await request(app).get('/api/admin/community/members/8/history').set('Authorization', 'Bearer test-member').expect(404)
})

test('query failure returns an error without leaking SQL or private data', async () => {
  service.overview.mockRejectedValue(new Error('secret SQL diagnostic'))
  const result = await request(app).get('/api/admin/community/overview').set('Authorization', 'Bearer test-member')
  expect(result.status).toBe(500)
  expect(JSON.stringify(result.body)).not.toContain('secret SQL')
})

test('the community API has no write routes', async () => {
  await request(app).post('/api/admin/community/members/7/history').set('Authorization', 'Bearer test-member').expect(404)
  expect(db.run).not.toHaveBeenCalled()
})

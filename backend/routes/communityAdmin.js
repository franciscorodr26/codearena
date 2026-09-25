const express = require('express')
const service = require('../services/communityAdmin')

const router = express.Router()

function positiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number <= maximum ? number : null
}

function parsePagination(query) {
  const page = positiveInteger(query.page, 1, 10000)
  const limit = positiveInteger(query.limit, 25, 100)
  return page && limit ? { page, limit } : null
}

// This router is mounted ONLY behind authMiddleware + DB-backed adminMiddleware.
// Keep all member information out of shared/browser caches.
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store')
  next()
})

router.get('/overview', async (_req, res, next) => {
  try {
    res.json({ success: true, ...await service.overview() })
  } catch (error) { next(error) }
})

router.get('/members', async (req, res, next) => {
  const paging = parsePagination(req.query)
  const search = req.query.search === undefined ? '' : req.query.search
  if (!paging || typeof search !== 'string' || search.length > 100) {
    return res.status(400).json({ error: 'Use page 1–10000, limit 1–100, and a search of at most 100 characters.' })
  }
  try {
    res.json({ success: true, ...await service.members({ ...paging, search: search.trim() }) })
  } catch (error) { next(error) }
})

router.get('/members/:id/history', async (req, res, next) => {
  const id = positiveInteger(req.params.id, null, Number.MAX_SAFE_INTEGER)
  const paging = parsePagination(req.query)
  if (!id || !paging) return res.status(400).json({ error: 'Invalid member ID or pagination.' })
  try {
    const result = await service.history(id, paging)
    if (!result) return res.status(404).json({ error: 'Member not found' })
    res.json({ success: true, ...result })
  } catch (error) { next(error) }
})

module.exports = router

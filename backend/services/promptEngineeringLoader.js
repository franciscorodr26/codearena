const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '../data/prompting/prompts.json')

let cached = null
let byId = null

function load() {
  if (cached) return cached
  const raw = fs.readFileSync(FILE, 'utf8')
  cached = JSON.parse(raw)
  if (!Array.isArray(cached) || cached.length === 0) {
    throw new Error('[promptEngineeringLoader] prompts.json is empty or invalid')
  }
  // Fail fast if any problem is missing tieredDeterministic scoring, without
  // it, evaluateModelOutputTiered silently returns 0% for that week and the
  // weekly leaderboard becomes a no-op.
  const missingScoring = cached.filter(
    (p) => !p?.modelOutputScoring || p.modelOutputScoring.mode !== 'tieredDeterministic'
  )
  if (missingScoring.length > 0) {
    const ids = missingScoring.map((p) => p.id).join(', ')
    throw new Error(
      `[promptEngineeringLoader] ${missingScoring.length} problem(s) missing tieredDeterministic modelOutputScoring: ${ids}`
    )
  }
  byId = new Map(cached.map((p) => [p.id, p]))
  return cached
}

function getAll() {
  return load()
}

function getById(id) {
  load()
  return byId.get(id) || null
}

/** Client-safe payload (no examplePrompt / hints for competitive) */
function toPublicProblem(p) {
  if (!p) return null
  return {
    id: p.id,
    title: p.title,
    difficulty: p.difficulty,
    category: p.category,
    description: p.description,
    scenario: p.scenario,
    targetOutput: p.targetOutput
  }
}

function getRandom() {
  const all = load()
  if (!all.length) return null
  return all[Math.floor(Math.random() * all.length)]
}

/** @param {'Easy'|'Medium'|'Hard'} difficulty */
function getRandomByDifficulty(difficulty) {
  const all = load().filter((p) => p.difficulty === difficulty)
  if (!all.length) return null
  return all[Math.floor(Math.random() * all.length)]
}

/** 5 min → Easy, 10 → Medium, 15 → Hard (only 5/10/15 used by prompt battle) */
function difficultyForDurationMinutes(minutes) {
  const m = Number(minutes)
  if (m === 5) return 'Easy'
  if (m === 10) return 'Medium'
  if (m === 15) return 'Hard'
  return 'Easy'
}

function listSummaries() {
  return load().map((p) => ({
    id: p.id,
    title: p.title,
    difficulty: p.difficulty,
    category: p.category
  }))
}

module.exports = {
  getAll,
  getById,
  getRandom,
  getRandomByDifficulty,
  difficultyForDurationMinutes,
  toPublicProblem,
  listSummaries
}

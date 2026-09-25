const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const sqlite3 = require('sqlite3').verbose();
const logger = require('./utils/logger');
const { v4: uuidv4 } = require('uuid');
const {
  CODEARENA_PRODUCT_MODE,
  getConsumerFairUseLimit,
  getConsumerQuotaStatus
} = require('../shared/codearenaProductMode');

// Use /data for Railway volume mount, fallback to local for development
const DB_PATH = process.env.DB_PATH || (process.env.RAILWAY_ENVIRONMENT
  ? '/data/data.sqlite'
  : path.join(__dirname, 'data.sqlite'));

// Promise that resolves when database is open and ready
let dbReadyResolve;
const dbReady = new Promise((resolve) => { dbReadyResolve = resolve; });

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    logger.error('Failed to open database', err);
    // Still resolve so we can fail gracefully in init()
    dbReadyResolve(false);
  } else {
    logger.info('SQLite DB opened at', DB_PATH);
    dbReadyResolve(true);
  }
});

// Run a single PRAGMA command with error handling (non-fatal)
function runPragma(pragma) {
  return new Promise((resolve) => {
    db.run(pragma, (err) => {
      if (err) {
        logger.warn(`[DB] PRAGMA failed (non-fatal): ${pragma} - ${err.message}`);
      }
      resolve(); // Always resolve, PRAGMAs are optimizations not requirements
    });
  });
}

// Run all PRAGMA optimizations sequentially with timeout protection
async function runPragmas() {
  const isRailway = !!process.env.RAILWAY_ENVIRONMENT;

  // Essential PRAGMAs that should work everywhere
  await runPragma('PRAGMA busy_timeout=30000');      // 30 second timeout
  await runPragma('PRAGMA journal_mode=WAL');        // Write-Ahead Logging
  await runPragma('PRAGMA synchronous=NORMAL');      // Faster writes, still safe with WAL
  await runPragma('PRAGMA cache_size=-64000');       // 64MB cache
  await runPragma('PRAGMA temp_store=MEMORY');       // Store temp tables in memory

  // mmap can cause issues on some volume mounts, skip on Railway
  if (!isRailway) {
    await runPragma('PRAGMA mmap_size=268435456');   // 256MB memory-mapped I/O
  } else {
    logger.info('[DB] Skipping mmap_size on Railway environment');
  }

  logger.info('[DB] PRAGMA optimizations complete');
}

// Retry wrapper for transient database errors
async function withRetry(operation, maxRetries = 5, delayMs = 200) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      // Retry on SQLITE_BUSY, SQLITE_LOCKED, or I/O errors
      const isRetryable = err.code === 'SQLITE_BUSY' ||
        err.code === 'SQLITE_LOCKED' ||
        err.message?.includes('database is locked') ||
        err.message?.includes('SQLITE_BUSY');

      if (isRetryable && attempt < maxRetries) {
        logger.warn(`[DB] Retrying operation (attempt ${attempt}/${maxRetries}): ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function run(sql, params = []) {
  return withRetry(() => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  }));
}

function get(sql, params = []) {
  return withRetry(() => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  }));
}

function all(sql, params = []) {
  return withRetry(() => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  }));
}

// ── Transactions ────────────────────────────────────────────────────────────
// node-sqlite3 multiplexes every statement over a SINGLE connection, so two
// transactions whose awaits interleave would both issue BEGIN IMMEDIATE on that
// one connection and the second throws "cannot start a transaction within a
// transaction". Since the whole backend is one event loop, a JS-level mutex is
// enough to make transactions run strictly one-at-a-time, end to end; the
// underlying BEGIN IMMEDIATE still provides cross-process safety.
//
// withTransaction() is therefore the single serialized transaction primitive for
// the entire backend: every caller is queued behind the in-flight transaction
// with zero coordination at the call site, so any read-then-write inside the
// callback is atomic against every other transaction (no lost updates, no TOCTOU).
const _txContext = new AsyncLocalStorage();
let _txQueue = Promise.resolve();

// Acquire the mutex, run one transaction to completion, release. The
// AsyncLocalStorage scope marks "we are inside a transaction" so re-entrant
// calls on this async chain can detect it (see withTransaction).
async function _runExclusiveTransaction(callback) {
  return _txContext.run({ active: true }, async () => {
    await run('BEGIN IMMEDIATE');
    try {
      const result = await callback();
      await run('COMMIT');
      return result;
    } catch (error) {
      await run('ROLLBACK');
      throw error;
    }
  });
}

/**
 * Run `callback` inside a serialized BEGIN IMMEDIATE transaction.
 *
 * - Globally serialized: concurrent calls queue and execute one-at-a-time, so a
 *   read-then-write in the callback is atomic against every other transaction in
 *   the process. This is what closes the seat/monthly-invite TOCTOU races and any
 *   like them, without per-call-site coordination.
 * - Re-entrant: if the current async context is ALREADY inside a transaction, the
 *   callback runs inline on the open transaction instead of issuing an illegal
 *   nested BEGIN or deadlocking behind our own in-flight transaction. No call path
 *   nests today; this keeps a future one correct by construction.
 */
function withTransaction(callback) {
  if (_txContext.getStore()?.active) {
    return Promise.resolve().then(callback); // join the open transaction
  }
  const job = _txQueue.then(() => _runExclusiveTransaction(callback));
  // Chain the next caller after this one regardless of outcome, a failed
  // transaction must not poison the queue for everyone behind it.
  _txQueue = job.then(() => {}, () => {});
  return job;
}

// ============================================
// MIGRATIONS
// ============================================

const migrations = [
  {
    id: 1,
    name: 'create_users_table',
    sql: `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  },
  {
    id: 2,
    name: 'create_password_resets_table',
    sql: `CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )`
  },
  {
    id: 3,
    name: 'add_username_to_users',
    sql: `ALTER TABLE users ADD COLUMN username TEXT`
  },
  {
    id: 4,
    name: 'add_avatar_to_users',
    sql: `ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT 'default-1'`
  },
  {
    id: 5,
    name: 'add_bio_to_users',
    sql: `ALTER TABLE users ADD COLUMN bio TEXT`
  },
  {
    id: 6,
    name: 'add_online_status_to_users',
    sql: `ALTER TABLE users ADD COLUMN is_online INTEGER DEFAULT 0`
  },
  {
    id: 7,
    name: 'add_last_seen_to_users',
    sql: `ALTER TABLE users ADD COLUMN last_seen TEXT`
  },
  {
    id: 8,
    name: 'create_battles_history_table',
    sql: `CREATE TABLE IF NOT EXISTS battles_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_uuid TEXT NOT NULL UNIQUE,
      problem_id TEXT NOT NULL,
      winner_id INTEGER REFERENCES users(id),
      loser_id INTEGER REFERENCES users(id),
      winner_time INTEGER,
      loser_time INTEGER,
      is_tie INTEGER DEFAULT 0,
      is_forfeit INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      finished_at TEXT
    )`
  },
  {
    id: 9,
    name: 'create_user_stats_table',
    sql: `CREATE TABLE IF NOT EXISTS user_stats (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      ties INTEGER DEFAULT 0,
      total_battles INTEGER DEFAULT 0,
      avg_solve_time REAL DEFAULT 0,
      fastest_solve INTEGER,
      win_streak INTEGER DEFAULT 0,
      best_win_streak INTEGER DEFAULT 0,
      rating INTEGER DEFAULT 1000,
      updated_at TEXT NOT NULL
    )`
  },
  {
    id: 10,
    name: 'create_messages_table',
    sql: `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      receiver_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT NOT NULL
    )`
  },
  {
    id: 11,
    name: 'create_conversations_table',
    sql: `CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1_id INTEGER NOT NULL REFERENCES users(id),
      user2_id INTEGER NOT NULL REFERENCES users(id),
      last_message_id INTEGER REFERENCES messages(id),
      last_activity TEXT NOT NULL,
      UNIQUE(user1_id, user2_id)
    )`
  },
  {
    id: 12,
    name: 'create_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
      CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_battles_winner ON battles_history(winner_id);
      CREATE INDEX IF NOT EXISTS idx_battles_loser ON battles_history(loser_id);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_conversations_users ON conversations(user1_id, user2_id);
    `
  },
  {
    id: 13,
    name: 'create_challenges_table',
    sql: `CREATE TABLE IF NOT EXISTS challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenger_id INTEGER NOT NULL REFERENCES users(id),
      challenged_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending',
      battle_uuid TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      responded_at TEXT
    )`
  },
  {
    id: 14,
    name: 'create_friend_requests_table',
    sql: `CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL REFERENCES users(id),
      requested_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      responded_at TEXT,
      UNIQUE(requester_id, requested_id)
    )`
  },
  {
    id: 15,
    name: 'create_friendships_table',
    sql: `CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1_id INTEGER NOT NULL REFERENCES users(id),
      user2_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(user1_id, user2_id)
    )`
  },
  {
    id: 16,
    name: 'create_friends_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_friend_requests_requester ON friend_requests(requester_id);
      CREATE INDEX IF NOT EXISTS idx_friend_requests_requested ON friend_requests(requested_id);
      CREATE INDEX IF NOT EXISTS idx_friend_requests_status ON friend_requests(status);
      CREATE INDEX IF NOT EXISTS idx_friendships_user1 ON friendships(user1_id);
      CREATE INDEX IF NOT EXISTS idx_friendships_user2 ON friendships(user2_id);
    `
  },
  {
    id: 17,
    name: 'create_battle_violations_table',
    sql: `CREATE TABLE IF NOT EXISTS battle_violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_uuid TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      player_id TEXT NOT NULL,
      violation_type TEXT NOT NULL,
      details TEXT,
      severity TEXT DEFAULT 'warning',
      created_at TEXT NOT NULL
    )`
  },
  {
    id: 18,
    name: 'add_violation_tracking_to_user_stats',
    sql: `ALTER TABLE user_stats ADD COLUMN total_violations INTEGER DEFAULT 0`
  },
  {
    id: 19,
    name: 'add_warning_count_to_user_stats',
    sql: `ALTER TABLE user_stats ADD COLUMN warning_count INTEGER DEFAULT 0`
  },
  {
    id: 20,
    name: 'add_trust_score_to_user_stats',
    sql: `ALTER TABLE user_stats ADD COLUMN trust_score INTEGER DEFAULT 100`
  },
  {
    id: 21,
    name: 'add_is_banned_to_users',
    sql: `ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0`
  },
  {
    id: 22,
    name: 'add_ban_reason_to_users',
    sql: `ALTER TABLE users ADD COLUMN ban_reason TEXT`
  },
  {
    id: 23,
    name: 'add_banned_until_to_users',
    sql: `ALTER TABLE users ADD COLUMN banned_until TEXT`
  },
  {
    id: 24,
    name: 'create_battle_violations_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_violations_battle ON battle_violations(battle_uuid);
      CREATE INDEX IF NOT EXISTS idx_violations_user ON battle_violations(user_id);
      CREATE INDEX IF NOT EXISTS idx_violations_type ON battle_violations(violation_type);
    `
  },
  {
    id: 25,
    name: 'create_daily_challenges_table',
    sql: `CREATE TABLE IF NOT EXISTS daily_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_date TEXT NOT NULL UNIQUE,
      problem_id TEXT NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'medium',
      created_at TEXT NOT NULL
    )`
  },
  {
    id: 26,
    name: 'create_daily_challenge_attempts_table',
    sql: `CREATE TABLE IF NOT EXISTS daily_challenge_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      challenge_date TEXT NOT NULL,
      solve_time INTEGER,
      completed INTEGER DEFAULT 0,
      code TEXT,
      language TEXT NOT NULL DEFAULT 'python',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(user_id, challenge_date)
    )`
  },
  {
    id: 27,
    name: 'create_daily_challenge_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_daily_challenges_date ON daily_challenges(challenge_date);
      CREATE INDEX IF NOT EXISTS idx_daily_attempts_user ON daily_challenge_attempts(user_id);
      CREATE INDEX IF NOT EXISTS idx_daily_attempts_date ON daily_challenge_attempts(challenge_date);
      CREATE INDEX IF NOT EXISTS idx_daily_attempts_completed ON daily_challenge_attempts(completed);
    `
  },
  {
    id: 28,
    name: 'add_streak_to_user_stats',
    sql: `ALTER TABLE user_stats ADD COLUMN daily_streak INTEGER DEFAULT 0`
  },
  {
    id: 29,
    name: 'add_best_daily_streak_to_user_stats',
    sql: `ALTER TABLE user_stats ADD COLUMN best_daily_streak INTEGER DEFAULT 0`
  },
  {
    id: 30,
    name: 'add_last_daily_completion_to_user_stats',
    sql: `ALTER TABLE user_stats ADD COLUMN last_daily_completion TEXT`
  },
  {
    id: 31,
    name: 'create_user_email_preferences_table',
    sql: `CREATE TABLE IF NOT EXISTS user_email_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
      weekly_challenge INTEGER DEFAULT 1,
      marketing INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  },
  {
    id: 32,
    name: 'create_email_preferences_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_email_prefs_weekly ON user_email_preferences(weekly_challenge)`
  },
  {
    id: 33,
    name: 'create_rating_history_table',
    sql: `CREATE TABLE IF NOT EXISTS rating_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      rating INTEGER NOT NULL,
      rating_change INTEGER NOT NULL,
      battle_uuid TEXT,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  },
  {
    id: 34,
    name: 'add_rating_history_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_rating_history_user ON rating_history(user_id, created_at DESC)`
  },
  {
    id: 35,
    name: 'add_language_to_battles_history',
    sql: `ALTER TABLE battles_history ADD COLUMN winner_language TEXT DEFAULT 'python';
          ALTER TABLE battles_history ADD COLUMN loser_language TEXT DEFAULT 'python'`
  },
  {
    id: 36,
    name: 'create_practice_stats_table',
    sql: `CREATE TABLE IF NOT EXISTS practice_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      problems_solved INTEGER DEFAULT 0,
      problems_attempted INTEGER DEFAULT 0,
      total_time_spent INTEGER DEFAULT 0,
      avg_solve_time INTEGER,
      fastest_solve INTEGER,
      by_difficulty TEXT DEFAULT '{}',
      by_language TEXT DEFAULT '{}',
      last_practice TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id)
    )`
  },
  {
    id: 37,
    name: 'create_practice_attempts_table',
    sql: `CREATE TABLE IF NOT EXISTS practice_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      problem_id TEXT NOT NULL,
      language TEXT NOT NULL,
      solved INTEGER DEFAULT 0,
      solve_time INTEGER,
      attempts INTEGER DEFAULT 1,
      solution_code TEXT,
      solution_submitted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 38,
    name: 'add_private_battle_stats_to_user_stats',
    sql: `ALTER TABLE user_stats ADD COLUMN private_wins INTEGER DEFAULT 0;
          ALTER TABLE user_stats ADD COLUMN private_losses INTEGER DEFAULT 0;
          ALTER TABLE user_stats ADD COLUMN private_ties INTEGER DEFAULT 0`
  },
  {
    id: 39,
    name: 'create_coding_sessions_table',
    sql: `CREATE TABLE IF NOT EXISTS coding_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      problem_id TEXT NOT NULL,
      session_type TEXT NOT NULL,
      language TEXT NOT NULL,

      -- Timing metrics
      start_time TEXT NOT NULL,
      end_time TEXT,
      total_duration INTEGER,

      -- Behavioral metrics
      first_keystroke_delay INTEGER,
      total_keystrokes INTEGER DEFAULT 0,
      total_pastes INTEGER DEFAULT 0,
      idle_time INTEGER DEFAULT 0,
      active_typing_time INTEGER DEFAULT 0,

      -- Code progression
      code_snapshots TEXT DEFAULT '[]',
      revision_count INTEGER DEFAULT 0,
      lines_added INTEGER DEFAULT 0,
      lines_deleted INTEGER DEFAULT 0,

      -- Outcome
      solved INTEGER DEFAULT 0,
      final_code TEXT,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 40,
    name: 'create_ai_feedback_cache',
    sql: `CREATE TABLE IF NOT EXISTS ai_feedback_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      feedback_type TEXT NOT NULL,
      feedback_data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    )`
  },
  // ============================================
  // PRO AI COACHING SYSTEM TABLES
  // ============================================
  {
    id: 41,
    name: 'add_is_pro_to_users',
    sql: `ALTER TABLE users ADD COLUMN is_pro INTEGER DEFAULT 0;
          ALTER TABLE users ADD COLUMN pro_expires_at TEXT;
          ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
          ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT`
  },
  {
    id: 42,
    name: 'create_coder_profiles_table',
    sql: `CREATE TABLE IF NOT EXISTS coder_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),

      -- Coder archetype (determined by AI)
      archetype TEXT,
      archetype_confidence REAL DEFAULT 0,

      -- Behavioral metrics (aggregated)
      avg_thinking_time REAL,
      avg_typing_speed REAL,
      avg_revision_count REAL,
      paste_frequency REAL,

      -- Strengths and growth areas (JSON arrays)
      strengths TEXT DEFAULT '[]',
      growth_areas TEXT DEFAULT '[]',

      -- Learning trajectory
      improvement_rate REAL,
      consistency_score REAL,

      -- Last analysis timestamp
      last_analyzed TEXT,
      sessions_analyzed INTEGER DEFAULT 0,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 43,
    name: 'create_problem_categories_table',
    sql: `CREATE TABLE IF NOT EXISTS problem_category_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      category TEXT NOT NULL,

      -- Performance metrics
      problems_attempted INTEGER DEFAULT 0,
      problems_solved INTEGER DEFAULT 0,
      avg_solve_time REAL,
      fastest_solve INTEGER,

      -- Improvement tracking
      initial_avg_time REAL,
      current_avg_time REAL,
      improvement_percent REAL,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, category)
    )`
  },
  {
    id: 44,
    name: 'create_coaching_insights_table',
    sql: `CREATE TABLE IF NOT EXISTS coaching_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),

      -- Insight details
      insight_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      priority INTEGER DEFAULT 5,

      -- Context
      related_sessions TEXT,
      evidence TEXT,

      -- Action tracking
      dismissed INTEGER DEFAULT 0,
      acted_on INTEGER DEFAULT 0,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 45,
    name: 'create_learning_milestones_table',
    sql: `CREATE TABLE IF NOT EXISTS learning_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),

      milestone_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,

      -- Achievement data
      achieved_value REAL,
      previous_value REAL,
      improvement_percent REAL,

      unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 46,
    name: 'add_problem_metadata_to_sessions',
    sql: `ALTER TABLE coding_sessions ADD COLUMN problem_difficulty TEXT;
          ALTER TABLE coding_sessions ADD COLUMN problem_category TEXT;
          ALTER TABLE coding_sessions ADD COLUMN error_count INTEGER DEFAULT 0;
          ALTER TABLE coding_sessions ADD COLUMN test_run_count INTEGER DEFAULT 0;
          ALTER TABLE coding_sessions ADD COLUMN hints_used INTEGER DEFAULT 0`
  },
  {
    id: 47,
    name: 'create_weekly_digests_table',
    sql: `CREATE TABLE IF NOT EXISTS weekly_digests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),

      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,

      -- Summary data
      sessions_count INTEGER DEFAULT 0,
      problems_solved INTEGER DEFAULT 0,
      total_time_spent INTEGER DEFAULT 0,

      -- AI analysis
      summary TEXT,
      key_insights TEXT,
      recommendations TEXT,

      -- Comparison to previous week
      vs_previous_week TEXT,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, week_start)
    )`
  },
  {
    id: 48,
    name: 'create_coaching_hints_table',
    sql: `CREATE TABLE IF NOT EXISTS coaching_hints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      problem_id TEXT,
      hint_type TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 49,
    name: 'create_code_reviews_table',
    sql: `CREATE TABLE IF NOT EXISTS code_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      problem_id TEXT NOT NULL,
      language TEXT NOT NULL,
      overall_score INTEGER,
      verdict TEXT,
      complexity_time TEXT,
      complexity_space TEXT,
      review_data TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 50,
    name: 'add_onboarding_to_users',
    sql: `ALTER TABLE users ADD COLUMN has_onboarded INTEGER DEFAULT 0`
  },
  {
    id: 51,
    name: 'mark_existing_users_onboarded',
    sql: `UPDATE users SET has_onboarded = 1 WHERE has_onboarded = 0 OR has_onboarded IS NULL`
  },
  {
    id: 52,
    name: 'add_google_id_to_users',
    sql: `ALTER TABLE users ADD COLUMN google_id TEXT; CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`
  },
  {
    id: 53,
    name: 'add_is_matchmade_to_battles',
    sql: `ALTER TABLE battles_history ADD COLUMN is_matchmade INTEGER DEFAULT 1`
  },
  {
    id: 54,
    name: 'add_username_changed_at_to_users',
    sql: `ALTER TABLE users ADD COLUMN username_changed_at TEXT`
  },
  {
    id: 55,
    name: 'create_badges_table',
    sql: `CREATE TABLE IF NOT EXISTS badges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL,
      rarity TEXT NOT NULL CHECK(rarity IN ('common', 'rare', 'epic', 'legendary')),
      category TEXT NOT NULL CHECK(category IN ('battle', 'streak', 'rank', 'practice', 'weekly', 'special')),
      criteria_type TEXT NOT NULL,
      criteria_value INTEGER,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 56,
    name: 'create_user_badges_table',
    sql: `CREATE TABLE IF NOT EXISTS user_badges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      badge_id INTEGER NOT NULL REFERENCES badges(id),
      earned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notified INTEGER DEFAULT 0,
      UNIQUE(user_id, badge_id)
    )`
  },
  {
    id: 57,
    name: 'create_badge_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);
          CREATE INDEX IF NOT EXISTS idx_user_badges_badge ON user_badges(badge_id);
          CREATE INDEX IF NOT EXISTS idx_badges_category ON badges(category);
          CREATE INDEX IF NOT EXISTS idx_badges_rarity ON badges(rarity)`
  },
  {
    id: 58,
    name: 'seed_badges',
    sql: `INSERT OR IGNORE INTO badges (slug, name, description, icon, rarity, category, criteria_type, criteria_value, sort_order) VALUES
      -- Battle Milestones
      ('first-blood', 'First Blood', 'Win your first battle', '🗡️', 'common', 'battle', 'battle_wins', 1, 1),
      ('battle-ready', 'Battle Ready', 'Win 10 battles', '⚔️', 'common', 'battle', 'battle_wins', 10, 2),
      ('gladiator', 'Gladiator', 'Win 50 battles', '🏛️', 'rare', 'battle', 'battle_wins', 50, 3),
      ('arena-champion', 'Arena Champion', 'Win 100 battles', '🏆', 'epic', 'battle', 'battle_wins', 100, 4),
      ('legendary-warrior', 'Legendary Warrior', 'Win 500 battles', '👑', 'legendary', 'battle', 'battle_wins', 500, 5),
      ('speed-demon', 'Speed Demon', 'Solve a battle in under 2 minutes', '⚡', 'rare', 'battle', 'fastest_solve', 120, 6),
      ('lightning-strike', 'Lightning Strike', 'Solve a battle in under 1 minute', '🌩️', 'epic', 'battle', 'fastest_solve', 60, 7),

      -- Win Streaks
      ('hot-streak', 'Hot Streak', 'Win 3 battles in a row', '🔥', 'common', 'streak', 'win_streak', 3, 10),
      ('on-fire', 'On Fire', 'Win 5 battles in a row', '🔥', 'rare', 'streak', 'win_streak', 5, 11),
      ('unstoppable', 'Unstoppable', 'Win 10 battles in a row', '💪', 'epic', 'streak', 'win_streak', 10, 12),
      ('invincible', 'Invincible', 'Win 15 battles in a row', '🛡️', 'epic', 'streak', 'win_streak', 15, 13),
      ('godlike', 'Godlike', 'Win 25 battles in a row', '⭐', 'legendary', 'streak', 'win_streak', 25, 14),

      -- Rank Achievements
      ('silver-tier', 'Silver Tier', 'Reach Silver rank (1200+ rating)', '🥈', 'common', 'rank', 'rating', 1200, 20),
      ('gold-tier', 'Gold Tier', 'Reach Gold rank (1400+ rating)', '🥇', 'rare', 'rank', 'rating', 1400, 21),
      ('platinum-tier', 'Platinum Tier', 'Reach Platinum rank (1600+ rating)', '💎', 'rare', 'rank', 'rating', 1600, 22),
      ('diamond-tier', 'Diamond Tier', 'Reach Diamond rank (1800+ rating)', '💠', 'epic', 'rank', 'rating', 1800, 23),
      ('master-tier', 'Master Tier', 'Reach Master rank (2000+ rating)', '👑', 'epic', 'rank', 'rating', 2000, 24),
      ('grandmaster', 'Grandmaster', 'Reach Grandmaster rank (2200+ rating)', '🏆', 'legendary', 'rank', 'rating', 2200, 25),
      ('elite-club', 'Elite Club', 'Reach top 100 on leaderboard', '🌟', 'legendary', 'rank', 'leaderboard_rank', 100, 26),

      -- Weekly Challenge
      ('weekly-warrior', 'Weekly Warrior', 'Complete your first weekly challenge', '📅', 'common', 'weekly', 'weekly_completion', 1, 30),
      ('consistent-coder', 'Consistent Coder', 'Complete 4 weekly challenges', '📊', 'rare', 'weekly', 'weekly_completion', 4, 31),
      ('weekly-master', 'Weekly Master', 'Complete 12 weekly challenges', '🎯', 'epic', 'weekly', 'weekly_completion', 12, 32),
      ('streak-keeper', 'Streak Keeper', 'Maintain a 4-week challenge streak', '🔥', 'rare', 'weekly', 'weekly_streak', 4, 33),
      ('streak-legend', 'Streak Legend', 'Maintain a 12-week challenge streak', '🌋', 'legendary', 'weekly', 'weekly_streak', 12, 34),

      -- Practice Mode
      ('practice-rookie', 'Practice Rookie', 'Solve 10 practice problems', '📝', 'common', 'practice', 'practice_solved', 10, 40),
      ('practice-adept', 'Practice Adept', 'Solve 50 practice problems', '📚', 'rare', 'practice', 'practice_solved', 50, 41),
      ('practice-master', 'Practice Master', 'Solve 100 practice problems', '🎓', 'epic', 'practice', 'practice_solved', 100, 42),
      ('problem-crusher', 'Problem Crusher', 'Solve 250 practice problems', '💪', 'legendary', 'practice', 'practice_solved', 250, 43)`
  },
  {
    id: 59,
    name: 'create_activity_events_table',
    sql: `CREATE TABLE IF NOT EXISTS activity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      event_type TEXT NOT NULL,
      event_data TEXT,
      is_public INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 60,
    name: 'create_activity_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_events(user_id);
          CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_events(event_type);
          CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at DESC)`
  },
  {
    id: 61,
    name: 'create_push_subscriptions_table',
    sql: `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 62,
    name: 'create_push_subscriptions_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)`
  },
  {
    id: 63,
    name: 'add_activity_preferences',
    sql: `ALTER TABLE user_email_preferences ADD COLUMN activity_feed INTEGER DEFAULT 1`
  },
  // ============================================
  // TOURNAMENT SYSTEM TABLES
  // ============================================
  {
    id: 64,
    name: 'create_tournaments_table',
    sql: `CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      start_time TEXT NOT NULL,
      registration_deadline TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'single_elimination',
      max_players INTEGER DEFAULT 32,
      min_players INTEGER DEFAULT 4,
      prize_description TEXT,
      is_pro_only INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'upcoming',
      current_round INTEGER DEFAULT 0,
      total_rounds INTEGER DEFAULT 0,
      winner_id INTEGER REFERENCES users(id),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      completed_at TEXT
    )`
  },
  {
    id: 65,
    name: 'create_tournament_participants_table',
    sql: `CREATE TABLE IF NOT EXISTS tournament_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      seed INTEGER,
      language TEXT DEFAULT 'python',
      eliminated_at TEXT,
      eliminated_in_round INTEGER,
      final_placement INTEGER,
      registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checked_in INTEGER DEFAULT 0,
      UNIQUE(tournament_id, user_id)
    )`
  },
  {
    id: 66,
    name: 'create_tournament_matches_table',
    sql: `CREATE TABLE IF NOT EXISTS tournament_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
      round INTEGER NOT NULL,
      match_number INTEGER NOT NULL,
      bracket_position INTEGER NOT NULL,
      player1_id INTEGER REFERENCES users(id),
      player2_id INTEGER REFERENCES users(id),
      winner_id INTEGER REFERENCES users(id),
      battle_uuid TEXT,
      problem_id TEXT,
      scheduled_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      UNIQUE(tournament_id, round, match_number)
    )`
  },
  {
    id: 67,
    name: 'create_tournament_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
          CREATE INDEX IF NOT EXISTS idx_tournaments_start ON tournaments(start_time);
          CREATE INDEX IF NOT EXISTS idx_tournament_participants_tournament ON tournament_participants(tournament_id);
          CREATE INDEX IF NOT EXISTS idx_tournament_participants_user ON tournament_participants(user_id);
          CREATE INDEX IF NOT EXISTS idx_tournament_matches_tournament ON tournament_matches(tournament_id);
          CREATE INDEX IF NOT EXISTS idx_tournament_matches_players ON tournament_matches(player1_id, player2_id)`
  },
  {
    id: 68,
    name: 'seed_tournament_badges',
    sql: `INSERT OR IGNORE INTO badges (slug, name, description, icon, rarity, category, criteria_type, criteria_value, sort_order) VALUES
      ('tournament-victor', 'Tournament Victor', 'Win your first tournament', '🏆', 'epic', 'battle', 'tournament_wins', 1, 50),
      ('tournament-champion', 'Tournament Champion', 'Win 5 tournaments', '👑', 'legendary', 'battle', 'tournament_wins', 5, 51),
      ('tournament-warrior', 'Tournament Warrior', 'Participate in 10 tournaments', '⚔️', 'rare', 'battle', 'tournament_participations', 10, 52),
      ('tournament-finalist', 'Tournament Finalist', 'Reach the finals of a tournament', '🥈', 'rare', 'battle', 'tournament_finalist', 1, 53)`
  },
  {
    id: 69,
    name: 'add_progress_digest_preference',
    sql: `ALTER TABLE user_email_preferences ADD COLUMN progress_digest INTEGER DEFAULT 1`
  },
  {
    id: 70,
    name: 'add_tournament_notifications_preference',
    sql: `ALTER TABLE user_email_preferences ADD COLUMN tournament_notifications INTEGER DEFAULT 0`
  },
  {
    id: 71,
    name: 'create_solution_fingerprints_table',
    sql: `CREATE TABLE IF NOT EXISTS solution_fingerprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id TEXT NOT NULL,
      battle_id TEXT,
      user_id INTEGER REFERENCES users(id),
      fingerprint TEXT NOT NULL,
      ngram_fingerprints TEXT,
      language TEXT NOT NULL,
      code_length INTEGER,
      is_winning_solution INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )`
  },
  {
    id: 72,
    name: 'create_solution_fingerprints_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_fingerprints_problem ON solution_fingerprints(problem_id);
      CREATE INDEX IF NOT EXISTS idx_fingerprints_hash ON solution_fingerprints(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_fingerprints_winning ON solution_fingerprints(is_winning_solution);
    `
  },
  {
    id: 73,
    name: 'create_browser_fingerprints_table',
    sql: `CREATE TABLE IF NOT EXISTS browser_fingerprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      fingerprint TEXT NOT NULL,
      user_agent TEXT,
      screen_resolution TEXT,
      timezone TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE(user_id, fingerprint)
    )`
  },
  {
    id: 74,
    name: 'create_browser_fingerprints_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_browser_fp_user ON browser_fingerprints(user_id);
      CREATE INDEX IF NOT EXISTS idx_browser_fp_hash ON browser_fingerprints(fingerprint);
    `
  },
  {
    id: 75,
    name: 'create_flagged_submissions_table',
    sql: `CREATE TABLE IF NOT EXISTS flagged_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      player_id TEXT NOT NULL,
      problem_id TEXT NOT NULL,
      code TEXT NOT NULL,
      language TEXT NOT NULL,
      violations TEXT NOT NULL,
      total_suspicion REAL NOT NULL,
      recommendation TEXT NOT NULL,
      review_status TEXT DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      review_notes TEXT,
      created_at TEXT NOT NULL
    )`
  },
  {
    id: 76,
    name: 'create_flagged_submissions_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_flagged_battle ON flagged_submissions(battle_id);
      CREATE INDEX IF NOT EXISTS idx_flagged_user ON flagged_submissions(user_id);
      CREATE INDEX IF NOT EXISTS idx_flagged_status ON flagged_submissions(review_status);
      CREATE INDEX IF NOT EXISTS idx_flagged_recommendation ON flagged_submissions(recommendation);
    `
  },
  {
    id: 77,
    name: 'add_private_tournament_fields',
    sql: `
      ALTER TABLE tournaments ADD COLUMN is_private INTEGER DEFAULT 0;
      ALTER TABLE tournaments ADD COLUMN invite_code TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_invite_code ON tournaments(invite_code) WHERE invite_code IS NOT NULL;
    `
  },
  {
    id: 78,
    name: 'create_email_changes_table',
    sql: `CREATE TABLE IF NOT EXISTS email_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      new_email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )`
  },
  {
    id: 79,
    name: 'add_username_chosen_to_users',
    sql: `ALTER TABLE users ADD COLUMN username_chosen INTEGER DEFAULT 1`
  },
  {
    id: 80,
    name: 'create_consent_records_table',
    sql: `CREATE TABLE IF NOT EXISTS consent_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      anonymous_id TEXT,
      analytics_consent INTEGER NOT NULL DEFAULT 0,
      functional_consent INTEGER NOT NULL DEFAULT 0,
      action TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`
  },
  {
    id: 81,
    name: 'create_user_reports_table',
    sql: `CREATE TABLE IF NOT EXISTS user_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL,
      reported_user_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER,
      reviewed_at TEXT,
      resolution TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    )`
  },
  {
    id: 82,
    name: 'create_user_bans_table',
    sql: `CREATE TABLE IF NOT EXISTS user_bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      banned_by INTEGER,
      reason TEXT NOT NULL,
      expires_at TEXT,
      is_permanent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE SET NULL
    )`
  },
  {
    id: 83,
    name: 'add_is_banned_to_users',
    sql: `ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0`
  },
  {
    id: 84,
    name: 'create_blocked_users_table',
    sql: `CREATE TABLE IF NOT EXISTS blocked_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blocker_id INTEGER NOT NULL,
      blocked_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(blocker_id, blocked_id)
    )`
  },
  {
    id: 85,
    name: 'add_is_admin_to_users',
    sql: `ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`
  },
  {
    id: 86,
    name: 'add_cookie_consent_to_users',
    sql: `ALTER TABLE users ADD COLUMN cookie_consent_analytics INTEGER;
          ALTER TABLE users ADD COLUMN cookie_consent_functional INTEGER;
          ALTER TABLE users ADD COLUMN cookie_consent_updated_at TEXT`
  },
  {
    id: 87,
    name: 'create_webhook_events_table',
    sql: `CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processed'
    )`
  },
  {
    id: 88,
    name: 'add_token_version_to_users',
    sql: `ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1`
  },
  {
    id: 89,
    name: 'add_scalability_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_user_stats_user ON user_stats(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_stats_rating ON user_stats(rating DESC);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
      CREATE INDEX IF NOT EXISTS idx_challenges_challenger ON challenges(challenger_id);
      CREATE INDEX IF NOT EXISTS idx_challenges_challenged ON challenges(challenged_id);
      CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);
      CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON blocked_users(blocker_id);
      CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users(blocked_id);
      CREATE INDEX IF NOT EXISTS idx_user_reports_reporter ON user_reports(reporter_id);
      CREATE INDEX IF NOT EXISTS idx_user_reports_reported ON user_reports(reported_user_id);
      CREATE INDEX IF NOT EXISTS idx_user_reports_status ON user_reports(status);
    `
  },
  {
    id: 90,
    name: 'set_initial_admin',
    sql: `SELECT 1` // No-op: Admin now managed via ADMIN_EMAILS env var
  },
  {
    id: 91,
    name: 'ensure_admin_set',
    sql: `SELECT 1` // No-op: Admin now managed via ADMIN_EMAILS env var
  },
  {
    id: 92,
    name: 'force_admin_update',
    sql: `SELECT 1` // No-op: Admin now managed via ADMIN_EMAILS env var
  },
  {
    id: 93,
    name: 'remove_old_admin',
    sql: `SELECT 1` // No-op: Legacy migration, no longer needed
  },
  {
    id: 94,
    name: 'set_playcodearena_admin',
    sql: `SELECT 1` // No-op: Admin now managed via ADMIN_EMAILS env var
  },
  {
    id: 95,
    name: 'create_admin_audit_log',
    sql: `CREATE TABLE IF NOT EXISTS admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (admin_id) REFERENCES users(id)
    )`
  },
  {
    id: 96,
    name: 'index_admin_audit_admin_id',
    sql: `CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_id ON admin_audit_log(admin_id)`
  },
  {
    id: 97,
    name: 'index_admin_audit_action',
    sql: `CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action)`
  },
  {
    id: 98,
    name: 'index_admin_audit_created_at',
    sql: `CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_log(created_at)`
  },
  {
    id: 99,
    name: 'create_retired_usernames',
    sql: `CREATE TABLE IF NOT EXISTS retired_usernames (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      original_user_id INTEGER,
      reason TEXT DEFAULT 'account_deleted',
      retired_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  },
  {
    id: 100,
    name: 'index_retired_usernames',
    sql: `CREATE INDEX IF NOT EXISTS idx_retired_usernames_username ON retired_usernames(LOWER(username))`
  },
  {
    id: 101,
    name: 'create_user_feedback_table',
    sql: `CREATE TABLE IF NOT EXISTS user_feedback (
      id TEXT PRIMARY KEY,
      battle_id TEXT,
      player_id TEXT,
      player_name TEXT NOT NULL,
      rating INTEGER NOT NULL,
      suggestion TEXT,
      email TEXT,
      winner TEXT,
      problem_id TEXT,
      standalone INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  },
  {
    id: 102,
    name: 'add_missing_performance_indexes',
    sql: `
      -- battles_history: for time-range queries and uuid lookups
      CREATE INDEX IF NOT EXISTS idx_battles_created_at ON battles_history(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_battles_uuid ON battles_history(battle_uuid);

      -- practice_attempts: for user practice mode queries
      CREATE INDEX IF NOT EXISTS idx_practice_attempts_user ON practice_attempts(user_id);
      CREATE INDEX IF NOT EXISTS idx_practice_attempts_problem ON practice_attempts(problem_id);
      CREATE INDEX IF NOT EXISTS idx_practice_attempts_solved ON practice_attempts(solved);

      -- coding_sessions: for AI coaching session analysis
      CREATE INDEX IF NOT EXISTS idx_coding_sessions_user ON coding_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_coding_sessions_problem ON coding_sessions(problem_id);
      CREATE INDEX IF NOT EXISTS idx_coding_sessions_start ON coding_sessions(start_time DESC);

      -- coaching_insights: for user coaching queries
      CREATE INDEX IF NOT EXISTS idx_coaching_insights_user ON coaching_insights(user_id);
      CREATE INDEX IF NOT EXISTS idx_coaching_insights_type ON coaching_insights(insight_type);

      -- learning_milestones: for user achievement queries
      CREATE INDEX IF NOT EXISTS idx_learning_milestones_user ON learning_milestones(user_id);
      CREATE INDEX IF NOT EXISTS idx_learning_milestones_type ON learning_milestones(milestone_type);

      -- code_reviews: for user review history
      CREATE INDEX IF NOT EXISTS idx_code_reviews_user ON code_reviews(user_id);
      CREATE INDEX IF NOT EXISTS idx_code_reviews_problem ON code_reviews(problem_id);

      -- weekly_digests: for user digest retrieval
      CREATE INDEX IF NOT EXISTS idx_weekly_digests_user ON weekly_digests(user_id);

      -- password_resets: for token validation and cleanup
      CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
      CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);
      CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at);

      -- email_changes: for pending change queries
      CREATE INDEX IF NOT EXISTS idx_email_changes_user ON email_changes(user_id);
      CREATE INDEX IF NOT EXISTS idx_email_changes_token ON email_changes(token_hash);

      -- consent_records: for consent lookups and auditing
      CREATE INDEX IF NOT EXISTS idx_consent_records_user ON consent_records(user_id);
      CREATE INDEX IF NOT EXISTS idx_consent_records_anon ON consent_records(anonymous_id);

      -- user_bans: for ban status checks
      CREATE INDEX IF NOT EXISTS idx_user_bans_user ON user_bans(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_bans_expires ON user_bans(expires_at);

      -- user_feedback: for admin review queries
      CREATE INDEX IF NOT EXISTS idx_user_feedback_battle ON user_feedback(battle_id);
      CREATE INDEX IF NOT EXISTS idx_user_feedback_timestamp ON user_feedback(timestamp DESC);

      -- coder_profiles: for coaching profile lookups (already unique on user_id, but explicit index helps)
      CREATE INDEX IF NOT EXISTS idx_coder_profiles_user ON coder_profiles(user_id);

      -- problem_category_stats: for category performance queries
      CREATE INDEX IF NOT EXISTS idx_problem_category_stats_user ON problem_category_stats(user_id);
      CREATE INDEX IF NOT EXISTS idx_problem_category_stats_category ON problem_category_stats(category);

      -- ai_feedback_cache: for cache lookups and cleanup
      CREATE INDEX IF NOT EXISTS idx_ai_feedback_cache_user ON ai_feedback_cache(user_id);
      CREATE INDEX IF NOT EXISTS idx_ai_feedback_cache_expires ON ai_feedback_cache(expires_at);

      -- webhook_events: for idempotency checks
      CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events(event_type);

      -- coaching_hints: for hint tracking
      CREATE INDEX IF NOT EXISTS idx_coaching_hints_user ON coaching_hints(user_id);
      CREATE INDEX IF NOT EXISTS idx_coaching_hints_problem ON coaching_hints(problem_id);
    `
  },
  {
    id: 103,
    name: 'create_bug_reports_table',
    sql: `
      CREATE TABLE IF NOT EXISTS bug_reports (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        username TEXT,
        email TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        screenshot_url TEXT,
        page_url TEXT,
        status TEXT DEFAULT 'new',
        admin_notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
      CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_bug_reports_user ON bug_reports(user_id);
    `
  },
  {
    id: 104,
    name: 'add_submitter_ip_to_bug_reports',
    sql: `
      ALTER TABLE bug_reports ADD COLUMN submitter_ip TEXT;
      CREATE INDEX IF NOT EXISTS idx_bug_reports_submitter_ip ON bug_reports(submitter_ip);
    `
  },
  {
    id: 105,
    name: 'create_battle_invites_table',
    sql: `
      CREATE TABLE IF NOT EXISTS battle_invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        battle_id TEXT NOT NULL,
        invite_code TEXT UNIQUE NOT NULL,
        inviter_id INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_by_id INTEGER REFERENCES users(id),
        used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_battle_invites_code ON battle_invites(invite_code);
      CREATE INDEX IF NOT EXISTS idx_battle_invites_battle ON battle_invites(battle_id);
      CREATE INDEX IF NOT EXISTS idx_battle_invites_inviter ON battle_invites(inviter_id);
      CREATE INDEX IF NOT EXISTS idx_battle_invites_status ON battle_invites(status);
    `
  },
  {
    id: 626,
    name: 'add_battle_invites_expires_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_battle_invites_expires ON battle_invites(expires_at);`
  },
  {
    id: 106,
    name: 'add_show_read_receipts_preference',
    sql: `ALTER TABLE users ADD COLUMN show_read_receipts INTEGER DEFAULT 1`
  },
  {
    id: 107,
    name: 'add_screenshots_to_user_reports',
    sql: `ALTER TABLE user_reports ADD COLUMN screenshots TEXT`
  },
  {
    id: 108,
    name: 'add_edited_at_to_messages',
    sql: `ALTER TABLE messages ADD COLUMN edited_at TEXT`
  },
  {
    id: 238,
    name: 'create_group_conversations_table',
    sql: `CREATE TABLE IF NOT EXISTS group_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      creator_id INTEGER NOT NULL REFERENCES users(id),
      avatar TEXT DEFAULT '👥',
      created_at TEXT NOT NULL,
      last_message_id INTEGER,
      last_activity TEXT
    )`
  },
  {
    id: 239,
    name: 'create_group_members_table',
    sql: `CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES group_conversations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      role TEXT DEFAULT 'member',
      joined_at TEXT NOT NULL,
      UNIQUE(group_id, user_id)
    )`
  },
  {
    id: 240,
    name: 'create_group_messages_table',
    sql: `CREATE TABLE IF NOT EXISTS group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES group_conversations(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      edited_at TEXT
    )`
  },
  {
    id: 241,
    name: 'add_group_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
          CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
          CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id);
          CREATE INDEX IF NOT EXISTS idx_group_messages_created ON group_messages(created_at)`
  },
  {
    id: 921,
    name: 'create_message_reactions_table',
    sql: `CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(message_id, user_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
    CREATE INDEX IF NOT EXISTS idx_message_reactions_user ON message_reactions(user_id)`
  },
  {
    id: 922,
    name: 'create_group_message_reactions_table',
    sql: `CREATE TABLE IF NOT EXISTS group_message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_message_id INTEGER NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(group_message_id, user_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS idx_group_message_reactions_message ON group_message_reactions(group_message_id);
    CREATE INDEX IF NOT EXISTS idx_group_message_reactions_user ON group_message_reactions(user_id)`
  },
  {
    id: 242,
    name: 'create_cheat_discipline_table',
    sql: `CREATE TABLE IF NOT EXISTS cheat_discipline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      offense_number INTEGER NOT NULL,
      violation_type TEXT NOT NULL,
      details TEXT,
      action_taken TEXT NOT NULL,
      suspension_hours INTEGER,
      expires_at TEXT,
      battle_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  },
  {
    id: 243,
    name: 'add_cheat_discipline_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_cheat_discipline_user ON cheat_discipline(user_id);
          CREATE INDEX IF NOT EXISTS idx_cheat_discipline_created ON cheat_discipline(created_at DESC)`
  },
  {
    id: 244,
    name: 'create_battle_snapshots_table',
    sql: `CREATE TABLE IF NOT EXISTS battle_snapshots (
      battle_id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      battle_data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  },
  {
    id: 245,
    name: 'add_battle_snapshots_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_battle_snapshots_state ON battle_snapshots(state);
          CREATE INDEX IF NOT EXISTS idx_battle_snapshots_updated ON battle_snapshots(updated_at)`
  },
  {
    id: 246,
    name: 'add_is_owner_column',
    sql: `ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0`
  },
  {
    id: 247,
    name: 'set_founder_as_owner',
    sql: `SELECT 1` // No-op: Owner now managed via OWNER_EMAILS env var
  },
  {
    id: 248,
    name: 'make_snorlax16_admin',
    sql: `SELECT 1` // No-op: Admin now managed via ADMIN_EMAILS env var
  },
  {
    id: 249,
    name: 'make_snorlax186_admin',
    sql: `SELECT 1` // No-op: Admin now managed via ADMIN_EMAILS env var
  },
  {
    id: 250,
    name: 'fix_invalid_avatar_values',
    sql: `UPDATE users SET avatar = 'default-1' WHERE avatar IS NULL OR avatar = '' OR avatar = '0' OR avatar = 0`
  },
  {
    id: 251,
    name: 'add_email_verified_column',
    sql: `ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0`
  },
  {
    id: 252,
    name: 'create_email_verifications_table',
    sql: `CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  },
  {
    id: 253,
    name: 'mark_existing_users_verified',
    sql: `UPDATE users SET email_verified = 1 WHERE email_verified IS NULL OR email_verified = 0`
  },
  // Trust Tier v2 Migrations
  {
    id: 270,
    name: 'trust_v2_user_stats_columns',
    sql: `ALTER TABLE user_stats ADD COLUMN last_trust_gain_date TEXT`
  },
  {
    id: 271,
    name: 'trust_v2_daily_trust_gained',
    sql: `ALTER TABLE user_stats ADD COLUMN daily_trust_gained REAL DEFAULT 0`
  },
  {
    id: 272,
    name: 'trust_v2_trust_frozen_until',
    sql: `ALTER TABLE user_stats ADD COLUMN trust_frozen_until TEXT`
  },
  {
    id: 273,
    name: 'trust_v2_last_active_date',
    sql: `ALTER TABLE user_stats ADD COLUMN last_active_date TEXT`
  },
  {
    id: 274,
    name: 'trust_v2_behavior_metrics_variance',
    sql: `CREATE TABLE IF NOT EXISTS user_behavior_metrics (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      typing_speed_avg REAL DEFAULT 0,
      paste_frequency REAL DEFAULT 0,
      focus_loss_rate REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      typing_speed_variance REAL DEFAULT 0
    )`
  },
  {
    id: 275,
    name: 'trust_v2_solve_time_easy',
    sql: `ALTER TABLE user_behavior_metrics ADD COLUMN avg_solve_time_easy REAL`
  },
  {
    id: 276,
    name: 'trust_v2_solve_time_medium',
    sql: `ALTER TABLE user_behavior_metrics ADD COLUMN avg_solve_time_medium REAL`
  },
  {
    id: 277,
    name: 'trust_v2_solve_time_hard',
    sql: `ALTER TABLE user_behavior_metrics ADD COLUMN avg_solve_time_hard REAL`
  },
  {
    id: 278,
    name: 'trust_v2_solve_variance_easy',
    sql: `ALTER TABLE user_behavior_metrics ADD COLUMN solve_time_variance_easy REAL`
  },
  {
    id: 279,
    name: 'trust_v2_solve_variance_medium',
    sql: `ALTER TABLE user_behavior_metrics ADD COLUMN solve_time_variance_medium REAL`
  },
  {
    id: 280,
    name: 'trust_v2_solve_variance_hard',
    sql: `ALTER TABLE user_behavior_metrics ADD COLUMN solve_time_variance_hard REAL`
  },
  {
    id: 281,
    name: 'trust_v2_violation_explanations',
    sql: `CREATE TABLE IF NOT EXISTS violation_explanations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      violation_type TEXT NOT NULL,
      user_facing_message TEXT NOT NULL,
      baseline_comparison TEXT,
      appealable INTEGER DEFAULT 1,
      appeal_status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  },
  {
    id: 282,
    name: 'trust_v2_violation_explanations_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_violation_exp_user ON violation_explanations(user_id);
          CREATE INDEX IF NOT EXISTS idx_violation_exp_battle ON violation_explanations(battle_id)`
  },
  {
    id: 283,
    name: 'trust_v2_appeals_table',
    sql: `CREATE TABLE IF NOT EXISTS trust_appeals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      violation_id INTEGER,
      battle_id TEXT,
      user_explanation TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      admin_id INTEGER,
      admin_response TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    )`
  },
  {
    id: 284,
    name: 'trust_v2_appeals_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_appeals_user ON trust_appeals(user_id);
          CREATE INDEX IF NOT EXISTS idx_appeals_status ON trust_appeals(status)`
  },
  {
    id: 285,
    name: 'trust_v2_milestone_streaks',
    sql: `ALTER TABLE user_stats ADD COLUMN milestone_streaks_claimed TEXT DEFAULT '[]'`
  },
  // Welford M2 columns for proper variance tracking
  {
    id: 286,
    name: 'trust_v2_welford_typing_m2',
    sql: `ALTER TABLE user_behavior_metrics ADD COLUMN typing_speed_m2 REAL DEFAULT 0`
  },
  {
    id: 287,
    name: 'trust_v2_welford_paste_m2',
    sql: `ALTER TABLE user_behavior_metrics ADD COLUMN paste_freq_m2 REAL DEFAULT 0`
  },
  {
    id: 288,
    name: 'trust_v2_welford_focus_m2',
    sql: `ALTER TABLE user_behavior_metrics ADD COLUMN focus_loss_m2 REAL DEFAULT 0`
  },
  {
    id: 289,
    name: 'trust_v2_solve_time_m2_easy',
    sql: `ALTER TABLE user_behavior_metrics ADD COLUMN solve_time_easy_m2 REAL DEFAULT 0`
  },
  {
    id: 290,
    name: 'trust_v2_solve_time_m2_medium',
    sql: `ALTER TABLE user_behavior_metrics ADD COLUMN solve_time_medium_m2 REAL DEFAULT 0`
  },
  {
    id: 291,
    name: 'trust_v2_solve_time_m2_hard',
    sql: `ALTER TABLE user_behavior_metrics ADD COLUMN solve_time_hard_m2 REAL DEFAULT 0`
  },
  {
    id: 292,
    name: 'trust_v2_solve_time_counts',
    sql: `ALTER TABLE user_behavior_metrics ADD COLUMN solve_time_easy_count INTEGER DEFAULT 0;
          ALTER TABLE user_behavior_metrics ADD COLUMN solve_time_medium_count INTEGER DEFAULT 0;
          ALTER TABLE user_behavior_metrics ADD COLUMN solve_time_hard_count INTEGER DEFAULT 0`
  },
  // Smurf detection - track device fingerprints per user
  {
    id: 293,
    name: 'trust_v2_user_device_fingerprints',
    sql: `CREATE TABLE IF NOT EXISTS user_device_fingerprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      times_seen INTEGER DEFAULT 1,
      UNIQUE(user_id, fingerprint)
    )`
  },
  {
    id: 294,
    name: 'trust_v2_device_fingerprints_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_device_fp_user ON user_device_fingerprints(user_id);
          CREATE INDEX IF NOT EXISTS idx_device_fp_fingerprint ON user_device_fingerprints(fingerprint)`
  },
  // Appeal cooldown tracking
  {
    id: 295,
    name: 'trust_v2_appeals_denied_count',
    sql: `ALTER TABLE trust_appeals ADD COLUMN denial_cooldown_until TEXT`
  },
  // Rolling window for median calculation (last 20 values)
  {
    id: 296,
    name: 'trust_v2_rolling_windows',
    sql: `ALTER TABLE user_behavior_metrics ADD COLUMN recent_typing_speeds TEXT DEFAULT '[]';
          ALTER TABLE user_behavior_metrics ADD COLUMN recent_solve_times_easy TEXT DEFAULT '[]';
          ALTER TABLE user_behavior_metrics ADD COLUMN recent_solve_times_medium TEXT DEFAULT '[]';
          ALTER TABLE user_behavior_metrics ADD COLUMN recent_solve_times_hard TEXT DEFAULT '[]'`
  },
  // Student plan verification
  {
    id: 297,
    name: 'add_student_columns_to_users',
    sql: `ALTER TABLE users ADD COLUMN student_email TEXT;
          ALTER TABLE users ADD COLUMN student_verified_at TEXT;
          ALTER TABLE users ADD COLUMN subscription_type TEXT DEFAULT 'pro'`
  },
  {
    id: 298,
    name: 'create_student_verifications_table',
    sql: `CREATE TABLE IF NOT EXISTS student_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      edu_email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  },
  {
    id: 299,
    name: 'student_verifications_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_student_verifications_token_hash ON student_verifications(token_hash);
          CREATE INDEX IF NOT EXISTS idx_student_verifications_user_id ON student_verifications(user_id)`
  },
  {
    id: 300,
    name: 'add_username_change_count',
    sql: `ALTER TABLE users ADD COLUMN username_change_count INTEGER DEFAULT 0`
  },
  // ============================================
  // ACTIVITY REMINDER NOTIFICATIONS
  // ============================================
  {
    id: 301,
    name: 'create_notification_log_table',
    sql: `CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      notification_type TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notification_log_user ON notification_log(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_log_unique ON notification_log(user_id, notification_type)`
  },
  {
    id: 302,
    name: 'add_activity_reminders_preference',
    sql: `ALTER TABLE user_email_preferences ADD COLUMN activity_reminders INTEGER DEFAULT 1`
  },
  // ============================================
  // PARTIAL CREDIT BATTLE TRACKING
  // ============================================
  {
    id: 303,
    name: 'add_partial_credit_to_battles',
    sql: `ALTER TABLE battles_history ADD COLUMN is_partial_credit INTEGER DEFAULT 0`
  },
  {
    id: 304,
    name: 'add_winner_tests_passed_to_battles',
    sql: `ALTER TABLE battles_history ADD COLUMN winner_tests_passed INTEGER DEFAULT NULL`
  },
  {
    id: 305,
    name: 'add_loser_tests_passed_to_battles',
    sql: `ALTER TABLE battles_history ADD COLUMN loser_tests_passed INTEGER DEFAULT NULL`
  },
  // ============================================
  // RATING CHANGE TRACKING IN BATTLE HISTORY
  // ============================================
  {
    id: 306,
    name: 'add_winner_rating_change_to_battles',
    sql: `ALTER TABLE battles_history ADD COLUMN winner_rating_change INTEGER DEFAULT NULL`
  },
  {
    id: 307,
    name: 'add_loser_rating_change_to_battles',
    sql: `ALTER TABLE battles_history ADD COLUMN loser_rating_change INTEGER DEFAULT NULL`
  },
  // ============================================
  // BACKWARDS COMPATIBILITY MIGRATION
  // ============================================
  // NOTE: This migration (#308) duplicates the table and index creation from migrations #298 and #299.
  // It is intentionally kept for backwards compatibility with databases that may have skipped those
  // earlier migrations due to deployment timing or migration tracking issues. The "IF NOT EXISTS"
  // clauses ensure this is a no-op for databases where the table already exists.
  {
    id: 308,
    name: 'ensure_student_verifications_table',
    sql: `CREATE TABLE IF NOT EXISTS student_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      edu_email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_student_verifications_token_hash ON student_verifications(token_hash);
    CREATE INDEX IF NOT EXISTS idx_student_verifications_user_id ON student_verifications(user_id)`
  },
  // Student expiration warning tracking
  {
    id: 309,
    name: 'add_student_expiration_warning_sent',
    sql: `ALTER TABLE users ADD COLUMN student_expiration_warning_sent TEXT`
  },
  // User sessions tracking for active sessions feature
  {
    id: 310,
    name: 'create_user_sessions_table',
    sql: `CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      device_type TEXT,
      browser TEXT,
      os TEXT,
      ip_address TEXT,
      location TEXT,
      last_active TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  },
  {
    id: 311,
    name: 'add_2fa_secret_to_users',
    sql: `ALTER TABLE users ADD COLUMN totp_secret TEXT`
  },
  {
    id: 312,
    name: 'add_2fa_enabled_to_users',
    sql: `ALTER TABLE users ADD COLUMN is_2fa_enabled INTEGER DEFAULT 0`
  },
  {
    id: 313,
    name: 'create_2fa_backup_codes_table',
    sql: `CREATE TABLE IF NOT EXISTS two_factor_backup_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      used_at TEXT,
      created_at TEXT NOT NULL
    )`
  },
  {
    id: 314,
    name: 'add_index_to_user_sessions_user_id',
    sql: `CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)`
  },
  {
    id: 315,
    name: 'add_index_to_user_sessions_token',
    sql: `CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash)`
  },
  // Two-Factor Authentication - Complete Setup
  {
    id: 426,
    name: 'add_2fa_totp_secret_to_users',
    sql: `ALTER TABLE users ADD COLUMN totp_secret TEXT`
  },
  {
    id: 427,
    name: 'add_2fa_enabled_flag_to_users',
    sql: `ALTER TABLE users ADD COLUMN is_2fa_enabled INTEGER DEFAULT 0`
  },
  {
    id: 428,
    name: 'create_two_factor_backup_codes_table',
    sql: `CREATE TABLE IF NOT EXISTS two_factor_backup_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      used_at TEXT,
      created_at TEXT NOT NULL
    )`
  },
  {
    id: 429,
    name: 'add_backup_codes_user_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON two_factor_backup_codes(user_id, used)`
  },
  {
    id: 430,
    name: 'create_2fa_audit_log_table',
    sql: `CREATE TABLE IF NOT EXISTS two_factor_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      success INTEGER NOT NULL DEFAULT 1,
      ip_address TEXT,
      user_agent TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  },
  {
    id: 431,
    name: 'add_2fa_audit_log_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_2fa_audit_user ON two_factor_audit_log(user_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_2fa_audit_action ON two_factor_audit_log(action, created_at DESC)`
  },
  {
    id: 432,
    name: 'add_2fa_pending_token_to_users',
    sql: `ALTER TABLE users ADD COLUMN two_factor_pending_token TEXT`
  },
  {
    id: 433,
    name: 'add_2fa_pending_token_expires_to_users',
    sql: `ALTER TABLE users ADD COLUMN two_factor_pending_expires INTEGER`
  },
  {
    id: 434,
    name: 'add_2fa_enabled_at_to_users',
    sql: `ALTER TABLE users ADD COLUMN two_fa_enabled_at TEXT`
  },
  // ============================================
  // TRUSTED DEVICES FOR 2FA
  // ============================================
  {
    id: 435,
    name: 'create_trusted_devices_table',
    sql: `CREATE TABLE IF NOT EXISTS trusted_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      device_token_hash TEXT NOT NULL,
      device_name TEXT,
      browser TEXT,
      os TEXT,
      ip_address TEXT,
      last_used TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`
  },
  {
    id: 436,
    name: 'create_trusted_devices_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
          CREATE INDEX IF NOT EXISTS idx_trusted_devices_token ON trusted_devices(device_token_hash);
          CREATE INDEX IF NOT EXISTS idx_trusted_devices_expires ON trusted_devices(expires_at)`
  },
  {
    id: 437,
    name: 'add_last_auth_at_to_users',
    sql: `ALTER TABLE users ADD COLUMN last_auth_at TEXT`
  },
  // Ensure user_sessions table exists on production (migration 310 may have been marked
  // as applied without the table being created due to deployment timing issues)
  {
    id: 438,
    name: 'ensure_user_sessions_table_exists',
    sql: `CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      device_type TEXT,
      browser TEXT,
      os TEXT,
      ip_address TEXT,
      location TEXT,
      last_active TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  },
  // Safety net: Ensure user_sessions indexes exist
  {
    id: 440,
    name: 'ensure_user_sessions_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
          CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash)`
  },
  // XP and Level system for gamification
  {
    id: 441,
    name: 'add_xp_and_level_to_user_stats',
    sql: `ALTER TABLE user_stats ADD COLUMN total_xp INTEGER DEFAULT 0`
  },
  {
    id: 442,
    name: 'add_level_to_user_stats',
    sql: `ALTER TABLE user_stats ADD COLUMN level INTEGER DEFAULT 1`
  },
  {
    id: 443,
    name: 'add_last_xp_earned_at',
    sql: `ALTER TABLE user_stats ADD COLUMN last_xp_earned_at TEXT`
  },
  {
    id: 444,
    name: 'add_github_url_to_users',
    sql: `ALTER TABLE users ADD COLUMN github_url TEXT`
  },
  {
    id: 445,
    name: 'add_linkedin_url_to_users',
    sql: `ALTER TABLE users ADD COLUMN linkedin_url TEXT`
  },
  {
    id: 446,
    name: 'add_twitter_url_to_users',
    sql: `ALTER TABLE users ADD COLUMN twitter_url TEXT`
  },
  {
    id: 447,
    name: 'add_performance_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_messages_receiver_read ON messages(receiver_id, read_at);
          CREATE INDEX IF NOT EXISTS idx_group_messages_group_created ON group_messages(group_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_tournament_participants_checked_in ON tournament_participants(tournament_id, checked_in);
          CREATE INDEX IF NOT EXISTS idx_battle_violations_created ON battle_violations(battle_uuid, created_at)`
  },
  {
    id: 448,
    name: 'drop_redundant_single_column_indexes',
    sql: `DROP INDEX IF EXISTS idx_messages_receiver;
          DROP INDEX IF EXISTS idx_group_messages_group;
          DROP INDEX IF EXISTS idx_tournament_participants_tournament;
          DROP INDEX IF EXISTS idx_violations_battle`
  },
  {
    id: 449,
    name: 'add_code_to_battles_history',
    sql: `ALTER TABLE battles_history ADD COLUMN winner_code TEXT;
          ALTER TABLE battles_history ADD COLUMN loser_code TEXT`
  },
  {
    id: 450,
    name: 'add_github_id_to_users',
    sql: `ALTER TABLE users ADD COLUMN github_id TEXT; CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id)`
  },
  {
    id: 451,
    name: 'create_agent_loadouts_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_loadouts (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      description TEXT,
      model TEXT NOT NULL,
      system_prompt TEXT,
      language TEXT NOT NULL,
      tools TEXT,
      elo INTEGER DEFAULT 1000,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 452,
    name: 'create_agent_loadouts_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_loadouts_user ON agent_loadouts(user_id)`
  },
  {
    id: 453,
    name: 'create_agent_battles_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_battles (
      id TEXT PRIMARY KEY,
      player1_id INTEGER NOT NULL REFERENCES users(id),
      player2_id INTEGER NOT NULL REFERENCES users(id),
      loadout1_id TEXT NOT NULL REFERENCES agent_loadouts(id),
      loadout2_id TEXT NOT NULL REFERENCES agent_loadouts(id),
      problem_id TEXT NOT NULL,
      winner_id INTEGER REFERENCES users(id),
      player1_code TEXT,
      player2_code TEXT,
      player1_results TEXT,
      player2_results TEXT,
      player1_time_ms INTEGER,
      player2_time_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 454,
    name: 'create_agent_battles_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_battles_player1 ON agent_battles(player1_id)`
  },
  {
    id: 455,
    name: 'add_agent_battles_elo_columns',
    sql: `ALTER TABLE agent_battles ADD COLUMN player1_elo_change INTEGER DEFAULT 0`
  },
  {
    id: 456,
    name: 'add_agent_battles_elo_columns_2',
    sql: `ALTER TABLE agent_battles ADD COLUMN player2_elo_change INTEGER DEFAULT 0`
  },
  {
    id: 457,
    name: 'add_agent_loadouts_is_public',
    sql: `ALTER TABLE agent_loadouts ADD COLUMN is_public INTEGER DEFAULT 0`
  },
  {
    id: 458,
    name: 'add_agent_loadouts_times_cloned',
    sql: `ALTER TABLE agent_loadouts ADD COLUMN times_cloned INTEGER DEFAULT 0`
  },
  {
    id: 459,
    name: 'add_agent_loadouts_original_id',
    sql: `ALTER TABLE agent_loadouts ADD COLUMN original_loadout_id TEXT REFERENCES agent_loadouts(id)`
  },
  {
    id: 460,
    name: 'add_agent_battles_player1_tokens_used',
    sql: `ALTER TABLE agent_battles ADD COLUMN player1_tokens_used INTEGER`
  },
  {
    id: 461,
    name: 'add_agent_battles_player2_tokens_used',
    sql: `ALTER TABLE agent_battles ADD COLUMN player2_tokens_used INTEGER`
  },
  {
    id: 462,
    name: 'add_agent_battles_player1_generation_time_ms',
    sql: `ALTER TABLE agent_battles ADD COLUMN player1_generation_time_ms INTEGER`
  },
  {
    id: 463,
    name: 'add_agent_battles_player2_generation_time_ms',
    sql: `ALTER TABLE agent_battles ADD COLUMN player2_generation_time_ms INTEGER`
  },
  {
    id: 464,
    name: 'add_agent_battles_player1_tool_calls',
    sql: `ALTER TABLE agent_battles ADD COLUMN player1_tool_calls INTEGER DEFAULT 0`
  },
  {
    id: 465,
    name: 'add_agent_battles_player2_tool_calls',
    sql: `ALTER TABLE agent_battles ADD COLUMN player2_tool_calls INTEGER DEFAULT 0`
  },
  {
    id: 466,
    name: 'add_agent_loadouts_current_streak',
    sql: `ALTER TABLE agent_loadouts ADD COLUMN current_streak INTEGER DEFAULT 0`
  },
  {
    id: 467,
    name: 'add_agent_loadouts_best_streak',
    sql: `ALTER TABLE agent_loadouts ADD COLUMN best_streak INTEGER DEFAULT 0`
  },
  {
    id: 468,
    name: 'add_agent_loadouts_last_battle_result',
    sql: `ALTER TABLE agent_loadouts ADD COLUMN last_battle_result TEXT`
  },
  {
    id: 469,
    name: 'create_agent_challenges_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_challenges (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      requirement_type TEXT NOT NULL,
      requirement_value TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      reward_value TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 470,
    name: 'create_agent_challenge_progress_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_challenge_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      challenge_id TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      completed_at TEXT,
      UNIQUE(user_id, challenge_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  },
  {
    id: 471,
    name: 'add_agent_challenges_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_challenges_type ON agent_challenges(type);
          CREATE INDEX IF NOT EXISTS idx_agent_challenges_dates ON agent_challenges(starts_at, ends_at)`
  },
  {
    id: 472,
    name: 'add_agent_challenge_progress_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_progress_user ON agent_challenge_progress(user_id);
          CREATE INDEX IF NOT EXISTS idx_agent_progress_challenge ON agent_challenge_progress(challenge_id);
          CREATE INDEX IF NOT EXISTS idx_agent_progress_completed ON agent_challenge_progress(completed)`
  },
  {
    id: 473,
    name: 'create_agent_battle_events_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_battle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      player_id INTEGER NOT NULL,
      event_data TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      FOREIGN KEY (battle_id) REFERENCES agent_battles(id)
    )`
  },
  {
    id: 474,
    name: 'create_agent_battle_events_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_battle_events_battle ON agent_battle_events(battle_id);
          CREATE INDEX IF NOT EXISTS idx_agent_battle_events_timestamp ON agent_battle_events(battle_id, timestamp_ms)`
  },
  {
    id: 475,
    name: 'create_agent_rivalries_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_rivalries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1_id INTEGER NOT NULL REFERENCES users(id),
      user2_id INTEGER NOT NULL REFERENCES users(id),
      user1_wins INTEGER DEFAULT 0,
      user2_wins INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      last_battle_at TEXT,
      last_winner_id INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user1_id, user2_id),
      CHECK(user1_id < user2_id)
    )`
  },
  {
    id: 476,
    name: 'create_agent_rivalries_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_rivalries_user1 ON agent_rivalries(user1_id);
          CREATE INDEX IF NOT EXISTS idx_agent_rivalries_user2 ON agent_rivalries(user2_id);
          CREATE INDEX IF NOT EXISTS idx_agent_rivalries_battles ON agent_rivalries(user1_wins + user2_wins + draws DESC)`
  },
  {
    id: 477,
    name: 'seed_agent_rivalry_badges',
    sql: `INSERT OR IGNORE INTO badges (slug, name, description, icon, rarity, category, criteria_type, criteria_value, sort_order) VALUES
      ('agent-rival', 'Rival', 'Battle the same opponent 5 times in agent battles', '🤝', 'common', 'battle', 'agent_rivalry_battles', 5, 60),
      ('agent-nemesis', 'Nemesis', 'Battle the same opponent 10 times in agent battles', '⚔️', 'rare', 'battle', 'agent_rivalry_battles', 10, 61),
      ('agent-redemption', 'Redemption', 'Win against someone who beat you 3+ times in a row', '🔄', 'epic', 'battle', 'agent_redemption', 3, 62)`
  },
  {
    id: 478,
    name: 'create_agent_seasons_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 479,
    name: 'create_agent_season_rankings_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_season_rankings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id INTEGER NOT NULL REFERENCES agent_seasons(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      loadout_id TEXT NOT NULL REFERENCES agent_loadouts(id),
      final_elo INTEGER NOT NULL,
      final_rank INTEGER,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      best_streak INTEGER DEFAULT 0,
      reward_claimed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(season_id, loadout_id)
    )`
  },
  {
    id: 480,
    name: 'create_agent_season_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_seasons_active ON agent_seasons(is_active);
          CREATE INDEX IF NOT EXISTS idx_agent_season_rankings_season ON agent_season_rankings(season_id);
          CREATE INDEX IF NOT EXISTS idx_agent_season_rankings_user ON agent_season_rankings(user_id);
          CREATE INDEX IF NOT EXISTS idx_agent_season_rankings_loadout ON agent_season_rankings(loadout_id);
          CREATE INDEX IF NOT EXISTS idx_agent_season_rankings_rank ON agent_season_rankings(season_id, final_rank)`
  },
  {
    id: 481,
    name: 'seed_agent_season_badges',
    sql: `INSERT OR IGNORE INTO badges (slug, name, description, icon, rarity, category, criteria_type, criteria_value, sort_order) VALUES
      ('season-champion', 'Champion', 'Finish #1 in an agent battle season', '🏆', 'legendary', 'special', 'season_rank', 1, 70),
      ('season-podium', 'Podium', 'Finish top 3 in an agent battle season', '🥇', 'epic', 'special', 'season_rank', 3, 71),
      ('season-elite', 'Elite', 'Finish top 10 in an agent battle season', '💎', 'rare', 'special', 'season_rank', 10, 72),
      ('season-competitor', 'Competitor', 'Finish in top 25% of an agent battle season', '⭐', 'common', 'special', 'season_percentile', 25, 73)`
  },
  {
    id: 482,
    name: 'seed_first_agent_season',
    sql: `INSERT OR IGNORE INTO agent_seasons (season_number, name, starts_at, ends_at, is_active) VALUES
      (1, 'Season 1: Genesis', datetime('now'), datetime('now', '+30 days'), 1)`
  },
  {
    id: 633,
    name: 'create_agent_spending_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_spending (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      daily_spend REAL DEFAULT 0,
      monthly_spend REAL DEFAULT 0,
      daily_reset_date TEXT NOT NULL,
      monthly_reset_date TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  },
  {
    id: 634,
    name: 'create_agent_spending_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_spending_user ON agent_spending(user_id)`
  },
  {
    id: 635,
    name: 'create_agent_rate_limits_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      request_count INTEGER DEFAULT 0,
      reset_time INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  },
  {
    id: 609,
    name: 'add_agent_loadouts_total_tokens',
    sql: `ALTER TABLE agent_loadouts ADD COLUMN total_tokens_used INTEGER DEFAULT 0`
  },
  {
    id: 610,
    name: 'add_agent_loadouts_total_tests',
    sql: `ALTER TABLE agent_loadouts ADD COLUMN total_tests_passed INTEGER DEFAULT 0`
  },
  {
    id: 611,
    name: 'add_agent_loadouts_total_battles',
    sql: `ALTER TABLE agent_loadouts ADD COLUMN total_battles INTEGER DEFAULT 0`
  },
  {
    id: 612,
    name: 'add_agent_loadouts_recent_results',
    sql: `ALTER TABLE agent_loadouts ADD COLUMN recent_results TEXT DEFAULT "[]"`
  },
  {
    id: 613,
    name: 'add_agent_loadouts_language_usage',
    sql: `ALTER TABLE agent_loadouts ADD COLUMN language_usage TEXT DEFAULT "{}"`
  },
  {
    id: 614,
    name: 'create_agent_loadout_versions_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_loadout_versions (
      id TEXT PRIMARY KEY,
      loadout_id TEXT NOT NULL REFERENCES agent_loadouts(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      system_prompt TEXT,
      model TEXT NOT NULL,
      language TEXT NOT NULL,
      tools TEXT,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(loadout_id, version_number)
    )`
  },
  {
    id: 615,
    name: 'create_agent_loadout_versions_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_loadout_versions_loadout ON agent_loadout_versions(loadout_id)`
  },
  {
    id: 616,
    name: 'add_agent_battles_loadout_version_ids',
    sql: `ALTER TABLE agent_battles ADD COLUMN loadout1_version_id TEXT REFERENCES agent_loadout_versions(id)`
  },
  {
    id: 617,
    name: 'add_agent_battles_loadout2_version_id',
    sql: `ALTER TABLE agent_battles ADD COLUMN loadout2_version_id TEXT REFERENCES agent_loadout_versions(id)`
  },
  {
    id: 618,
    name: 'create_agent_battle_bans_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_battle_bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      banned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      banned_until DATETIME NOT NULL,
      reason TEXT,
      banned_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (banned_by) REFERENCES users(id)
    )`
  },
  {
    id: 619,
    name: 'create_agent_battle_bans_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_battle_bans_user ON agent_battle_bans(user_id)`
  },
  // ============================================
  // AGENT TOURNAMENTS
  // ============================================
  {
    id: 620,
    name: 'create_agent_tournaments_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      format TEXT NOT NULL DEFAULT 'single_elimination',
      status TEXT NOT NULL DEFAULT 'upcoming',
      max_participants INTEGER NOT NULL DEFAULT 32,
      entry_fee INTEGER DEFAULT 0,
      prize_pool INTEGER DEFAULT 0,
      start_time TEXT NOT NULL,
      registration_deadline TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      winner_id INTEGER REFERENCES users(id),
      current_round INTEGER DEFAULT 0,
      total_rounds INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    )`
  },
  {
    id: 621,
    name: 'create_agent_tournaments_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_tournaments_status ON agent_tournaments(status);
          CREATE INDEX IF NOT EXISTS idx_agent_tournaments_created_by ON agent_tournaments(created_by);
          CREATE INDEX IF NOT EXISTS idx_agent_tournaments_start_time ON agent_tournaments(start_time)`
  },
  {
    id: 622,
    name: 'create_agent_tournament_participants_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_tournament_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES agent_tournaments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      loadout_id TEXT NOT NULL REFERENCES agent_loadouts(id),
      seed INTEGER,
      status TEXT NOT NULL DEFAULT 'registered',
      checked_in_at TEXT,
      eliminated_at TEXT,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tournament_id, user_id)
    )`
  },
  {
    id: 623,
    name: 'create_agent_tournament_participants_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_tournament_participants_tournament ON agent_tournament_participants(tournament_id);
          CREATE INDEX IF NOT EXISTS idx_agent_tournament_participants_user ON agent_tournament_participants(user_id);
          CREATE INDEX IF NOT EXISTS idx_agent_tournament_participants_status ON agent_tournament_participants(tournament_id, status)`
  },
  {
    id: 624,
    name: 'create_agent_tournament_matches_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_tournament_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES agent_tournaments(id) ON DELETE CASCADE,
      round INTEGER NOT NULL,
      match_number INTEGER NOT NULL,
      player1_id INTEGER REFERENCES users(id),
      player2_id INTEGER REFERENCES users(id),
      winner_id INTEGER REFERENCES users(id),
      battle_id TEXT REFERENCES agent_battles(id),
      scheduled_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tournament_id, round, match_number)
    )`
  },
  {
    id: 625,
    name: 'create_agent_tournament_matches_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_tournament_matches_tournament ON agent_tournament_matches(tournament_id);
          CREATE INDEX IF NOT EXISTS idx_agent_tournament_matches_round ON agent_tournament_matches(tournament_id, round);
          CREATE INDEX IF NOT EXISTS idx_agent_tournament_matches_battle ON agent_tournament_matches(battle_id)`
  },
  {
    id: 917,
    name: 'create_agent_training_runs_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_training_runs (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      loadout_id TEXT NOT NULL REFERENCES agent_loadouts(id),
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      total_problems INTEGER DEFAULT 0,
      problems_solved INTEGER DEFAULT 0,
      total_tests_passed INTEGER DEFAULT 0,
      total_tests_failed INTEGER DEFAULT 0,
      total_tokens_used INTEGER DEFAULT 0,
      total_execution_time_ms INTEGER DEFAULT 0,
      difficulty_filter TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 627,
    name: 'create_agent_training_results_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_training_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      training_run_id TEXT NOT NULL REFERENCES agent_training_runs(id) ON DELETE CASCADE,
      problem_id TEXT NOT NULL,
      problem_title TEXT,
      problem_difficulty TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      code_generated TEXT,
      tests_passed INTEGER DEFAULT 0,
      total_tests INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      execution_time_ms INTEGER DEFAULT 0,
      error_message TEXT,
      test_results TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 628,
    name: 'create_agent_training_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_training_runs_user ON agent_training_runs(user_id);
          CREATE INDEX IF NOT EXISTS idx_agent_training_runs_loadout ON agent_training_runs(loadout_id);
          CREATE INDEX IF NOT EXISTS idx_agent_training_runs_status ON agent_training_runs(status);
          CREATE INDEX IF NOT EXISTS idx_agent_training_results_run ON agent_training_results(training_run_id);
          CREATE INDEX IF NOT EXISTS idx_agent_training_results_problem ON agent_training_results(problem_id)`
  },
  {
    id: 629,
    name: 'create_user_webhooks_table',
    sql: `CREATE TABLE IF NOT EXISTS user_webhooks (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      events TEXT NOT NULL DEFAULT '["battle.completed"]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_triggered_at TEXT,
      total_deliveries INTEGER DEFAULT 0,
      failed_deliveries INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  },
  {
    id: 630,
    name: 'create_user_webhooks_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_user_webhooks_user_id ON user_webhooks(user_id);
          CREATE INDEX IF NOT EXISTS idx_user_webhooks_active ON user_webhooks(is_active)`
  },
  {
    id: 631,
    name: 'create_webhook_deliveries_table',
    sql: `CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      response_code INTEGER,
      response_body TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_attempt_at TEXT,
      next_retry_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (webhook_id) REFERENCES user_webhooks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  },
  {
    id: 632,
    name: 'create_webhook_deliveries_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
          CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_user_id ON webhook_deliveries(user_id);
          CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
          CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_retry ON webhook_deliveries(next_retry_at) WHERE status = 'pending'`
  },
  {
    id: 918,
    name: 'add_agent_loadouts_elo_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_loadouts_elo ON agent_loadouts(elo DESC)`
  },
  {
    id: 919,
    name: 'add_agent_battles_status_created_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_battles_status_created ON agent_battles(status, created_at)`
  },
  {
    id: 700,
    name: 'opt_all_existing_users_into_marketing_emails',
    sql: `INSERT INTO user_email_preferences (user_id, weekly_challenge, marketing, progress_digest, tournament_notifications, created_at, updated_at)
          SELECT id, 1, 1, 1, 0, datetime('now'), datetime('now') FROM users WHERE email IS NOT NULL AND email != ''
          ON CONFLICT(user_id) DO UPDATE SET marketing = 1, updated_at = datetime('now')`
  },
  {
    id: 701,
    name: 'make_codergirl123_admin',
    sql: `UPDATE users SET is_admin = 1 WHERE username = 'codergirl123'`
  },
  {
    id: 702,
    name: 'make_player_1grvvt_admin',
    sql: `UPDATE users SET is_admin = 1 WHERE username = 'player_1grvvt'`
  },
  {
    id: 703,
    name: 'create_prompt_attempts_table',
    sql: `CREATE TABLE IF NOT EXISTS prompt_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      challenge_id TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      score INTEGER DEFAULT 0,
      tests_passed INTEGER DEFAULT 0,
      tests_total INTEGER DEFAULT 0,
      solved INTEGER DEFAULT 0,
      time_spent INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 704,
    name: 'create_prompt_practice_stats_table',
    sql: `CREATE TABLE IF NOT EXISTS prompt_practice_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      challenges_solved INTEGER DEFAULT 0,
      challenges_attempted INTEGER DEFAULT 0,
      total_attempts INTEGER DEFAULT 0,
      avg_score INTEGER,
      best_score INTEGER,
      last_practice TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id)
    )`
  },
  {
    id: 705,
    name: 'create_prompt_attempts_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_prompt_attempts_user_date ON prompt_attempts(user_id, created_at)`
  },
  {
    id: 706,
    name: 'seed_prompt_practice_badges',
    sql: `INSERT OR IGNORE INTO badges (slug, name, description, icon, rarity, category, criteria_type, criteria_value, sort_order) VALUES
      ('prompt-novice', 'Prompt Novice', 'Solve your first prompt challenge', '💬', 'common', 'prompt', 'prompt_solved', 1, 50),
      ('prompt-crafter', 'Prompt Crafter', 'Solve 5 prompt challenges', '✍️', 'rare', 'prompt', 'prompt_solved', 5, 51),
      ('prompt-engineer', 'Prompt Engineer', 'Solve 10 prompt challenges', '🧠', 'epic', 'prompt', 'prompt_solved', 10, 52),
      ('prompt-master', 'Prompt Master', 'Solve all prompt challenges', '🏆', 'legendary', 'prompt', 'prompt_solved', 14, 53)`
  },
  {
    // Re-issued from id 707, which prod already applied as `add_avatar_url_to_users`.
    // The recycled id meant this table migration was shadowed (skipped) in prod.
    // Idempotent (CREATE TABLE IF NOT EXISTS), so running it now is safe.
    id: 925,
    name: 'create_newsletter_subscriptions_table',
    sql: `CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      subscribed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      unsubscribed_at TEXT,
      source TEXT DEFAULT 'website'
    )`
  },
  {
    id: 708,
    name: 'create_newsletter_email_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter_subscriptions(email)`
  },
  {
    id: 709,
    name: 'add_avatar_url_to_users',
    sql: `ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT NULL`
  },
  {
    id: 710,
    name: 'add_error_message_to_webhook_events',
    sql: `ALTER TABLE webhook_events ADD COLUMN error_message TEXT`
  },
  {
    id: 718,
    name: 'add_github_access_token_to_users',
    sql: `ALTER TABLE users ADD COLUMN github_access_token TEXT`
  },
  {
    id: 719,
    name: 'create_games_table',
    sql: `CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      description TEXT,
      game_type TEXT NOT NULL DEFAULT 'browser',
      html_content TEXT NOT NULL,
      thumbnail_url TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      github_repo TEXT,
      github_path TEXT,
      play_count INTEGER DEFAULT 0,
      vote_score INTEGER DEFAULT 0,
      tags TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 720,
    name: 'create_game_versions_table',
    sql: `CREATE TABLE IF NOT EXISTS game_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL DEFAULT 1,
      html_content TEXT NOT NULL,
      prompt_used TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 721,
    name: 'create_game_votes_table',
    sql: `CREATE TABLE IF NOT EXISTS game_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      vote INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(game_id, user_id)
    )`
  },
  {
    id: 722,
    name: 'create_game_comments_table',
    sql: `CREATE TABLE IF NOT EXISTS game_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      parent_id INTEGER REFERENCES game_comments(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 723,
    name: 'create_game_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_games_creator ON games(creator_id);
      CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
      CREATE INDEX IF NOT EXISTS idx_games_vote_score ON games(vote_score DESC);
      CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_game_versions_game ON game_versions(game_id);
      CREATE INDEX IF NOT EXISTS idx_game_votes_game ON game_votes(game_id);
      CREATE INDEX IF NOT EXISTS idx_game_votes_user ON game_votes(user_id);
      CREATE INDEX IF NOT EXISTS idx_game_comments_game ON game_comments(game_id);
      CREATE INDEX IF NOT EXISTS idx_game_comments_parent ON game_comments(parent_id)`
  },
  {
    id: 724,
    name: 'create_in_app_notifications_table',
    sql: `CREATE TABLE IF NOT EXISTS in_app_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      link TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_in_app_notif_user ON in_app_notifications(user_id, read);
    CREATE INDEX IF NOT EXISTS idx_in_app_notif_created ON in_app_notifications(created_at DESC)`
  },
  {
    id: 725,
    name: 'create_guest_practice_attempts_table',
    sql: `CREATE TABLE IF NOT EXISTS guest_practice_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_session_id TEXT NOT NULL,
      problem_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(guest_session_id, problem_id)
    );
    CREATE INDEX IF NOT EXISTS idx_guest_practice_guest ON guest_practice_attempts(guest_session_id);
    CREATE INDEX IF NOT EXISTS idx_guest_practice_day ON guest_practice_attempts(guest_session_id, created_at)`
  },
  // ============================================
  // CREDITS SYSTEM FOR GAME CREATION
  // ============================================
  {
    id: 737,
    name: 'create_user_credits_table',
    sql: `CREATE TABLE IF NOT EXISTS user_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      balance INTEGER DEFAULT 0,
      lifetime_earned INTEGER DEFAULT 0,
      lifetime_spent INTEGER DEFAULT 0,
      last_monthly_grant TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id)
    )`
  },
  {
    id: 738,
    name: 'create_credit_transactions_table',
    sql: `CREATE TABLE IF NOT EXISTS credit_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      game_id INTEGER REFERENCES games(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 739,
    name: 'create_credit_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_user_credits_user ON user_credits(user_id);
          CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id);
          CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(type)`
  },
  {
    id: 740,
    name: 'add_visibility_to_games',
    sql: `ALTER TABLE games ADD COLUMN visibility TEXT DEFAULT 'public'`
  },
  {
    id: 741,
    name: 'add_forked_from_to_games',
    sql: `ALTER TABLE games ADD COLUMN forked_from INTEGER REFERENCES games(id)`
  },
  // ============================================
  // PRACTICE MODE & RECORDING MANAGEMENT
  // ============================================
  // REFERRAL SYSTEM
  // ============================================
  {
    id: 745,
    name: 'create_referrals_table',
    sql: `CREATE TABLE IF NOT EXISTS referrals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            referrer_id INTEGER NOT NULL REFERENCES users(id),
            referee_id INTEGER NOT NULL REFERENCES users(id),
            referral_code TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            referrer_credited INTEGER DEFAULT 0,
            referee_credited INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT,
            UNIQUE(referee_id)
          );
          CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
          CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code)`
  },
  {
    id: 746,
    name: 'add_referral_code_to_users',
    sql: `ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE`
  },
  // ============================================
  {
    id: 765,
    name: 'add_guest_session_to_battles_history',
    sql: `ALTER TABLE battles_history ADD COLUMN winner_guest_session_id TEXT`
  },
  {
    id: 766,
    name: 'add_loser_guest_session_to_battles_history',
    sql: `ALTER TABLE battles_history ADD COLUMN loser_guest_session_id TEXT`
  },
  // ============================================
  // FEATURE 1: AGENT LOADOUT TEMPLATES
  // ============================================
  {
    id: 914,
    name: 'create_agent_loadout_templates_table',
    sql: `CREATE TABLE IF NOT EXISTS agent_loadout_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      strategy TEXT,
      model TEXT NOT NULL,
      system_prompt TEXT,
      language TEXT NOT NULL DEFAULT 'python',
      tools TEXT,
      is_official INTEGER DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      win_rate REAL,
      times_used INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 799,
    name: 'create_agent_templates_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_templates_official ON agent_loadout_templates(is_official, is_active);
          CREATE INDEX IF NOT EXISTS idx_agent_templates_sort ON agent_loadout_templates(sort_order)`
  },
  {
    id: 800,
    name: 'seed_official_agent_templates',
    sql: `INSERT OR IGNORE INTO agent_loadout_templates (id, name, description, strategy, model, system_prompt, language, tools, is_official, sort_order, win_rate) VALUES
      ('template-speed-demon', 'Speed Demon', 'Fast and efficient - optimizes for quick solutions', 'aggressive', 'haiku', 'You are a competitive programmer focused on speed. Write clean, efficient code quickly. Prioritize working solutions over perfect code. Test edge cases mentally before submitting.', 'python', '["test-runner"]', 1, 1, 52.3),
      ('template-careful-coder', 'Careful Coder', 'Methodical approach - double-checks everything', 'defensive', 'sonnet', 'You are a careful programmer. Before writing code, analyze the problem thoroughly. Consider edge cases: empty inputs, single elements, large values, negative numbers. Write clean, readable code with proper variable names. Test your solution mentally before submitting.', 'python', '["test-runner", "auto-retry"]', 1, 2, 58.7),
      ('template-polyglot', 'The Polyglot', 'Multi-language expert - adapts to any challenge', 'balanced', 'sonnet', 'You are an expert programmer fluent in multiple languages. Choose the most appropriate approach for each problem. Write idiomatic code that leverages language-specific features. Focus on correctness first, then optimization.', 'javascript', '["test-runner", "docs-lookup"]', 1, 3, 55.1),
      ('template-optimizer', 'The Optimizer', 'Performance focused - finds the best algorithm', 'analytical', 'sonnet', 'You are an algorithm specialist. Analyze time and space complexity before coding. Choose optimal data structures. Identify patterns: sliding window, two pointers, dynamic programming, etc. Implement the most efficient solution.', 'python', '["test-runner", "auto-retry"]', 1, 4, 61.2),
      ('template-grandmaster', 'Grandmaster', 'Top-tier AI for serious competitors', 'elite', 'opus', 'You are a grandmaster-level competitive programmer. Approach each problem systematically: understand constraints, identify the algorithm class, consider edge cases, implement cleanly, and verify correctness. Your solutions should be optimal in both time and space complexity.', 'python', '["test-runner", "auto-retry"]', 1, 5, 67.8)`
  },
  // ============================================
  // FEATURE 2: PROMPT BATTLE HISTORY
  // ============================================
  {
    id: 801,
    name: 'create_prompt_battle_history_table',
    sql: `CREATE TABLE IF NOT EXISTS prompt_battle_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT NOT NULL,
      player1_id TEXT NOT NULL,
      player1_username TEXT,
      player1_is_guest INTEGER DEFAULT 0,
      player2_id TEXT NOT NULL,
      player2_username TEXT,
      player2_is_guest INTEGER DEFAULT 0,
      problem_id TEXT,
      problem_title TEXT,
      difficulty TEXT,
      duration_sec INTEGER,
      player1_prompt TEXT,
      player2_prompt TEXT,
      player1_score REAL,
      player2_score REAL,
      player1_adjusted_score REAL,
      player2_adjusted_score REAL,
      player1_submit_count INTEGER DEFAULT 0,
      player2_submit_count INTEGER DEFAULT 0,
      winner_id TEXT,
      is_tie INTEGER DEFAULT 0,
      player1_model_output TEXT,
      player2_model_output TEXT,
      player1_token_usage TEXT,
      player2_token_usage TEXT,
      started_at TEXT,
      finished_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    id: 802,
    name: 'create_prompt_battle_history_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_prompt_battle_history_player1 ON prompt_battle_history(player1_id);
          CREATE INDEX IF NOT EXISTS idx_prompt_battle_history_player2 ON prompt_battle_history(player2_id);
          CREATE INDEX IF NOT EXISTS idx_prompt_battle_history_finished ON prompt_battle_history(finished_at DESC)`
  },
  {
    id: 803,
    name: 'create_feature_requests_table',
    sql: `
      CREATE TABLE IF NOT EXISTS feature_requests (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        username TEXT,
        email TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT DEFAULT 'other',
        priority TEXT DEFAULT 'medium',
        votes INTEGER DEFAULT 0,
        status TEXT DEFAULT 'new',
        admin_notes TEXT,
        submitter_ip TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_feature_requests_status ON feature_requests(status);
      CREATE INDEX IF NOT EXISTS idx_feature_requests_category ON feature_requests(category);
      CREATE INDEX IF NOT EXISTS idx_feature_requests_created ON feature_requests(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_feature_requests_user ON feature_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_feature_requests_votes ON feature_requests(votes DESC);
      CREATE INDEX IF NOT EXISTS idx_feature_requests_submitter_ip ON feature_requests(submitter_ip);
    `
  },
  {
    id: 808,
    name: 'create_game_comment_votes_table',
    sql: `CREATE TABLE IF NOT EXISTS game_comment_votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            comment_id INTEGER NOT NULL REFERENCES game_comments(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            vote INTEGER NOT NULL CHECK(vote IN (-1, 1)),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(comment_id, user_id)
          );
          CREATE INDEX IF NOT EXISTS idx_game_comment_votes_comment ON game_comment_votes(comment_id);
          CREATE INDEX IF NOT EXISTS idx_game_comment_votes_user ON game_comment_votes(user_id)`
  },
  {
    // NOTE: this migration originally shipped as id 809, but id 809 had already
    // been applied in prod as `add_creator_arena_emails_preference` (since
    // renumbered to 813). A recycled id is treated as already-applied, so this
    // migration was silently skipped everywhere, leaving daily_challenges /
    // daily_challenge_attempts without challenge_type, prompt_submit_count and
    // prompt_score, which then made migration 810's index on prompt_score abort
    // init(). Re-issued under a fresh id so it actually runs. Stays positioned
    // before migration 810 so the columns exist before that index is built.
    id: 923,
    name: 'add_challenge_type_and_prompt_fields',
    sql: `ALTER TABLE daily_challenges ADD COLUMN challenge_type TEXT NOT NULL DEFAULT 'prompt';
          ALTER TABLE daily_challenge_attempts ADD COLUMN prompt_submit_count INTEGER DEFAULT 0;
          ALTER TABLE daily_challenge_attempts ADD COLUMN prompt_score REAL`
  },
  {
    id: 810,
    name: 'add_prompt_telemetry_columns',
    sql: `ALTER TABLE daily_challenge_attempts ADD COLUMN model_output TEXT;
          ALTER TABLE daily_challenge_attempts ADD COLUMN passed_tier_id TEXT;
          ALTER TABLE daily_challenge_attempts ADD COLUMN model_used TEXT;
          CREATE INDEX IF NOT EXISTS idx_daily_attempts_score_rank ON daily_challenge_attempts(challenge_date, prompt_score DESC, prompt_submit_count ASC, solve_time ASC)`
  },
  {
    id: 811,
    name: 'rename_code_to_prompt_text_on_daily_challenge_attempts',
    sql: `ALTER TABLE daily_challenge_attempts RENAME COLUMN code TO prompt_text`
  },
  {
    id: 812,
    name: 'create_judge_score_log',
    sql: `CREATE TABLE IF NOT EXISTS judge_score_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id),
            challenge_date TEXT NOT NULL,
            problem_id TEXT NOT NULL,
            judge_score INTEGER,
            rubric_score INTEGER,
            divergence INTEGER,
            judge_source TEXT NOT NULL,
            model_used TEXT,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_judge_log_problem ON judge_score_log(problem_id);
          CREATE INDEX IF NOT EXISTS idx_judge_log_date ON judge_score_log(challenge_date);
          CREATE INDEX IF NOT EXISTS idx_judge_log_divergence ON judge_score_log(problem_id, divergence DESC)`
  },
  {
    id: 813,
    name: 'add_creator_arena_emails_preference',
    sql: `ALTER TABLE user_email_preferences ADD COLUMN creator_arena_emails INTEGER DEFAULT 1`
  },
  {
    id: 816,
    name: 'add_revision_count_to_games',
    sql: `ALTER TABLE games ADD COLUMN revision_count INTEGER NOT NULL DEFAULT 0`
  },
  {
    id: 818,
    name: 'add_student_trial_claimed_at',
    sql: `ALTER TABLE users ADD COLUMN student_trial_claimed_at TEXT DEFAULT NULL`
  },
  {
    id: 823,
    name: 'add_is_third_place_match_column',
    sql: `ALTER TABLE tournament_matches ADD COLUMN is_third_place_match INTEGER DEFAULT 0`
  },
  {
    id: 824,
    name: 'add_solution_code_to_practice_attempts',
    sql: `ALTER TABLE practice_attempts ADD COLUMN solution_code TEXT;
          ALTER TABLE practice_attempts ADD COLUMN solution_submitted_at TEXT`
  },
  {
    id: 822,
    name: 'add_message_digest_preference',
    sql: `ALTER TABLE user_email_preferences ADD COLUMN message_digest INTEGER DEFAULT 1`
  },
  {
    id: 821,
    name: 'create_game_ratings_table',
    sql: `CREATE TABLE IF NOT EXISTS game_ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(game_id, user_id)
          );
          CREATE INDEX IF NOT EXISTS idx_game_ratings_game ON game_ratings(game_id);
          CREATE INDEX IF NOT EXISTS idx_game_ratings_user ON game_ratings(user_id)`
  },
  {
    id: 915,
    name: 'add_practice_demo_shown_at_to_users',
    sql: `ALTER TABLE users ADD COLUMN practice_demo_shown_at TEXT`
  },
  {
    id: 840,
    name: 'add_anticheat_columns_to_prompt_attempts',
    sql: `ALTER TABLE prompt_attempts ADD COLUMN paste_detected INTEGER DEFAULT 0;
          ALTER TABLE prompt_attempts ADD COLUMN tab_switch_count INTEGER DEFAULT 0`
  },
  {
    id: 841,
    name: 'honor_legacy_changelog_unsubscribes_as_marketing_optout',
    // The changelog/product-update email's unsubscribe link historically wrote to
    // the weekly_challenge flag (type=weekly-challenge), never marketing. Now that
    // changelog sends are gated on `marketing`, back-fill marketing=0 for everyone
    // who had previously unsubscribed (weekly_challenge=0) so their prior opt-out is
    // honored and they stop receiving product-update emails.
    sql: `UPDATE user_email_preferences
          SET marketing = 0, updated_at = datetime('now')
          WHERE weekly_challenge = 0`
  },
  {
    id: 900,
    name: 'create_campaign_claims_table',
    sql: `CREATE TABLE IF NOT EXISTS campaign_claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            post_tag TEXT NOT NULL,
            claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
            pro_granted_until TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_campaign_claims_post_tag ON campaign_claims(post_tag);
          CREATE INDEX IF NOT EXISTS idx_campaign_claims_claimed_at ON campaign_claims(claimed_at)`
  },
  {
    id: 901,
    name: 'create_campaign_post_caps_table',
    sql: `CREATE TABLE IF NOT EXISTS campaign_post_caps (
            post_tag TEXT PRIMARY KEY,
            cap INTEGER NOT NULL,
            claimed_count INTEGER NOT NULL DEFAULT 0
          )`
  },
  {
    id: 902,
    name: 'create_campaign_config_table',
    sql: `CREATE TABLE IF NOT EXISTS campaign_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            kill_switch INTEGER NOT NULL DEFAULT 0,
            ai_minutes_cap INTEGER NOT NULL DEFAULT 60,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT OR IGNORE INTO campaign_config (id, kill_switch, ai_minutes_cap) VALUES (1, 0, 60)`
  },
  {
    id: 910,
    name: 'create_build_challenges_table',
    sql: `CREATE TABLE IF NOT EXISTS build_challenges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            period_key TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            brief TEXT NOT NULL,
            target_output TEXT,
            evaluation_criteria TEXT,
            track TEXT NOT NULL DEFAULT 'applied',
            judging_mode TEXT NOT NULL DEFAULT 'auto_gate_vote',
            source_name TEXT,
            source_url TEXT,
            model_id TEXT,
            shortlist_size INTEGER NOT NULL DEFAULT 5,
            submit_open_at TEXT NOT NULL,
            submit_close_at TEXT NOT NULL,
            vote_close_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'scheduled',
            shortlisted_at TEXT,
            winner_submission_id INTEGER,
            closed_at TEXT,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_build_challenges_window ON build_challenges(submit_open_at, submit_close_at, vote_close_at)`
  },
  {
    id: 911,
    name: 'create_build_submissions_table',
    sql: `CREATE TABLE IF NOT EXISTS build_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            challenge_id INTEGER NOT NULL REFERENCES build_challenges(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            prompt_text TEXT NOT NULL,
            model_id TEXT,
            model_output TEXT,
            auto_score INTEGER,
            judge_rationale TEXT,
            judge_criteria TEXT,
            is_shortlisted INTEGER NOT NULL DEFAULT 0,
            vote_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(challenge_id, user_id)
          );
          CREATE INDEX IF NOT EXISTS idx_build_subs_score ON build_submissions(challenge_id, auto_score DESC);
          CREATE INDEX IF NOT EXISTS idx_build_subs_shortlist ON build_submissions(challenge_id, is_shortlisted, vote_count DESC)`
  },
  {
    id: 912,
    name: 'create_build_votes_table',
    sql: `CREATE TABLE IF NOT EXISTS build_votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            challenge_id INTEGER NOT NULL REFERENCES build_challenges(id) ON DELETE CASCADE,
            submission_id INTEGER NOT NULL REFERENCES build_submissions(id) ON DELETE CASCADE,
            voter_user_id INTEGER NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            UNIQUE(challenge_id, voter_user_id)
          );
          CREATE INDEX IF NOT EXISTS idx_build_votes_submission ON build_votes(submission_id)`
  },
  {
    id: 913,
    name: 'create_open_builds_table',
    sql: `CREATE TABLE IF NOT EXISTS open_builds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            challenge_id INTEGER NOT NULL REFERENCES build_challenges(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT,
            repo_url TEXT,
            status TEXT NOT NULL DEFAULT 'building',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(challenge_id, user_id)
          );
          CREATE INDEX IF NOT EXISTS idx_open_builds_challenge ON open_builds(challenge_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_open_builds_user ON open_builds(user_id)`
  },
  {
    id: 930,
    name: 'add_deleted_at_to_messages',
    sql: `ALTER TABLE messages ADD COLUMN deleted_at TEXT`
  },
  {
    id: 931,
    name: 'add_deleted_at_to_group_messages',
    sql: `ALTER TABLE group_messages ADD COLUMN deleted_at TEXT`
  },
  {
    id: 933,
    name: 'create_learn_tables',
    sql: `CREATE TABLE IF NOT EXISTS lesson_translations (
      lesson_id TEXT NOT NULL,
      lang TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (lesson_id, lang)
    );
    CREATE TABLE IF NOT EXISTS tutor_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tutor_messages_user_day ON tutor_messages(user_id, created_at)`
  },
  {
    id: 934,
    name: 'create_centaur_tables',
    sql: `CREATE TABLE IF NOT EXISTS centaur_stats (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      rating INTEGER DEFAULT 1000,
      sprints INTEGER DEFAULT 0,
      best_time INTEGER,
      current_streak INTEGER DEFAULT 0,
      best_streak INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS centaur_sprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      problem_id TEXT NOT NULL,
      difficulty TEXT,
      language TEXT,
      solved INTEGER DEFAULT 0,
      solve_time INTEGER,
      rating_change INTEGER DEFAULT 0,
      rating_after INTEGER,
      used_assist INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_centaur_sprints_user ON centaur_sprints(user_id);
    CREATE INDEX IF NOT EXISTS idx_centaur_sprints_solved ON centaur_sprints(user_id, problem_id, solved)`
  },
  {
    id: 935,
    name: 'add_centaur_battle_wins_losses',
    sql: `ALTER TABLE centaur_stats ADD COLUMN wins INTEGER DEFAULT 0;
          ALTER TABLE centaur_stats ADD COLUMN losses INTEGER DEFAULT 0`
  },
  {
    id: 951,
    name: 'create_consumer_daily_usage',
    sql: `CREATE TABLE IF NOT EXISTS consumer_daily_usage (
            usage_date TEXT NOT NULL,
            metric TEXT NOT NULL,
            subject_id TEXT NOT NULL,
            usage_count INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (usage_date, metric, subject_id)
          );
          CREATE INDEX IF NOT EXISTS idx_consumer_daily_usage_metric
            ON consumer_daily_usage(usage_date, metric)`
  },
  {
    id: 952,
    name: 'add_provider_payment_id_to_credit_transactions',
    sql: `ALTER TABLE credit_transactions ADD COLUMN provider_payment_id TEXT;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_provider_payment
            ON credit_transactions(provider_payment_id)
            WHERE provider_payment_id IS NOT NULL`
  }
];

async function init() {
  logger.info('[DB] init() starting...');

  // Wait for database to be ready with timeout
  logger.info('[DB] Waiting for database to be ready...');
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Database open timeout after 30s')), 30000)
  );

  const dbOpened = await Promise.race([dbReady, timeoutPromise]);
  if (!dbOpened) {
    throw new Error('Failed to open database');
  }
  logger.info('[DB] Database is ready');

  // Run PRAGMA optimizations first (these are awaited properly now)
  logger.info('[DB] Running PRAGMA optimizations...');
  await runPragmas();

  // Create migrations tracking table
  logger.info('[DB] Creating migrations table...');
  await run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  // Ledger repair: an add_domain_to_companies entry once shipped with a
  // missing id. `INSERT ... VALUES (NULL, ...)` on an INTEGER PRIMARY KEY
  // allocates max(id)+1, so every server boot recorded one bogus "applied"
  // row under that name (300+ rows on long-lived DBs, squatting on ids
  // ~824-1137). Any new migration whose id lands on a squatted row is treated
  // as already applied and silently skipped, this shadowed migrations 925
  // and 926 and would shadow every future id up to the pollution high-water
  // mark. Delete everything except the genuine id-916 row. Shadowed
  // migrations re-run on this boot; they are idempotent or covered by the
  // already-exists handling below, so re-running is safe.
  const repaired = await run(
    `DELETE FROM schema_migrations WHERE name = 'add_domain_to_companies' AND id != 916`
  );
  if (repaired.changes > 0) {
    logger.warn(`[DB] Ledger repair: removed ${repaired.changes} bogus schema_migrations rows (null-id pollution under 'add_domain_to_companies')`);
  }

  // Get applied migrations
  const applied = await all('SELECT id FROM schema_migrations');
  const appliedIds = new Set(applied.map(m => m.id));

  // Guard against accidental duplicate migration IDs. Non-fatal, the
  // applied-set check + PRIMARY KEY already stop a migration re-running, but a
  // duplicate id silently shadows whichever entry runs second, so surface it.
  const seenMigrationIds = new Set();
  for (const m of migrations) {
    if (m.id == null) continue;
    if (seenMigrationIds.has(m.id)) {
      logger.warn(`[DB] Duplicate migration id ${m.id} (${m.name}), only the first will apply`);
    }
    seenMigrationIds.add(m.id);
  }

  // Run pending migrations
  for (const migration of migrations) {
    // Guard: a migration missing an id would otherwise re-run on every server
    // start (appliedIds.has(undefined) is always false). Skip + warn so the
    // bug is visible without breaking startup.
    if (migration.id == null) {
      logger.warn(`[DB] Skipping migration with missing id: ${migration.name || '<unnamed>'}`);
      continue;
    }
    if (appliedIds.has(migration.id)) {
      continue;
    }

    logger.info(`Running migration ${migration.id}: ${migration.name}`);
    try {
      // Handle multi-statement migrations (per-statement errors: only skip for the failing stmt)
      const statements = migration.sql.split(';').filter(s => s.trim());
      // A statement skipped only because its target table doesn't exist YET means
      // the migration's effect did not land. We must NOT record it as applied, or
      // it can never re-run once the table exists, that is exactly how columns
      // end up permanently missing in prod (e.g. user_reports.screenshots). Defer
      // it instead so a later startup (table now present) retries and completes it.
      let deferred = false;
      for (const stmt of statements) {
        const trimmed = stmt.trim()
        if (!trimmed) continue
        try {
          await run(trimmed)
        } catch (err) {
          // The desired end-state already exists, treat as success, safe to mark applied.
          const isAlreadyExists = err.message && (
            err.message.includes('duplicate column name') ||
            err.message.includes('Cannot add a UNIQUE column') ||
            err.message.includes('already exists')
          )
          // Only skip index-on-missing-table/column when THIS statement is CREATE INDEX
          // (not whole migration). The missing-column case happens when the index
          // references a column added by an earlier migration that was itself
          // deferred/shadowed, defer the index too rather than hard-aborting init().
          const stmtIsIndex = trimmed.toUpperCase().startsWith('CREATE INDEX')
          const isIndexOnMissingTarget = stmtIsIndex && err.message && (
            err.message.includes('no such table') ||
            err.message.includes('no such column')
          )

          // Defer ALTER TABLE statements whose table or source column is not
          // present yet. This lets the migration retry on a later startup
          // instead of aborting initialization or being marked as applied.
          const stmtIsAlter = trimmed.toUpperCase().startsWith('ALTER TABLE')
          const isAlterOnMissingTarget = stmtIsAlter && err.message &&
            (err.message.includes('no such table') || err.message.includes('no such column'))

          if (isIndexOnMissingTarget || isAlterOnMissingTarget) {
            // Effect deferred, not achieved, skip the statement but don't mark applied.
            deferred = true
            logger.warn(`  Migration ${migration.id} statement deferred (table missing, will retry next startup): ${err.message}`)
          } else if (isAlreadyExists) {
            logger.warn(`  Migration ${migration.id} statement skipped: ${err.message}`)
          } else {
            throw err
          }
        }
      }
      if (deferred) {
        logger.warn(`  Migration ${migration.id} not recorded as applied, a statement was deferred; will retry on next startup`);
      } else {
        await run(
          'INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
          [migration.id, migration.name, new Date().toISOString()]
        );
        logger.info(`  Migration ${migration.id} complete`);
      }
    } catch (err) {
      logger.error(`  Migration ${migration.id} failed:`, err.message);
      throw err;
    }
  }

  logger.info('Database migrations complete');

  // Ensure student_verifications table exists (migration 298 may not have run on production)
  try {
    await run(`CREATE TABLE IF NOT EXISTS student_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      edu_email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_student_verifications_token_hash ON student_verifications(token_hash)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_student_verifications_user_id ON student_verifications(user_id)`);
  } catch (err) {
    logger.warn(`[DB] student_verifications table ensure failed: ${err.message}`);
  }

  // Ensure webhook_events table exists (migration 87 may not have run)
  try {
    await run(`CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processed'
    )`);
  } catch (err) {
    logger.warn(`[DB] webhook_events table ensure failed: ${err.message}`);
  }

  // Ensure campaign tables exist + seeded (migrations 900-902 may not have run on production)
  try {
    await run(`CREATE TABLE IF NOT EXISTS campaign_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      post_tag TEXT NOT NULL,
      claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
      pro_granted_until TEXT NOT NULL
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_campaign_claims_post_tag ON campaign_claims(post_tag)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_campaign_claims_claimed_at ON campaign_claims(claimed_at)`);

    await run(`CREATE TABLE IF NOT EXISTS campaign_post_caps (
      post_tag TEXT PRIMARY KEY,
      cap INTEGER NOT NULL,
      claimed_count INTEGER NOT NULL DEFAULT 0
    )`);

    await run(`CREATE TABLE IF NOT EXISTS campaign_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      kill_switch INTEGER NOT NULL DEFAULT 0,
      ai_minutes_cap INTEGER NOT NULL DEFAULT 60,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await run(
      `INSERT OR IGNORE INTO campaign_config (id, kill_switch, ai_minutes_cap) VALUES (1, 0, 60)`
    );
    logger.info('[DB] Ensured campaign tables exist (claims, post_caps seeded, config)');
  } catch (err) {
    logger.warn(`[DB] campaign tables ensure failed: ${err.message}`);
  }

  // Ensure build challenge tables exist (migrations 910-912 may not have run on
  // production, like the campaign tables they sit at the end of the migration
  // array and get skipped if an earlier migration aborts the run). Idempotent:
  // CREATE TABLE IF NOT EXISTS is a no-op when the tables already exist.
  try {
    await run(`CREATE TABLE IF NOT EXISTS build_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      brief TEXT NOT NULL,
      target_output TEXT,
      evaluation_criteria TEXT,
      track TEXT NOT NULL DEFAULT 'applied',
      judging_mode TEXT NOT NULL DEFAULT 'auto_gate_vote',
      source_name TEXT,
      source_url TEXT,
      model_id TEXT,
      shortlist_size INTEGER NOT NULL DEFAULT 5,
      submit_open_at TEXT NOT NULL,
      submit_close_at TEXT NOT NULL,
      vote_close_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      shortlisted_at TEXT,
      winner_submission_id INTEGER,
      closed_at TEXT,
      created_at TEXT NOT NULL
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_build_challenges_window ON build_challenges(submit_open_at, submit_close_at, vote_close_at)`);

    await run(`CREATE TABLE IF NOT EXISTS build_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL REFERENCES build_challenges(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      prompt_text TEXT NOT NULL,
      model_id TEXT,
      model_output TEXT,
      auto_score INTEGER,
      judge_rationale TEXT,
      judge_criteria TEXT,
      is_shortlisted INTEGER NOT NULL DEFAULT 0,
      vote_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(challenge_id, user_id)
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_build_subs_score ON build_submissions(challenge_id, auto_score DESC)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_build_subs_shortlist ON build_submissions(challenge_id, is_shortlisted, vote_count DESC)`);

    await run(`CREATE TABLE IF NOT EXISTS build_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL REFERENCES build_challenges(id) ON DELETE CASCADE,
      submission_id INTEGER NOT NULL REFERENCES build_submissions(id) ON DELETE CASCADE,
      voter_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(challenge_id, voter_user_id)
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_build_votes_submission ON build_votes(submission_id)`);
    logger.info('[DB] Ensured build challenge tables exist (challenges, submissions, votes)');
  } catch (err) {
    logger.warn(`[DB] build challenge tables ensure failed: ${err.message}`);
  }

  // Ensure open_builds table exists (migration 913 may not run on production,
  // same end-of-array skip risk). Lets a challenge entry graduate into a real
  // project ("Take this further"). Idempotent.
  try {
    await run(`CREATE TABLE IF NOT EXISTS open_builds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL REFERENCES build_challenges(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      repo_url TEXT,
      status TEXT NOT NULL DEFAULT 'building',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(challenge_id, user_id)
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_open_builds_challenge ON open_builds(challenge_id, created_at DESC)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_open_builds_user ON open_builds(user_id)`);
    logger.info('[DB] Ensured open_builds table exists');
  } catch (err) {
    logger.warn(`[DB] open_builds table ensure failed: ${err.message}`);
  }

  // Ensure accepted practice solutions can be displayed on problem pages.
  try {
    const practiceCols = await all(`PRAGMA table_info(practice_attempts)`);
    const hasPracticeCol = (name) => practiceCols.some(c => c.name === name);
    const addPracticeColIfMissing = async (name, sql) => {
      if (!hasPracticeCol(name)) {
        try {
          await run(sql);
          logger.info(`[DB] practice_attempts added column ${name}`);
        } catch (e) {
          if (!/duplicate column/i.test(e.message || '')) {
            logger.warn(`[DB] practice_attempts add column ${name} failed: ${e.message}`);
          }
        }
      }
    };
    await addPracticeColIfMissing('solution_code', `ALTER TABLE practice_attempts ADD COLUMN solution_code TEXT`);
    await addPracticeColIfMissing('solution_submitted_at', `ALTER TABLE practice_attempts ADD COLUMN solution_submitted_at TEXT`);
  } catch (err) {
    logger.warn(`[DB] practice_attempts solution column ensure failed: ${err.message}`);
  }

  // Ensure daily_challenges + daily_challenge_attempts have the prompt-era
  // columns (migrations 809-811). Production crashes on the weekly prompt
  // challenge page when challenge_type is missing, symptom: SQLITE_ERROR
  // table daily_challenges has no column named challenge_type. Migration
  // 809 may have been silently skipped if the multi-statement ALTER ran
  // against a missing table at that point in history. Defensive add here.
  try {
    const dcCols = await all(`PRAGMA table_info(daily_challenges)`);
    const hasDcCol = (name) => dcCols.some(c => c.name === name);
    const addDcColIfMissing = async (name, sql) => {
      if (!hasDcCol(name)) {
        try { await run(sql); logger.info(`[DB] daily_challenges added column ${name}`); }
        catch (e) { if (!/duplicate column/i.test(e.message)) logger.warn(`[DB] daily_challenges add column ${name} failed: ${e.message}`); }
      }
    };
    await addDcColIfMissing('challenge_type', `ALTER TABLE daily_challenges ADD COLUMN challenge_type TEXT NOT NULL DEFAULT 'prompt'`);

    const dcaCols = await all(`PRAGMA table_info(daily_challenge_attempts)`);
    const hasDcaCol = (name) => dcaCols.some(c => c.name === name);
    const addDcaColIfMissing = async (name, sql) => {
      if (!hasDcaCol(name)) {
        try { await run(sql); logger.info(`[DB] daily_challenge_attempts added column ${name}`); }
        catch (e) { if (!/duplicate column/i.test(e.message)) logger.warn(`[DB] daily_challenge_attempts add column ${name} failed: ${e.message}`); }
      }
    };
    await addDcaColIfMissing('prompt_submit_count', `ALTER TABLE daily_challenge_attempts ADD COLUMN prompt_submit_count INTEGER DEFAULT 0`);
    await addDcaColIfMissing('prompt_score', `ALTER TABLE daily_challenge_attempts ADD COLUMN prompt_score REAL`);
    await addDcaColIfMissing('model_output', `ALTER TABLE daily_challenge_attempts ADD COLUMN model_output TEXT`);
    await addDcaColIfMissing('passed_tier_id', `ALTER TABLE daily_challenge_attempts ADD COLUMN passed_tier_id TEXT`);
    await addDcaColIfMissing('model_used', `ALTER TABLE daily_challenge_attempts ADD COLUMN model_used TEXT`);
    // Migration 811 renamed `code` → `prompt_text`. If the rename never ran
    // and the column is still `code`, add `prompt_text` as a parallel
    // column so write paths don't fail. (Reads tolerate either since the
    // INSERT path is the one that crashes today.)
    if (!hasDcaCol('prompt_text') && hasDcaCol('code')) {
      try {
        await run(`ALTER TABLE daily_challenge_attempts RENAME COLUMN code TO prompt_text`);
        logger.info('[DB] daily_challenge_attempts renamed code → prompt_text');
      } catch (e) {
        // Older SQLite versions without RENAME COLUMN, fall back to add.
        try {
          await run(`ALTER TABLE daily_challenge_attempts ADD COLUMN prompt_text TEXT`);
          logger.info('[DB] daily_challenge_attempts added prompt_text (rename unsupported)');
        } catch (e2) {
          logger.warn(`[DB] could not provision prompt_text: ${e2.message}`);
        }
      }
    } else if (!hasDcaCol('prompt_text')) {
      try { await run(`ALTER TABLE daily_challenge_attempts ADD COLUMN prompt_text TEXT`); }
      catch (e) { if (!/duplicate column/i.test(e.message)) logger.warn(`[DB] could not add prompt_text: ${e.message}`); }
    }
  } catch (err) {
    logger.warn(`[DB] daily_challenges ensure failed: ${err.message}`);
  }

  // Ensure student columns exist on users table (migration 297 may not have run)
  const studentCols = [
    { name: 'student_email', sql: 'ALTER TABLE users ADD COLUMN student_email TEXT' },
    { name: 'student_verified_at', sql: 'ALTER TABLE users ADD COLUMN student_verified_at TEXT' },
    { name: 'subscription_type', sql: "ALTER TABLE users ADD COLUMN subscription_type TEXT DEFAULT 'pro'" },
    { name: 'student_expiration_warning_sent', sql: 'ALTER TABLE users ADD COLUMN student_expiration_warning_sent TEXT' }
  ];
  for (const col of studentCols) {
    try {
      await run(col.sql);
      logger.info(`[DB] Added missing column users.${col.name}`);
    } catch (e) {
      // Column already exists - expected
    }
  }

  // Ensure 2FA columns exist on users table (migrations 311-312 may not have run)
  const twofaCols = [
    { name: 'totp_secret', sql: 'ALTER TABLE users ADD COLUMN totp_secret TEXT' },
    { name: 'is_2fa_enabled', sql: 'ALTER TABLE users ADD COLUMN is_2fa_enabled INTEGER DEFAULT 0' },
    { name: 'two_fa_enabled_at', sql: 'ALTER TABLE users ADD COLUMN two_fa_enabled_at TEXT' },
    { name: 'two_factor_pending_token', sql: 'ALTER TABLE users ADD COLUMN two_factor_pending_token TEXT' },
    { name: 'two_factor_pending_expires', sql: 'ALTER TABLE users ADD COLUMN two_factor_pending_expires INTEGER' },
    { name: 'last_auth_at', sql: 'ALTER TABLE users ADD COLUMN last_auth_at TEXT' }
  ];
  for (const col of twofaCols) {
    try {
      await run(col.sql);
      logger.info(`[DB] Added missing column users.${col.name}`);
    } catch (e) {
      // Column already exists - expected
    }
  }

  // Ensure activity_reminders column exists on user_email_preferences (migration 302 may have been silently skipped)
  try {
    await run('ALTER TABLE user_email_preferences ADD COLUMN activity_reminders INTEGER DEFAULT 1');
    logger.info('[DB] Added missing column user_email_preferences.activity_reminders');
  } catch (e) {
    // Column already exists - expected
  }

  // Ensure message_digest column exists on user_email_preferences (migration 822)
  try {
    await run('ALTER TABLE user_email_preferences ADD COLUMN message_digest INTEGER DEFAULT 1');
    logger.info('[DB] Added missing column user_email_preferences.message_digest');
  } catch (e) {
    // Column already exists - expected
  }

  // Ensure creator_arena_emails column exists on user_email_preferences (migration 813).
  // PUT /api/notifications/preferences writes this column on every toggle, so a
  // missing column 500s every save and the frontend toasts "Couldn't save email preferences."
  try {
    await run('ALTER TABLE user_email_preferences ADD COLUMN creator_arena_emails INTEGER DEFAULT 1');
    logger.info('[DB] Added missing column user_email_preferences.creator_arena_emails');
  } catch (e) {
    // Column already exists - expected
  }

  // Ensure progress_digest and tournament_notifications columns exist on
  // user_email_preferences (migrations 937, 942). setEmailPreferences writes
  // both on every pref save, so a missing column 500s the PUT route.
  try {
    await run('ALTER TABLE user_email_preferences ADD COLUMN progress_digest INTEGER DEFAULT 1');
    logger.info('[DB] Added missing column user_email_preferences.progress_digest');
  } catch (e) {
    // Column already exists - expected
  }
  try {
    await run('ALTER TABLE user_email_preferences ADD COLUMN tournament_notifications INTEGER DEFAULT 0');
    logger.info('[DB] Added missing column user_email_preferences.tournament_notifications');
  } catch (e) {
    // Column already exists - expected
  }

  // Ensure screenshots column exists on user_reports (migration 107 may have been
  // silently skipped on prod, POST /api/moderation/report 500s without it)
  try {
    await run('ALTER TABLE user_reports ADD COLUMN screenshots TEXT');
    logger.info('[DB] Added missing column user_reports.screenshots');
  } catch (e) {
    // Column already exists - expected
  }

  // Ensure is_third_place_match column exists on tournament_matches (migration 823)
  try {
    await run('ALTER TABLE tournament_matches ADD COLUMN is_third_place_match INTEGER DEFAULT 0');
    logger.info('[DB] Added missing column tournament_matches.is_third_place_match');
  } catch (e) {
    // Column already exists - expected
  }

  // Ensure social link columns exist on users table (migrations 444-446 may not have run on production)
  const socialLinkCols = [
    { name: 'github_url', sql: 'ALTER TABLE users ADD COLUMN github_url TEXT' },
    { name: 'linkedin_url', sql: 'ALTER TABLE users ADD COLUMN linkedin_url TEXT' },
    { name: 'twitter_url', sql: 'ALTER TABLE users ADD COLUMN twitter_url TEXT' }
  ];
  for (const col of socialLinkCols) {
    try {
      await run(col.sql);
      logger.info(`[DB] Added missing column users.${col.name}`);
    } catch (e) {
      // Column already exists - expected
    }
  }

  // Ensure practice demo tracking column exists on users table
  try {
    await run('ALTER TABLE users ADD COLUMN practice_demo_shown_at TEXT');
    logger.info('[DB] Added missing column users.practice_demo_shown_at');
  } catch (e) {
    // Column already exists - expected
  }

  // Ensure github_id column exists on users table (migration 450 may not have run on production)
  try {
    // Check if github_id column exists using PRAGMA table_info
    const columns = await all('PRAGMA table_info(users)');
    const hasGithubId = columns.some(col => col.name === 'github_id');

    if (!hasGithubId) {
      logger.info('[DB] Adding missing column users.github_id');
      await run('ALTER TABLE users ADD COLUMN github_id TEXT');
      await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id)');
      logger.info('[DB] Added missing column users.github_id with unique index');
    } else {
      // Column exists, ensure index exists
      await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id)');
    }
  } catch (err) {
    logger.error(`[DB] Failed to ensure github_id column exists: ${err.message}`);
    // Don't throw - this is a fallback check, not critical for startup
  }

  // Ensure avatar_url column exists on users table (safety check for migration 709)
  try {
    const userCols = await all("PRAGMA table_info(users)");
    const hasAvatarUrl = userCols.some(c => c.name === 'avatar_url');
    if (!hasAvatarUrl) {
      await run('ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT NULL');
      logger.info('[DB] Safety check: added avatar_url column to users');
    }
  } catch (err) {
    logger.warn('[DB] Safety check avatar_url:', err.message);
  }

  // Ensure agent_loadouts table exists (safety check for migration 451)
  try {
    await run(`CREATE TABLE IF NOT EXISTS agent_loadouts (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      description TEXT,
      model TEXT NOT NULL,
      system_prompt TEXT,
      language TEXT NOT NULL,
      tools TEXT,
      elo INTEGER DEFAULT 1000,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      is_public INTEGER DEFAULT 0,
      times_cloned INTEGER DEFAULT 0,
      original_loadout_id TEXT REFERENCES agent_loadouts(id),
      current_streak INTEGER DEFAULT 0,
      best_streak INTEGER DEFAULT 0,
      last_battle_result TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agent_loadouts_user ON agent_loadouts(user_id)`);
    logger.info('[DB] Ensured agent_loadouts table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure agent_loadouts table:', err.message);
  }

  // Ensure agent_loadouts has all required columns (safety check for migrations 609-613)
  const loadoutColumns = [
    { name: 'total_tokens_used', sql: 'ALTER TABLE agent_loadouts ADD COLUMN total_tokens_used INTEGER DEFAULT 0' },
    { name: 'total_tests_passed', sql: 'ALTER TABLE agent_loadouts ADD COLUMN total_tests_passed INTEGER DEFAULT 0' },
    { name: 'total_battles', sql: 'ALTER TABLE agent_loadouts ADD COLUMN total_battles INTEGER DEFAULT 0' },
    { name: 'recent_results', sql: 'ALTER TABLE agent_loadouts ADD COLUMN recent_results TEXT DEFAULT "[]"' },
    { name: 'language_usage', sql: 'ALTER TABLE agent_loadouts ADD COLUMN language_usage TEXT DEFAULT "{}"' }
  ];
  for (const col of loadoutColumns) {
    try {
      await run(col.sql);
      logger.info(`[DB] Added missing column ${col.name} to agent_loadouts`);
    } catch (err) {
      // Column likely already exists, ignore
    }
  }

  // Ensure agent_battles table exists (safety check for migration 453)
  try {
    await run(`CREATE TABLE IF NOT EXISTS agent_battles (
      id TEXT PRIMARY KEY,
      player1_id INTEGER NOT NULL REFERENCES users(id),
      player2_id INTEGER NOT NULL REFERENCES users(id),
      loadout1_id TEXT NOT NULL REFERENCES agent_loadouts(id),
      loadout2_id TEXT NOT NULL REFERENCES agent_loadouts(id),
      problem_id TEXT NOT NULL,
      winner_id INTEGER REFERENCES users(id),
      player1_code TEXT,
      player2_code TEXT,
      player1_tests_passed INTEGER DEFAULT 0,
      player2_tests_passed INTEGER DEFAULT 0,
      player1_elo_change INTEGER,
      player2_elo_change INTEGER,
      player1_tokens_used INTEGER DEFAULT 0,
      player2_tokens_used INTEGER DEFAULT 0,
      status TEXT DEFAULT 'in_progress',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agent_battles_players ON agent_battles(player1_id, player2_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agent_battles_status ON agent_battles(status)`);
    logger.info('[DB] Ensured agent_battles table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure agent_battles table:', err.message);
  }

  // Ensure agent_battles has all required columns (safety check for columns used in queries)
  const battleColumns = [
    { name: 'player1_tests_passed', sql: 'ALTER TABLE agent_battles ADD COLUMN player1_tests_passed INTEGER DEFAULT 0' },
    { name: 'player2_tests_passed', sql: 'ALTER TABLE agent_battles ADD COLUMN player2_tests_passed INTEGER DEFAULT 0' },
    { name: 'player1_results', sql: 'ALTER TABLE agent_battles ADD COLUMN player1_results TEXT' },
    { name: 'player2_results', sql: 'ALTER TABLE agent_battles ADD COLUMN player2_results TEXT' },
    { name: 'player1_time_ms', sql: 'ALTER TABLE agent_battles ADD COLUMN player1_time_ms INTEGER' },
    { name: 'player2_time_ms', sql: 'ALTER TABLE agent_battles ADD COLUMN player2_time_ms INTEGER' },
    { name: 'finished_at', sql: 'ALTER TABLE agent_battles ADD COLUMN finished_at TEXT' },
    { name: 'player1_elo_change', sql: 'ALTER TABLE agent_battles ADD COLUMN player1_elo_change INTEGER DEFAULT 0' },
    { name: 'player2_elo_change', sql: 'ALTER TABLE agent_battles ADD COLUMN player2_elo_change INTEGER DEFAULT 0' },
    { name: 'player1_tokens_used', sql: 'ALTER TABLE agent_battles ADD COLUMN player1_tokens_used INTEGER DEFAULT 0' },
    { name: 'player2_tokens_used', sql: 'ALTER TABLE agent_battles ADD COLUMN player2_tokens_used INTEGER DEFAULT 0' },
    { name: 'player1_generation_time_ms', sql: 'ALTER TABLE agent_battles ADD COLUMN player1_generation_time_ms INTEGER' },
    { name: 'player2_generation_time_ms', sql: 'ALTER TABLE agent_battles ADD COLUMN player2_generation_time_ms INTEGER' },
    { name: 'player1_tool_calls', sql: 'ALTER TABLE agent_battles ADD COLUMN player1_tool_calls INTEGER DEFAULT 0' },
    { name: 'player2_tool_calls', sql: 'ALTER TABLE agent_battles ADD COLUMN player2_tool_calls INTEGER DEFAULT 0' },
    { name: 'loadout1_version_id', sql: 'ALTER TABLE agent_battles ADD COLUMN loadout1_version_id TEXT' },
    { name: 'loadout2_version_id', sql: 'ALTER TABLE agent_battles ADD COLUMN loadout2_version_id TEXT' }
  ];
  for (const col of battleColumns) {
    try {
      await run(col.sql);
      logger.info(`[DB] Added missing column ${col.name} to agent_battles`);
    } catch (err) {
      // Column likely already exists, ignore
    }
  }

  // Ensure agent_battle_events table exists (safety check for migration 454)
  try {
    await run(`CREATE TABLE IF NOT EXISTS agent_battle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id TEXT NOT NULL REFERENCES agent_battles(id),
      event_type TEXT NOT NULL,
      player_id INTEGER,
      event_data TEXT,
      timestamp_ms INTEGER NOT NULL
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agent_battle_events_battle ON agent_battle_events(battle_id)`);
    logger.info('[DB] Ensured agent_battle_events table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure agent_battle_events table:', err.message);
  }

  // Ensure agent_seasons table exists (safety check for migration 459)
  try {
    await run(`CREATE TABLE IF NOT EXISTS agent_seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_number INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    logger.info('[DB] Ensured agent_seasons table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure agent_seasons table:', err.message);
  }

  // Ensure agent_season_rankings table exists (safety check for migration 479)
  try {
    await run(`CREATE TABLE IF NOT EXISTS agent_season_rankings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id INTEGER NOT NULL REFERENCES agent_seasons(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      loadout_id TEXT NOT NULL REFERENCES agent_loadouts(id),
      final_elo INTEGER NOT NULL DEFAULT 1000,
      final_rank INTEGER,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      best_streak INTEGER DEFAULT 0,
      reward_claimed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(season_id, loadout_id)
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agent_season_rankings_season ON agent_season_rankings(season_id)`);
    logger.info('[DB] Ensured agent_season_rankings table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure agent_season_rankings table:', err.message);
  }

  // Ensure agent_season_rankings has best_streak column (safety check)
  try {
    await run('ALTER TABLE agent_season_rankings ADD COLUMN best_streak INTEGER DEFAULT 0');
    logger.info('[DB] Added missing column best_streak to agent_season_rankings');
  } catch (err) {
    // Column likely already exists, ignore
  }

  // Ensure agent_training_runs table exists (safety check for migration 626)
  try {
    await run(`CREATE TABLE IF NOT EXISTS agent_training_runs (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      loadout_id TEXT NOT NULL REFERENCES agent_loadouts(id),
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      total_problems INTEGER DEFAULT 0,
      problems_solved INTEGER DEFAULT 0,
      total_tests_passed INTEGER DEFAULT 0,
      total_tests_failed INTEGER DEFAULT 0,
      total_tokens_used INTEGER DEFAULT 0,
      total_execution_time_ms INTEGER DEFAULT 0,
      difficulty_filter TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agent_training_runs_user ON agent_training_runs(user_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agent_training_runs_loadout ON agent_training_runs(loadout_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agent_training_runs_status ON agent_training_runs(status)`);
    logger.info('[DB] Ensured agent_training_runs table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure agent_training_runs table:', err.message);
  }

  // Ensure agent_training_results table exists (safety check for migration 627)
  try {
    await run(`CREATE TABLE IF NOT EXISTS agent_training_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      training_run_id TEXT NOT NULL REFERENCES agent_training_runs(id) ON DELETE CASCADE,
      problem_id TEXT NOT NULL,
      problem_title TEXT,
      problem_difficulty TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      code_generated TEXT,
      tests_passed INTEGER DEFAULT 0,
      total_tests INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      execution_time_ms INTEGER DEFAULT 0,
      error_message TEXT,
      test_results TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agent_training_results_run ON agent_training_results(training_run_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agent_training_results_problem ON agent_training_results(problem_id)`);
    logger.info('[DB] Ensured agent_training_results table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure agent_training_results table:', err.message);
  }

  // Ensure agent_rate_limits table exists and has all required columns
  try {
    await run(`CREATE TABLE IF NOT EXISTS agent_rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      request_count INTEGER DEFAULT 0,
      haiku_count INTEGER DEFAULT 0,
      sonnet_count INTEGER DEFAULT 0,
      opus_count INTEGER DEFAULT 0,
      reset_time INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    logger.info('[DB] Ensured agent_rate_limits table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure agent_rate_limits table:', err.message);
  }

  // Ensure agent_rate_limits has model-specific count columns
  const rateLimitColumns = [
    { name: 'haiku_count', sql: 'ALTER TABLE agent_rate_limits ADD COLUMN haiku_count INTEGER DEFAULT 0' },
    { name: 'sonnet_count', sql: 'ALTER TABLE agent_rate_limits ADD COLUMN sonnet_count INTEGER DEFAULT 0' },
    { name: 'opus_count', sql: 'ALTER TABLE agent_rate_limits ADD COLUMN opus_count INTEGER DEFAULT 0' }
  ];
  for (const col of rateLimitColumns) {
    try {
      await run(col.sql);
      logger.info(`[DB] Added missing column ${col.name} to agent_rate_limits`);
    } catch (err) {
      // Column likely already exists, ignore
    }
  }

  // Ensure agent_rivalries table exists (safety check for migration 475)
  try {
    await run(`CREATE TABLE IF NOT EXISTS agent_rivalries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1_id INTEGER NOT NULL REFERENCES users(id),
      user2_id INTEGER NOT NULL REFERENCES users(id),
      user1_wins INTEGER DEFAULT 0,
      user2_wins INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      last_battle_at TEXT,
      last_winner_id INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user1_id, user2_id)
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agent_rivalries_user1 ON agent_rivalries(user1_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agent_rivalries_user2 ON agent_rivalries(user2_id)`);
    logger.info('[DB] Ensured agent_rivalries table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure agent_rivalries table:', err.message);
  }

  // Ensure agent_battle_bans table exists
  try {
    await run(`CREATE TABLE IF NOT EXISTS agent_battle_bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      banned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      banned_until DATETIME NOT NULL,
      reason TEXT,
      banned_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (banned_by) REFERENCES users(id)
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agent_battle_bans_user ON agent_battle_bans(user_id)`);
    logger.info('[DB] Ensured agent_battle_bans table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure agent_battle_bans table:', err.message);
  }

  // Fix user_sessions table - drop if it has wrong schema (session_token instead of token_hash)
  try {
    const cols = await all("PRAGMA table_info(user_sessions)");
    const hasSessionToken = cols.some(c => c.name === 'session_token');
    const hasTokenHash = cols.some(c => c.name === 'token_hash');

    if (hasSessionToken) {
      // Wrong schema - session_token column shouldn't exist, drop and recreate
      logger.info('[DB] user_sessions has wrong schema (session_token column exists), recreating...');
      await run('DROP TABLE IF EXISTS user_sessions');
    } else if (!hasTokenHash && cols.length > 0) {
      // Table exists but missing token_hash column
      logger.info('[DB] user_sessions missing token_hash column, recreating...');
      await run('DROP TABLE IF EXISTS user_sessions');
    }
  } catch (err) {
    // Table doesn't exist yet, that's fine
  }

  // Ensure user_sessions table exists with correct schema
  try {
    await run(`CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      device_type TEXT,
      browser TEXT,
      os TEXT,
      ip_address TEXT,
      location TEXT,
      last_active TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash)`);
    logger.info('[DB] Ensured user_sessions table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure user_sessions table:', err.message);
  }

  // Ensure 2FA backup codes table exists
  try {
    await run(`CREATE TABLE IF NOT EXISTS two_factor_backup_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      used_at TEXT,
      created_at TEXT NOT NULL
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON two_factor_backup_codes(user_id, used)`);
  } catch (e) {
    // Table already exists - expected
  }

  // Ensure 2FA audit log table exists
  try {
    await run(`CREATE TABLE IF NOT EXISTS two_factor_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      success INTEGER NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch (e) {
    // Table already exists - expected
  }

  // Ensure trusted_devices table exists
  try {
    await run(`CREATE TABLE IF NOT EXISTS trusted_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_token_hash TEXT NOT NULL UNIQUE,
      device_name TEXT,
      browser TEXT,
      os TEXT,
      ip_address TEXT,
      last_used TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_trusted_devices_token ON trusted_devices(device_token_hash)`);
  } catch (e) {
    // Table already exists - expected
  }

  // Log battles_history schema for debugging
  try {
    const battlesColumns = await all("PRAGMA table_info(battles_history)");
    const columnNames = battlesColumns.map(col => col.name);
    logger.info(`[DB-SCHEMA] battles_history columns: ${columnNames.join(', ')}`);

    // Check for required columns
    const requiredCols = [
      'is_matchmade',
      'winner_language',
      'loser_language',
      'winner_rating_change',
      'loser_rating_change',
      'is_partial_credit',
      'winner_tests_passed',
      'loser_tests_passed'
    ];
    const missingCols = requiredCols.filter(col => !columnNames.includes(col));
    if (missingCols.length > 0) {
      logger.error(`[DB-SCHEMA] MISSING COLUMNS in battles_history: ${missingCols.join(', ')}`);
      // Try to add missing columns
      for (const col of missingCols) {
        try {
          if (col === 'is_matchmade') {
            await run(`ALTER TABLE battles_history ADD COLUMN is_matchmade INTEGER DEFAULT 1`);
          } else if (col === 'is_partial_credit') {
            await run(`ALTER TABLE battles_history ADD COLUMN is_partial_credit INTEGER DEFAULT 0`);
          } else if (col === 'winner_language' || col === 'loser_language') {
            await run(`ALTER TABLE battles_history ADD COLUMN ${col} TEXT DEFAULT 'python'`);
          } else {
            await run(`ALTER TABLE battles_history ADD COLUMN ${col} INTEGER DEFAULT NULL`);
          }
          logger.info(`[DB-SCHEMA] Added missing column: ${col}`);
        } catch (addErr) {
          logger.warn(`[DB-SCHEMA] Could not add column ${col}: ${addErr.message}`);
        }
      }
    }
  } catch (schemaErr) {
    logger.error(`[DB-SCHEMA] Failed to check battles_history schema: ${schemaErr.message}`);
  }

  // Ensure critical columns exist (safety check for migrations that may have been marked complete but failed)
  try {
    const messagesColumns = await all("PRAGMA table_info(messages)");
    const hasEditedAt = messagesColumns.some(col => col.name === 'edited_at');
    if (!hasEditedAt) {
      logger.info('Adding missing edited_at column to messages table');
      await run('ALTER TABLE messages ADD COLUMN edited_at TEXT');
    }
    const hasDeletedAt = messagesColumns.some(col => col.name === 'deleted_at');
    if (!hasDeletedAt) {
      logger.info('Adding missing deleted_at column to messages table');
      await run('ALTER TABLE messages ADD COLUMN deleted_at TEXT');
    }
  } catch (err) {
    logger.warn('Could not verify edited_at/deleted_at columns:', err.message);
  }

  try {
    const groupMessagesColumns = await all("PRAGMA table_info(group_messages)");
    const hasGroupDeletedAt = groupMessagesColumns.some(col => col.name === 'deleted_at');
    if (!hasGroupDeletedAt) {
      logger.info('Adding missing deleted_at column to group_messages table');
      await run('ALTER TABLE group_messages ADD COLUMN deleted_at TEXT');
    }
  } catch (err) {
    logger.warn('Could not verify group_messages deleted_at column:', err.message);
  }

  try {
    await ensureMessageReactionTables();
  } catch (err) {
    logger.warn('Could not ensure message reaction tables:', err.message);
  }

  // Ensure battle_snapshots table exists (safety check for migration 244)
  try {
    await run(`CREATE TABLE IF NOT EXISTS battle_snapshots (
      battle_id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      battle_data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_battle_snapshots_state ON battle_snapshots(state)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_battle_snapshots_updated ON battle_snapshots(updated_at)`);
  } catch (err) {
    logger.warn('Could not ensure battle_snapshots table:', err.message);
  }

  // Ensure email_verifications table exists (safety check for migration 252)
  try {
    await run(`CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(token_hash)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id)`);
  } catch (err) {
    logger.warn('Could not ensure email_verifications table:', err.message);
  }

  // Ensure email_verified column exists on users table (safety check for migration 251)
  try {
    const usersColumns = await all("PRAGMA table_info(users)");
    const hasEmailVerified = usersColumns.some(col => col.name === 'email_verified');
    if (!hasEmailVerified) {
      logger.info('Adding missing email_verified column to users table');
      await run('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0');
    }
  } catch (err) {
    logger.warn('Could not verify email_verified column:', err.message);
  }

  // Grandfather existing users: mark all users created before 2026-02-16 as email verified
  // This ensures only NEW signups after this date need to verify their email
  try {
    const result = await run(`
      UPDATE users
      SET email_verified = 1
      WHERE email_verified = 0
      AND created_at < '2026-02-16'
    `);
    if (result.changes > 0) {
      logger.info(`Grandfathered ${result.changes} existing user(s) as email verified`);
    }
  } catch (err) {
    logger.warn('Could not grandfather existing users:', err.message);
  }

  // Auto-verify all Google OAuth users (Google already verified their email)
  try {
    const result = await run(`
      UPDATE users
      SET email_verified = 1
      WHERE email_verified = 0
      AND google_id IS NOT NULL
    `);
    if (result.changes > 0) {
      logger.info(`Auto-verified ${result.changes} Google OAuth user(s)`);
    }
  } catch (err) {
    logger.warn('Could not auto-verify Google OAuth users:', err.message);
  }

  // Ensure show_read_receipts column exists (safety check for migration 106)
  try {
    const usersColumns = await all("PRAGMA table_info(users)");
    const hasShowReadReceipts = usersColumns.some(col => col.name === 'show_read_receipts');
    if (!hasShowReadReceipts) {
      logger.info('Adding missing show_read_receipts column to users table');
      await run('ALTER TABLE users ADD COLUMN show_read_receipts INTEGER DEFAULT 1');
    }
  } catch (err) {
    logger.warn('Could not verify show_read_receipts column:', err.message);
  }

  // Ensure username_change_count column exists (safety check for migration 300)
  try {
    const usersColumns = await all("PRAGMA table_info(users)");
    const hasUsernameChangeCount = usersColumns.some(col => col.name === 'username_change_count');
    if (!hasUsernameChangeCount) {
      logger.info('Adding missing username_change_count column to users table');
      await run('ALTER TABLE users ADD COLUMN username_change_count INTEGER DEFAULT 0');
    }
  } catch (err) {
    logger.warn('Could not verify username_change_count column:', err.message);
  }

  // Ensure prompt_attempts table exists (safety check for migration 703)
  try {
    await run(`CREATE TABLE IF NOT EXISTS prompt_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      challenge_id TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      score INTEGER DEFAULT 0,
      tests_passed INTEGER DEFAULT 0,
      tests_total INTEGER DEFAULT 0,
      solved INTEGER DEFAULT 0,
      time_spent INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_prompt_attempts_user_date ON prompt_attempts(user_id, created_at)`);
    logger.info('[DB] Ensured prompt_attempts table exists');
  } catch (err) {
    logger.warn('Could not ensure prompt_attempts table:', err.message);
  }

  // Ensure prompt_practice_stats table exists (safety check for migration 704)
  try {
    await run(`CREATE TABLE IF NOT EXISTS prompt_practice_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      challenges_solved INTEGER DEFAULT 0,
      challenges_attempted INTEGER DEFAULT 0,
      total_attempts INTEGER DEFAULT 0,
      avg_score INTEGER,
      best_score INTEGER,
      last_practice TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id)
    )`);
    logger.info('[DB] Ensured prompt_practice_stats table exists');
  } catch (err) {
    logger.warn('Could not ensure prompt_practice_stats table:', err.message);
  }

  // Ensure in_app_notifications table exists (safety check for migration 724; avoids SQLITE_ERROR on fetch)
  try {
    await run(`CREATE TABLE IF NOT EXISTS in_app_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      link TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
    await run(`CREATE INDEX IF NOT EXISTS idx_in_app_notif_user ON in_app_notifications(user_id, read)`)
    await run(`CREATE INDEX IF NOT EXISTS idx_in_app_notif_created ON in_app_notifications(created_at DESC)`)
    logger.info('[DB] Ensured in_app_notifications table exists')
  } catch (err) {
    logger.warn('Could not ensure in_app_notifications table:', err.message)
  }

  // Ensure guest_practice_attempts table exists (safety check for migration 725)
  try {
    await run(`CREATE TABLE IF NOT EXISTS guest_practice_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_session_id TEXT NOT NULL,
      problem_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(guest_session_id, problem_id)
    )`)
    await run(`CREATE INDEX IF NOT EXISTS idx_guest_practice_guest ON guest_practice_attempts(guest_session_id)`)
    await run(`CREATE INDEX IF NOT EXISTS idx_guest_practice_day ON guest_practice_attempts(guest_session_id, created_at)`)
    logger.info('[DB] Ensured guest_practice_attempts table exists')
  } catch (err) {
    logger.warn('Could not ensure guest_practice_attempts table:', err.message)
  }

  // Ensure games table exists (safety check for migration 719)
  try {
    await run(`CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      description TEXT,
      game_type TEXT NOT NULL DEFAULT 'browser',
      html_content TEXT NOT NULL,
      thumbnail_url TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      github_repo TEXT,
      github_path TEXT,
      play_count INTEGER DEFAULT 0,
      vote_score INTEGER DEFAULT 0,
      tags TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_games_creator ON games(creator_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_games_status ON games(status)`);
    logger.info('[DB] Ensured games table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure games table:', err.message);
  }

  // Ensure game_versions table exists (safety check for migration 720)
  try {
    await run(`CREATE TABLE IF NOT EXISTS game_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL DEFAULT 1,
      html_content TEXT NOT NULL,
      prompt_used TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_game_versions_game ON game_versions(game_id)`);
    logger.info('[DB] Ensured game_versions table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure game_versions table:', err.message);
  }

  // Ensure game_verifications table exists for CreatorArena publish gate
  try {
    await run(`CREATE TABLE IF NOT EXISTS game_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
      spec_json TEXT,
      static_status TEXT NOT NULL,
      runtime_status TEXT NOT NULL,
      accuracy_status TEXT NOT NULL,
      overall_status TEXT NOT NULL,
      accuracy_score REAL DEFAULT 0,
      findings_json TEXT,
      artifacts_json TEXT,
      verifier_version TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_game_verifications_game ON game_verifications(game_id, created_at DESC)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_game_verifications_version ON game_verifications(version_id, created_at DESC)`);
    logger.info('[DB] Ensured game_verifications table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure game_verifications table:', err.message);
  }

  // Ensure game_votes table exists (safety check for migration 721)
  try {
    await run(`CREATE TABLE IF NOT EXISTS game_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      vote INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(game_id, user_id)
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_game_votes_game ON game_votes(game_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_game_votes_user ON game_votes(user_id)`);
    logger.info('[DB] Ensured game_votes table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure game_votes table:', err.message);
  }

  // Ensure game_comments table exists (safety check for migration 722)
  try {
    await run(`CREATE TABLE IF NOT EXISTS game_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      parent_id INTEGER REFERENCES game_comments(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_game_comments_game ON game_comments(game_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_game_comments_parent ON game_comments(parent_id)`);
    logger.info('[DB] Ensured game_comments table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure game_comments table:', err.message);
  }

  // Ensure game_comment_votes table exists (safety check for migration 808)
  try {
    await run(`CREATE TABLE IF NOT EXISTS game_comment_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL REFERENCES game_comments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      vote INTEGER NOT NULL CHECK(vote IN (-1, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(comment_id, user_id)
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_game_comment_votes_comment ON game_comment_votes(comment_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_game_comment_votes_user ON game_comment_votes(user_id)`);
    logger.info('[DB] Ensured game_comment_votes table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure game_comment_votes table:', err.message);
  }

  // Ensure game_ratings table exists (safety check for migration 821)
  try {
    await run(`CREATE TABLE IF NOT EXISTS game_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(game_id, user_id)
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_game_ratings_game ON game_ratings(game_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_game_ratings_user ON game_ratings(user_id)`);
    logger.info('[DB] Ensured game_ratings table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure game_ratings table:', err.message);
  }

  // Ensure avg_rating and rating_count columns exist on games table
  for (const col of [
    'ALTER TABLE games ADD COLUMN avg_rating REAL DEFAULT 0',
    'ALTER TABLE games ADD COLUMN rating_count INTEGER DEFAULT 0'
  ]) {
    try { await run(col); } catch (err) { /* column already exists */ }
  }

  // Ensure agent_loadout_versions table exists (safety check for migration 606)
  try {
    await run(`CREATE TABLE IF NOT EXISTS agent_loadout_versions (
      id TEXT PRIMARY KEY,
      loadout_id TEXT NOT NULL REFERENCES agent_loadouts(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL DEFAULT 1,
      system_prompt TEXT,
      model TEXT NOT NULL,
      language TEXT NOT NULL,
      tools TEXT,
      is_active INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_loadout_versions_loadout ON agent_loadout_versions(loadout_id)`);
    logger.info('[DB] Ensured agent_loadout_versions table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure agent_loadout_versions table:', err.message);
  }

  // Ensure webhook_deliveries table exists (safety check for migration 631)
  try {
    await run(`CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      response_code INTEGER,
      response_body TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_attempt_at TEXT,
      next_retry_at TEXT,
      completed_at TEXT
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_user_id ON webhook_deliveries(user_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status)`);
    logger.info('[DB] Ensured webhook_deliveries table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure webhook_deliveries table:', err.message);
  }

  // Ensure user_credits table exists (safety check for migration 737)
  try {
    await run(`CREATE TABLE IF NOT EXISTS user_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      balance INTEGER DEFAULT 0,
      lifetime_earned INTEGER DEFAULT 0,
      lifetime_spent INTEGER DEFAULT 0,
      last_monthly_grant TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id)
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_user_credits_user ON user_credits(user_id)`);
    logger.info('[DB] Ensured user_credits table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure user_credits table:', err.message);
  }

  // Ensure credit_transactions table exists (safety check for migration 738)
  try {
    await run(`CREATE TABLE IF NOT EXISTS credit_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      game_id INTEGER REFERENCES games(id),
      provider_payment_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const creditTransactionColumns = await all(`PRAGMA table_info(credit_transactions)`);
    if (!creditTransactionColumns.some(column => column.name === 'provider_payment_id')) {
      await run(`ALTER TABLE credit_transactions ADD COLUMN provider_payment_id TEXT`);
    }
    await run(`CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(type)`);
    await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_provider_payment
      ON credit_transactions(provider_payment_id) WHERE provider_payment_id IS NOT NULL`);
    logger.info('[DB] Ensured credit_transactions table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure credit_transactions table:', err.message);
  }

  // Ensure referrals table exists (safety check for migration 745)
  try {
    await run(`CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER NOT NULL REFERENCES users(id),
      referee_id INTEGER NOT NULL REFERENCES users(id),
      referral_code TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      referrer_credited INTEGER DEFAULT 0,
      referee_credited INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      UNIQUE(referee_id)
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code)`);
    logger.info('[DB] Ensured referrals table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure referrals table:', err.message);
  }

  // Ensure referral_code column on users (safety check for migration 746)
  try {
    const userCols = await all("PRAGMA table_info(users)");
    const hasReferralCode = userCols.some(c => c.name === 'referral_code');
    if (!hasReferralCode) {
      await run(`ALTER TABLE users ADD COLUMN referral_code TEXT`);
      logger.info('[DB] Added referral_code column to users');
      // Add unique index separately (safer than UNIQUE constraint on ALTER)
      try {
        await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)`);
        logger.info('[DB] Added unique index on users.referral_code');
      } catch (indexErr) {
        logger.warn('[DB] Could not add referral_code index:', indexErr.message);
      }
    }
  } catch (err) {
    logger.error('[DB] Error ensuring referral_code column:', err.message);
  }

  // Ensure prompt_battle_history table exists (safety check for migration 801)
  try {
    await run(`CREATE TABLE IF NOT EXISTS prompt_battle_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT NOT NULL,
      player1_id TEXT NOT NULL,
      player1_username TEXT,
      player1_is_guest INTEGER DEFAULT 0,
      player2_id TEXT NOT NULL,
      player2_username TEXT,
      player2_is_guest INTEGER DEFAULT 0,
      problem_id TEXT,
      problem_title TEXT,
      difficulty TEXT,
      duration_sec INTEGER,
      player1_prompt TEXT,
      player2_prompt TEXT,
      player1_score REAL,
      player2_score REAL,
      player1_adjusted_score REAL,
      player2_adjusted_score REAL,
      player1_submit_count INTEGER DEFAULT 0,
      player2_submit_count INTEGER DEFAULT 0,
      winner_id TEXT,
      is_tie INTEGER DEFAULT 0,
      player1_model_output TEXT,
      player2_model_output TEXT,
      player1_token_usage TEXT,
      player2_token_usage TEXT,
      started_at TEXT,
      finished_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_prompt_battle_history_player1 ON prompt_battle_history(player1_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_prompt_battle_history_player2 ON prompt_battle_history(player2_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_prompt_battle_history_finished ON prompt_battle_history(finished_at DESC)`);
    logger.info('[DB] Ensured prompt_battle_history table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure prompt_battle_history table:', err.message);
  }

  // Ensure github_access_token column on users (safety check for migration 735)
  try {
    await run(`ALTER TABLE users ADD COLUMN github_access_token TEXT`);
    logger.info('[DB] Added github_access_token column to users');
  } catch (err) {
    // Column likely already exists
  }

  // Ensure agent_loadout_templates table exists (migration 798 may have been skipped)
  try {
    await run(`CREATE TABLE IF NOT EXISTS agent_loadout_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      strategy TEXT,
      model TEXT NOT NULL,
      system_prompt TEXT,
      language TEXT NOT NULL DEFAULT 'python',
      tools TEXT,
      is_official INTEGER DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      win_rate REAL,
      times_used INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch (err) {
    logger.warn('[DB] Could not ensure agent_loadout_templates:', err.message);
  }

  // Ensure feature_requests table exists (migration may have been skipped)
  try {
    await run(`CREATE TABLE IF NOT EXISTS feature_requests (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      username TEXT,
      email TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT DEFAULT 'other',
      priority TEXT DEFAULT 'medium',
      votes INTEGER DEFAULT 0,
      status TEXT DEFAULT 'new',
      admin_notes TEXT,
      submitter_ip TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_feature_requests_status ON feature_requests(status)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_feature_requests_category ON feature_requests(category)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_feature_requests_created ON feature_requests(created_at DESC)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_feature_requests_user ON feature_requests(user_id)`);
  } catch (err) {
    logger.warn('[DB] Could not ensure feature_requests:', err.message);
  }

  // Ensure trust tier columns exist on user_stats (safety check for trust system)
  const trustTierColumns = [
    { name: 'trust_tier', sql: "ALTER TABLE user_stats ADD COLUMN trust_tier TEXT DEFAULT 'standard'" },
    { name: 'tier_updated_at', sql: 'ALTER TABLE user_stats ADD COLUMN tier_updated_at TEXT' },
    { name: 'clean_battles_since_violation', sql: 'ALTER TABLE user_stats ADD COLUMN clean_battles_since_violation INTEGER DEFAULT 0' },
    { name: 'last_active_date', sql: 'ALTER TABLE user_stats ADD COLUMN last_active_date TEXT' },
    { name: 'milestone_streaks_claimed', sql: "ALTER TABLE user_stats ADD COLUMN milestone_streaks_claimed TEXT DEFAULT '[]'" }
  ];
  for (const col of trustTierColumns) {
    try {
      await run(col.sql);
      logger.info(`[DB] Added missing column ${col.name} to user_stats`);
    } catch (err) {
      // Column likely already exists
    }
  }

  // Ensure trust_score_log table exists (safety check for trust system)
  try {
    await run(`CREATE TABLE IF NOT EXISTS trust_score_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      previous_score INTEGER NOT NULL,
      new_score INTEGER NOT NULL,
      change_amount INTEGER NOT NULL,
      reason TEXT,
      battle_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_trust_score_log_user ON trust_score_log(user_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_trust_score_log_created ON trust_score_log(created_at)`);
    logger.info('[DB] Ensured trust_score_log table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure trust_score_log table:', err.message);
  }

  // Ensure trust_tier_history table exists (safety check for trust system)
  try {
    await run(`CREATE TABLE IF NOT EXISTS trust_tier_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      previous_tier TEXT NOT NULL,
      new_tier TEXT NOT NULL,
      trust_score_at_change INTEGER,
      reason TEXT,
      triggered_by TEXT DEFAULT 'system',
      admin_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_trust_tier_history_user ON trust_tier_history(user_id)`);
    logger.info('[DB] Ensured trust_tier_history table exists');
  } catch (err) {
    logger.warn('[DB] Could not ensure trust_tier_history table:', err.message);
  }

  // Sync admin users from environment variable
  await syncAdminsFromEnv();

  logger.info('[DB] init() completed successfully!');
}

// Sync admin status from ADMIN_EMAILS environment variable
async function syncAdminsFromEnv() {
  const adminEmails = process.env.ADMIN_EMAILS;
  if (!adminEmails) {
    logger.info('No ADMIN_EMAILS env var set - skipping admin sync');
    return;
  }

  const emails = adminEmails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) return;

  logger.info(`Syncing admin status for ${emails.length} email(s) from ADMIN_EMAILS env var`);

  for (const email of emails) {
    try {
      const result = await run(
        'UPDATE users SET is_admin = 1 WHERE LOWER(email) = ?',
        [email]
      );
      if (result.changes > 0) {
        logger.info(`  Set admin: ${email}`);
      }
    } catch (err) {
      logger.warn(`  Failed to set admin for ${email}:`, err.message);
    }
  }
}

// ============================================
// USER FUNCTIONS
// ============================================

async function createUser(email, passwordHash, username = null, avatar = 'default-1') {
  const createdAt = new Date().toISOString();
  const res = await run(
    `INSERT INTO users (email, password, username, avatar, created_at) VALUES (?, ?, ?, ?, ?)`,
    [email, passwordHash, username, avatar, createdAt]
  );

  // Create initial stats record
  await run(
    `INSERT INTO user_stats (user_id, updated_at) VALUES (?, ?)`,
    [res.lastID, createdAt]
  );

  return { id: res.lastID, email, username, avatar, created_at: createdAt };
}

async function getUserByEmail(email) {
  return get(`SELECT id, email, password, username, avatar, avatar_url, bio, is_online, last_seen, created_at, is_admin FROM users WHERE LOWER(email) = LOWER(?)`, [email]);
}

async function getUserById(id) {
  return get(`SELECT id, email, username, avatar, avatar_url, bio, github_url, linkedin_url, twitter_url, is_online, last_seen, created_at, is_pro, pro_expires_at, has_onboarded, practice_demo_shown_at, username_changed_at, username_chosen, username_change_count, is_admin, is_2fa_enabled, two_fa_enabled_at FROM users WHERE id = ?`, [id]);
}

// Lightweight verification check, used to gate abuse-prone actions (e.g.
// community voting) behind a verified email without pulling a full user row.
function getUserEmailVerified(userId) {
  return get('SELECT email_verified FROM users WHERE id = ?', [userId]);
}

async function getUserByIdWithPassword(id) {
  return get(`SELECT id, email, password, username, avatar, avatar_url FROM users WHERE id = ?`, [id]);
}

async function getUserByUsername(username) {
  return get(`SELECT id, email, username, avatar, avatar_url, bio, github_url, linkedin_url, twitter_url, is_online, last_seen, created_at, is_pro FROM users WHERE username = ?`, [username]);
}

async function getUserByUsernameWithPassword(username) {
  return get(`SELECT id, email, password, username, avatar, avatar_url, bio, is_online, last_seen, created_at, is_pro, pro_expires_at FROM users WHERE LOWER(username) = LOWER(?)`, [username]);
}

async function getUserByEmailWithPassword(email) {
  return get(`SELECT id, email, password, username, avatar, avatar_url, bio, is_online, last_seen, created_at, is_pro, pro_expires_at FROM users WHERE LOWER(email) = LOWER(?)`, [email]);
}

async function getUserByGoogleId(googleId) {
  return get(`SELECT id, email, username, avatar, avatar_url, bio, google_id, is_online, last_seen, created_at, username_chosen, has_onboarded, is_admin FROM users WHERE google_id = ?`, [googleId]);
}

async function createUserFromGoogle(email, googleId, username, avatar = 'default-1') {
  const createdAt = new Date().toISOString();
  // For Google users, we don't have a password, so we set a placeholder that can never match
  const noPasswordHash = '$google_oauth_user$';
  // Set username_chosen = 0 so user is prompted to choose their own username
  // Set email_verified = 1 since Google already verified their email
  const res = await run(
    `INSERT INTO users (email, password, google_id, username, avatar, created_at, username_chosen, email_verified) VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
    [email, noPasswordHash, googleId, username, avatar, createdAt]
  );

  // Create initial stats record
  await run(
    `INSERT INTO user_stats (user_id, updated_at) VALUES (?, ?)`,
    [res.lastID, createdAt]
  );

  return { id: res.lastID, email, username, avatar, google_id: googleId, created_at: createdAt, username_chosen: 0, has_onboarded: 0 };
}

async function linkGoogleAccount(userId, googleId) {
  await run(`UPDATE users SET google_id = ? WHERE id = ?`, [googleId, userId]);
}

async function getUserByGitHubId(githubId) {
  return get(`SELECT id, email, username, avatar, avatar_url, bio, github_id, is_online, last_seen, created_at, username_chosen, has_onboarded, is_admin FROM users WHERE github_id = ?`, [githubId]);
}

async function createUserFromGitHub(email, githubId, username, avatar = 'default-1') {
  const createdAt = new Date().toISOString();
  // For GitHub users, we don't have a password, so we set a placeholder that can never match
  const noPasswordHash = '$github_oauth_user$';
  // Set username_chosen = 0 so user is prompted to choose their own username
  // Set email_verified = 1 since GitHub already verified their email
  const res = await run(
    `INSERT INTO users (email, password, github_id, username, avatar, created_at, username_chosen, email_verified) VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
    [email, noPasswordHash, githubId, username, avatar, createdAt]
  );

  // Create initial stats record
  await run(
    `INSERT INTO user_stats (user_id, updated_at) VALUES (?, ?)`,
    [res.lastID, createdAt]
  );

  return { id: res.lastID, email, username, avatar, github_id: githubId, created_at: createdAt, username_chosen: 0, has_onboarded: 0 };
}

async function linkGitHubAccount(userId, githubId) {
  await run(`UPDATE users SET github_id = ? WHERE id = ?`, [githubId, userId]);
}

async function isUsernameAvailable(username, excludeUserId = null) {
  // Check if username is taken by an active user
  let query = 'SELECT id FROM users WHERE LOWER(username) = LOWER(?)';
  let params = [username];

  if (excludeUserId) {
    query += ' AND id != ?';
    params.push(excludeUserId);
  }

  const existing = await get(query, params);
  return !existing;
}

async function updateUserProfile(userId, { username, avatar, bio, github_url, linkedin_url, twitter_url }) {
  const updates = [];
  const params = [];

  if (username !== undefined) {
    updates.push('username = ?');
    params.push(username);
    // Track when username was changed for cooldown
    updates.push('username_changed_at = ?');
    params.push(new Date().toISOString());
    // Mark that user has chosen their username
    updates.push('username_chosen = 1');
    // Increment username change count
    updates.push('username_change_count = COALESCE(username_change_count, 0) + 1');
  }
  if (avatar !== undefined) {
    updates.push('avatar = ?');
    params.push(avatar);
  }
  if (bio !== undefined) {
    updates.push('bio = ?');
    params.push(bio);
  }
  if (github_url !== undefined) {
    updates.push('github_url = ?');
    params.push(github_url || null);
  }
  if (linkedin_url !== undefined) {
    updates.push('linkedin_url = ?');
    params.push(linkedin_url || null);
  }
  if (twitter_url !== undefined) {
    updates.push('twitter_url = ?');
    params.push(twitter_url || null);
  }

  if (updates.length === 0) return;

  params.push(userId);
  await run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
}

async function updateUserPassword(userId, passwordHash) {
  return run(`UPDATE users SET password = ? WHERE id = ?`, [passwordHash, userId]);
}

// Delete user account and all associated data
async function deleteUserAccount(userId) {
  // Wrap the entire ~30-write cascade in a transaction so a mid-sequence
  // failure rolls back cleanly instead of leaving a half-deleted account.
  await run('BEGIN IMMEDIATE');
  try {
    // Delete in order to respect foreign key relationships
    // Start with tables that reference other user tables, then work up to users table

    // Activity and notifications
    await run(`DELETE FROM push_subscriptions WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM activity_events WHERE user_id = ?`, [userId]);

    // Coaching and AI data
    await run(`DELETE FROM coaching_hints WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM code_reviews WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM coaching_insights WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM ai_feedback_cache WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM weekly_digests WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM learning_milestones WHERE user_id = ?`, [userId]);

    // Practice and coding sessions
    await run(`DELETE FROM coding_sessions WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM practice_attempts WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM practice_stats WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM problem_category_stats WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM coder_profiles WHERE user_id = ?`, [userId]);

    // Daily challenges
    await run(`DELETE FROM daily_challenge_attempts WHERE user_id = ?`, [userId]);

    // Build challenge + open builds (FKs are disabled in SQLite here, so clean up
    // explicitly to avoid orphaned rows that vanish from INNER-JOIN listings).
    await run(`DELETE FROM build_votes WHERE voter_user_id = ?`, [userId]);
    await run(`DELETE FROM build_submissions WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM open_builds WHERE user_id = ?`, [userId]);

    // Badges
    await run(`DELETE FROM user_badges WHERE user_id = ?`, [userId]);

    // Tournament data
    await run(`DELETE FROM tournament_participants WHERE user_id = ?`, [userId]);
    // Note: tournament_matches references winner_id but we don't delete matches, just null out the user
    await run(`UPDATE tournament_matches SET winner_id = NULL WHERE winner_id = ?`, [userId]);
    await run(`UPDATE tournament_matches SET player1_id = NULL WHERE player1_id = ?`, [userId]);
    await run(`UPDATE tournament_matches SET player2_id = NULL WHERE player2_id = ?`, [userId]);
    await run(`UPDATE tournaments SET winner_id = NULL WHERE winner_id = ?`, [userId]);
    await run(`UPDATE tournaments SET created_by = NULL WHERE created_by = ?`, [userId]);

    // Anti-cheat data
    await run(`DELETE FROM flagged_submissions WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM browser_fingerprints WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM solution_fingerprints WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM battle_violations WHERE user_id = ?`, [userId]);

    // Social - Messages and friends
    await run(
      `DELETE FROM message_reactions
       WHERE user_id = ?
          OR message_id IN (SELECT id FROM messages WHERE sender_id = ? OR receiver_id = ?)`,
      [userId, userId, userId]
    );
    await run(
      `DELETE FROM group_message_reactions
       WHERE user_id = ?
          OR group_message_id IN (SELECT id FROM group_messages WHERE sender_id = ?)`,
      [userId, userId]
    );
    await run(`DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?`, [userId, userId]);
    await run(`DELETE FROM conversations WHERE user1_id = ? OR user2_id = ?`, [userId, userId]);
    await run(`DELETE FROM friend_requests WHERE requester_id = ? OR requested_id = ?`, [userId, userId]);
    await run(`DELETE FROM friendships WHERE user1_id = ? OR user2_id = ?`, [userId, userId]);

    // Challenges
    await run(`DELETE FROM challenges WHERE challenger_id = ? OR challenged_id = ?`, [userId, userId]);

    // Battle history - anonymize rather than delete to preserve opponent history
    await run(`UPDATE battles_history SET winner_id = NULL WHERE winner_id = ?`, [userId]);
    await run(`UPDATE battles_history SET loser_id = NULL WHERE loser_id = ?`, [userId]);

    // Rating history
    await run(`DELETE FROM rating_history WHERE user_id = ?`, [userId]);

    // Email preferences and password resets
    await run(`DELETE FROM user_email_preferences WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM email_changes WHERE user_id = ?`, [userId]);
    await run(`DELETE FROM password_resets WHERE user_id = ?`, [userId]);

    // User stats
    await run(`DELETE FROM user_stats WHERE user_id = ?`, [userId]);

    // Finally, delete the user
    await run(`DELETE FROM users WHERE id = ?`, [userId]);

    await run('COMMIT');
    return { success: true };
  } catch (err) {
    try {
      await run('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('[deleteUserAccount] Rollback failed:', rollbackErr.message);
    }
    throw err;
  }
}

async function setUserOnlineStatus(userId, isOnline) {
  const lastSeen = new Date().toISOString();
  return run(
    `UPDATE users SET is_online = ?, last_seen = ? WHERE id = ?`,
    [isOnline ? 1 : 0, lastSeen, userId]
  );
}

async function setUserAdminStatus(userId, isAdmin) {
  // Prevent removing admin from owners (founders)
  if (!isAdmin) {
    try {
      const user = await get('SELECT is_owner FROM users WHERE id = ?', [userId]);
      if (user?.is_owner === 1) {
        throw new Error('Cannot remove admin from owner account');
      }
    } catch (err) {
      // is_owner column may not exist yet (migration pending) - allow the operation
      if (!err.message.includes('no such column')) {
        throw err;
      }
    }
  }
  return run(
    `UPDATE users SET is_admin = ? WHERE id = ?`,
    [isAdmin ? 1 : 0, userId]
  );
}

async function searchUsers(query, excludeUserId = null, limit = 20) {
  const searchTerm = `%${query}%`;
  let sql = `
    SELECT u.id, u.username, u.avatar, u.avatar_url, u.is_online, s.rating, s.wins, s.losses
    FROM users u
    LEFT JOIN user_stats s ON u.id = s.user_id
    WHERE u.username IS NOT NULL
      AND u.email_verified = 1
      AND (u.username LIKE ? OR u.email LIKE ?)
  `;
  const params = [searchTerm, searchTerm];

  if (excludeUserId) {
    sql += ' AND u.id != ?';
    params.push(excludeUserId);
  }

  sql += ' ORDER BY s.rating DESC LIMIT ?';
  params.push(limit);

  return all(sql, params);
}

async function getRecentUsers(limit = 20) {
  return all(`
    SELECT u.id, u.username, u.email, u.avatar, u.avatar_url, u.is_online, u.created_at,
           s.rating, s.wins, s.losses
    FROM users u
    LEFT JOIN user_stats s ON u.id = s.user_id
    WHERE u.username IS NOT NULL
    ORDER BY u.created_at DESC
    LIMIT ?
  `, [limit]);
}

async function getAllUsersForAdmin(limit = 50, filters = {}) {
  let whereClause = 'WHERE u.username IS NOT NULL';
  const params = [];

  // Filter by Pro status
  if (filters.proOnly) {
    whereClause += ' AND u.pro_expires_at > datetime(\'now\')';
  }

  // Filter by Banned status
  if (filters.bannedOnly) {
    whereClause += ' AND u.is_banned = 1';
  }

  // Determine sort order
  let orderClause;
  switch (filters.sortBy) {
    case 'joined_desc':
      orderClause = 'ORDER BY u.created_at DESC';
      break;
    case 'joined_asc':
      orderClause = 'ORDER BY u.created_at ASC';
      break;
    case 'rating_asc':
      orderClause = 'ORDER BY s.rating ASC, u.created_at DESC';
      break;
    case 'rating_desc':
    default:
      orderClause = 'ORDER BY s.rating DESC, u.created_at DESC';
      break;
  }

  params.push(limit);

  return all(`
    SELECT u.id, u.username, u.email, u.avatar, u.is_online, u.created_at,
           u.pro_expires_at, u.is_banned, u.ban_reason, u.banned_until,
           CASE WHEN u.pro_expires_at > datetime('now') THEN 1 ELSE 0 END as is_pro,
           s.rating, s.wins, s.losses
    FROM users u
    LEFT JOIN user_stats s ON u.id = s.user_id
    ${whereClause}
    ${orderClause}
    LIMIT ?
  `, params);
}

async function clearAllReports() {
  return run('DELETE FROM user_reports');
}

// ============================================
// ONBOARDING FUNCTIONS
// ============================================

async function getUserOnboardingStatus(userId) {
  const user = await get('SELECT has_onboarded FROM users WHERE id = ?', [userId]);
  return user?.has_onboarded === 1;
}

async function completeOnboarding(userId) {
  await run('UPDATE users SET has_onboarded = 1 WHERE id = ?', [userId]);
  return { success: true };
}

async function hasSeenPracticeDemo(userId) {
  const user = await get('SELECT practice_demo_shown_at FROM users WHERE id = ?', [userId]);
  return !!user?.practice_demo_shown_at;
}

async function claimPracticeDemo(userId) {
  const shownAt = new Date().toISOString();
  const result = await run(
    `UPDATE users
     SET practice_demo_shown_at = ?
     WHERE id = ? AND practice_demo_shown_at IS NULL`,
    [shownAt, userId]
  );
  const claimed = (result?.changes || 0) > 0;
  return {
    claimed,
    alreadyShown: !claimed,
    practiceDemoShownAt: claimed ? shownAt : (await get('SELECT practice_demo_shown_at FROM users WHERE id = ?', [userId]))?.practice_demo_shown_at || null
  };
}

// ============================================
// PASSWORD RESET FUNCTIONS
// ============================================

async function createPasswordReset(userId, tokenHash, expiresAt) {
  const createdAt = new Date().toISOString();
  const res = await run(
    `INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    [userId, tokenHash, expiresAt, createdAt]
  );
  return { id: res.lastID, user_id: userId, token_hash: tokenHash, expires_at: expiresAt };
}

async function findValidResetByTokenHash(tokenHash) {
  const now = Math.floor(Date.now() / 1000);
  return get(`SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > ?`, [
    tokenHash,
    now
  ]);
}

async function markResetUsed(id) {
  return run(`UPDATE password_resets SET used = 1 WHERE id = ?`, [id]);
}

// ============================================
// EMAIL CHANGE FUNCTIONS
// ============================================

async function createEmailChange(userId, newEmail, tokenHash, expiresAt) {
  const createdAt = new Date().toISOString();
  // Invalidate any pending email changes for this user
  await run(`UPDATE email_changes SET used = 1 WHERE user_id = ? AND used = 0`, [userId]);

  const res = await run(
    `INSERT INTO email_changes (user_id, new_email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    [userId, newEmail, tokenHash, expiresAt, createdAt]
  );
  return { id: res.lastID, user_id: userId, new_email: newEmail };
}

async function findValidEmailChangeByTokenHash(tokenHash) {
  const now = Math.floor(Date.now() / 1000);
  return get(
    `SELECT * FROM email_changes WHERE token_hash = ? AND used = 0 AND expires_at > ?`,
    [tokenHash, now]
  );
}

async function markEmailChangeUsed(id) {
  return run(`UPDATE email_changes SET used = 1 WHERE id = ?`, [id]);
}

async function updateUserEmail(userId, newEmail) {
  return run(`UPDATE users SET email = ? WHERE id = ?`, [newEmail, userId]);
}

async function isEmailAvailable(email, excludeUserId = null) {
  const query = excludeUserId
    ? `SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?`
    : `SELECT id FROM users WHERE LOWER(email) = LOWER(?)`;
  const params = excludeUserId ? [email, excludeUserId] : [email];
  const existing = await get(query, params);
  return !existing;
}

// ============================================
// EMAIL VERIFICATION FUNCTIONS
// ============================================

async function createEmailVerification(userId, tokenHash, expiresAt) {
  const createdAt = new Date().toISOString();
  // Invalidate any pending verifications for this user
  await run(`UPDATE email_verifications SET used = 1 WHERE user_id = ? AND used = 0`, [userId]);

  const res = await run(
    `INSERT INTO email_verifications (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    [userId, tokenHash, expiresAt, createdAt]
  );
  return { id: res.lastID, user_id: userId };
}

async function findValidEmailVerificationByTokenHash(tokenHash) {
  const now = Math.floor(Date.now() / 1000);
  return get(
    `SELECT * FROM email_verifications WHERE token_hash = ? AND used = 0 AND expires_at > ?`,
    [tokenHash, now]
  );
}

async function markEmailVerificationUsed(id) {
  return run(`UPDATE email_verifications SET used = 1 WHERE id = ?`, [id]);
}

async function markUserEmailVerified(userId) {
  return run(`UPDATE users SET email_verified = 1 WHERE id = ?`, [userId]);
}

async function isUserEmailVerified(userId) {
  const user = await get(`SELECT email_verified FROM users WHERE id = ?`, [userId]);
  return user && user.email_verified === 1;
}

// ============================================
// STUDENT VERIFICATION FUNCTIONS
// ============================================

async function ensureStudentVerificationsTable() {
  await run(`CREATE TABLE IF NOT EXISTS student_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    edu_email TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_student_verifications_token_hash ON student_verifications(token_hash)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_student_verifications_user_id ON student_verifications(user_id)`);
}

async function createStudentVerification(userId, eduEmail, tokenHash, expiresAt) {
  await ensureStudentVerificationsTable();
  const createdAt = new Date().toISOString();
  // Invalidate any pending student verifications for this user
  await run(`UPDATE student_verifications SET used = 1 WHERE user_id = ? AND used = 0`, [userId]);

  const res = await run(
    `INSERT INTO student_verifications (user_id, edu_email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    [userId, eduEmail, tokenHash, expiresAt, createdAt]
  );
  return { id: res.lastID, user_id: userId };
}

async function findValidStudentVerificationByTokenHash(tokenHash) {
  await ensureStudentVerificationsTable();
  const now = Math.floor(Date.now() / 1000);
  return get(
    `SELECT * FROM student_verifications WHERE token_hash = ? AND used = 0 AND expires_at > ?`,
    [tokenHash, now]
  );
}

async function markStudentVerificationUsed(id) {
  return run(`UPDATE student_verifications SET used = 1 WHERE id = ?`, [id]);
}

async function markStudentVerified(userId, eduEmail) {
  const now = new Date().toISOString();
  // Update core student verification fields
  await run(
    `UPDATE users SET student_email = ?, student_verified_at = ? WHERE id = ?`,
    [eduEmail, now, userId]
  );
  // Also clear the expiration warning flag (column may not exist yet)
  try {
    await run(`UPDATE users SET student_expiration_warning_sent = NULL WHERE id = ?`, [userId]);
  } catch (e) {
    // Column doesn't exist yet - that's fine
  }
}

async function isStudentVerified(userId) {
  const user = await get(`SELECT student_email, student_verified_at FROM users WHERE id = ?`, [userId]);
  if (!user || !user.student_verified_at) return false;

  // Check if verification is still valid (within 12 months)
  const verifiedAt = new Date(user.student_verified_at);
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  return verifiedAt > oneYearAgo;
}

async function getStudentVerificationStatus(userId) {
  const user = await get(
    `SELECT student_email, student_verified_at, subscription_type FROM users WHERE id = ?`,
    [userId]
  );
  if (!user || !user.student_verified_at) {
    return { verified: false, expired: false, email: null, expiresAt: null, daysUntilExpiry: null };
  }

  const verifiedAt = new Date(user.student_verified_at);
  const now = new Date();

  // Calculate expiration date (12 months from verification)
  const expiresAt = new Date(verifiedAt);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  // Calculate days until expiry (can be negative if expired)
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntilExpiry = Math.ceil((expiresAt - now) / msPerDay);

  const expired = daysUntilExpiry <= 0;

  return {
    verified: true,
    expired,
    email: user.student_email,
    verifiedAt: user.student_verified_at,
    expiresAt: expiresAt.toISOString(),
    daysUntilExpiry,
    subscriptionType: user.subscription_type
  };
}

async function setUserSubscriptionType(userId, subscriptionType) {
  return run(`UPDATE users SET subscription_type = ? WHERE id = ?`, [subscriptionType, userId]);
}

/**
 * Clean up expired student verification tokens to prevent database bloat.
 * Deletes verification records that are:
 * - Expired (expires_at < current time) AND used = 1 (already used)
 * - OR expired more than 7 days ago (even if unused - they're invalid anyway)
 * @returns {Object} { deletedCount: number } - The number of records deleted
 */
async function cleanupExpiredStudentVerifications() {
  const now = Math.floor(Date.now() / 1000);
  const sevenDaysAgo = now - (7 * 24 * 60 * 60);

  const result = await run(
    `DELETE FROM student_verifications
     WHERE (expires_at < ? AND used = 1)
        OR (expires_at < ?)`,
    [now, sevenDaysAgo]
  );

  return { deletedCount: result.changes || 0 };
}

/**
 * Get users whose student verification is expiring within the specified number of days
 * and who haven't already been sent a warning email.
 *
 * @param {number} daysUntilExpiry - Number of days before expiry to warn (default 30)
 * @returns {Array} Users needing expiration warning with their details
 */
async function getUsersNeedingStudentExpirationWarning(daysUntilExpiry = 30) {
  const now = new Date();
  const nowMs = now.getTime();
  const msPerDay = 24 * 60 * 60 * 1000;

  // Calculate the date range for users to warn
  // Users whose verification expires between now and (now + daysUntilExpiry days)
  const expirationWindowEnd = new Date(nowMs + (daysUntilExpiry * msPerDay));

  // We need to find users where:
  // 1. student_verified_at is set (they have verified student status)
  // 2. Their verification hasn't already expired (student_verified_at > 1 year ago)
  // 3. Their verification will expire within daysUntilExpiry days
  // 4. We haven't already sent them a warning (student_expiration_warning_sent is NULL or was sent before current verification)
  // 5. They have an active student subscription

  return all(`
    SELECT
      u.id,
      u.email,
      u.username,
      u.student_email,
      u.student_verified_at,
      u.student_expiration_warning_sent,
      u.subscription_type
    FROM users u
    WHERE u.student_verified_at IS NOT NULL
      AND u.email IS NOT NULL
      AND u.email != ''
      AND u.subscription_type = 'student'
      -- Verification hasn't expired yet (verified within the last year)
      AND datetime(u.student_verified_at) > datetime('now', '-1 year')
      -- Verification will expire within the warning window
      AND datetime(u.student_verified_at, '+1 year') <= datetime('now', '+' || ? || ' days')
      -- Haven't sent a warning for this verification period
      -- (warning_sent is NULL OR warning_sent was before this verification started)
      AND (
        u.student_expiration_warning_sent IS NULL
        OR datetime(u.student_expiration_warning_sent) < datetime(u.student_verified_at)
      )
  `, [daysUntilExpiry]);
}

/**
 * Record that we sent a student expiration warning email to a user
 *
 * @param {number} userId - The user's ID
 * @returns {Object} Run result
 */
async function recordStudentExpirationWarningSent(userId) {
  const now = new Date().toISOString();
  return run(
    `UPDATE users SET student_expiration_warning_sent = ? WHERE id = ?`,
    [now, userId]
  );
}

/**
 * Clear the student expiration warning sent flag (called after successful re-verification)
 * This allows sending a new warning next year
 *
 * @param {number} userId - The user's ID
 * @returns {Object} Run result
 */
async function clearStudentExpirationWarning(userId) {
  return run(
    `UPDATE users SET student_expiration_warning_sent = NULL WHERE id = ?`,
    [userId]
  );
}

// ============================================
// BATTLE HISTORY FUNCTIONS
// ============================================

async function saveBattleResult({
  battleUuid,
  problemId,
  winnerId,
  loserId,
  winnerTime,
  loserTime,
  isTie = false,
  isForfeit = false,
  createdAt: passedCreatedAt = null,
  finishedAt: passedFinishedAt = null,
  winnerLanguage = 'python',
  loserLanguage = 'python',
  isMatchmade = true,
  isPartialCredit = false,
  winnerTestsPassed = null,
  loserTestsPassed = null,
  winnerRatingChange = null,
  loserRatingChange = null,
  winnerCode = null,
  loserCode = null,
  winnerGuestSessionId = null,
  loserGuestSessionId = null
}) {
  const now = new Date().toISOString();
  const createdAt = passedCreatedAt || now;
  const finishedAt = passedFinishedAt || now;

  const res = await run(
    `INSERT INTO battles_history
     (battle_uuid, problem_id, winner_id, loser_id, winner_time, loser_time, is_tie, is_forfeit, created_at, finished_at, winner_language, loser_language, is_matchmade, is_partial_credit, winner_tests_passed, loser_tests_passed, winner_rating_change, loser_rating_change, winner_code, loser_code, winner_guest_session_id, loser_guest_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [battleUuid, problemId, winnerId, loserId, winnerTime, loserTime, isTie ? 1 : 0, isForfeit ? 1 : 0, createdAt, finishedAt, winnerLanguage, loserLanguage, isMatchmade ? 1 : 0, isPartialCredit ? 1 : 0, winnerTestsPassed, loserTestsPassed, winnerRatingChange, loserRatingChange, winnerCode, loserCode, winnerGuestSessionId, loserGuestSessionId]
  );

  return { id: res.lastID, battle_uuid: battleUuid };
}

async function updateBattleRatingChanges(battleUuid, winnerRatingChange, loserRatingChange) {
  return run(
    `UPDATE battles_history SET winner_rating_change = ?, loser_rating_change = ? WHERE battle_uuid = ?`,
    [winnerRatingChange, loserRatingChange, battleUuid]
  );
}

/**
 * Get battle by UUID for replay analysis
 * Returns battle data including player codes if available
 */
async function getBattleByUuid(battleUuid) {
  return get(`
    SELECT
      b.*,
      winner.username as winner_username,
      winner.avatar as winner_avatar,
      loser.username as loser_username,
      loser.avatar as loser_avatar
    FROM battles_history b
    LEFT JOIN users winner ON b.winner_id = winner.id
    LEFT JOIN users loser ON b.loser_id = loser.id
    WHERE b.battle_uuid = ?
  `, [battleUuid]);
}

async function getUserBattleHistory(userId, limit = 20, offset = 0) {
  return all(`
    SELECT
      b.id,
      b.battle_uuid,
      b.problem_id,
      b.winner_id,
      b.loser_id,
      b.winner_time,
      b.loser_time,
      b.is_tie,
      b.is_forfeit,
      b.created_at,
      b.finished_at,
      b.winner_language,
      b.loser_language,
      b.is_matchmade,
      b.is_partial_credit,
      b.winner_tests_passed,
      b.loser_tests_passed,
      b.winner_rating_change,
      b.loser_rating_change,
      winner.username as winner_username,
      winner.avatar as winner_avatar,
      loser.username as loser_username,
      loser.avatar as loser_avatar
    FROM battles_history b
    LEFT JOIN users winner ON b.winner_id = winner.id
    LEFT JOIN users loser ON b.loser_id = loser.id
    WHERE b.winner_id = ? OR b.loser_id = ?
    ORDER BY b.finished_at DESC
    LIMIT ? OFFSET ?
  `, [userId, userId, limit, offset]);
}

async function getUserBattleCount(userId) {
  const result = await get(
    'SELECT COUNT(*) as count FROM battles_history WHERE winner_id = ? OR loser_id = ?',
    [userId, userId]
  );
  return result?.count || 0;
}

/**
 * Get battle history for a guest user by their session ID
 */
async function getGuestBattleHistory(guestSessionId, limit = 20, offset = 0) {
  return all(`
    SELECT
      b.id,
      b.battle_uuid,
      b.problem_id,
      b.winner_id,
      b.loser_id,
      b.winner_time,
      b.loser_time,
      b.is_tie,
      b.is_forfeit,
      b.created_at,
      b.finished_at,
      b.winner_language,
      b.loser_language,
      b.is_matchmade,
      b.is_partial_credit,
      b.winner_tests_passed,
      b.loser_tests_passed,
      b.winner_rating_change,
      b.loser_rating_change,
      winner.username as winner_username,
      winner.avatar as winner_avatar,
      loser.username as loser_username,
      loser.avatar as loser_avatar
    FROM battles_history b
    LEFT JOIN users winner ON b.winner_id = winner.id
    LEFT JOIN users loser ON b.loser_id = loser.id
    WHERE b.winner_guest_session_id = ? OR b.loser_guest_session_id = ?
    ORDER BY b.finished_at DESC
    LIMIT ? OFFSET ?
  `, [guestSessionId, guestSessionId, limit, offset]);
}

// ============================================
// USER STATS FUNCTIONS
// ============================================

async function getUserStats(userId) {
  return get('SELECT * FROM user_stats WHERE user_id = ?', [userId]);
}

async function adjustUserRating(userId, delta) {
  const now = new Date().toISOString();
  const existing = await getUserStats(userId);
  if (!existing) {
    await run(`INSERT INTO user_stats (user_id, updated_at) VALUES (?, ?)`, [userId, now]);
  }
  await run(
    `UPDATE user_stats SET rating = MIN(3500, MAX(100, rating + ?)), updated_at = ? WHERE user_id = ?`,
    [delta, now, userId]
  );
  return get('SELECT rating FROM user_stats WHERE user_id = ?', [userId]);
}

async function updateUserStats(userId, { result, solveTime }) {
  const now = new Date().toISOString();
  const currentStats = await getUserStats(userId);

  if (!currentStats) {
    // Create stats record if doesn't exist
    await run(
      `INSERT INTO user_stats (user_id, updated_at) VALUES (?, ?)`,
      [userId, now]
    );
  }

  let sql = '';
  const params = [];

  if (result === 'win') {
    sql = `
      UPDATE user_stats SET
        wins = wins + 1,
        total_battles = total_battles + 1,
        win_streak = win_streak + 1,
        best_win_streak = MAX(best_win_streak, win_streak + 1),
        avg_solve_time = CASE
          WHEN ? IS NULL THEN avg_solve_time
          WHEN wins = 0 OR avg_solve_time IS NULL THEN ?
          ELSE (avg_solve_time * wins + ?) / (wins + 1)
        END,
        fastest_solve = CASE
          WHEN fastest_solve IS NULL OR ? < fastest_solve THEN ?
          ELSE fastest_solve
        END,
        rating = rating + 25,
        updated_at = ?
      WHERE user_id = ?
    `;
    params.push(solveTime, solveTime, solveTime, solveTime, solveTime, now, userId);
  } else if (result === 'loss') {
    sql = `
      UPDATE user_stats SET
        losses = losses + 1,
        total_battles = total_battles + 1,
        win_streak = 0,
        rating = MAX(rating - 20, 100),
        updated_at = ?
      WHERE user_id = ?
    `;
    params.push(now, userId);
  } else if (result === 'tie') {
    sql = `
      UPDATE user_stats SET
        ties = ties + 1,
        total_battles = total_battles + 1,
        win_streak = 0,
        updated_at = ?
      WHERE user_id = ?
    `;
    params.push(now, userId);
  }

  if (sql) {
    await run(sql, params);
  }
}

/**
 * Update user stats with proper ELO rating calculation
 * @param {number} userId - User ID
 * @param {string} result - 'win', 'loss', or 'tie'
 * @param {number} ratingChange - Pre-calculated rating change from ELO system
 * @param {number} solveTime - Time to solve in seconds (for wins)
 */
async function updateUserStatsWithElo(userId, { result, ratingChange, solveTime }) {
  const now = new Date().toISOString();
  const currentStats = await getUserStats(userId);

  if (!currentStats) {
    await run(
      `INSERT INTO user_stats (user_id, updated_at) VALUES (?, ?)`,
      [userId, now]
    );
  }

  let sql = '';
  const params = [];

  if (result === 'win') {
    sql = `
      UPDATE user_stats SET
        wins = wins + 1,
        total_battles = total_battles + 1,
        win_streak = win_streak + 1,
        best_win_streak = MAX(best_win_streak, win_streak + 1),
        avg_solve_time = CASE
          WHEN ? IS NULL THEN avg_solve_time
          WHEN wins = 0 OR avg_solve_time IS NULL THEN ?
          ELSE (avg_solve_time * wins + ?) / (wins + 1)
        END,
        fastest_solve = CASE
          WHEN fastest_solve IS NULL OR ? < fastest_solve THEN ?
          ELSE fastest_solve
        END,
        rating = MIN(3500, MAX(100, rating + ?)),
        updated_at = ?
      WHERE user_id = ?
    `;
    params.push(solveTime, solveTime, solveTime, solveTime, solveTime, ratingChange, now, userId);
  } else if (result === 'loss') {
    sql = `
      UPDATE user_stats SET
        losses = losses + 1,
        total_battles = total_battles + 1,
        win_streak = 0,
        rating = MIN(3500, MAX(100, rating + ?)),
        updated_at = ?
      WHERE user_id = ?
    `;
    params.push(ratingChange, now, userId);
  } else if (result === 'tie') {
    sql = `
      UPDATE user_stats SET
        ties = ties + 1,
        total_battles = total_battles + 1,
        win_streak = 0,
        rating = MIN(3500, MAX(100, rating + ?)),
        updated_at = ?
      WHERE user_id = ?
    `;
    params.push(ratingChange, now, userId);
  }

  if (sql) {
    await run(sql, params);
    logger.info(`[STATS-DEBUG] DB update executed for userId=${userId}, result=${result}, ratingChange=${ratingChange}`);
  }

  // Return updated stats
  return getUserStats(userId);
}

async function getLeaderboard(limit = 50, offset = 0) {
  return all(`
    SELECT
      u.id, u.username, u.avatar, u.avatar_url, u.is_online,
      s.wins, s.losses, s.ties, s.total_battles, s.rating,
      s.avg_solve_time, s.fastest_solve, s.best_win_streak
    FROM user_stats s
    JOIN users u ON s.user_id = u.id
    WHERE u.username IS NOT NULL AND u.email_verified = 1
    ORDER BY s.rating DESC, s.wins DESC, s.total_battles DESC, u.id ASC
    LIMIT ? OFFSET ?
  `, [limit, offset]);
}

// ============================================
// MESSAGING FUNCTIONS
// ============================================

const MESSAGE_REACTION_EMOJIS = new Set([
  '\uD83D\uDC4D',
  '\u2764\uFE0F',
  '\uD83D\uDE02',
  '\uD83D\uDD25',
  '\uD83D\uDC4F',
  '\uD83D\uDE2E'
]);

function normalizeMessageReaction(emoji) {
  if (typeof emoji !== 'string') return null;
  const normalizedEmoji = emoji.trim();
  return MESSAGE_REACTION_EMOJIS.has(normalizedEmoji) ? normalizedEmoji : null;
}

function mapReactionRows(rows = []) {
  return rows.map(row => {
    // SQLite's json_group_array returns a JSON-encoded string at the driver
    // boundary; parse defensively so a malformed row never crashes the
    // message list. Order matters for the UI tooltip, reactions are listed
    // in the order users reacted, so the first three names are the earliest.
    let users = [];
    if (row.users) {
      try {
        const parsed = typeof row.users === 'string' ? JSON.parse(row.users) : row.users;
        if (Array.isArray(parsed)) {
          users = parsed
            .filter(u => u && (u.id != null || u.username))
            .map(u => ({ id: Number(u.id), username: String(u.username || '') }));
        }
      } catch (_) {
        users = [];
      }
    }
    return {
      emoji: row.emoji,
      count: Number(row.count) || 0,
      reacted_by_me: !!row.reacted_by_me,
      users
    };
  });
}

async function ensureMessageReactionTables() {
  await run(`CREATE TABLE IF NOT EXISTS message_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(message_id, user_id, emoji)
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_message_reactions_user ON message_reactions(user_id)');

  await run(`CREATE TABLE IF NOT EXISTS group_message_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_message_id INTEGER NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(group_message_id, user_id, emoji)
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_group_message_reactions_message ON group_message_reactions(group_message_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_group_message_reactions_user ON group_message_reactions(user_id)');
}

async function getMessageReactions(messageId, viewerId = null) {
  const viewerUserId = Number(viewerId) || 0;
  // json_group_array + json_object lets us return the reactors per emoji as
  // a JSON array in one query. The subquery on the inner SELECT keeps the
  // reactors in chronological order (earliest first), so the UI tooltip
  // reads naturally, "ada, bo, cy reacted with 🔥".
  const rows = await all(`
    SELECT
      mr.emoji,
      COUNT(*) as count,
      MAX(CASE WHEN mr.user_id = ? THEN 1 ELSE 0 END) as reacted_by_me,
      json_group_array(json_object('id', u.id, 'username', u.username)) as users
    FROM (
      SELECT message_id, user_id, emoji, created_at
      FROM message_reactions
      WHERE message_id = ?
      ORDER BY created_at ASC
    ) mr
    JOIN users u ON u.id = mr.user_id
    GROUP BY mr.emoji
    ORDER BY MIN(mr.created_at) ASC
  `, [viewerUserId, messageId]);
  return mapReactionRows(rows);
}

async function getGroupMessageReactions(messageId, viewerId = null) {
  const viewerUserId = Number(viewerId) || 0;
  const rows = await all(`
    SELECT
      gmr.emoji,
      COUNT(*) as count,
      MAX(CASE WHEN gmr.user_id = ? THEN 1 ELSE 0 END) as reacted_by_me,
      json_group_array(json_object('id', u.id, 'username', u.username)) as users
    FROM (
      SELECT group_message_id, user_id, emoji, created_at
      FROM group_message_reactions
      WHERE group_message_id = ?
      ORDER BY created_at ASC
    ) gmr
    JOIN users u ON u.id = gmr.user_id
    GROUP BY gmr.emoji
    ORDER BY MIN(gmr.created_at) ASC
  `, [viewerUserId, messageId]);
  return mapReactionRows(rows);
}

async function attachMessageReactions(messages, viewerId) {
  return Promise.all((messages || []).map(async message => ({
    ...message,
    reactions: await getMessageReactions(message.id, viewerId)
  })));
}

async function attachGroupMessageReactions(messages, viewerId) {
  return Promise.all((messages || []).map(async message => ({
    ...message,
    reactions: await getGroupMessageReactions(message.id, viewerId)
  })));
}

async function createMessage(senderId, receiverId, content) {
  const createdAt = new Date().toISOString();

  const res = await run(
    `INSERT INTO messages (sender_id, receiver_id, content, created_at) VALUES (?, ?, ?, ?)`,
    [senderId, receiverId, content, createdAt]
  );

  // Update or create conversation
  const [user1Id, user2Id] = senderId < receiverId ? [senderId, receiverId] : [receiverId, senderId];

  await run(`
    INSERT INTO conversations (user1_id, user2_id, last_message_id, last_activity)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user1_id, user2_id) DO UPDATE SET
      last_message_id = excluded.last_message_id,
      last_activity = excluded.last_activity
  `, [user1Id, user2Id, res.lastID, createdAt]);

  return {
    id: res.lastID,
    sender_id: senderId,
    receiver_id: receiverId,
    content,
    created_at: createdAt,
    read_at: null,
    reactions: []
  };
}

async function getConversationMessages(user1Id, user2Id, limit = 50, offset = 0, beforeId = null) {
  const params = [user1Id, user2Id, user2Id, user1Id];
  let beforeClause = '';
  if (beforeId) {
    beforeClause = 'AND m.id < ?';
    params.push(beforeId);
  }
  params.push(limit, offset);
  const messages = await all(`
    SELECT m.*,
      sender.username as sender_username,
      sender.avatar as sender_avatar,
      sender.avatar_url as sender_avatar_url
    FROM messages m
    JOIN users sender ON m.sender_id = sender.id
    WHERE ((m.sender_id = ? AND m.receiver_id = ?)
       OR (m.sender_id = ? AND m.receiver_id = ?))
    ${beforeClause}
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `, params);
  return attachMessageReactions(messages, user1Id);
}

async function getUserConversations(userId, limit = 50, offset = 0) {
  return all(`
    SELECT
      c.*,
      CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END as other_user_id,
      u.username as other_username,
      u.avatar as other_avatar,
      u.avatar_url as other_avatar_url,
      u.is_online as other_online,
      u.last_seen as other_last_seen,
      m.content as last_message_content,
      m.sender_id as last_message_sender_id,
      m.created_at as last_message_time,
      (SELECT COUNT(*) FROM messages
       WHERE receiver_id = ?
         AND sender_id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END
         AND read_at IS NULL) as unread_count
    FROM conversations c
    JOIN users u ON u.id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END
    LEFT JOIN messages m ON m.id = c.last_message_id
    WHERE c.user1_id = ? OR c.user2_id = ?
    ORDER BY c.last_activity DESC
    LIMIT ? OFFSET ?
  `, [userId, userId, userId, userId, userId, userId, limit, offset]);
}

async function markMessagesAsRead(userId, fromUserId) {
  const readAt = new Date().toISOString();
  return run(
    `UPDATE messages SET read_at = ? WHERE receiver_id = ? AND sender_id = ? AND read_at IS NULL`,
    [readAt, userId, fromUserId]
  );
}

async function getUnreadMessageCount(userId) {
  const result = await get(
    'SELECT COUNT(*) as count FROM messages WHERE receiver_id = ? AND read_at IS NULL',
    [userId]
  );
  return result?.count || 0;
}

async function getMessageById(id) {
  return get('SELECT * FROM messages WHERE id = ?', [id]);
}

async function toggleMessageReaction(messageId, userId, emoji) {
  const messageIdNum = parseInt(messageId, 10);
  const userIdNum = parseInt(userId, 10);
  const normalizedEmoji = normalizeMessageReaction(emoji);

  if (isNaN(messageIdNum) || messageIdNum <= 0) {
    return { success: false, error: 'Invalid message ID' };
  }
  if (isNaN(userIdNum) || userIdNum <= 0) {
    return { success: false, error: 'Invalid user ID' };
  }
  if (!normalizedEmoji) {
    return { success: false, error: 'Invalid reaction' };
  }

  const message = await getMessageById(messageIdNum);
  if (!message) {
    return { success: false, error: 'Message not found' };
  }
  if (message.sender_id !== userIdNum && message.receiver_id !== userIdNum) {
    return { success: false, error: 'You can only react to messages in your conversations' };
  }

  const existing = await get(
    'SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
    [messageIdNum, userIdNum, normalizedEmoji]
  );

  let action = 'added';
  if (existing) {
    await run('DELETE FROM message_reactions WHERE id = ?', [existing.id]);
    action = 'removed';
  } else {
    await run(
      'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)',
      [messageIdNum, userIdNum, normalizedEmoji, new Date().toISOString()]
    );
  }

  return {
    success: true,
    action,
    emoji: normalizedEmoji,
    message,
    reactions: await getMessageReactions(messageIdNum)
  };
}

// Update a message (only within 1 hour of sending, only by sender)
async function updateMessage(messageId, senderId, newContent) {
  const message = await getMessageById(messageId);

  if (!message) {
    return { success: false, error: 'Message not found' };
  }

  if (message.sender_id !== senderId) {
    return { success: false, error: 'You can only edit your own messages' };
  }

  // Check if within 15 minutes (like WhatsApp)
  const createdAt = new Date(message.created_at);
  const now = new Date();
  const fifteenMinInMs = 15 * 60 * 1000;

  if (now - createdAt > fifteenMinInMs) {
    return { success: false, error: 'Messages can only be edited within 15 minutes of sending' };
  }

  const editedAt = new Date().toISOString();

  await run(
    'UPDATE messages SET content = ?, edited_at = ? WHERE id = ?',
    [newContent, editedAt, messageId]
  );

  return {
    success: true,
    message: {
      ...message,
      content: newContent,
      edited_at: editedAt
    }
  };
}

// Hard-delete a message (sender only). Removes the row and its reactions
// entirely, no trace is kept, and repoints the conversation's last message.
async function deleteMessage(messageId, senderId) {
  const messageIdNum = parseInt(messageId, 10);
  const senderIdNum = parseInt(senderId, 10);

  if (isNaN(messageIdNum) || messageIdNum <= 0) {
    return { success: false, error: 'Invalid message ID' };
  }

  const message = await getMessageById(messageIdNum);
  if (!message) {
    return { success: false, error: 'Message not found' };
  }
  if (message.sender_id !== senderIdNum) {
    return { success: false, error: 'You can only delete your own messages' };
  }

  const a = message.sender_id;
  const b = message.receiver_id;

  // Delete + repoint atomically so a concurrent send can't be clobbered and a
  // crash can't leave conversations.last_message_id dangling.
  const lastMessage = await withTransaction(async () => {
    await run('DELETE FROM message_reactions WHERE message_id = ?', [messageIdNum]);
    await run('DELETE FROM messages WHERE id = ?', [messageIdNum]);

    // Repoint the conversation's last message to the newest remaining one (or none).
    const latest = await get(
      `SELECT id, content, sender_id, created_at FROM messages
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [a, b, b, a]
    );
    if (latest) {
      await run(
        `UPDATE conversations SET last_message_id = ?, last_activity = ?
         WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)`,
        [latest.id, latest.created_at, a, b, b, a]
      );
    } else {
      await run(
        `UPDATE conversations SET last_message_id = NULL
         WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)`,
        [a, b, b, a]
      );
    }
    return latest || null;
  });

  return {
    success: true,
    message: { id: messageIdNum, sender_id: a, receiver_id: b },
    lastMessage
  };
}

// ============================================
// GROUP CHAT FUNCTIONS
// ============================================

async function createGroupConversation(name, creatorId, memberIds = []) {
  const createdAt = new Date().toISOString();

  // Create the group
  const res = await run(
    `INSERT INTO group_conversations (name, creator_id, created_at, last_activity)
     VALUES (?, ?, ?, ?)`,
    [name, creatorId, createdAt, createdAt]
  );

  const groupId = res.lastID;

  // Add creator as admin
  await run(
    `INSERT INTO group_members (group_id, user_id, role, joined_at)
     VALUES (?, ?, 'admin', ?)`,
    [groupId, creatorId, createdAt]
  );

  // Add other members
  for (const memberId of memberIds) {
    if (memberId !== creatorId) {
      await run(
        `INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at)
         VALUES (?, ?, 'member', ?)`,
        [groupId, memberId, createdAt]
      );
    }
  }

  return {
    id: groupId,
    name,
    creator_id: creatorId,
    avatar: '👥',
    created_at: createdAt,
    last_activity: createdAt
  };
}

async function getGroupById(groupId) {
  return get('SELECT * FROM group_conversations WHERE id = ?', [groupId]);
}

async function getGroupMembers(groupId) {
  return all(
    `SELECT gm.*, u.username, u.avatar, u.avatar_url, u.is_online
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ?
     ORDER BY gm.role DESC, gm.joined_at ASC`,
    [groupId]
  );
}

async function isGroupMember(groupId, userId) {
  const member = await get(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId]
  );
  return !!member;
}

async function isGroupAdmin(groupId, userId) {
  const member = await get(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ? AND role = ?',
    [groupId, userId, 'admin']
  );
  return !!member;
}

async function addGroupMember(groupId, userId, role = 'member') {
  const joinedAt = new Date().toISOString();
  try {
    await run(
      `INSERT INTO group_members (group_id, user_id, role, joined_at)
       VALUES (?, ?, ?, ?)`,
      [groupId, userId, role, joinedAt]
    );
    return { success: true };
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return { success: false, error: 'User is already a member' };
    }
    throw err;
  }
}

async function removeGroupMember(groupId, userId) {
  await run(
    'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId]
  );
  return { success: true };
}

async function leaveGroup(groupId, userId) {
  // Check if user is the only admin
  const admins = await all(
    'SELECT user_id FROM group_members WHERE group_id = ? AND role = ?',
    [groupId, 'admin']
  );

  const isAdmin = admins.some(a => a.user_id === userId);

  if (isAdmin && admins.length === 1) {
    // Promote another member to admin or delete group if empty
    const otherMembers = await all(
      'SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?',
      [groupId, userId]
    );

    if (otherMembers.length > 0) {
      // Promote first member to admin
      await run(
        'UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?',
        ['admin', groupId, otherMembers[0].user_id]
      );
    } else {
      // Delete the group if no other members
      await run('DELETE FROM group_conversations WHERE id = ?', [groupId]);
      return { success: true, groupDeleted: true };
    }
  }

  await removeGroupMember(groupId, userId);
  return { success: true };
}

async function updateGroupName(groupId, name) {
  await run(
    'UPDATE group_conversations SET name = ? WHERE id = ?',
    [name, groupId]
  );
  return { success: true };
}

async function deleteGroup(groupId, userId) {
  // Only creator can delete the group
  const group = await get('SELECT creator_id FROM group_conversations WHERE id = ?', [groupId]);
  if (!group) {
    throw new Error('Group not found');
  }
  if (group.creator_id !== userId) {
    throw new Error('Only the group creator can delete the group');
  }

  // Use transaction to ensure all-or-nothing deletion
  return withTransaction(async () => {
    await run(
      'DELETE FROM group_message_reactions WHERE group_message_id IN (SELECT id FROM group_messages WHERE group_id = ?)',
      [groupId]
    );
    // Delete all group messages first (due to foreign key)
    await run('DELETE FROM group_messages WHERE group_id = ?', [groupId]);
    // Delete all group members
    await run('DELETE FROM group_members WHERE group_id = ?', [groupId]);
    // Delete the group itself
    await run('DELETE FROM group_conversations WHERE id = ?', [groupId]);

    return { success: true };
  });
}

async function getGroupConversations(userId) {
  return all(
    `SELECT gc.*,
            (SELECT COUNT(*) FROM group_members WHERE group_id = gc.id) as member_count,
            (SELECT content FROM group_messages WHERE group_id = gc.id ORDER BY created_at DESC LIMIT 1) as last_message_content,
            (SELECT sender_id FROM group_messages WHERE group_id = gc.id ORDER BY created_at DESC LIMIT 1) as last_message_sender_id,
            (SELECT u.username FROM group_messages gm JOIN users u ON u.id = gm.sender_id WHERE gm.group_id = gc.id ORDER BY gm.created_at DESC LIMIT 1) as last_message_sender_username
     FROM group_conversations gc
     JOIN group_members gm ON gm.group_id = gc.id
     WHERE gm.user_id = ?
     ORDER BY gc.last_activity DESC`,
    [userId]
  );
}

async function createGroupMessage(groupId, senderId, content) {
  const createdAt = new Date().toISOString();

  const res = await run(
    `INSERT INTO group_messages (group_id, sender_id, content, created_at)
     VALUES (?, ?, ?, ?)`,
    [groupId, senderId, content, createdAt]
  );

  // Update last activity
  await run(
    'UPDATE group_conversations SET last_message_id = ?, last_activity = ? WHERE id = ?',
    [res.lastID, createdAt, groupId]
  );

  return {
    id: res.lastID,
    group_id: groupId,
    sender_id: senderId,
    content,
    created_at: createdAt,
    edited_at: null,
    reactions: []
  };
}

async function getGroupMessages(groupId, limit = 50, offset = 0, viewerId = null) {
  const messages = await all(
    `SELECT gm.*, u.username as sender_username, u.avatar as sender_avatar, u.avatar_url as sender_avatar_url
     FROM group_messages gm
     JOIN users u ON u.id = gm.sender_id
     WHERE gm.group_id = ?
     ORDER BY gm.created_at DESC
     LIMIT ? OFFSET ?`,
    [groupId, limit, offset]
  );
  return attachGroupMessageReactions(messages, viewerId);
}

async function getGroupMessageById(messageId) {
  return get('SELECT * FROM group_messages WHERE id = ?', [messageId]);
}

async function toggleGroupMessageReaction(messageId, userId, emoji) {
  const messageIdNum = parseInt(messageId, 10);
  const userIdNum = parseInt(userId, 10);
  const normalizedEmoji = normalizeMessageReaction(emoji);

  if (isNaN(messageIdNum) || messageIdNum <= 0) {
    return { success: false, error: 'Invalid message ID' };
  }
  if (isNaN(userIdNum) || userIdNum <= 0) {
    return { success: false, error: 'Invalid user ID' };
  }
  if (!normalizedEmoji) {
    return { success: false, error: 'Invalid reaction' };
  }

  const message = await getGroupMessageById(messageIdNum);
  if (!message) {
    return { success: false, error: 'Message not found' };
  }

  const isMember = await isGroupMember(message.group_id, userIdNum);
  if (!isMember) {
    return { success: false, error: 'You are not a member of this group' };
  }

  const existing = await get(
    'SELECT id FROM group_message_reactions WHERE group_message_id = ? AND user_id = ? AND emoji = ?',
    [messageIdNum, userIdNum, normalizedEmoji]
  );

  let action = 'added';
  if (existing) {
    await run('DELETE FROM group_message_reactions WHERE id = ?', [existing.id]);
    action = 'removed';
  } else {
    await run(
      'INSERT INTO group_message_reactions (group_message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)',
      [messageIdNum, userIdNum, normalizedEmoji, new Date().toISOString()]
    );
  }

  return {
    success: true,
    action,
    emoji: normalizedEmoji,
    message,
    reactions: await getGroupMessageReactions(messageIdNum)
  };
}

async function updateGroupMessage(messageId, senderId, newContent, groupId) {
  const message = await getGroupMessageById(messageId);

  if (!message) {
    return { success: false, error: 'Message not found' };
  }

  // The message must belong to the group in the request path. Without this, a member of group X
  // could edit their own message from a DIFFERENT group Y by calling the edit route with groupId=X
  // and a Y messageId (the membership check passes for X, the sender check passes for their own
  // message). Mirrors the deleteGroupMessage guard.
  if (message.group_id !== groupId) {
    return { success: false, error: 'Message not found' };
  }

  if (message.sender_id !== senderId) {
    return { success: false, error: 'You can only edit your own messages' };
  }

  // Check if within 15 minutes (like WhatsApp)
  const createdAt = new Date(message.created_at);
  const now = new Date();
  const fifteenMinInMs = 15 * 60 * 1000;

  if (now - createdAt > fifteenMinInMs) {
    return { success: false, error: 'Messages can only be edited within 15 minutes of sending' };
  }

  const editedAt = new Date().toISOString();

  await run(
    'UPDATE group_messages SET content = ?, edited_at = ? WHERE id = ?',
    [newContent, editedAt, messageId]
  );

  return {
    success: true,
    message: {
      ...message,
      content: newContent,
      edited_at: editedAt
    }
  };
}

// Hard-delete a group message (sender only). Removes the row and its reactions
// entirely, no trace is kept, and repoints the group's last message.
async function deleteGroupMessage(messageId, senderId) {
  const messageIdNum = parseInt(messageId, 10);
  const senderIdNum = parseInt(senderId, 10);

  if (isNaN(messageIdNum) || messageIdNum <= 0) {
    return { success: false, error: 'Invalid message ID' };
  }

  const message = await getGroupMessageById(messageIdNum);
  if (!message) {
    return { success: false, error: 'Message not found' };
  }
  if (message.sender_id !== senderIdNum) {
    return { success: false, error: 'You can only delete your own messages' };
  }

  const groupId = message.group_id;

  // Must still be a member to delete (matches every other group operation).
  const isMember = await isGroupMember(groupId, senderIdNum);
  if (!isMember) {
    return { success: false, error: 'You are not a member of this group' };
  }

  // Delete + repoint atomically (see deleteMessage).
  const lastMessage = await withTransaction(async () => {
    await run('DELETE FROM group_message_reactions WHERE group_message_id = ?', [messageIdNum]);
    await run('DELETE FROM group_messages WHERE id = ?', [messageIdNum]);

    // Repoint the group's last message to the newest remaining one (or none).
    // LEFT JOIN so a message whose author deleted their account isn't silently
    // dropped from the recompute (which would repoint to an older message).
    const latest = await get(
      `SELECT gm.id, gm.content, gm.sender_id, gm.created_at, u.username as sender_username
       FROM group_messages gm LEFT JOIN users u ON u.id = gm.sender_id
       WHERE gm.group_id = ? ORDER BY gm.created_at DESC, gm.id DESC LIMIT 1`,
      [groupId]
    );
    if (latest) {
      await run(
        'UPDATE group_conversations SET last_message_id = ?, last_activity = ? WHERE id = ?',
        [latest.id, latest.created_at, groupId]
      );
    } else {
      await run('UPDATE group_conversations SET last_message_id = NULL WHERE id = ?', [groupId]);
    }
    return latest || null;
  });

  return {
    success: true,
    message: { id: messageIdNum, group_id: groupId },
    lastMessage
  };
}

// ============================================
// CHALLENGE FUNCTIONS
// ============================================

async function createChallenge(challengerId, challengedId, expiresInSeconds = 60) {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  const res = await run(
    `INSERT INTO challenges (challenger_id, challenged_id, status, created_at, expires_at)
     VALUES (?, ?, 'pending', ?, ?)`,
    [challengerId, challengedId, createdAt, expiresAt]
  );

  return {
    id: res.lastID,
    challenger_id: challengerId,
    challenged_id: challengedId,
    status: 'pending',
    created_at: createdAt,
    expires_at: expiresAt
  };
}

async function getChallengeById(id) {
  return get(`
    SELECT c.*,
      challenger.username as challenger_username,
      challenger.avatar as challenger_avatar,
      challenger.avatar_url as challenger_avatar_url,
      challenged.username as challenged_username,
      challenged.avatar as challenged_avatar,
      challenged.avatar_url as challenged_avatar_url
    FROM challenges c
    JOIN users challenger ON c.challenger_id = challenger.id
    JOIN users challenged ON c.challenged_id = challenged.id
    WHERE c.id = ?
  `, [id]);
}

async function getPendingChallengeForUser(userId) {
  const now = new Date().toISOString();
  return get(`
    SELECT c.*,
      challenger.username as challenger_username,
      challenger.avatar as challenger_avatar,
      challenger.avatar_url as challenger_avatar_url,
      s.rating as challenger_rating,
      s.wins as challenger_wins,
      s.losses as challenger_losses
    FROM challenges c
    JOIN users challenger ON c.challenger_id = challenger.id
    LEFT JOIN user_stats s ON challenger.id = s.user_id
    WHERE c.challenged_id = ?
      AND c.status = 'pending'
      AND c.expires_at > ?
    ORDER BY c.created_at DESC
    LIMIT 1
  `, [userId, now]);
}

async function updateChallengeStatus(id, status, battleUuid = null) {
  const respondedAt = new Date().toISOString();
  // M7 fix: when accepting a challenge, require the row to still be 'pending'
  // so two simultaneous accepts (or an accept racing with a cancel/decline/expire)
  // cannot both succeed. Other status transitions keep the old unconditional
  // behavior to preserve compatibility with cancel/decline/expire callers.
  let result;
  if (status === 'accepted') {
    result = await run(
      `UPDATE challenges SET status = ?, battle_uuid = ?, responded_at = ? WHERE id = ? AND status = 'pending'`,
      [status, battleUuid, respondedAt, id]
    );
  } else {
    result = await run(
      `UPDATE challenges SET status = ?, battle_uuid = ?, responded_at = ? WHERE id = ?`,
      [status, battleUuid, respondedAt, id]
    );
  }
  // `run` resolves to the sqlite3 statement context, which carries `.changes`.
  // Return a small wrapper so call sites can detect the lost race.
  return { changed: (result?.changes || 0) > 0, changes: result?.changes || 0 };
}

async function expirePendingChallenges() {
  const now = new Date().toISOString();
  return run(
    `UPDATE challenges SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`,
    [now]
  );
}

async function hasPendingChallengeBetween(user1Id, user2Id) {
  const now = new Date().toISOString();
  const challenge = await get(`
    SELECT id FROM challenges
    WHERE status = 'pending'
      AND expires_at > ?
      AND ((challenger_id = ? AND challenged_id = ?) OR (challenger_id = ? AND challenged_id = ?))
  `, [now, user1Id, user2Id, user2Id, user1Id]);
  return !!challenge;
}

// ============================================
// BATTLE INVITE FUNCTIONS
// ============================================

function generateBattleInviteCode() {
  // Generate a short, URL-safe invite code (8 chars)
  // Uses uppercase + digits only for easier sharing (no confusing chars like 0/O, 1/I/L)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function createBattleInvite(battleId, inviterId) {
  const createdAt = new Date().toISOString();
  // 30 minute expiration
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const inviteCode = generateBattleInviteCode();

  const res = await run(
    `INSERT INTO battle_invites (battle_id, invite_code, inviter_id, status, created_at, expires_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
    [battleId, inviteCode, inviterId, createdAt, expiresAt]
  );

  return {
    id: res.lastID,
    battle_id: battleId,
    invite_code: inviteCode,
    inviter_id: inviterId,
    status: 'pending',
    created_at: createdAt,
    expires_at: expiresAt
  };
}

async function getBattleInviteByCode(inviteCode) {
  return get(`
    SELECT bi.*,
      inviter.username as inviter_username,
      inviter.avatar as inviter_avatar,
      inviter.avatar_url as inviter_avatar_url
    FROM battle_invites bi
    JOIN users inviter ON bi.inviter_id = inviter.id
    WHERE bi.invite_code = ?
  `, [inviteCode]);
}

async function markBattleInviteUsed(inviteCode, usedById) {
  const usedAt = new Date().toISOString();
  return run(
    `UPDATE battle_invites SET status = 'used', used_by_id = ?, used_at = ? WHERE invite_code = ?`,
    [usedById, usedAt, inviteCode]
  );
}

/**
 * Atomically claim a battle invite - only succeeds if invite is still pending.
 * Returns { success: true } if claimed, { success: false } if already used/expired.
 * This prevents race conditions where two users click join simultaneously.
 */
async function atomicClaimBattleInvite(inviteCode, usedById) {
  const usedAt = new Date().toISOString();
  const now = new Date().toISOString();

  // Only update if status is 'pending' AND not expired - this is atomic
  const result = await run(
    `UPDATE battle_invites
     SET status = 'used', used_by_id = ?, used_at = ?
     WHERE invite_code = ? AND status = 'pending' AND expires_at > ?`,
    [usedById, usedAt, inviteCode, now]
  );

  // Check if the update affected any rows
  return { success: result.changes > 0 };
}

async function expireBattleInvite(inviteCode) {
  return run(
    `UPDATE battle_invites SET status = 'expired' WHERE invite_code = ?`,
    [inviteCode]
  );
}

async function expireBattleInvitesByBattleId(battleId) {
  return run(
    `UPDATE battle_invites SET status = 'expired' WHERE battle_id = ? AND status = 'pending'`,
    [battleId]
  );
}

async function getActiveBattleInviteForBattle(battleId) {
  const now = new Date().toISOString();
  return get(`
    SELECT * FROM battle_invites
    WHERE battle_id = ?
      AND status = 'pending'
      AND expires_at > ?
    ORDER BY created_at DESC
    LIMIT 1
  `, [battleId, now]);
}

// ============================================
// FRIEND FUNCTIONS
// ============================================

async function sendFriendRequest(requesterId, requestedId) {
  // Check if they're already friends
  const existingFriendship = await areFriends(requesterId, requestedId);
  if (existingFriendship) {
    throw new Error('Already friends');
  }

  // Check for existing pending request in either direction
  const existingRequest = await get(`
    SELECT * FROM friend_requests
    WHERE status = 'pending'
      AND ((requester_id = ? AND requested_id = ?) OR (requester_id = ? AND requested_id = ?))
  `, [requesterId, requestedId, requestedId, requesterId]);

  if (existingRequest) {
    if (existingRequest.requester_id === requesterId) {
      throw new Error('Friend request already sent');
    } else {
      throw new Error('This user has already sent you a friend request');
    }
  }

  // Remove any old cancelled/declined requests so the unique constraint doesn't block re-sending
  await run(
    `DELETE FROM friend_requests WHERE requester_id = ? AND requested_id = ? AND status IN ('cancelled', 'declined')`,
    [requesterId, requestedId]
  );

  const createdAt = new Date().toISOString();
  const res = await run(
    `INSERT INTO friend_requests (requester_id, requested_id, status, created_at) VALUES (?, ?, 'pending', ?)`,
    [requesterId, requestedId, createdAt]
  );

  return {
    id: res.lastID,
    requester_id: requesterId,
    requested_id: requestedId,
    status: 'pending',
    created_at: createdAt
  };
}

async function getPendingFriendRequests(userId) {
  return all(`
    SELECT fr.*,
      u.id as requester_user_id,
      u.username as requester_username,
      u.avatar as requester_avatar,
      u.avatar_url as requester_avatar_url,
      u.is_online as requester_online,
      s.rating as requester_rating,
      s.wins as requester_wins,
      s.losses as requester_losses
    FROM friend_requests fr
    JOIN users u ON fr.requester_id = u.id
    LEFT JOIN user_stats s ON u.id = s.user_id
    WHERE fr.requested_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
  `, [userId]);
}

async function getSentFriendRequests(userId) {
  return all(`
    SELECT fr.*,
      u.id as requested_user_id,
      u.username as requested_username,
      u.avatar as requested_avatar,
      u.avatar_url as requested_avatar_url,
      u.is_online as requested_online,
      s.rating as requested_rating,
      s.wins as requested_wins,
      s.losses as requested_losses
    FROM friend_requests fr
    JOIN users u ON fr.requested_id = u.id
    LEFT JOIN user_stats s ON u.id = s.user_id
    WHERE fr.requester_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
  `, [userId]);
}

async function getFriendRequestBetweenUsers(userId, otherUserId) {
  return get(`
    SELECT id FROM friend_requests
    WHERE status = 'pending'
      AND ((requester_id = ? AND requested_id = ?) OR (requester_id = ? AND requested_id = ?))
  `, [userId, otherUserId, otherUserId, userId]);
}

async function getFriendRequestById(requestId) {
  return get(`
    SELECT fr.*,
      requester.username as requester_username,
      requester.avatar as requester_avatar,
      requester.avatar_url as requester_avatar_url,
      requested.username as requested_username,
      requested.avatar as requested_avatar,
      requested.avatar_url as requested_avatar_url
    FROM friend_requests fr
    JOIN users requester ON fr.requester_id = requester.id
    JOIN users requested ON fr.requested_id = requested.id
    WHERE fr.id = ?
  `, [requestId]);
}

async function acceptFriendRequest(requestId, userId) {
  const request = await getFriendRequestById(requestId);

  if (!request) {
    throw new Error('Friend request not found');
  }

  if (request.requested_id !== userId) {
    throw new Error('Not authorized to accept this request');
  }

  if (request.status !== 'pending') {
    throw new Error('Request is no longer pending');
  }

  // A block in either direction must defeat a pending request. The send paths already check
  // isBlockedEitherWay, but a request created BEFORE a block could otherwise still be accepted
  // into a friendship, silently circumventing the block. Cancel the stale request instead.
  if (await isBlockedEitherWay(request.requester_id, request.requested_id)) {
    await run(
      `UPDATE friend_requests SET status = 'cancelled', responded_at = ? WHERE id = ?`,
      [new Date().toISOString(), requestId]
    );
    throw new Error('Request is no longer pending');
  }

  const respondedAt = new Date().toISOString();

  // Update request status
  await run(
    `UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?`,
    [respondedAt, requestId]
  );

  // Create friendship (ensure user1_id < user2_id for consistency)
  const [user1Id, user2Id] = request.requester_id < request.requested_id
    ? [request.requester_id, request.requested_id]
    : [request.requested_id, request.requester_id];

  // OR IGNORE so two concurrent accepts (double-click / two tabs) don't throw on the
  // UNIQUE(user1_id,user2_id) constraint: both pass the 'pending' check before either UPDATEs,
  // so the second INSERT would otherwise surface a confusing 400 even though they are now friends.
  await run(
    `INSERT OR IGNORE INTO friendships (user1_id, user2_id, created_at) VALUES (?, ?, ?)`,
    [user1Id, user2Id, respondedAt]
  );

  return {
    friendshipCreated: true,
    requesterId: request.requester_id,
    friend: {
      id: request.requester_id,
      username: request.requester_username,
      avatar: request.requester_avatar,
      avatar_url: request.requester_avatar_url
    }
  };
}

async function declineFriendRequest(requestId, userId) {
  const request = await getFriendRequestById(requestId);

  if (!request) {
    throw new Error('Friend request not found');
  }

  if (request.requested_id !== userId) {
    throw new Error('Not authorized to decline this request');
  }

  if (request.status !== 'pending') {
    throw new Error('Request is no longer pending');
  }

  const respondedAt = new Date().toISOString();
  await run(
    `UPDATE friend_requests SET status = 'declined', responded_at = ? WHERE id = ?`,
    [respondedAt, requestId]
  );

  return { declined: true, requesterId: request.requester_id };
}

async function cancelFriendRequest(requestId, userId) {
  const request = await getFriendRequestById(requestId);

  if (!request) {
    throw new Error('Friend request not found');
  }

  if (request.requester_id !== userId) {
    throw new Error('Not authorized to cancel this request');
  }

  if (request.status !== 'pending') {
    throw new Error('Request is no longer pending');
  }

  const respondedAt = new Date().toISOString();
  await run(
    `UPDATE friend_requests SET status = 'cancelled', responded_at = ? WHERE id = ?`,
    [respondedAt, requestId]
  );

  return { cancelled: true, requestedId: request.requested_id };
}

async function getUserFriends(userId, limit = 50, offset = 0) {
  return all(`
    SELECT
      CASE WHEN f.user1_id = ? THEN f.user2_id ELSE f.user1_id END as id,
      u.username,
      u.avatar,
      u.avatar_url,
      u.is_online,
      u.last_seen,
      s.rating,
      s.wins,
      s.losses,
      f.created_at as friends_since
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.user1_id = ? THEN f.user2_id ELSE f.user1_id END
    LEFT JOIN user_stats s ON u.id = s.user_id
    WHERE f.user1_id = ? OR f.user2_id = ?
    ORDER BY u.is_online DESC, u.username ASC
    LIMIT ? OFFSET ?
  `, [userId, userId, userId, userId, limit, offset]);
}

async function getFriendCount(userId) {
  const result = await get(
    'SELECT COUNT(*) as count FROM friendships WHERE user1_id = ? OR user2_id = ?',
    [userId, userId]
  );
  return result?.count || 0;
}

async function areFriends(user1Id, user2Id) {
  const [smallerId, largerId] = user1Id < user2Id ? [user1Id, user2Id] : [user2Id, user1Id];
  const friendship = await get(
    'SELECT id FROM friendships WHERE user1_id = ? AND user2_id = ?',
    [smallerId, largerId]
  );
  return !!friendship;
}

async function getGroupMemberValidationDetails(creatorId, memberIds = []) {
  const normalizedIds = [...new Set(
    memberIds
      .map(id => parseInt(id, 10))
      .filter(id => !isNaN(id) && id > 0 && id !== creatorId)
  )];

  if (normalizedIds.length === 0) {
    return [];
  }

  const placeholders = normalizedIds.map(() => '?').join(',');

  return all(`
    SELECT
      u.id,
      u.username,
      CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_friend
    FROM users u
    LEFT JOIN friendships f
      ON (
        (f.user1_id = ? AND f.user2_id = u.id)
        OR (f.user2_id = ? AND f.user1_id = u.id)
      )
    WHERE u.id IN (${placeholders})
  `, [creatorId, creatorId, ...normalizedIds]);
}

/**
 * Get online users for battle invite
 * Returns users sorted by: friends first, then by username
 * Includes is_friend flag for each user
 */
async function getOnlineUsers(currentUserId, search = '', limit = 20) {
  const searchPattern = search ? `%${search}%` : '%';

  return all(`
    SELECT
      u.id,
      u.username,
      u.avatar,
      u.is_online,
      s.rating,
      s.wins,
      s.losses,
      CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_friend
    FROM users u
    LEFT JOIN user_stats s ON u.id = s.user_id
    LEFT JOIN friendships f ON (
      (f.user1_id = ? AND f.user2_id = u.id) OR
      (f.user2_id = ? AND f.user1_id = u.id)
    )
    WHERE u.id != ?
      AND u.is_online = 1
      AND u.email_verified = 1
      AND u.username LIKE ?
    ORDER BY is_friend DESC, u.username ASC
    LIMIT ?
  `, [currentUserId, currentUserId, currentUserId, searchPattern, limit]);
}

async function removeFriend(userId, friendId) {
  const [user1Id, user2Id] = userId < friendId ? [userId, friendId] : [friendId, userId];

  const result = await run(
    'DELETE FROM friendships WHERE user1_id = ? AND user2_id = ?',
    [user1Id, user2Id]
  );

  if (result.changes === 0) {
    throw new Error('Friendship not found');
  }

  return { removed: true };
}

async function getFriendshipStatus(userId, otherUserId) {
  // Check if already friends
  if (await areFriends(userId, otherUserId)) {
    return 'friends';
  }

  // Check for pending requests
  const request = await get(`
    SELECT * FROM friend_requests
    WHERE status = 'pending'
      AND ((requester_id = ? AND requested_id = ?) OR (requester_id = ? AND requested_id = ?))
  `, [userId, otherUserId, otherUserId, userId]);

  if (request) {
    if (request.requester_id === userId) {
      return 'pending_sent';
    } else {
      return 'pending_received';
    }
  }

  return 'none';
}

async function getPendingFriendRequestCount(userId) {
  const result = await get(
    'SELECT COUNT(*) as count FROM friend_requests WHERE requested_id = ? AND status = ?',
    [userId, 'pending']
  );
  return result?.count || 0;
}

async function getUserFriendIds(userId) {
  const friendships = await all(`
    SELECT
      CASE WHEN user1_id = ? THEN user2_id ELSE user1_id END as friend_id
    FROM friendships
    WHERE user1_id = ? OR user2_id = ?
  `, [userId, userId, userId]);

  return friendships.map(f => f.friend_id);
}

// ============================================
// ANTI-CHEATING FUNCTIONS
// ============================================

async function logViolation(battleUuid, userId, playerId, violationType, details = null, severity = 'warning') {
  const createdAt = new Date().toISOString();
  await run(
    `INSERT INTO battle_violations (battle_uuid, user_id, player_id, violation_type, details, severity, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [battleUuid, userId, playerId, violationType, details, severity, createdAt]
  );

  // Update user stats if authenticated
  if (userId) {
    await run(
      `UPDATE user_stats SET
        total_violations = total_violations + 1,
        warning_count = CASE WHEN ? = 'warning' THEN warning_count + 1 ELSE warning_count END,
        trust_score = MAX(0, trust_score - CASE
          WHEN ? = 'critical' THEN 15
          WHEN ? = 'serious' THEN 10
          WHEN ? = 'warning' THEN 3
          ELSE 1
        END),
        updated_at = ?
      WHERE user_id = ?`,
      [severity, severity, severity, severity, createdAt, userId]
    );
  }

  return { logged: true };
}

async function getBattleViolations(battleUuid) {
  return all(
    `SELECT * FROM battle_violations WHERE battle_uuid = ? ORDER BY created_at`,
    [battleUuid]
  );
}

async function getUserViolations(userId, limit = 50) {
  return all(
    `SELECT * FROM battle_violations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
}

async function getUserTrustScore(userId) {
  const stats = await get('SELECT trust_score, total_violations, warning_count FROM user_stats WHERE user_id = ?', [userId]);
  return stats || { trust_score: 100, total_violations: 0, warning_count: 0 };
}

async function checkUserBanStatus(userId) {
  const user = await get('SELECT is_banned, ban_reason, banned_until FROM users WHERE id = ?', [userId]);
  if (!user) return { banned: false };

  if (user.is_banned) {
    // Check if temporary ban has expired
    if (user.banned_until) {
      const banExpiry = new Date(user.banned_until);
      if (banExpiry <= new Date()) {
        // Ban has expired, lift it
        await run('UPDATE users SET is_banned = 0, ban_reason = NULL, banned_until = NULL WHERE id = ?', [userId]);
        return { banned: false };
      }
      return { banned: true, reason: user.ban_reason, until: user.banned_until, temporary: true };
    }
    return { banned: true, reason: user.ban_reason, permanent: true };
  }

  return { banned: false };
}

async function autoBanUser(userId, reason, durationHours = null) {
  const bannedUntil = durationHours ? new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString() : null;
  await run(
    'UPDATE users SET is_banned = 1, ban_reason = ?, banned_until = ? WHERE id = ?',
    [reason, bannedUntil, userId]
  );
  return { banned: true, until: bannedUntil };
}

async function unbanUser(userId) {
  await run('UPDATE users SET is_banned = 0, ban_reason = NULL, banned_until = NULL WHERE id = ?', [userId]);
  return { unbanned: true };
}

async function getViolationStats(userId) {
  const violations = await all(
    `SELECT violation_type, COUNT(*) as count FROM battle_violations WHERE user_id = ? GROUP BY violation_type`,
    [userId]
  );
  const trust = await getUserTrustScore(userId);
  return { violations, ...trust };
}

// ============================================
// DAILY CHALLENGE FUNCTIONS
// ============================================

/**
 * Get current week string in YYYY-Www format (ISO week)
 */
function getCurrentWeekString() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now - startOfYear) / 86400000);
  const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * Get previous week string
 */
function getPreviousWeekString() {
  const now = new Date();
  const lastWeek = new Date(now.getTime() - 7 * 86400000);
  const startOfYear = new Date(lastWeek.getFullYear(), 0, 1);
  const days = Math.floor((lastWeek - startOfYear) / 86400000);
  const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `${lastWeek.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * Get time until next week's challenge (milliseconds until Monday 00:00 UTC)
 */
function getTimeUntilNextWeek() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const nextMonday = new Date(now);
  nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
  nextMonday.setUTCHours(0, 0, 0, 0);
  return nextMonday.getTime() - now.getTime();
}

/**
 * Get or create this week's arena challenge
 * @param {Array} problems - Array of available problems
 * @param {string} challengeType - 'prompt' or 'coding'
 */
async function getOrCreateArenaChallenge(problems, challengeType = 'prompt') {
  const currentWeek = getCurrentWeekString();

  // Check if this week's challenge exists
  let challenge = await get(
    'SELECT * FROM daily_challenges WHERE challenge_date = ?',
    [currentWeek]
  );

  if (challenge) {
    return challenge;
  }

  // Create new challenge for this week
  // Select a problem based on week number for consistency
  const weekNum = parseInt(currentWeek.split('-W')[1]);
  const year = parseInt(currentWeek.split('-W')[0]);
  const problemIndex = (weekNum + year * 52) % problems.length;
  const selectedProblem = problems[problemIndex];

  const createdAt = new Date().toISOString();

  await run(
    `INSERT INTO daily_challenges (challenge_date, problem_id, difficulty, created_at, challenge_type)
     VALUES (?, ?, ?, ?, ?)`,
    [currentWeek, selectedProblem.id, selectedProblem.difficulty || 'medium', createdAt, challengeType]
  );

  challenge = await get(
    'SELECT * FROM daily_challenges WHERE challenge_date = ?',
    [currentWeek]
  );

  return challenge;
}

/**
 * Get a specific week's challenge
 */
function getArenaChallenge(weekString) {
  return get('SELECT * FROM daily_challenges WHERE challenge_date = ?', [weekString]);
}

/**
 * Get user's attempt for an arena challenge
 */
function getArenaAttempt(userId, weekString) {
  return get(
    'SELECT * FROM daily_challenge_attempts WHERE user_id = ? AND challenge_date = ?',
    [userId, weekString]
  );
}

/**
 * Start an arena challenge attempt
 */
async function startArenaAttempt(userId, weekString, language = 'python') {
  const startedAt = new Date().toISOString();

  // Check if attempt already exists
  const existing = await getArenaAttempt(userId, weekString);
  if (existing) {
    return existing;
  }

  await run(
    `INSERT INTO daily_challenge_attempts (user_id, challenge_date, language, started_at)
     VALUES (?, ?, ?, ?)`,
    [userId, weekString, language, startedAt]
  );

  return getArenaAttempt(userId, weekString);
}

/**
 * Complete an arena challenge attempt
 */
async function completeArenaAttempt(userId, weekString, solveTime, code, opts = {}) {
  const {
    promptScore = null,
    promptSubmitCount = null,
    modelOutput = null,
    passedTierId = null,
    modelUsed = null
  } = opts;
  const completedAt = new Date().toISOString();
  const currentWeek = getCurrentWeekString();

  await run(
    `UPDATE daily_challenge_attempts
     SET completed = 1, solve_time = ?, prompt_text = ?, completed_at = ?,
         prompt_score = COALESCE(?, prompt_score),
         prompt_submit_count = COALESCE(?, prompt_submit_count),
         model_output = COALESCE(?, model_output),
         passed_tier_id = COALESCE(?, passed_tier_id),
         model_used = COALESCE(?, model_used)
     WHERE user_id = ? AND challenge_date = ?`,
    [solveTime, code, completedAt, promptScore, promptSubmitCount, modelOutput, passedTierId, modelUsed, userId, weekString]
  );

  // Update streak (weekly streak - consecutive weeks)
  let stats = await getUserStats(userId);

  // Ensure user_stats row exists (may not if user never battled)
  if (!stats) {
    await run(
      `INSERT INTO user_stats (user_id, updated_at) VALUES (?, ?)`,
      [userId, completedAt]
    );
    stats = { daily_streak: 0, best_daily_streak: 0 };
  }

  const lastCompletion = stats?.last_daily_completion;
  const previousWeek = getPreviousWeekString();

  let newStreak = 1;
  if (lastCompletion === previousWeek) {
    // Continuing streak from last week
    newStreak = (stats?.daily_streak || 0) + 1;
  } else if (lastCompletion === currentWeek) {
    // Already completed this week, don't change streak
    newStreak = stats?.daily_streak || 1;
  }

  const bestStreak = Math.max(newStreak, stats?.best_daily_streak || 0);

  await run(
    `UPDATE user_stats
     SET daily_streak = ?, best_daily_streak = ?, last_daily_completion = ?, updated_at = ?
     WHERE user_id = ?`,
    [newStreak, bestStreak, currentWeek, completedAt, userId]
  );

  return getArenaAttempt(userId, weekString);
}

/**
 * Get arena challenge leaderboard
 * Shows weekly streak and total completions (not ELO rating).
 *
 * `revealPrompts` is intended to be true ONLY for past-week leaderboards
 * (the "study the winners" reveal). For the current week we hide the
 * prompt and model output to prevent prompt copying. The flag selects
 * literal NULL in the SELECT list (not user input, ternary returns a
 * hardcoded string), so this is safe.
 */
function getArenaLeaderboard(weekString, limit = 50, { revealPrompts = false } = {}) {
  const promptCol = revealPrompts ? 'dca.prompt_text' : 'NULL';
  const outputCol = revealPrompts ? 'dca.model_output' : 'NULL';
  return all(`
    SELECT
      dca.user_id,
      dca.solve_time,
      dca.language,
      dca.completed_at,
      dca.prompt_score,
      dca.prompt_submit_count,
      dca.passed_tier_id,
      dca.model_used,
      ${promptCol} as prompt,
      ${outputCol} as model_output,
      u.username,
      u.avatar,
      s.daily_streak as weekly_streak,
      (SELECT COUNT(*) FROM daily_challenge_attempts
       WHERE user_id = dca.user_id AND completed = 1) as total_completions
    FROM daily_challenge_attempts dca
    JOIN users u ON dca.user_id = u.id
    LEFT JOIN user_stats s ON dca.user_id = s.user_id
    WHERE dca.challenge_date = ? AND dca.completed = 1
    ORDER BY COALESCE(dca.prompt_score, 0) DESC, dca.prompt_submit_count ASC, dca.solve_time ASC
    LIMIT ?
  `, [weekString, limit]);
}

/**
 * Get user's arena challenge history
 */
function getUserArenaHistory(userId, limit = 20) {
  return all(`
    SELECT
      dca.*,
      dc.problem_id,
      dc.difficulty
    FROM daily_challenge_attempts dca
    JOIN daily_challenges dc ON dca.challenge_date = dc.challenge_date
    WHERE dca.user_id = ?
    ORDER BY dca.challenge_date DESC
    LIMIT ?
  `, [userId, limit]);
}

/**
 * Get arena challenge stats
 */
async function getArenaChallengeStats(weekString) {
  const stats = await get(`
    SELECT
      COUNT(*) as total_attempts,
      SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completions,
      AVG(CASE WHEN completed = 1 THEN solve_time ELSE NULL END) as avg_solve_time,
      MIN(CASE WHEN completed = 1 THEN solve_time ELSE NULL END) as best_time
    FROM daily_challenge_attempts
    WHERE challenge_date = ?
  `, [weekString]);

  return stats;
}

/**
 * Get user's rank on arena leaderboard.
 *
 * Must match the ORDER BY used by getArenaLeaderboard() exactly:
 *   COALESCE(prompt_score, 0) DESC, prompt_submit_count ASC, solve_time ASC
 *
 * A row ranks ahead of the user iff it strictly beats the user on the
 * canonical sort tuple. Implemented as a lexicographic comparison so
 * ties on prompt_score break to prompt_submit_count, then to solve_time.
 */
async function getUserArenaRank(userId, weekString) {
  const attempt = await getArenaAttempt(userId, weekString);
  if (!attempt || !attempt.completed) {
    return null;
  }

  const userScore = attempt.prompt_score == null ? 0 : attempt.prompt_score;
  const userSubmitCount = attempt.prompt_submit_count == null ? 0 : attempt.prompt_submit_count;
  const userSolveTime = attempt.solve_time;

  const rank = await get(`
    SELECT COUNT(*) + 1 as rank
    FROM daily_challenge_attempts
    WHERE challenge_date = ? AND completed = 1
      AND (
        COALESCE(prompt_score, 0) > ?
        OR (COALESCE(prompt_score, 0) = ? AND COALESCE(prompt_submit_count, 0) < ?)
        OR (COALESCE(prompt_score, 0) = ? AND COALESCE(prompt_submit_count, 0) = ? AND solve_time < ?)
      )
  `, [weekString, userScore, userScore, userSubmitCount, userScore, userSubmitCount, userSolveTime]);

  return rank?.rank || null;
}

// ============================================
// BUILD (PROMPT-BUILD) CHALLENGE, biweekly, real-world themed
// Submit a prompt -> auto-scored -> top-N shortlist -> community vote -> winner.
// ============================================

async function createBuildChallenge(data) {
  const {
    periodKey, title, brief, targetOutput = null, evaluationCriteria = [],
    track = 'applied', judgingMode = 'auto_gate_vote',
    sourceName = null, sourceUrl = null, modelId = null, shortlistSize = 5,
    submitOpenAt, submitCloseAt, voteCloseAt
  } = data;
  const createdAt = new Date().toISOString();
  await run(
    `INSERT INTO build_challenges
      (period_key, title, brief, target_output, evaluation_criteria, track, judging_mode,
       source_name, source_url, model_id, shortlist_size, submit_open_at, submit_close_at, vote_close_at, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [periodKey, title, brief, targetOutput,
      JSON.stringify(Array.isArray(evaluationCriteria) ? evaluationCriteria : []),
      track, judgingMode, sourceName, sourceUrl, modelId, shortlistSize,
      submitOpenAt, submitCloseAt, voteCloseAt, 'scheduled', createdAt]
  );
  return getBuildChallengeByPeriod(periodKey);
}

function getBuildChallengeByPeriod(periodKey) {
  return get('SELECT * FROM build_challenges WHERE period_key = ?', [periodKey]);
}

function getBuildChallengeById(id) {
  return get('SELECT * FROM build_challenges WHERE id = ?', [id]);
}

// The challenge whose window currently spans now; else the most recent one.
async function getCurrentBuildChallenge() {
  const nowIso = new Date().toISOString();
  const active = await get(
    `SELECT * FROM build_challenges
     WHERE submit_open_at <= ? AND vote_close_at > ?
     ORDER BY submit_open_at DESC LIMIT 1`,
    [nowIso, nowIso]
  );
  if (active) return active;
  return get('SELECT * FROM build_challenges ORDER BY submit_open_at DESC LIMIT 1');
}

function listBuildChallenges(limit = 20) {
  return all('SELECT * FROM build_challenges ORDER BY submit_open_at DESC LIMIT ?', [limit]);
}

function getBuildSubmissionForUser(challengeId, userId) {
  return get('SELECT * FROM build_submissions WHERE challenge_id = ? AND user_id = ?', [challengeId, userId]);
}

function getBuildSubmissionById(id) {
  return get('SELECT * FROM build_submissions WHERE id = ?', [id]);
}

// One submission per user per challenge, editable until submissions close.
async function upsertBuildSubmission(challengeId, userId, fields) {
  const {
    promptText, modelId = null, modelOutput = null,
    autoScore = null, judgeRationale = null, judgeCriteria = []
  } = fields;
  const nowIso = new Date().toISOString();
  await run(
    `INSERT INTO build_submissions
       (challenge_id, user_id, prompt_text, model_id, model_output, auto_score, judge_rationale, judge_criteria, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(challenge_id, user_id) DO UPDATE SET
       prompt_text = excluded.prompt_text,
       model_id = excluded.model_id,
       model_output = excluded.model_output,
       auto_score = excluded.auto_score,
       judge_rationale = excluded.judge_rationale,
       judge_criteria = excluded.judge_criteria,
       updated_at = excluded.updated_at`,
    [challengeId, userId, promptText, modelId, modelOutput, autoScore, judgeRationale,
      JSON.stringify(Array.isArray(judgeCriteria) ? judgeCriteria : []), nowIso, nowIso]
  );
  return getBuildSubmissionForUser(challengeId, userId);
}

function getTopBuildSubmissionsByScore(challengeId, limit = 5) {
  return all(
    `SELECT * FROM build_submissions
     WHERE challenge_id = ? AND auto_score IS NOT NULL
     ORDER BY auto_score DESC, created_at ASC
     LIMIT ?`,
    [challengeId, limit]
  );
}

async function markBuildShortlisted(challengeId, submissionIds) {
  await run('UPDATE build_submissions SET is_shortlisted = 0 WHERE challenge_id = ?', [challengeId]);
  if (!submissionIds || !submissionIds.length) return;
  const placeholders = submissionIds.map(() => '?').join(',');
  await run(
    `UPDATE build_submissions SET is_shortlisted = 1 WHERE challenge_id = ? AND id IN (${placeholders})`,
    [challengeId, ...submissionIds]
  );
}

function shortlistAllBuildSubmissions(challengeId) {
  return run('UPDATE build_submissions SET is_shortlisted = 1 WHERE challenge_id = ?', [challengeId]);
}

// Shortlisted entries for voting / results. Author identity is revealed only
// once the challenge closes, during voting we hide usernames so people vote on
// the work, not the name (reduces popularity/brigading bias).
function getBuildShortlist(challengeId, { revealAuthors = false } = {}) {
  const authorCols = revealAuthors ? 'u.username, u.avatar' : 'NULL as username, NULL as avatar';
  return all(
    `SELECT bs.id, bs.challenge_id, bs.user_id, bs.prompt_text, bs.model_output,
            bs.auto_score, bs.judge_rationale, bs.vote_count, bs.created_at,
            ${authorCols}
     FROM build_submissions bs
     JOIN users u ON bs.user_id = u.id
     WHERE bs.challenge_id = ? AND bs.is_shortlisted = 1
     ORDER BY bs.vote_count DESC, bs.auto_score DESC, bs.created_at ASC`,
    [challengeId]
  );
}

async function getBuildSubmissionCount(challengeId) {
  const row = await get('SELECT COUNT(*) as count FROM build_submissions WHERE challenge_id = ?', [challengeId]);
  return row?.count || 0;
}

function getUserBuildVote(challengeId, userId) {
  return get('SELECT * FROM build_votes WHERE challenge_id = ? AND voter_user_id = ?', [challengeId, userId]);
}

// Cast a community vote. One vote per user per challenge; only on shortlisted
// entries; cannot vote for your own. Atomic via transaction + UNIQUE constraint.
async function castBuildVote(challengeId, submissionId, voterUserId) {
  try {
    let payload;
    await withTransaction(async () => {
      const submission = await get(
        'SELECT id, user_id, is_shortlisted FROM build_submissions WHERE id = ? AND challenge_id = ?',
        [submissionId, challengeId]
      );
      if (!submission) { const e = new Error('unknown_submission'); e.code = 'unknown_submission'; throw e; }
      if (!submission.is_shortlisted) { const e = new Error('not_shortlisted'); e.code = 'not_shortlisted'; throw e; }
      if (submission.user_id === voterUserId) { const e = new Error('self_vote'); e.code = 'self_vote'; throw e; }

      try {
        await run(
          'INSERT INTO build_votes (challenge_id, submission_id, voter_user_id, created_at) VALUES (?,?,?,?)',
          [challengeId, submissionId, voterUserId, new Date().toISOString()]
        );
      } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          const e = new Error('already_voted'); e.code = 'already_voted'; throw e;
        }
        throw err;
      }
      await run('UPDATE build_submissions SET vote_count = vote_count + 1 WHERE id = ?', [submissionId]);
      payload = { success: true, submissionId };
    });
    return payload;
  } catch (err) {
    if (err && err.code) return { success: false, code: err.code };
    throw err;
  }
}

// Winner = most votes; ties broken by auto_score then earliest submission.
function getBuildWinnerCandidate(challengeId) {
  return get(
    `SELECT * FROM build_submissions
     WHERE challenge_id = ? AND is_shortlisted = 1
     ORDER BY vote_count DESC, auto_score DESC, created_at ASC
     LIMIT 1`,
    [challengeId]
  );
}

function setBuildChallengeShortlisted(challengeId) {
  return run('UPDATE build_challenges SET shortlisted_at = ?, status = ? WHERE id = ?',
    [new Date().toISOString(), 'voting', challengeId]);
}

function setBuildChallengeStatus(challengeId, status) {
  return run('UPDATE build_challenges SET status = ? WHERE id = ?', [status, challengeId]);
}

// Conditionally close + crown a winner. The `closed_at IS NULL` guard makes this
// idempotent under concurrent lazy-progression: only the first caller wins and
// returns true (so only it grants the reward); submissionId may be null when
// there were no entries.
async function setBuildChallengeWinnerIfUnset(challengeId, submissionId) {
  const res = await run(
    `UPDATE build_challenges
     SET winner_submission_id = ?, status = 'closed', closed_at = ?
     WHERE id = ? AND closed_at IS NULL`,
    [submissionId, new Date().toISOString(), challengeId]
  );
  return res.changes > 0;
}

// Winner reward: +1 month Pro (extend existing expiry, never shorten). Mirrors
// the campaign Pro-grant logic.
async function grantBuildChallengeReward(userId) {
  return withTransaction(async () => {
    const user = await get('SELECT pro_expires_at FROM users WHERE id = ?', [userId]);
    if (!user) return { success: false, code: 'user_not_found' };
    const now = new Date();
    const currentExpiry = user.pro_expires_at ? new Date(user.pro_expires_at) : null;
    const baseDate = (currentExpiry && !Number.isNaN(currentExpiry.getTime()) && currentExpiry > now)
      ? currentExpiry : now;
    const expiresAt = new Date(baseDate.getTime());
    expiresAt.setMonth(expiresAt.getMonth() + 1);
    const expiresAtIso = expiresAt.toISOString();
    await run('UPDATE users SET is_pro = 1, pro_expires_at = ? WHERE id = ?', [expiresAtIso, userId]);
    return { success: true, proExpiresAt: expiresAtIso };
  });
}

// ============================================
// OPEN BUILDS, "Take this further": a challenge entry graduates into a real
// project (optional repo link) that others can discover and follow.
// ============================================

const OPEN_BUILD_STATUSES = ['building', 'seeking_collaborators', 'shipped'];

// One open build per user per challenge, editable.
async function upsertOpenBuild(challengeId, userId, fields) {
  const { title, description = null, repoUrl = null, status = 'building' } = fields;
  const safeStatus = OPEN_BUILD_STATUSES.includes(status) ? status : 'building';
  const nowIso = new Date().toISOString();
  await run(
    `INSERT INTO open_builds (challenge_id, user_id, title, description, repo_url, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(challenge_id, user_id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       repo_url = excluded.repo_url,
       status = excluded.status,
       updated_at = excluded.updated_at`,
    [challengeId, userId, title, description, repoUrl, safeStatus, nowIso, nowIso]
  );
  return getOpenBuildForUser(challengeId, userId);
}

function getOpenBuildForUser(challengeId, userId) {
  return get('SELECT * FROM open_builds WHERE challenge_id = ? AND user_id = ?', [challengeId, userId]);
}

function deleteOpenBuild(challengeId, userId) {
  return run('DELETE FROM open_builds WHERE challenge_id = ? AND user_id = ?', [challengeId, userId]);
}

// Public list of open builds, newest first. Optionally scoped to one challenge.
function listOpenBuilds({ challengeId = null, limit = 50 } = {}) {
  const where = challengeId ? 'WHERE ob.challenge_id = ?' : '';
  const params = challengeId ? [challengeId, limit] : [limit];
  return all(
    `SELECT ob.id, ob.challenge_id, ob.user_id, ob.title, ob.description, ob.repo_url,
            ob.status, ob.created_at, ob.updated_at,
            u.username, u.avatar,
            bc.title AS challenge_title
     FROM open_builds ob
     JOIN users u ON ob.user_id = u.id
     JOIN build_challenges bc ON ob.challenge_id = bc.id
     ${where}
     ORDER BY ob.created_at DESC
     LIMIT ?`,
    params
  );
}

// ============================================
// JUDGE-VS-RUBRIC DIVERGENCE TELEMETRY
// ============================================

/**
 * Log a judge vs rubric scoring sample for divergence analysis.
 * Telemetry is fire-and-forget; the caller wraps this in try/catch.
 */
async function logJudgeScore({ userId, challengeDate, problemId, judgeScore, rubricScore, judgeSource, modelUsed }) {
  const divergence = (typeof judgeScore === 'number' && typeof rubricScore === 'number')
    ? Math.abs(judgeScore - rubricScore) : null;
  await run(
    `INSERT INTO judge_score_log (user_id, challenge_date, problem_id, judge_score, rubric_score, divergence, judge_source, model_used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, challengeDate, problemId, judgeScore, rubricScore, divergence, judgeSource, modelUsed, new Date().toISOString()]
  );
}

/**
 * Average divergence over the most recent samples for a single problem.
 */
async function getProblemDivergenceStats(problemId, { sampleSize = 50 } = {}) {
  return get(`
    SELECT
      problem_id,
      COUNT(*) as sample_count,
      AVG(divergence) as avg_divergence,
      MAX(divergence) as max_divergence,
      MIN(divergence) as min_divergence,
      AVG(judge_score) as avg_judge_score,
      AVG(rubric_score) as avg_rubric_score
    FROM (
      SELECT * FROM judge_score_log
      WHERE problem_id = ? AND divergence IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ?
    )
  `, [problemId, sampleSize]);
}

/**
 * Problems with the highest average divergence, likely gameable or judge-unstable.
 */
async function getDivergenceLeaderboard(limit = 20) {
  return all(`
    SELECT
      problem_id,
      COUNT(*) as samples,
      AVG(divergence) as avg_divergence,
      AVG(judge_score) as avg_judge_score,
      AVG(rubric_score) as avg_rubric_score
    FROM judge_score_log
    WHERE divergence IS NOT NULL
    GROUP BY problem_id
    HAVING samples >= 3
    ORDER BY avg_divergence DESC
    LIMIT ?
  `, [limit]);
}

/**
 * Get past arena challenges (for archive)
 */
function getPastArenaChallenges(limit = 10) {
  const currentWeek = getCurrentWeekString();
  return all(`
    SELECT dc.*,
      (SELECT COUNT(*) FROM daily_challenge_attempts WHERE challenge_date = dc.challenge_date AND completed = 1) as completions,
      (SELECT MIN(solve_time) FROM daily_challenge_attempts WHERE challenge_date = dc.challenge_date AND completed = 1) as best_time
    FROM daily_challenges dc
    WHERE dc.challenge_date < ?
    ORDER BY dc.challenge_date DESC
    LIMIT ?
  `, [currentWeek, limit]);
}

// ============================================
// EMAIL PREFERENCES FUNCTIONS
// ============================================

/**
 * Get user's email preferences
 */
function getEmailPreferences(userId) {
  return get('SELECT * FROM user_email_preferences WHERE user_id = ?', [userId]);
}

/**
 * Create or update email preferences for a user.
 *
 * Bug 15 fix: partial-merge semantics. Only keys actually present in `prefs`
 * are written; anything else is preserved from the existing row. The old
 * default-argument destructure was silently re-enabling marketing for users
 * who had opted out whenever a sibling preference was updated.
 *
 * For new rows (no existing prefs), defaults apply ONLY to columns the caller
 * didn't specify, matching the previous opt-in defaults.
 */
async function setEmailPreferences(userId, prefs = {}) {
  const now = new Date().toISOString();
  const existing = await getEmailPreferences(userId);

  // Defaults used only when creating a row for the first time AND the caller
  // didn't specify the field.
  const DEFAULTS = {
    weeklyChallenge: true,
    marketing: true,
    progressDigest: true,
    tournamentNotifications: false,
    messageDigest: true,
  };

  const pickBool = (camel, snake) => {
    if (Object.prototype.hasOwnProperty.call(prefs, camel)) {
      return prefs[camel] ? 1 : 0;
    }
    if (existing) {
      // Preserve the existing value, do NOT clobber with a default.
      return existing[snake] ? 1 : 0;
    }
    return DEFAULTS[camel] ? 1 : 0;
  };

  const values = {
    weekly_challenge: pickBool('weeklyChallenge', 'weekly_challenge'),
    marketing: pickBool('marketing', 'marketing'),
    progress_digest: pickBool('progressDigest', 'progress_digest'),
    tournament_notifications: pickBool('tournamentNotifications', 'tournament_notifications'),
    message_digest: pickBool('messageDigest', 'message_digest'),
  };

  if (existing) {
    await run(
      `UPDATE user_email_preferences
       SET weekly_challenge = ?, marketing = ?, progress_digest = ?, tournament_notifications = ?, message_digest = ?, updated_at = ?
       WHERE user_id = ?`,
      [values.weekly_challenge, values.marketing, values.progress_digest, values.tournament_notifications, values.message_digest, now, userId]
    );
  } else {
    await run(
      `INSERT INTO user_email_preferences (user_id, weekly_challenge, marketing, progress_digest, tournament_notifications, message_digest, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, values.weekly_challenge, values.marketing, values.progress_digest, values.tournament_notifications, values.message_digest, now, now]
    );
  }

  return getEmailPreferences(userId);
}

/**
 * Get all users subscribed to weekly challenge emails
 * Uses LEFT JOIN to include users who haven't set preferences yet (default is opt-in)
 */
function getWeeklyChallengeSubscribers() {
  // email_verified = 1 filter: unverified addresses degrade deliverability
  // (Resend rejects bounces, ISPs ding the sender domain) AND violate the
  // marketing-consent flow, we never sent the verification mail, so the
  // user never gave consent. Mirrors the activity_reminder query below.
  return all(`
    SELECT u.id, u.email, u.username
    FROM users u
    LEFT JOIN user_email_preferences uep ON u.id = uep.user_id
    WHERE u.email IS NOT NULL AND u.email != ''
      AND u.email_verified = 1
      AND (uep.weekly_challenge IS NULL OR uep.weekly_challenge = 1)
  `);
}

/**
 * Get all users subscribed to tournament notification emails
 */
function getTournamentNotificationSubscribers() {
  return all(`
    SELECT u.id, u.email, u.username
    FROM users u
    JOIN user_email_preferences uep ON u.id = uep.user_id
    WHERE uep.tournament_notifications = 1
      AND u.email IS NOT NULL AND u.email != ''
      AND u.email_verified = 1
  `);
}

/**
 * Get all users subscribed to marketing emails (changelog, product updates)
 * Marketing emails are opt-out by default, so we use JOIN to only get users who explicitly opted in
 */
function getMarketingSubscribers() {
  return all(`
    SELECT u.id, u.email, u.username
    FROM users u
    JOIN user_email_preferences uep ON u.id = uep.user_id
    WHERE uep.marketing = 1
      AND u.email IS NOT NULL AND u.email != ''
      AND u.email_verified = 1
  `);
}

/**
 * Unsubscribe user from weekly challenge emails
 */
async function unsubscribeFromWeeklyChallenge(userId) {
  const prefs = await getEmailPreferences(userId);
  // Use setEmailPreferences to properly create row if it doesn't exist.
  // Pass every pref the helper accepts, its destructure defaults would
  // otherwise silently re-enable any pref we omit (e.g. messageDigest -> 1).
  await setEmailPreferences(userId, {
    weeklyChallenge: false,
    marketing: prefs?.marketing === 1,
    progressDigest: prefs?.progress_digest !== 0,
    tournamentNotifications: prefs?.tournament_notifications === 1,
    messageDigest: prefs?.message_digest !== 0
  });
  return { success: true };
}

// ============================================
// ACTIVITY REMINDER NOTIFICATIONS
// ============================================

/**
 * Get the last time an activity reminder was sent to a user
 */
async function getLastActivityReminderSent(userId) {
  const record = await get(`
    SELECT sent_at, metadata
    FROM notification_log
    WHERE user_id = ? AND notification_type = 'activity_reminder'
  `, [userId]);
  return record;
}

/**
 * Record that an activity reminder was sent to a user
 * Uses INSERT OR REPLACE to only keep the most recent send per user
 */
async function recordActivityReminderSent(userId, metadata = {}) {
  const now = new Date().toISOString();
  await run(`
    INSERT INTO notification_log (user_id, notification_type, sent_at, metadata)
    VALUES (?, 'activity_reminder', ?, ?)
    ON CONFLICT(user_id, notification_type) DO UPDATE SET
      sent_at = excluded.sent_at,
      metadata = excluded.metadata
  `, [userId, now, JSON.stringify(metadata)]);
}

/**
 * Get users who have pending activity (friend requests or unread messages)
 * that is at least `daysSinceActivity` days old, and who haven't been
 * reminded in the last `daysSinceLastReminder` days.
 *
 * @param {number} daysSinceActivity - How old the activity must be (default 3)
 * @param {number} daysSinceLastReminder - Min days since last reminder (default 7)
 * @returns {Array} Users needing activity reminders with counts
 */
async function getUsersNeedingActivityReminder(daysSinceActivity = 3, daysSinceLastReminder = 7) {
  return all(`
    SELECT
      u.id,
      u.email,
      u.username,
      (
        SELECT COUNT(*)
        FROM friend_requests fr
        WHERE fr.requested_id = u.id
          AND fr.status = 'pending'
          AND datetime(fr.created_at) < datetime('now', '-' || ? || ' days')
      ) as pending_friend_requests,
      (
        SELECT COUNT(*)
        FROM messages m
        WHERE m.receiver_id = u.id
          AND m.read_at IS NULL
          AND datetime(m.created_at) < datetime('now', '-' || ? || ' days')
      ) as unread_messages
    FROM users u
    LEFT JOIN notification_log nl
      ON u.id = nl.user_id AND nl.notification_type = 'activity_reminder'
    LEFT JOIN user_email_preferences uep
      ON u.id = uep.user_id
    WHERE u.email_verified = 1
      AND u.email IS NOT NULL
      AND u.email != ''
      AND (uep.activity_reminders IS NULL OR uep.activity_reminders = 1)
      AND (nl.sent_at IS NULL OR datetime(nl.sent_at) < datetime('now', '-' || ? || ' days'))
    HAVING pending_friend_requests > 0 OR unread_messages > 0
  `, [daysSinceActivity, daysSinceActivity, daysSinceLastReminder]);
}

/**
 * Get details of pending friend requests for a user (for email template)
 * @param {number} userId - The user receiving the requests
 * @param {number} limit - Max requests to return (default 3)
 */
async function getPendingFriendRequestsForReminder(userId, limit = 3) {
  return all(`
    SELECT
      fr.id,
      fr.created_at,
      u.id as sender_id,
      u.username as sender_username,
      u.avatar_url as sender_avatar
    FROM friend_requests fr
    JOIN users u ON fr.requester_id = u.id
    WHERE fr.requested_id = ?
      AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
    LIMIT ?
  `, [userId, limit]);
}

/**
 * Get details of unread messages for a user (for email template)
 * @param {number} userId - The user who received the messages
 * @param {number} limit - Max messages to return (default 3)
 */
async function getUnreadMessagesForReminder(userId, limit = 3) {
  return all(`
    SELECT
      m.id,
      m.content,
      m.created_at,
      u.id as sender_id,
      u.username as sender_username,
      u.avatar_url as sender_avatar
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.receiver_id = ?
      AND m.read_at IS NULL
    ORDER BY m.created_at DESC
    LIMIT ?
  `, [userId, limit]);
}

async function getActivityReminderDetailsForUsers(userIds = [], limit = 3) {
  const normalizedIds = [...new Set(
    userIds
      .map(id => parseInt(id, 10))
      .filter(id => !isNaN(id) && id > 0)
  )];

  const emptyResult = {};
  for (const userId of normalizedIds) {
    emptyResult[userId] = { friendRequests: [], messages: [] };
  }

  if (normalizedIds.length === 0) {
    return emptyResult;
  }

  const placeholders = normalizedIds.map(() => '?').join(',');
  const requestRows = await all(`
    SELECT *
    FROM (
      SELECT
        fr.requested_id as user_id,
        fr.id,
        fr.created_at,
        u.id as sender_id,
        u.username as sender_username,
        u.avatar_url as sender_avatar,
        ROW_NUMBER() OVER (PARTITION BY fr.requested_id ORDER BY fr.created_at DESC) as row_num
      FROM friend_requests fr
      JOIN users u ON fr.requester_id = u.id
      WHERE fr.requested_id IN (${placeholders})
        AND fr.status = 'pending'
    )
    WHERE row_num <= ?
    ORDER BY user_id, created_at DESC
  `, [...normalizedIds, limit]);

  const messageRows = await all(`
    SELECT *
    FROM (
      SELECT
        m.receiver_id as user_id,
        m.id,
        m.content,
        m.created_at,
        u.id as sender_id,
        u.username as sender_username,
        u.avatar_url as sender_avatar,
        ROW_NUMBER() OVER (PARTITION BY m.receiver_id ORDER BY m.created_at DESC) as row_num
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.receiver_id IN (${placeholders})
        AND m.read_at IS NULL
    )
    WHERE row_num <= ?
    ORDER BY user_id, created_at DESC
  `, [...normalizedIds, limit]);

  for (const row of requestRows) {
    emptyResult[row.user_id].friendRequests.push({
      id: row.id,
      created_at: row.created_at,
      sender_id: row.sender_id,
      sender_username: row.sender_username,
      sender_avatar: row.sender_avatar
    });
  }

  for (const row of messageRows) {
    emptyResult[row.user_id].messages.push({
      id: row.id,
      content: row.content,
      created_at: row.created_at,
      sender_id: row.sender_id,
      sender_username: row.sender_username,
      sender_avatar: row.sender_avatar
    });
  }

  return emptyResult;
}

/**
 * Unsubscribe user from activity reminder emails
 */
async function unsubscribeFromActivityReminders(userId) {
  const now = new Date().toISOString();
  await run(`
    INSERT INTO user_email_preferences (user_id, activity_reminders, created_at, updated_at)
    VALUES (?, 0, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      activity_reminders = 0,
      updated_at = excluded.updated_at
  `, [userId, now, now]);
  return { success: true };
}

/**
 * Unsubscribe user from marketing emails (changelog / product updates)
 */
async function unsubscribeFromMarketing(userId) {
  const now = new Date().toISOString();
  await run(`
    INSERT INTO user_email_preferences (user_id, marketing, created_at, updated_at)
    VALUES (?, 0, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      marketing = 0,
      updated_at = excluded.updated_at
  `, [userId, now, now]);
  return { success: true };
}

/**
 * Unsubscribe user from CreatorArena milestone emails
 */
async function unsubscribeFromCreatorArenaEmails(userId) {
  const now = new Date().toISOString();
  await run(`
    INSERT INTO user_email_preferences (user_id, creator_arena_emails, created_at, updated_at)
    VALUES (?, 0, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      creator_arena_emails = 0,
      updated_at = excluded.updated_at
  `, [userId, now, now]);
  return { success: true };
}

async function unsubscribeFromMessageDigest(userId) {
  const now = new Date().toISOString();
  await run(`
    INSERT INTO user_email_preferences (user_id, message_digest, created_at, updated_at)
    VALUES (?, 0, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      message_digest = 0,
      updated_at = excluded.updated_at
  `, [userId, now, now]);
  return { success: true };
}

/**
 * Get users who received at least 1 message in the past 7 days
 * and have message_digest enabled (default opt-in).
 * Returns each user with a list of up to 3 preview messages per sender.
 */
async function getUsersForWeeklyMessageDigest() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return all(`
    SELECT u.id, u.email, u.username, COUNT(m.id) AS total_messages
    FROM users u
    JOIN messages m ON m.receiver_id = u.id
    LEFT JOIN user_email_preferences uep ON u.id = uep.user_id
    WHERE m.created_at >= ?
      AND u.email IS NOT NULL AND u.email != ''
      AND (uep.message_digest IS NULL OR uep.message_digest = 1)
    GROUP BY u.id
    HAVING total_messages >= 1
  `, [weekAgo]);
}

/**
 * Get message digest details for a user: senders and their recent messages.
 */
async function getWeeklyMessageDigestDetails(userId, limit = 3) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const senders = await all(`
    SELECT s.id, s.username, s.avatar, COUNT(m.id) AS message_count
    FROM messages m
    JOIN users s ON m.sender_id = s.id
    WHERE m.receiver_id = ? AND m.created_at >= ?
    GROUP BY s.id
    ORDER BY message_count DESC
    LIMIT ?
  `, [userId, weekAgo, limit]);

  for (const sender of senders) {
    sender.preview = await all(`
      SELECT content, created_at
      FROM messages
      WHERE receiver_id = ? AND sender_id = ? AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT 2
    `, [userId, sender.id, weekAgo]);
  }

  return senders;
}

/**
 * Try to record a one-time notification. Returns true if this is the first time
 * (i.e., the email should be sent), false if already recorded for this (user, type).
 * Relies on the unique index on notification_log(user_id, notification_type).
 */
async function tryRecordOneTimeNotification(userId, notificationType, metadata = {}) {
  const now = new Date().toISOString();
  const result = await run(`
    INSERT OR IGNORE INTO notification_log (user_id, notification_type, sent_at, metadata)
    VALUES (?, ?, ?, ?)
  `, [userId, notificationType, now, JSON.stringify(metadata)]);
  return (result.changes || 0) > 0;
}

/**
 * Get the total comment count for a CreatorArena game (used for first-comment milestone)
 */
async function getGameCommentCount(gameId) {
  const row = await get(`SELECT COUNT(*) as count FROM game_comments WHERE game_id = ?`, [gameId]);
  return row?.count || 0;
}

// ============================================
// ANALYTICS FUNCTIONS
// ============================================

/**
 * Record a rating change in history
 */
async function recordRatingChange(userId, { rating, ratingChange, battleUuid, result }) {
  const now = new Date().toISOString();
  await run(
    `INSERT INTO rating_history (user_id, rating, rating_change, battle_uuid, result, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, rating, ratingChange, battleUuid, result, now]
  );
}

/**
 * Get rating history for a user (for charts)
 */
async function getRatingHistory(userId, limit = 50) {
  return all(`
    SELECT rating, rating_change, result, created_at
    FROM rating_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [userId, limit]);
}

/**
 * Get win/loss stats by language for a user
 */
async function getStatsByLanguage(userId) {
  // Get wins by language
  const wins = await all(`
    SELECT winner_language as language, COUNT(*) as count
    FROM battles_history
    WHERE winner_id = ? AND winner_language IS NOT NULL
    GROUP BY winner_language
  `, [userId]);

  // Get losses by language
  const losses = await all(`
    SELECT loser_language as language, COUNT(*) as count
    FROM battles_history
    WHERE loser_id = ? AND loser_language IS NOT NULL
    GROUP BY loser_language
  `, [userId]);

  // Combine into a single object
  const stats = {};
  for (const w of wins) {
    if (!stats[w.language]) stats[w.language] = { wins: 0, losses: 0 };
    stats[w.language].wins = w.count;
  }
  for (const l of losses) {
    if (!stats[l.language]) stats[l.language] = { wins: 0, losses: 0 };
    stats[l.language].losses = l.count;
  }

  return stats;
}

/**
 * Get solve time trends (average solve time over recent battles)
 */
async function getSolveTimeTrends(userId, limit = 20) {
  return all(`
    SELECT
      winner_time as solve_time,
      created_at,
      problem_id
    FROM battles_history
    WHERE winner_id = ? AND winner_time IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ?
  `, [userId, limit]);
}

/**
 * Get comprehensive analytics for a user
 */
async function getUserAnalytics(userId) {
  const [stats, ratingHistory, languageStats, solveTimeTrends, recentBattles] = await Promise.all([
    getUserStats(userId),
    getRatingHistory(userId, 30),
    getStatsByLanguage(userId),
    getSolveTimeTrends(userId, 20),
    getUserBattleHistory(userId, 10)
  ]);

  return {
    stats,
    ratingHistory: ratingHistory.reverse(), // Oldest first for charts
    languageStats,
    solveTimeTrends: solveTimeTrends.reverse(),
    recentBattles
  };
}

// ============================================
// CODING SESSIONS (Behavioral Tracking)
// ============================================

/**
 * Start a new coding session
 */
async function startCodingSession(userId, { problemId, sessionType, language }) {
  const result = await run(`
    INSERT INTO coding_sessions (user_id, problem_id, session_type, language, start_time)
    VALUES (?, ?, ?, ?, datetime('now'))
  `, [userId, problemId, sessionType, language]);

  return result.lastID;
}

/**
 * Update coding session with behavioral metrics
 */
async function updateCodingSession(sessionId, metrics) {
  const {
    keystrokes,
    pastes,
    idleTime,
    activeTypingTime,
    codeSnapshot,
    revisionCount,
    linesAdded,
    linesDeleted
  } = metrics;

  // Get existing snapshots
  const session = await get(`SELECT code_snapshots FROM coding_sessions WHERE id = ?`, [sessionId]);
  let snapshots = [];
  try {
    snapshots = JSON.parse(session?.code_snapshots || '[]');
  } catch (e) {
    snapshots = [];
  }

  // Add new snapshot if provided
  if (codeSnapshot) {
    snapshots.push({
      timestamp: new Date().toISOString(),
      code: codeSnapshot,
      lines: codeSnapshot.split('\n').length
    });
    // Keep only last 10 snapshots
    if (snapshots.length > 10) {
      snapshots = snapshots.slice(-10);
    }
  }

  await run(`
    UPDATE coding_sessions SET
      total_keystrokes = COALESCE(total_keystrokes, 0) + ?,
      total_pastes = COALESCE(total_pastes, 0) + ?,
      idle_time = COALESCE(idle_time, 0) + ?,
      active_typing_time = COALESCE(active_typing_time, 0) + ?,
      code_snapshots = ?,
      revision_count = COALESCE(revision_count, 0) + ?,
      lines_added = COALESCE(lines_added, 0) + ?,
      lines_deleted = COALESCE(lines_deleted, 0) + ?
    WHERE id = ?
  `, [
    keystrokes || 0,
    pastes || 0,
    idleTime || 0,
    activeTypingTime || 0,
    JSON.stringify(snapshots),
    revisionCount || 0,
    linesAdded || 0,
    linesDeleted || 0,
    sessionId
  ]);
}

/**
 * End a coding session
 */
async function endCodingSession(sessionId, { solved, finalCode, firstKeystrokeDelay }) {
  const session = await get(`SELECT start_time FROM coding_sessions WHERE id = ?`, [sessionId]);
  if (!session) return;

  const startTime = new Date(session.start_time);
  const endTime = new Date();
  const totalDuration = Math.round((endTime - startTime) / 1000);

  await run(`
    UPDATE coding_sessions SET
      end_time = datetime('now'),
      total_duration = ?,
      first_keystroke_delay = ?,
      solved = ?,
      final_code = ?
    WHERE id = ?
  `, [totalDuration, firstKeystrokeDelay || null, solved ? 1 : 0, finalCode, sessionId]);
}

/**
 * Get user's coding sessions for analysis
 */
async function getUserCodingSessions(userId, limit = 50) {
  return all(`
    SELECT * FROM coding_sessions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [userId, limit]);
}

/**
 * Get aggregated behavioral stats for a user
 */
async function getUserBehavioralStats(userId) {
  const stats = await get(`
    SELECT
      COUNT(*) as total_sessions,
      SUM(CASE WHEN solved = 1 THEN 1 ELSE 0 END) as solved_sessions,
      AVG(total_duration) as avg_duration,
      AVG(first_keystroke_delay) as avg_thinking_time,
      AVG(active_typing_time) as avg_typing_time,
      AVG(idle_time) as avg_idle_time,
      AVG(total_keystrokes) as avg_keystrokes,
      AVG(revision_count) as avg_revisions,
      SUM(total_pastes) as total_pastes,
      AVG(CASE WHEN total_duration > 0 THEN (active_typing_time * 1.0 / total_duration) ELSE 0 END) as typing_ratio
    FROM coding_sessions
    WHERE user_id = ? AND end_time IS NOT NULL
  `, [userId]);

  return stats || {};
}

// ============================================
// PRACTICE MODE STATS
// ============================================

/**
 * Record a practice attempt
 */
async function recordPracticeAttempt(userId, { problemId, language, solved, solveTime, solutionCode }) {
  // Check if user already attempted this problem
  const existing = await get(`
    SELECT id, attempts, solved FROM practice_attempts
    WHERE user_id = ? AND problem_id = ?
  `, [userId, problemId]);

  if (existing) {
    // Update existing attempt
    await run(`
      UPDATE practice_attempts
      SET attempts = attempts + 1,
          solved = MAX(solved, ?),
          solve_time = CASE WHEN ? = 1 AND (solve_time IS NULL OR ? < solve_time) THEN ? ELSE solve_time END,
          language = CASE
            WHEN ? = 1 THEN ?
            WHEN solved = 0 THEN ?
            ELSE language
          END,
          solution_code = CASE WHEN ? = 1 AND ? IS NOT NULL THEN ? ELSE solution_code END,
          solution_submitted_at = CASE WHEN ? = 1 AND ? IS NOT NULL THEN datetime('now') ELSE solution_submitted_at END
      WHERE id = ?
    `, [
      solved ? 1 : 0,
      solved ? 1 : 0,
      solveTime,
      solveTime,
      solved ? 1 : 0,
      language,
      language,
      solved ? 1 : 0,
      solutionCode || null,
      solutionCode || null,
      solved ? 1 : 0,
      solutionCode || null,
      existing.id
    ]);
  } else {
    // Create new attempt record
    await run(`
      INSERT INTO practice_attempts (user_id, problem_id, language, solved, solve_time, solution_code, solution_submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE NULL END)
    `, [
      userId,
      problemId,
      language,
      solved ? 1 : 0,
      solved ? solveTime : null,
      solved ? solutionCode || null : null,
      solved ? solutionCode || null : null
    ]);
  }

  // Update aggregate practice stats
  await updatePracticeStats(userId);

  return { success: true };
}

/**
 * Update aggregate practice stats for a user
 */
async function updatePracticeStats(userId) {
  // Calculate aggregate stats from practice_attempts
  const stats = await get(`
    SELECT
      COUNT(DISTINCT problem_id) as problems_attempted,
      SUM(CASE WHEN solved = 1 THEN 1 ELSE 0 END) as problems_solved,
      AVG(CASE WHEN solved = 1 THEN solve_time ELSE NULL END) as avg_solve_time,
      MIN(CASE WHEN solved = 1 THEN solve_time ELSE NULL END) as fastest_solve,
      SUM(COALESCE(solve_time, 0)) as total_time
    FROM practice_attempts
    WHERE user_id = ?
  `, [userId]);

  // Upsert practice_stats
  await run(`
    INSERT INTO practice_stats (user_id, problems_solved, problems_attempted, total_time_spent, avg_solve_time, fastest_solve, last_practice)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      problems_solved = excluded.problems_solved,
      problems_attempted = excluded.problems_attempted,
      total_time_spent = excluded.total_time_spent,
      avg_solve_time = excluded.avg_solve_time,
      fastest_solve = excluded.fastest_solve,
      last_practice = excluded.last_practice
  `, [userId, stats.problems_solved || 0, stats.problems_attempted || 0, stats.total_time || 0,
      stats.avg_solve_time ? Math.round(stats.avg_solve_time) : null, stats.fastest_solve || null]);
}

/**
 * Get practice stats for a user
 */
async function getPracticeStats(userId) {
  const stats = await get(`
    SELECT * FROM practice_stats WHERE user_id = ?
  `, [userId]);

  // Get recent practice history
  const recent = await all(`
    SELECT problem_id, language, solved, solve_time, attempts, created_at
    FROM practice_attempts
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `, [userId]);

  // Get stats by difficulty (requires joining with problems data - simplified for now)
  const byLanguage = await all(`
    SELECT language, COUNT(*) as attempted, SUM(solved) as solved
    FROM practice_attempts
    WHERE user_id = ?
    GROUP BY language
  `, [userId]);

  const solvedProblems = await all(`
    SELECT
      pa.problem_id,
      (
        SELECT pa2.language
        FROM practice_attempts pa2
        WHERE pa2.user_id = pa.user_id
          AND pa2.problem_id = pa.problem_id
          AND pa2.solved = 1
        ORDER BY datetime(COALESCE(pa2.solution_submitted_at, pa2.created_at)) DESC
        LIMIT 1
      ) as language
    FROM practice_attempts pa
    WHERE pa.user_id = ?
      AND pa.solved = 1
    GROUP BY pa.problem_id
  `, [userId]);

  return {
    stats: stats || { problems_solved: 0, problems_attempted: 0, avg_solve_time: null, fastest_solve: null },
    recent,
    byLanguage,
    solvedProblems
  };
}

/**
 * Get the accepted practice solution a user submitted for a problem.
 */
async function getPracticeSolution(userId, problemId) {
  return get(`
    SELECT problem_id, language, solution_code, solution_submitted_at, solve_time
    FROM practice_attempts
    WHERE user_id = ?
      AND problem_id = ?
      AND solved = 1
      AND solution_code IS NOT NULL
    ORDER BY datetime(COALESCE(solution_submitted_at, created_at)) DESC
    LIMIT 1
  `, [userId, problemId]);
}

// ============================================
// PROMPT PRACTICE
// ============================================

/**
 * Record a prompt practice attempt
 */
async function recordPromptAttempt(userId, { challengeId, promptText, score, testsPassed, testsTotal, solved, timeSpent, pasteDetected, tabSwitchCount }) {
  await run(`
    INSERT INTO prompt_attempts (user_id, challenge_id, prompt_text, score, tests_passed, tests_total, solved, time_spent, paste_detected, tab_switch_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [userId, challengeId, promptText, score, testsPassed, testsTotal, solved ? 1 : 0, timeSpent || null, pasteDetected || 0, tabSwitchCount || 0]);

  await updatePromptPracticeStats(userId);
  return { success: true };
}

/**
 * Update aggregate prompt practice stats for a user
 */
async function updatePromptPracticeStats(userId) {
  const stats = await get(`
    SELECT
      COUNT(DISTINCT challenge_id) as challenges_attempted,
      COUNT(DISTINCT CASE WHEN solved = 1 THEN challenge_id END) as challenges_solved,
      COUNT(*) as total_attempts,
      AVG(score) as avg_score,
      MAX(score) as best_score
    FROM prompt_attempts
    WHERE user_id = ?
  `, [userId]);

  await run(`
    INSERT INTO prompt_practice_stats (user_id, challenges_solved, challenges_attempted, total_attempts, avg_score, best_score, last_practice)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      challenges_solved = excluded.challenges_solved,
      challenges_attempted = excluded.challenges_attempted,
      total_attempts = excluded.total_attempts,
      avg_score = excluded.avg_score,
      best_score = excluded.best_score,
      last_practice = excluded.last_practice
  `, [userId, stats.challenges_solved || 0, stats.challenges_attempted || 0, stats.total_attempts || 0,
      stats.avg_score ? Math.round(stats.avg_score) : null, stats.best_score || null]);
}

/**
 * Get prompt practice stats for a user
 */
async function getPromptPracticeStats(userId) {
  const stats = await get(`
    SELECT * FROM prompt_practice_stats WHERE user_id = ?
  `, [userId]);

  const recent = await all(`
    SELECT challenge_id, score, tests_passed, tests_total, solved, time_spent, created_at
    FROM prompt_attempts
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `, [userId]);

  const byCategory = await all(`
    SELECT challenge_id, MAX(score) as best_score, COUNT(*) as attempts, MAX(solved) as solved
    FROM prompt_attempts
    WHERE user_id = ?
    GROUP BY challenge_id
  `, [userId]);

  return {
    stats: stats || { challenges_solved: 0, challenges_attempted: 0, total_attempts: 0, avg_score: null, best_score: null },
    recent,
    byCategory
  };
}

/**
 * Get count of prompt attempts today for rate limiting
 */
async function getPromptAttemptsToday(userId) {
  const result = await get(`
    SELECT COUNT(*) as count FROM prompt_attempts
    WHERE user_id = ? AND created_at >= date('now')
  `, [userId]);
  return result?.count || 0;
}

// ============================================
// PRIVATE BATTLE STATS
// ============================================

/**
 * Update private battle stats (separate from ranked ELO)
 */
async function updatePrivateBattleStats(userId, result) {
  // Whitelist validation to prevent SQL injection
  const validColumns = {
    'win': 'private_wins',
    'loss': 'private_losses',
    'tie': 'private_ties'
  };

  const column = validColumns[result];
  if (!column) {
    throw new Error(`Invalid result type: ${result}`);
  }

  await run(`
    UPDATE user_stats SET ${column} = ${column} + 1 WHERE user_id = ?
  `, [userId]);
}

/**
 * Get private battle stats for a user
 */
async function getPrivateBattleStats(userId) {
  const stats = await get(`
    SELECT private_wins, private_losses, private_ties FROM user_stats WHERE user_id = ?
  `, [userId]);

  return stats || { private_wins: 0, private_losses: 0, private_ties: 0 };
}

// ============================================
// PRO STATUS & SUBSCRIPTION
// ============================================

/**
 * Check if user has Pro status
 */
async function isUserPro(userId) {
  const user = await get(`
    SELECT is_pro, pro_expires_at FROM users WHERE id = ?
  `, [userId]);

  if (!user || !user.is_pro) return false;

  // pro_expires_at must be set -- all legitimate grant paths provide a real date.
  // If it is NULL, treat as expired (prevents stale is_pro=1 rows from granting access).
  if (!user.pro_expires_at) {
    return false;
  }

  // Check if Pro has expired
  const expiresAt = new Date(user.pro_expires_at);
  if (expiresAt < new Date()) {
    // Pro has expired, update status
    await run(`UPDATE users SET is_pro = 0 WHERE id = ?`, [userId]);
    return false;
  }

  return true;
}

/**
 * Set user Pro status
 */
async function setUserProStatus(userId, isPro, expiresAt = null, stripeData = {}) {
  await run(`
    UPDATE users SET
      is_pro = ?,
      pro_expires_at = ?,
      stripe_customer_id = COALESCE(?, stripe_customer_id),
      stripe_subscription_id = COALESCE(?, stripe_subscription_id)
    WHERE id = ?
  `, [isPro ? 1 : 0, expiresAt, stripeData.customerId, stripeData.subscriptionId, userId]);
}

/**
 * Get user's subscription info
 */
async function getUserSubscription(userId) {
  return get(`
    SELECT is_pro, pro_expires_at, stripe_customer_id, stripe_subscription_id
    FROM users WHERE id = ?
  `, [userId]);
}

// ============================================
// WEBHOOK EVENT TRACKING (for deduplication)
// ============================================

/**
 * Check if a webhook event has already been successfully processed
 */
async function isWebhookEventProcessed(eventId) {
  const event = await get('SELECT id, status FROM webhook_events WHERE id = ?', [eventId]);
  // Only consider 'completed' as truly processed - allow retry of 'pending' or 'failed'
  return event?.status === 'completed';
}

/**
 * Start processing a webhook event (marks as 'pending')
 * Returns: { canProcess: true } if we can process
 *          { canProcess: false, reason: 'completed' } if already done
 *          { canProcess: false, reason: 'pending' } if another process is handling it
 */
async function startWebhookEventProcessing(eventId, eventType) {
  try {
    await run(
      'INSERT INTO webhook_events (id, event_type, processed_at, status) VALUES (?, ?, ?, ?)',
      [eventId, eventType, new Date().toISOString(), 'pending']
    );
    return { canProcess: true };
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed') || err.message?.includes('PRIMARY KEY')) {
      // Event exists - check its status
      const existing = await get('SELECT status FROM webhook_events WHERE id = ?', [eventId]);
      if (existing?.status === 'completed') {
        return { canProcess: false, reason: 'completed' };
      }
      if (existing?.status === 'failed') {
        // Previous attempt failed; allow Stripe's retry to re-run the handler.
        // Conditional UPDATE so we don't stomp a row another worker just moved to 'pending'.
        const result = await run(
          `UPDATE webhook_events
             SET status = 'pending', error_message = NULL, processed_at = ?
           WHERE id = ? AND status = 'failed'`,
          [new Date().toISOString(), eventId]
        );
        if (result.changes > 0) {
          return { canProcess: true };
        }
        // Lost the race - re-read and fall through to status-based response
        const recheck = await get('SELECT status FROM webhook_events WHERE id = ?', [eventId]);
        if (recheck?.status === 'completed') {
          return { canProcess: false, reason: 'completed' };
        }
        return { canProcess: false, reason: recheck?.status || 'unknown' };
      }
      return { canProcess: false, reason: existing?.status || 'unknown' };
    }
    throw err;
  }
}

/**
 * Mark a webhook event as successfully completed
 */
async function completeWebhookEvent(eventId) {
  await run(
    'UPDATE webhook_events SET status = ?, processed_at = ? WHERE id = ?',
    ['completed', new Date().toISOString(), eventId]
  );
}

/**
 * Mark a webhook event as failed (allows Stripe retry)
 */
async function failWebhookEvent(eventId, errorMessage) {
  await run(
    'UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?',
    ['failed', errorMessage?.substring(0, 500) || 'Unknown error', eventId]
  );
}

/**
 * @deprecated Use startWebhookEventProcessing + completeWebhookEvent instead
 * Mark a webhook event as processed (returns false if already exists)
 */
async function markWebhookEventProcessed(eventId, eventType) {
  try {
    await run(
      'INSERT INTO webhook_events (id, event_type, processed_at, status) VALUES (?, ?, ?, ?)',
      [eventId, eventType, new Date().toISOString(), 'completed']
    );
    return true;
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed') || err.message?.includes('PRIMARY KEY')) {
      return false;
    }
    throw err;
  }
}

/**
 * Atomically activate Pro status (prevents race conditions)
 * Returns true if Pro was activated, false if already Pro
 */
async function activateProIfNotAlready(userId, expiresAt, stripeData = {}) {
  // Use a single UPDATE that only affects non-Pro users
  const result = await run(`
    UPDATE users SET
      is_pro = 1,
      pro_expires_at = ?,
      stripe_customer_id = COALESCE(?, stripe_customer_id),
      stripe_subscription_id = COALESCE(?, stripe_subscription_id)
    WHERE id = ? AND (is_pro = 0 OR is_pro IS NULL)
  `, [expiresAt, stripeData.customerId, stripeData.subscriptionId, userId]);

  return result.changes > 0;
}

// ============================================
// CAMPAIGN (LinkedIn Launch), capped Pro trial claims
// ============================================

/**
 * Atomic claim: per-post cap + one-per-account + grant Pro in a single transaction.
 * Returns { success: true, postTag, proExpiresAt } on grant, or
 *         { success: false, code, ... } for any soft failure.
 * Throws only on unexpected errors.
 *
 * Serialized through a module-level promise chain because node-sqlite3 shares one
 * connection, two concurrent BEGIN IMMEDIATE statements collide with
 * "cannot start a transaction within a transaction". A single Node process →
 * JS-level mutex is sufficient; throughput is plenty (~50ms per claim).
 */
let _campaignClaimQueue = Promise.resolve();
function claimCampaignProTrial(userId, postTag) {
  const job = _campaignClaimQueue.then(() => _claimCampaignProTrialImpl(userId, postTag));
  _campaignClaimQueue = job.catch(() => {}); // failures don't poison the chain
  return job;
}

async function _claimCampaignProTrialImpl(userId, postTag) {
  try {
    let payload;
    await withTransaction(async () => {
      const config = await get('SELECT kill_switch FROM campaign_config WHERE id = 1');
      if (config?.kill_switch) {
        const e = new Error('campaign_disabled'); e.code = 'campaign_disabled'; throw e;
      }

      const capRow = await get('SELECT cap FROM campaign_post_caps WHERE post_tag = ?', [postTag]);
      if (!capRow) {
        const e = new Error('invalid_post_tag'); e.code = 'invalid_post_tag'; throw e;
      }

      // Atomic conditional increment, only succeeds if room remains
      const incRes = await run(`
        UPDATE campaign_post_caps
        SET claimed_count = claimed_count + 1
        WHERE post_tag = ? AND claimed_count < cap
      `, [postTag]);
      if (incRes.changes === 0) {
        const e = new Error('post_full'); e.code = 'post_full'; throw e;
      }

      const user = await get('SELECT pro_expires_at FROM users WHERE id = ?', [userId]);
      if (!user) {
        const e = new Error('user_not_found'); e.code = 'user_not_found'; throw e;
      }
      const now = new Date();
      const currentExpiry = user.pro_expires_at ? new Date(user.pro_expires_at) : null;
      const baseDate = (currentExpiry && !Number.isNaN(currentExpiry.getTime()) && currentExpiry > now)
        ? currentExpiry : now;
      const expiresAt = new Date(baseDate.getTime());
      expiresAt.setMonth(expiresAt.getMonth() + 3);
      const expiresAtIso = expiresAt.toISOString();

      // INSERT, UNIQUE(user_id) catches concurrent double-claims; rollback unwinds cap increment
      try {
        await run(`
          INSERT INTO campaign_claims (user_id, post_tag, claimed_at, pro_granted_until)
          VALUES (?, ?, ?, ?)
        `, [userId, postTag, now.toISOString(), expiresAtIso]);
      } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          const e = new Error('already_claimed'); e.code = 'already_claimed'; throw e;
        }
        throw err;
      }

      await run(`
        UPDATE users SET is_pro = 1, pro_expires_at = ? WHERE id = ?
      `, [expiresAtIso, userId]);

      payload = { success: true, postTag, proExpiresAt: expiresAtIso };
    });
    return payload;
  } catch (err) {
    if (err && err.code === 'already_claimed') {
      const existing = await get(
        'SELECT post_tag, pro_granted_until, claimed_at FROM campaign_claims WHERE user_id = ?',
        [userId]
      );
      return { success: false, code: 'already_claimed', existing };
    }
    if (err && err.code) {
      return { success: false, code: err.code };
    }
    throw err;
  }
}

/**
 * Public-safe status for a given post tag (drives "X of 100 spots left").
 */
async function getCampaignPublicStatus(postTag) {
  const cap = await get('SELECT cap, claimed_count FROM campaign_post_caps WHERE post_tag = ?', [postTag]);
  if (!cap) return null;
  const config = await get('SELECT kill_switch FROM campaign_config WHERE id = 1');
  const killSwitch = !!(config && config.kill_switch);
  const spotsLeft = Math.max(0, cap.cap - cap.claimed_count);
  return {
    postTag,
    cap: cap.cap,
    claimedCount: cap.claimed_count,
    spotsLeft,
    isClosed: killSwitch || spotsLeft === 0,
    killSwitch
  };
}

async function getCampaignClaimForUser(userId) {
  return get(
    'SELECT user_id, post_tag, claimed_at, pro_granted_until FROM campaign_claims WHERE user_id = ?',
    [userId]
  );
}

/**
 * Minutes of AI trial time used since the campaign claim. Always 0 now.
 */
async function getCampaignTrialMinutesUsed(userId) {
  // AI voice interviews were removed from CodeArena; nothing accrues against the cap.
  return 0;
}

async function getCampaignAiMinutesCap() {
  const row = await get('SELECT ai_minutes_cap FROM campaign_config WHERE id = 1');
  return (row && row.ai_minutes_cap) != null ? row.ai_minutes_cap : 60;
}

/**
 * Returns whether the campaign minute cap currently applies to this user
 * and, if so, how much they've used. Paid Pro (stripe_subscription_id present)
 * bypasses the trial cap.
 */
async function getCampaignTrialMinuteCapStatus(userId) {
  const claim = await get('SELECT claimed_at FROM campaign_claims WHERE user_id = ?', [userId]);
  if (!claim) return { capped: false };

  const user = await get('SELECT stripe_subscription_id FROM users WHERE id = ?', [userId]);
  if (user && user.stripe_subscription_id) return { capped: false };

  const cap = await getCampaignAiMinutesCap();
  if (!cap || cap <= 0) return { capped: false };

  const used = await getCampaignTrialMinutesUsed(userId);
  return {
    capped: true,
    cap,
    used,
    remaining: Math.max(0, cap - used),
    exceeded: used >= cap
  };
}

async function setCampaignKillSwitch(enabled) {
  await run(
    `UPDATE campaign_config SET kill_switch = ?, updated_at = datetime('now') WHERE id = 1`,
    [enabled ? 1 : 0]
  );
}

async function setCampaignAiMinutesCap(cap) {
  const safe = Math.max(0, parseInt(cap, 10) || 0);
  await run(
    `UPDATE campaign_config SET ai_minutes_cap = ?, updated_at = datetime('now') WHERE id = 1`,
    [safe]
  );
}

async function getCampaignAdminSummary() {
  const config = await get('SELECT kill_switch, ai_minutes_cap, updated_at FROM campaign_config WHERE id = 1');
  const caps = await all('SELECT post_tag, cap, claimed_count FROM campaign_post_caps ORDER BY post_tag');
  const totalRow = await get('SELECT COUNT(*) AS total FROM campaign_claims');
  return {
    config: config || { kill_switch: 0, ai_minutes_cap: 60, updated_at: null },
    posts: caps.map(c => ({
      postTag: c.post_tag,
      cap: c.cap,
      claimedCount: c.claimed_count,
      spotsLeft: Math.max(0, c.cap - c.claimed_count)
    })),
    totalClaims: (totalRow && totalRow.total) || 0
  };
}

// ============================================
// TOKEN VERSION (for invalidation on password change)
// ============================================

/**
 * Get user's current token version
 */
async function getTokenVersion(userId) {
  const user = await get('SELECT token_version FROM users WHERE id = ?', [userId]);
  return user?.token_version || 1;
}

/**
 * Increment user's token version (invalidates all existing tokens)
 */
async function incrementTokenVersion(userId) {
  await run('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?', [userId]);
  const user = await get('SELECT token_version FROM users WHERE id = ?', [userId]);
  return user?.token_version || 1;
}

/**
 * Verify token version matches (returns false if token is invalidated)
 */
async function isTokenVersionValid(userId, tokenVersion) {
  const currentVersion = await getTokenVersion(userId);
  return currentVersion === tokenVersion;
}

// ============================================
// AI COACHING - CODER PROFILES
// ============================================

/**
 * Get or create a coder profile
 */
async function getCoderProfile(userId) {
  let profile = await get(`SELECT * FROM coder_profiles WHERE user_id = ?`, [userId]);

  if (!profile) {
    await run(`
      INSERT INTO coder_profiles (user_id) VALUES (?)
    `, [userId]);
    profile = await get(`SELECT * FROM coder_profiles WHERE user_id = ?`, [userId]);
  }

  // Parse JSON fields
  if (profile) {
    try {
      profile.strengths = JSON.parse(profile.strengths || '[]');
      profile.growth_areas = JSON.parse(profile.growth_areas || '[]');
    } catch (e) {
      profile.strengths = [];
      profile.growth_areas = [];
    }
  }

  return profile;
}

/**
 * Update coder profile with AI analysis results
 */
async function updateCoderProfile(userId, analysisData) {
  const {
    archetype,
    archetypeConfidence,
    avgThinkingTime,
    avgTypingSpeed,
    avgRevisionCount,
    pasteFrequency,
    strengths,
    growthAreas,
    improvementRate,
    consistencyScore,
    sessionsAnalyzed
  } = analysisData;

  await run(`
    UPDATE coder_profiles SET
      archetype = COALESCE(?, archetype),
      archetype_confidence = COALESCE(?, archetype_confidence),
      avg_thinking_time = COALESCE(?, avg_thinking_time),
      avg_typing_speed = COALESCE(?, avg_typing_speed),
      avg_revision_count = COALESCE(?, avg_revision_count),
      paste_frequency = COALESCE(?, paste_frequency),
      strengths = COALESCE(?, strengths),
      growth_areas = COALESCE(?, growth_areas),
      improvement_rate = COALESCE(?, improvement_rate),
      consistency_score = COALESCE(?, consistency_score),
      last_analyzed = datetime('now'),
      sessions_analyzed = COALESCE(?, sessions_analyzed),
      updated_at = datetime('now')
    WHERE user_id = ?
  `, [
    archetype,
    archetypeConfidence,
    avgThinkingTime,
    avgTypingSpeed,
    avgRevisionCount,
    pasteFrequency,
    strengths ? JSON.stringify(strengths) : null,
    growthAreas ? JSON.stringify(growthAreas) : null,
    improvementRate,
    consistencyScore,
    sessionsAnalyzed,
    userId
  ]);
}

// ============================================
// AI COACHING - PROBLEM CATEGORY STATS
// ============================================

/**
 * Update stats for a problem category
 */
async function updateProblemCategoryStats(userId, category, { solved, solveTime }) {
  const existing = await get(`
    SELECT * FROM problem_category_stats WHERE user_id = ? AND category = ?
  `, [userId, category]);

  if (existing) {
    const newAttempted = existing.problems_attempted + 1;
    const newSolved = existing.problems_solved + (solved ? 1 : 0);
    let newAvgTime = existing.avg_solve_time;
    let fastestSolve = existing.fastest_solve;

    if (solved && solveTime) {
      // Recalculate average
      if (existing.avg_solve_time && existing.problems_solved > 0) {
        const totalTime = existing.avg_solve_time * existing.problems_solved + solveTime;
        newAvgTime = totalTime / newSolved;
      } else {
        newAvgTime = solveTime;
      }

      // Track fastest
      if (!fastestSolve || solveTime < fastestSolve) {
        fastestSolve = solveTime;
      }
    }

    // Calculate improvement
    const currentAvgTime = newAvgTime;
    const initialAvgTime = existing.initial_avg_time || currentAvgTime;
    const improvementPercent = initialAvgTime > 0 && currentAvgTime > 0
      ? Math.round(((initialAvgTime - currentAvgTime) / initialAvgTime) * 100)
      : 0;

    await run(`
      UPDATE problem_category_stats SET
        problems_attempted = ?,
        problems_solved = ?,
        avg_solve_time = ?,
        fastest_solve = ?,
        current_avg_time = ?,
        improvement_percent = ?,
        updated_at = datetime('now')
      WHERE user_id = ? AND category = ?
    `, [newAttempted, newSolved, newAvgTime, fastestSolve, currentAvgTime, improvementPercent, userId, category]);
  } else {
    await run(`
      INSERT INTO problem_category_stats
        (user_id, category, problems_attempted, problems_solved, avg_solve_time, fastest_solve, initial_avg_time, current_avg_time)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?)
    `, [userId, category, solved ? 1 : 0, solved ? solveTime : null, solved ? solveTime : null, solved ? solveTime : null, solved ? solveTime : null]);
  }
}

/**
 * Get problem category stats for a user
 */
async function getProblemCategoryStats(userId) {
  return all(`
    SELECT * FROM problem_category_stats
    WHERE user_id = ?
    ORDER BY problems_attempted DESC
  `, [userId]);
}

/**
 * Get progress dashboard data with optimized batched queries
 * Combines 8 queries into 3 batched queries for better performance
 */
async function getProgressDashboardData(userId) {
  // Batch 1: Core stats (single query with JOIN)
  const coreStatsPromise = get(`
    SELECT
      us.*,
      cp.archetype,
      cp.strengths,
      cp.growth_areas,
      cp.improvement_rate,
      cp.consistency_score
    FROM user_stats us
    LEFT JOIN coder_profiles cp ON us.user_id = cp.user_id
    WHERE us.user_id = ?
  `, [userId]);

  // Batch 2: Time-series data (parallel but grouped)
  const timeSeriesPromise = Promise.all([
    all(`
      SELECT rating, rating_change, result, created_at
      FROM rating_history
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `, [userId]),
    all(`
      SELECT
        b.*,
        winner.username as winner_username,
        loser.username as loser_username
      FROM battles_history b
      LEFT JOIN users winner ON b.winner_id = winner.id
      LEFT JOIN users loser ON b.loser_id = loser.id
      WHERE b.winner_id = ? OR b.loser_id = ?
      ORDER BY b.created_at DESC
      LIMIT 50
    `, [userId, userId])
  ]);

  // Batch 3: Aggregated stats (parallel)
  const aggregatedPromise = Promise.all([
    getStatsByLanguage(userId),
    get(`SELECT * FROM practice_stats WHERE user_id = ?`, [userId]),
    all(`
      SELECT * FROM problem_category_stats
      WHERE user_id = ?
      ORDER BY problems_attempted DESC
    `, [userId]),
    get(`
      SELECT
        COUNT(*) as total_sessions,
        SUM(CASE WHEN solved = 1 THEN 1 ELSE 0 END) as solved_sessions,
        AVG(total_duration) as avg_duration,
        AVG(active_typing_time) as avg_typing_time,
        AVG(idle_time) as avg_idle_time,
        SUM(total_keystrokes) as total_keystrokes,
        SUM(total_pastes) as total_pastes,
        AVG(revision_count) as avg_revisions
      FROM coding_sessions
      WHERE user_id = ?
    `, [userId]),
    // Recent activity across all game modes
    all(`
      SELECT * FROM (
        SELECT 'coding_battle' as type,
          CASE
            WHEN bh.is_tie = 1 AND bh.winner_id = ? THEN 'Draw with ' || COALESCE(loser.username, 'Unknown')
            WHEN bh.is_tie = 1 THEN 'Draw with ' || COALESCE(winner.username, 'Unknown')
            WHEN bh.winner_id = ? THEN 'Won vs ' || COALESCE(loser.username, 'Unknown')
            WHEN bh.loser_id = ? THEN 'Lost to ' || COALESCE(winner.username, 'Unknown')
            ELSE 'Draw'
          END as title,
          CASE
            WHEN bh.is_tie = 1 THEN 'draw'
            WHEN bh.winner_id = ? THEN 'win'
            ELSE 'loss'
          END as result,
          NULL as score,
          json_object('language', '', 'opponent', CASE WHEN bh.winner_id = ? THEN COALESCE(loser.username, 'Unknown') ELSE COALESCE(winner.username, 'Unknown') END) as metadata,
          COALESCE(bh.finished_at, bh.created_at) as timestamp
        FROM battles_history bh
        LEFT JOIN users winner ON bh.winner_id = winner.id
        LEFT JOIN users loser ON bh.loser_id = loser.id
        WHERE bh.winner_id = ? OR bh.loser_id = ?
        ORDER BY timestamp DESC LIMIT 15
      )

      UNION ALL

      SELECT * FROM (
        SELECT 'agent_battle' as type,
          CASE
            WHEN ab.winner_id = ? THEN 'Agent battle won'
            WHEN ab.winner_id IS NULL THEN 'Agent battle draw'
            ELSE 'Agent battle lost'
          END as title,
          CASE
            WHEN ab.winner_id = ? THEN 'win'
            WHEN ab.winner_id IS NULL THEN 'draw'
            ELSE 'loss'
          END as result,
          NULL as score,
          '{}' as metadata,
          ab.created_at as timestamp
        FROM agent_battles ab
        WHERE (ab.player1_id = ? OR ab.player2_id = ?) AND ab.status = 'completed'
        ORDER BY timestamp DESC LIMIT 15
      )

      UNION ALL

      SELECT * FROM (
        SELECT 'solo_practice' as type,
          CASE WHEN pa.solved = 1 THEN 'Solved practice problem' ELSE 'Attempted practice problem' END as title,
          CASE WHEN pa.solved = 1 THEN 'solved' ELSE 'attempted' END as result,
          NULL as score,
          json_object('language', pa.language, 'problem_id', pa.problem_id) as metadata,
          pa.created_at as timestamp
        FROM practice_attempts pa
        WHERE pa.user_id = ?
        ORDER BY timestamp DESC LIMIT 15
      )

      UNION ALL

      SELECT * FROM (
        SELECT 'prompt_practice' as type,
          'Prompt practice' as title,
          CASE WHEN pt.solved = 1 THEN 'solved' ELSE 'attempted' END as result,
          pt.score as score,
          json_object('challenge_id', pt.challenge_id, 'tests_passed', pt.tests_passed, 'tests_total', pt.tests_total) as metadata,
          pt.created_at as timestamp
        FROM prompt_attempts pt
        WHERE pt.user_id = ?
        ORDER BY timestamp DESC LIMIT 15
      )

      UNION ALL

      SELECT * FROM (
        SELECT 'game_created' as type,
          'Created game: ' || g.title as title,
          NULL as result,
          NULL as score,
          json_object('game_type', g.game_type, 'status', g.status) as metadata,
          g.created_at as timestamp
        FROM games g
        WHERE g.creator_id = ?
        ORDER BY timestamp DESC LIMIT 15
      )

      UNION ALL

      SELECT * FROM (
        SELECT 'prompt_1v1' as type,
          CASE
            WHEN pbh.winner_id = CAST(? AS TEXT) THEN 'Prompt 1v1 won'
            WHEN pbh.is_tie = 1 THEN 'Prompt 1v1 draw'
            ELSE 'Prompt 1v1 lost'
          END as title,
          CASE
            WHEN pbh.winner_id = CAST(? AS TEXT) THEN 'win'
            WHEN pbh.is_tie = 1 THEN 'draw'
            ELSE 'loss'
          END as result,
          CASE WHEN pbh.player1_id = CAST(? AS TEXT) THEN pbh.player1_score ELSE pbh.player2_score END as score,
          json_object('opponent', CASE WHEN pbh.player1_id = CAST(? AS TEXT) THEN COALESCE(pbh.player2_username, 'Unknown') ELSE COALESCE(pbh.player1_username, 'Unknown') END) as metadata,
          pbh.finished_at as timestamp
        FROM prompt_battle_history pbh
        WHERE pbh.player1_id = CAST(? AS TEXT) OR pbh.player2_id = CAST(? AS TEXT)
        ORDER BY timestamp DESC LIMIT 15
      )

      ORDER BY timestamp DESC
      LIMIT 15
    `, [
      userId, userId, userId, userId, userId, userId, userId,
      userId, userId, userId, userId,
      userId,
      userId,
      userId,
      userId, userId, userId, userId, userId, userId
    ]),
    // Prompt score history for sparklines
    all(`
      SELECT challenge_id, score, created_at
      FROM prompt_attempts
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `, [userId])
  ]);

  // Execute all batches in parallel
  const [coreStats, [ratingHistory, battleHistory], [languageStats, practiceStats, categoryStats, behavioralStats, rawRecentActivity, rawPromptScoreHistory]] =
    await Promise.all([coreStatsPromise, timeSeriesPromise, aggregatedPromise]);

  // Parse metadata JSON strings in recent activity
  const recentActivity = (rawRecentActivity || []).map(row => ({
    ...row,
    metadata: (() => { try { return JSON.parse(row.metadata); } catch { return {}; } })()
  }));

  // Group prompt score history by challenge_id for sparklines
  const promptScoreHistory = {};
  (rawPromptScoreHistory || []).forEach(r => {
    if (!promptScoreHistory[r.challenge_id]) promptScoreHistory[r.challenge_id] = [];
    promptScoreHistory[r.challenge_id].push(r.score);
  });
  // Query returns newest-first; reverse so sparklines read left-to-right chronologically
  Object.values(promptScoreHistory).forEach(arr => arr.reverse());

  // Extract coder profile from core stats
  const coderProfile = coreStats ? {
    archetype: coreStats.archetype,
    strengths: coreStats.strengths,
    growth_areas: coreStats.growth_areas,
    improvement_rate: coreStats.improvement_rate,
    consistency_score: coreStats.consistency_score
  } : null;

  // Clean stats object (remove profile fields)
  const stats = coreStats ? {
    user_id: coreStats.user_id,
    rating: coreStats.rating,
    wins: coreStats.wins,
    losses: coreStats.losses,
    ties: coreStats.ties,
    total_battles: coreStats.total_battles,
    win_streak: coreStats.win_streak,
    best_win_streak: coreStats.best_win_streak,
    avg_solve_time: coreStats.avg_solve_time,
    fastest_solve: coreStats.fastest_solve,
    daily_streak: coreStats.daily_streak
  } : null;

  return {
    stats,
    ratingHistory,
    languageStats,
    practiceStats: {
      stats: practiceStats,
      byLanguage: [],
      recent: []
    },
    battleHistory,
    behavioralStats,
    coderProfile,
    categoryStats: categoryStats || [],
    recentActivity,
    promptScoreHistory
  };
}

/**
 * Get weak categories for recommendations
 */
async function getWeakCategories(userId, limit = 3) {
  return all(`
    SELECT category,
           problems_solved,
           problems_attempted,
           ROUND(problems_solved * 100.0 / problems_attempted, 1) as solve_rate,
           avg_solve_time
    FROM problem_category_stats
    WHERE user_id = ? AND problems_attempted >= 3
    ORDER BY (problems_solved * 1.0 / problems_attempted) ASC
    LIMIT ?
  `, [userId, limit]);
}

/**
 * Get strong categories (strengths)
 */
async function getStrongCategories(userId, limit = 3) {
  return all(`
    SELECT category,
           problems_solved,
           problems_attempted,
           ROUND(problems_solved * 100.0 / problems_attempted, 1) as solve_rate,
           avg_solve_time,
           improvement_percent
    FROM problem_category_stats
    WHERE user_id = ? AND problems_solved >= 2
    ORDER BY (problems_solved * 1.0 / problems_attempted) DESC
    LIMIT ?
  `, [userId, limit]);
}

// ============================================
// AI COACHING - INSIGHTS & MILESTONES
// ============================================

/**
 * Save a coaching insight
 */
async function saveCoachingInsight(userId, { insightType, title, content, priority, relatedSessions, evidence }) {
  const result = await run(`
    INSERT INTO coaching_insights (user_id, insight_type, title, content, priority, related_sessions, evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [userId, insightType, title, content, priority || 5, JSON.stringify(relatedSessions || []), JSON.stringify(evidence || {})]);

  return result.lastID;
}

/**
 * Get active coaching insights for a user
 */
async function getActiveInsights(userId, limit = 5) {
  return all(`
    SELECT * FROM coaching_insights
    WHERE user_id = ? AND dismissed = 0
    ORDER BY priority DESC, created_at DESC
    LIMIT ?
  `, [userId, limit]);
}

/**
 * Dismiss an insight
 */
async function dismissInsight(insightId) {
  await run(`UPDATE coaching_insights SET dismissed = 1 WHERE id = ?`, [insightId]);
}

/**
 * Mark an insight as acted upon
 */
async function markInsightActedOn(insightId) {
  await run(`UPDATE coaching_insights SET acted_on = 1 WHERE id = ?`, [insightId]);
}

/**
 * Record a learning milestone
 */
async function recordMilestone(userId, { milestoneType, title, description, achievedValue, previousValue }) {
  const improvementPercent = previousValue > 0
    ? Math.round(((achievedValue - previousValue) / previousValue) * 100)
    : 100;

  const result = await run(`
    INSERT INTO learning_milestones (user_id, milestone_type, title, description, achieved_value, previous_value, improvement_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [userId, milestoneType, title, description, achievedValue, previousValue, improvementPercent]);

  return result.lastID;
}

/**
 * Get recent milestones
 */
async function getRecentMilestones(userId, limit = 10) {
  return all(`
    SELECT * FROM learning_milestones
    WHERE user_id = ?
    ORDER BY unlocked_at DESC
    LIMIT ?
  `, [userId, limit]);
}

/**
 * Check for and create new milestones based on current stats
 */
async function checkForNewMilestones(userId, currentStats) {
  const milestones = [];
  const existingMilestones = await all(`
    SELECT milestone_type, achieved_value FROM learning_milestones WHERE user_id = ?
  `, [userId]);

  const existingTypes = new Map(existingMilestones.map(m => [m.milestone_type, m.achieved_value]));

  // First solve
  if (currentStats.totalSolved >= 1 && !existingTypes.has('first_solve')) {
    const id = await recordMilestone(userId, {
      milestoneType: 'first_solve',
      title: '🎯 First Blood',
      description: 'Solved your first problem!',
      achievedValue: 1,
      previousValue: 0
    });
    milestones.push({ id, type: 'first_solve' });
  }

  // Problem count milestones
  const problemMilestones = [10, 25, 50, 100, 250, 500];
  for (const count of problemMilestones) {
    const type = `problems_${count}`;
    if (currentStats.totalSolved >= count && !existingTypes.has(type)) {
      const id = await recordMilestone(userId, {
        milestoneType: type,
        title: `🏆 ${count} Problems Solved`,
        description: `You've conquered ${count} problems!`,
        achievedValue: count,
        previousValue: existingTypes.get(`problems_${problemMilestones[problemMilestones.indexOf(count) - 1]}`) || 0
      });
      milestones.push({ id, type });
    }
  }

  // Speed milestones (fastest solve)
  if (currentStats.fastestSolve) {
    const speedMilestones = [
      { time: 60, title: '⚡ Speed Demon', desc: 'Solved a problem in under 60 seconds!' },
      { time: 30, title: '🚀 Lightning Fast', desc: 'Solved a problem in under 30 seconds!' },
      { time: 15, title: '💫 Impossible Speed', desc: 'Solved a problem in under 15 seconds!' }
    ];

    for (const milestone of speedMilestones) {
      const type = `speed_${milestone.time}`;
      if (currentStats.fastestSolve <= milestone.time && !existingTypes.has(type)) {
        const id = await recordMilestone(userId, {
          milestoneType: type,
          title: milestone.title,
          description: milestone.desc,
          achievedValue: currentStats.fastestSolve,
          previousValue: existingTypes.get(type) || milestone.time + 1
        });
        milestones.push({ id, type });
      }
    }
  }

  // Win streak milestones
  const streakMilestones = [3, 5, 10, 25];
  for (const streak of streakMilestones) {
    const type = `streak_${streak}`;
    if (currentStats.winStreak >= streak && !existingTypes.has(type)) {
      const id = await recordMilestone(userId, {
        milestoneType: type,
        title: `🔥 ${streak} Win Streak`,
        description: `Won ${streak} battles in a row!`,
        achievedValue: streak,
        previousValue: existingTypes.get(`streak_${streakMilestones[streakMilestones.indexOf(streak) - 1]}`) || 0
      });
      milestones.push({ id, type });
    }
  }

  return milestones;
}

// ============================================
// AI COACHING - WEEKLY DIGESTS
// ============================================

/**
 * Generate or get weekly digest
 */
async function getWeeklyDigest(userId, weekStart) {
  return get(`
    SELECT * FROM weekly_digests
    WHERE user_id = ? AND week_start = ?
  `, [userId, weekStart]);
}

/**
 * Save weekly digest
 */
async function saveWeeklyDigest(userId, digestData) {
  const {
    weekStart,
    weekEnd,
    sessionsCount,
    problemsSolved,
    totalTimeSpent,
    summary,
    keyInsights,
    recommendations,
    vsPreviousWeek
  } = digestData;

  await run(`
    INSERT INTO weekly_digests (user_id, week_start, week_end, sessions_count, problems_solved, total_time_spent, summary, key_insights, recommendations, vs_previous_week)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, week_start) DO UPDATE SET
      sessions_count = excluded.sessions_count,
      problems_solved = excluded.problems_solved,
      total_time_spent = excluded.total_time_spent,
      summary = excluded.summary,
      key_insights = excluded.key_insights,
      recommendations = excluded.recommendations,
      vs_previous_week = excluded.vs_previous_week
  `, [
    userId, weekStart, weekEnd, sessionsCount || 0, problemsSolved || 0, totalTimeSpent || 0,
    summary, JSON.stringify(keyInsights || []), JSON.stringify(recommendations || []), JSON.stringify(vsPreviousWeek || {})
  ]);
}

/**
 * Get recent weekly digests
 */
async function getRecentDigests(userId, limit = 4) {
  const digests = await all(`
    SELECT * FROM weekly_digests
    WHERE user_id = ?
    ORDER BY week_start DESC
    LIMIT ?
  `, [userId, limit]);

  // Parse JSON fields
  return digests.map(d => ({
    ...d,
    key_insights: JSON.parse(d.key_insights || '[]'),
    recommendations: JSON.parse(d.recommendations || '[]'),
    vs_previous_week: JSON.parse(d.vs_previous_week || '{}')
  }));
}

// ============================================
// AI COACHING - COMPREHENSIVE ANALYTICS
// ============================================

/**
 * Get comprehensive data for AI analysis
 */
async function getComprehensiveCoachingData(userId) {
  const [
    profile,
    behavioralStats,
    recentSessions,
    categoryStats,
    practiceStats,
    battleStats,
    activeInsights,
    recentMilestones,
    weeklyDigests
  ] = await Promise.all([
    getCoderProfile(userId),
    getUserBehavioralStats(userId),
    getUserCodingSessions(userId, 30),
    getProblemCategoryStats(userId),
    getPracticeStats(userId),
    getUserStats(userId),
    getActiveInsights(userId, 10),
    getRecentMilestones(userId, 5),
    getRecentDigests(userId, 4)
  ]);

  return {
    profile,
    behavioralStats,
    recentSessions,
    categoryStats,
    practiceStats,
    battleStats,
    activeInsights,
    recentMilestones,
    weeklyDigests
  };
}

/**
 * Cache AI feedback to avoid repeated API calls
 */
async function cacheAIFeedback(userId, feedbackType, feedbackData, expiresInHours = 6) {
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  await run(`
    DELETE FROM ai_feedback_cache WHERE user_id = ? AND feedback_type = ?
  `, [userId, feedbackType]);

  await run(`
    INSERT INTO ai_feedback_cache (user_id, feedback_type, feedback_data, expires_at)
    VALUES (?, ?, ?, ?)
  `, [userId, feedbackType, JSON.stringify(feedbackData), expiresAt]);
}

/**
 * Get cached AI feedback
 */
async function getCachedAIFeedback(userId, feedbackType) {
  const cached = await get(`
    SELECT feedback_data, expires_at FROM ai_feedback_cache
    WHERE user_id = ? AND feedback_type = ?
  `, [userId, feedbackType]);

  if (!cached) return null;

  // Check expiration
  if (new Date(cached.expires_at) < new Date()) {
    await run(`DELETE FROM ai_feedback_cache WHERE user_id = ? AND feedback_type = ?`, [userId, feedbackType]);
    return null;
  }

  try {
    return JSON.parse(cached.feedback_data);
  } catch (e) {
    return null;
  }
}

// ============================================
// BADGES SYSTEM
// ============================================

/**
 * Get all badges (optionally filtered by category)
 */
async function getAllBadges(category = null) {
  if (category) {
    return await all(
      'SELECT * FROM badges WHERE is_active = 1 AND category = ? ORDER BY sort_order',
      [category]
    );
  }
  return await all('SELECT * FROM badges WHERE is_active = 1 ORDER BY sort_order');
}

/**
 * Get a badge by its slug
 */
async function getBadgeBySlug(slug) {
  return await get('SELECT * FROM badges WHERE slug = ?', [slug]);
}

/**
 * Get all badges earned by a user
 */
async function getUserBadges(userId) {
  return await all(`
    SELECT b.*, ub.earned_at, ub.notified
    FROM user_badges ub
    JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ?
    ORDER BY ub.earned_at DESC
  `, [userId]);
}

/**
 * Check if user has a specific badge
 */
async function userHasBadge(userId, badgeSlug) {
  const result = await get(`
    SELECT ub.id FROM user_badges ub
    JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ? AND b.slug = ?
  `, [userId, badgeSlug]);
  return !!result;
}

/**
 * Award a badge to a user (returns the badge if newly awarded, null if already had it)
 */
async function awardBadge(userId, badgeSlug) {
  const badge = await getBadgeBySlug(badgeSlug);
  if (!badge) {
    logger.error(`Badge not found: ${badgeSlug}`);
    return null;
  }

  // Check if user already has this badge
  const alreadyHas = await userHasBadge(userId, badgeSlug);
  if (alreadyHas) {
    return null;
  }

  // Award the badge
  try {
    await run(
      'INSERT INTO user_badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)',
      [userId, badge.id, new Date().toISOString()]
    );
    logger.info(`Badge awarded: ${badgeSlug} to user ${userId}`);
    return badge;
  } catch (err) {
    // Handle race condition where badge was awarded between check and insert
    if (err.message?.includes('UNIQUE constraint')) {
      return null;
    }
    throw err;
  }
}

/**
 * Get all badge slugs a user already has (for efficient batch checking)
 */
async function getUserBadgeSlugs(userId) {
  const badges = await all(`
    SELECT b.slug FROM user_badges ub
    JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ?
  `, [userId]);
  return new Set(badges.map(b => b.slug));
}

/**
 * Batch award multiple badges efficiently
 * Takes array of badge slugs, returns array of newly awarded badges
 * Reduces DB calls from 3 per badge to 2 total + 1 per new badge
 */
async function batchAwardBadges(userId, badgeSlugs) {
  if (!badgeSlugs || badgeSlugs.length === 0) return [];

  // Get all badge slugs user already has in one query
  const existingSlugs = await getUserBadgeSlugs(userId);

  // Filter to only new badges
  const newSlugs = badgeSlugs.filter(slug => !existingSlugs.has(slug));
  if (newSlugs.length === 0) return [];

  // Get badge definitions for new slugs in one query
  const placeholders = newSlugs.map(() => '?').join(',');
  const badges = await all(
    `SELECT * FROM badges WHERE slug IN (${placeholders})`,
    newSlugs
  );

  if (badges.length === 0) return [];

  // Insert all new badges
  const now = new Date().toISOString();
  const awardedBadges = [];

  for (const badge of badges) {
    try {
      await run(
        'INSERT INTO user_badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)',
        [userId, badge.id, now]
      );
      awardedBadges.push(badge);
      logger.info(`Badge awarded: ${badge.slug} to user ${userId}`);
    } catch (err) {
      // Handle race condition where badge was awarded between our check and insert
      // This can happen when multiple badge checks run concurrently (e.g., battle + practice)
      if (err.message?.includes('UNIQUE constraint')) {
        logger.debug(`Badge ${badge.slug} already awarded to user ${userId} (race condition)`);
      } else {
        // Re-throw unexpected errors - these indicate real DB problems
        logger.error(`Failed to award badge ${badge.slug} to user ${userId}:`, err);
        throw err;
      }
    }
  }

  return awardedBadges;
}

/**
 * Mark a badge notification as seen
 */
async function markBadgeNotified(userId, badgeId) {
  await run(
    'UPDATE user_badges SET notified = 1 WHERE user_id = ? AND badge_id = ?',
    [userId, badgeId]
  );
}

/**
 * Batch mark multiple badges as notified (single query)
 */
async function markBadgesNotified(userId, badgeIds) {
  if (!badgeIds || badgeIds.length === 0) return;
  const placeholders = badgeIds.map(() => '?').join(',');
  await run(
    `UPDATE user_badges SET notified = 1 WHERE user_id = ? AND badge_id IN (${placeholders})`,
    [userId, ...badgeIds]
  );
}

/**
 * Get unnotified badges for a user
 */
async function getUnnotifiedBadges(userId) {
  return await all(`
    SELECT b.*, ub.earned_at
    FROM user_badges ub
    JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ? AND ub.notified = 0
    ORDER BY ub.earned_at DESC
  `, [userId]);
}

/**
 * Get user's badge count by rarity
 */
async function getUserBadgeStats(userId) {
  const stats = await all(`
    SELECT b.rarity, COUNT(*) as count
    FROM user_badges ub
    JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ?
    GROUP BY b.rarity
  `, [userId]);

  // Convert to object
  const result = { common: 0, rare: 0, epic: 0, legendary: 0, total: 0 };
  for (const row of stats) {
    result[row.rarity] = row.count;
    result.total += row.count;
  }
  return result;
}

/**
 * Get badges with user's earned status (for badge showcase)
 */
async function getBadgesWithUserStatus(userId) {
  return await all(`
    SELECT
      b.*,
      CASE WHEN ub.id IS NOT NULL THEN 1 ELSE 0 END as earned,
      ub.earned_at
    FROM badges b
    LEFT JOIN user_badges ub ON b.id = ub.badge_id AND ub.user_id = ?
    WHERE b.is_active = 1
    ORDER BY b.sort_order
  `, [userId]);
}

/**
 * Get user's current win streak
 */
async function getUserWinStreak(userId) {
  // Get recent battles ordered by date, find consecutive wins from most recent
  const battles = await all(`
    SELECT
      CASE WHEN winner_id = ? THEN 'win' ELSE 'loss' END as result
    FROM battles_history
    WHERE (winner_id = ? OR loser_id = ?)
    AND is_tie = 0
    ORDER BY created_at DESC
    LIMIT 50
  `, [userId, userId, userId]);

  let streak = 0;
  for (const battle of battles) {
    if (battle.result === 'win') {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Get user's fastest solve time in seconds (from battles)
 */
async function getUserFastestSolve(userId) {
  const result = await get(`
    SELECT MIN(solve_time) as fastest
    FROM battles_history
    WHERE winner_id = ? AND solve_time > 0
  `, [userId]);
  return result?.fastest || null;
}

/**
 * Get user's weekly challenge completion count
 */
async function getUserWeeklyCompletionCount(userId) {
  const result = await get(`
    SELECT COUNT(*) as count
    FROM daily_challenge_attempts
    WHERE user_id = ? AND completed = 1
  `, [userId]);
  return result?.count || 0;
}

/**
 * Get the number of ISO weeks in a year (52 or 53)
 * A year has 53 weeks if Jan 1 is Thursday, or Dec 31 is Thursday
 */
function getISOWeeksInYear(year) {
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  // getDay() returns 0=Sun, 4=Thu
  return (jan1.getDay() === 4 || dec31.getDay() === 4) ? 53 : 52;
}

/**
 * Get the previous week string (handles week 53 correctly)
 */
function getPreviousWeekStringFrom(weekString) {
  const [year, weekNum] = weekString.split('-W').map(Number);
  if (weekNum === 1) {
    const prevYearWeeks = getISOWeeksInYear(year - 1);
    return `${year - 1}-W${String(prevYearWeeks).padStart(2, '0')}`;
  } else {
    return `${year}-W${String(weekNum - 1).padStart(2, '0')}`;
  }
}

/**
 * Get user's current weekly challenge streak
 */
async function getUserWeeklyStreak(userId) {
  // Get completed weeks ordered by date
  const weeks = await all(`
    SELECT DISTINCT challenge_date as week
    FROM daily_challenge_attempts
    WHERE user_id = ? AND completed = 1
    ORDER BY challenge_date DESC
  `, [userId]);

  if (weeks.length === 0) return 0;

  // Check for consecutive weeks starting from most recent
  let streak = 0;
  const currentWeek = getCurrentWeekString();
  const previousWeek = getPreviousWeekStringFrom(currentWeek);

  // Start from current week, or previous week if current not completed yet
  let expectedWeek = currentWeek;
  if (weeks[0].week !== currentWeek && weeks[0].week === previousWeek) {
    // User hasn't completed current week, but has previous - start from there
    expectedWeek = previousWeek;
  }

  for (const { week } of weeks) {
    if (week === expectedWeek) {
      streak++;
      expectedWeek = getPreviousWeekStringFrom(expectedWeek);
    } else if (week < expectedWeek) {
      // Missed a week, streak broken
      break;
    }
  }

  return streak;
}

/**
 * Get user's leaderboard rank
 */
async function getUserLeaderboardRank(userId) {
  const result = await get(`
    SELECT COUNT(*) + 1 as rank
    FROM user_stats
    WHERE rating > (SELECT rating FROM user_stats WHERE user_id = ?)
  `, [userId]);
  return result?.rank || null;
}

// ============================================
// AGENT RIVALRY TRACKING
// ============================================

/**
 * Update or create rivalry record between two players
 * Always stores with user1_id < user2_id for consistency
 */
async function updateAgentRivalry(player1Id, player2Id, winnerId) {
  // Ensure user1_id < user2_id (matches table's CHECK constraint)
  const [user1Id, user2Id] = player1Id < player2Id ? [player1Id, player2Id] : [player2Id, player1Id];

  // Compute increments so the DB does the arithmetic atomically, eliminates
  // the read-modify-write race that lost concurrent updates.
  const winInc = winnerId === user1Id ? 1 : 0;
  const lossInc = winnerId === user2Id ? 1 : 0;
  const drawInc = winnerId === null ? 1 : 0;
  const nowIso = new Date().toISOString();

  // Single atomic UPSERT, INSERT new row, or on UNIQUE(user1_id, user2_id)
  // conflict increment the existing counters in SQL.
  await run(
    `INSERT INTO agent_rivalries
       (user1_id, user2_id, user1_wins, user2_wins, draws, last_battle_at, last_winner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user1_id, user2_id) DO UPDATE SET
       user1_wins = user1_wins + excluded.user1_wins,
       user2_wins = user2_wins + excluded.user2_wins,
       draws = draws + excluded.draws,
       last_battle_at = excluded.last_battle_at,
       last_winner_id = excluded.last_winner_id`,
    [user1Id, user2Id, winInc, lossInc, drawInc, nowIso, winnerId]
  );

  logger.info(`[Rivalry] Updated rivalry between ${user1Id} and ${user2Id}. Winner: ${winnerId || 'draw'}`);
}

/**
 * Get rivalry record between two users
 */
async function getAgentRivalry(userId, opponentId) {
  const [user1Id, user2Id] = userId < opponentId ? [userId, opponentId] : [opponentId, userId];

  const rivalry = await get(
    `SELECT
      r.*,
      u1.username as user1_username,
      u1.avatar as user1_avatar,
      u2.username as user2_username,
      u2.avatar as user2_avatar
     FROM agent_rivalries r
     JOIN users u1 ON r.user1_id = u1.id
     JOIN users u2 ON r.user2_id = u2.id
     WHERE r.user1_id = ? AND r.user2_id = ?`,
    [user1Id, user2Id]
  );

  if (!rivalry) return null;

  // Format the response from the requesting user's perspective
  const isUser1 = userId === user1Id;
  return {
    opponentId: isUser1 ? user2Id : user1Id,
    opponentUsername: isUser1 ? rivalry.user2_username : rivalry.user1_username,
    opponentAvatar: isUser1 ? rivalry.user2_avatar : rivalry.user1_avatar,
    userWins: isUser1 ? rivalry.user1_wins : rivalry.user2_wins,
    opponentWins: isUser1 ? rivalry.user2_wins : rivalry.user1_wins,
    draws: rivalry.draws,
    totalBattles: rivalry.user1_wins + rivalry.user2_wins + rivalry.draws,
    lastBattleAt: rivalry.last_battle_at,
    lastWinnerId: rivalry.last_winner_id,
    userWonLast: rivalry.last_winner_id === userId,
    createdAt: rivalry.created_at
  };
}

/**
 * Get user's top rivalries (most battles fought)
 */
async function getUserTopRivalries(userId, limit = 5) {
  const rivalries = await all(
    `SELECT
      r.*,
      CASE
        WHEN r.user1_id = ? THEN u2.id
        ELSE u1.id
      END as opponent_id,
      CASE
        WHEN r.user1_id = ? THEN u2.username
        ELSE u1.username
      END as opponent_username,
      CASE
        WHEN r.user1_id = ? THEN u2.avatar
        ELSE u1.avatar
      END as opponent_avatar,
      CASE
        WHEN r.user1_id = ? THEN r.user1_wins
        ELSE r.user2_wins
      END as user_wins,
      CASE
        WHEN r.user1_id = ? THEN r.user2_wins
        ELSE r.user1_wins
      END as opponent_wins,
      (r.user1_wins + r.user2_wins + r.draws) as total_battles
     FROM agent_rivalries r
     JOIN users u1 ON r.user1_id = u1.id
     JOIN users u2 ON r.user2_id = u2.id
     WHERE r.user1_id = ? OR r.user2_id = ?
     ORDER BY total_battles DESC, r.last_battle_at DESC
     LIMIT ?`,
    [userId, userId, userId, userId, userId, userId, userId, limit]
  );

  return rivalries.map(r => ({
    opponentId: r.opponent_id,
    opponentUsername: r.opponent_username,
    opponentAvatar: r.opponent_avatar,
    userWins: r.user_wins,
    opponentWins: r.opponent_wins,
    draws: r.draws,
    totalBattles: r.total_battles,
    lastBattleAt: r.last_battle_at,
    lastWinnerId: r.last_winner_id,
    userWonLast: r.last_winner_id === userId,
    isLosing: r.opponent_wins > r.user_wins
  }));
}

/**
 * Check for rivalry-related badge achievements
 */
async function checkRivalryBadges(userId, opponentId) {
  const earnedBadges = [];
  const existingBadges = await getUserBadgeSlugs(userId);

  const rivalry = await getAgentRivalry(userId, opponentId);
  if (!rivalry) return earnedBadges;

  // Rival badge - 5 battles with same opponent
  if (rivalry.totalBattles >= 5 && !existingBadges.has('agent-rival')) {
    const badge = await awardBadge(userId, 'agent-rival');
    if (badge) earnedBadges.push(badge);
  }

  // Nemesis badge - 10 battles with same opponent
  if (rivalry.totalBattles >= 10 && !existingBadges.has('agent-nemesis')) {
    const badge = await awardBadge(userId, 'agent-nemesis');
    if (badge) earnedBadges.push(badge);
  }

  // Redemption badge - win after losing 3+ in a row
  if (rivalry.userWonLast && !existingBadges.has('agent-redemption')) {
    // Check if opponent had won 3+ times in a row before this battle
    const [user1Id, user2Id] = userId < opponentId ? [userId, opponentId] : [opponentId, userId];

    const recentBattles = await all(
      `SELECT winner_id FROM agent_battles
       WHERE ((player1_id = ? AND player2_id = ?) OR (player1_id = ? AND player2_id = ?))
       AND status = 'completed'
       ORDER BY created_at DESC
       LIMIT 4`,
      [user1Id, user2Id, user2Id, user1Id]
    );

    if (recentBattles.length >= 4) {
      // Check if previous 3 were all opponent wins
      const previousThree = recentBattles.slice(1, 4);
      const allOpponentWins = previousThree.every(b => b.winner_id === opponentId);

      if (allOpponentWins) {
        const badge = await awardBadge(userId, 'agent-redemption');
        if (badge) earnedBadges.push(badge);
      }
    }
  }

  return earnedBadges;
}

/**
 * Check and award agent battle badges after a battle completes
 * Returns array of newly awarded badges
 */
async function checkAgentBattleBadges(userId, battleData) {
  const earnedBadges = [];

  try {
    const {
      isWinner,
      winnerId,
      loadoutId,
      currentStreak,
      executionTime,
      opponentElo,
      userElo
    } = battleData;

    // Get user's existing badge slugs for efficient checking
    const existingBadges = await getUserBadgeSlugs(userId);

    // 1. First Blood - Win your first agent battle
    if (isWinner && !existingBadges.has('agent-first-blood')) {
      const agentWins = await get(`
        SELECT COUNT(*) as count FROM agent_battles
        WHERE (player1_id = ? OR player2_id = ?) AND winner_id = ?
      `, [userId, userId, userId]);

      if (agentWins?.count === 1) {
        const badge = await awardBadge(userId, 'agent-first-blood');
        if (badge) earnedBadges.push(badge);
      }
    }

    // 2. Streak badges (3, 5, 10 win streaks)
    if (isWinner && currentStreak) {
      if (currentStreak >= 10 && !existingBadges.has('agent-streak-10')) {
        const badge = await awardBadge(userId, 'agent-streak-10');
        if (badge) earnedBadges.push(badge);
      } else if (currentStreak >= 5 && !existingBadges.has('agent-streak-5')) {
        const badge = await awardBadge(userId, 'agent-streak-5');
        if (badge) earnedBadges.push(badge);
      } else if (currentStreak >= 3 && !existingBadges.has('agent-streak-3')) {
        const badge = await awardBadge(userId, 'agent-streak-3');
        if (badge) earnedBadges.push(badge);
      }
    }

    // 3. Speed Demon - Win in under 30 seconds
    if (isWinner && executionTime && executionTime < 30000 && !existingBadges.has('agent-speed-demon')) {
      const badge = await awardBadge(userId, 'agent-speed-demon');
      if (badge) earnedBadges.push(badge);
    }

    // 4. Flawless Victory - All tests passed on first try (no tool retries needed)
    // This would require checking if the agent didn't retry failed tests
    // For now, we'll check if execution time is very fast (< 10s) as proxy
    if (isWinner && executionTime && executionTime < 10000 && !existingBadges.has('agent-flawless')) {
      const badge = await awardBadge(userId, 'agent-flawless');
      if (badge) earnedBadges.push(badge);
    }

    // 5. Underdog - Beat an agent with 200+ higher ELO
    if (isWinner && opponentElo && userElo && (opponentElo - userElo) >= 200 && !existingBadges.has('agent-underdog')) {
      const badge = await awardBadge(userId, 'agent-underdog');
      if (badge) earnedBadges.push(badge);
    }

    // 6. Mad Scientist - Create 5 different agent loadouts
    if (!existingBadges.has('agent-creator')) {
      const loadoutCount = await get(`
        SELECT COUNT(*) as count FROM agent_loadouts WHERE user_id = ?
      `, [userId]);

      if (loadoutCount?.count >= 5) {
        const badge = await awardBadge(userId, 'agent-creator');
        if (badge) earnedBadges.push(badge);
      }
    }

    // 7. Influencer - Have your loadout cloned 10 times
    if (loadoutId && !existingBadges.has('agent-popular')) {
      const cloneCount = await get(`
        SELECT clone_count FROM agent_loadouts WHERE id = ?
      `, [loadoutId]);

      if (cloneCount?.clone_count >= 10) {
        const badge = await awardBadge(userId, 'agent-popular');
        if (badge) earnedBadges.push(badge);
      }
    }

    logger.info(`[Badges] Checked agent battle badges for user ${userId}, earned ${earnedBadges.length} new badges`);
    return earnedBadges;

  } catch (err) {
    logger.error('[Badges] Error checking agent battle badges:', err);
    return [];
  }
}

// ============================================
// DAILY USAGE LIMITS (Free Tier)
// ============================================

const FREE_DAILY_PRACTICE_LIMIT = getConsumerFairUseLimit('practiceRunsPerDay');
/** Guests (no account): max distinct problems started per calendar day (server date). */
const GUEST_DAILY_PRACTICE_LIMIT = 3;

function normalizeGuestSessionIdForPractice(id) {
  if (id == null) return null;
  const s = String(id).trim();
  if (s.length < 8 || s.length > 128) return null;
  return s;
}

// Free tier gets Python, Java, JavaScript, C, and C++ - Pro unlocks all languages including TypeScript and SQL
const FREE_TIER_LANGUAGES = ['python', 'java', 'javascript', 'c', 'cpp'];
const ALL_LANGUAGES = ['python', 'javascript', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'typescript', 'sql', 'ruby', 'php', 'kotlin', 'swift'];

/**
 * Get user's battle count for today (matchmade battles only)
 */
async function getDailyBattleCount(userId) {
  const result = await get(`
    SELECT COUNT(*) as count FROM battles_history
    WHERE (winner_id = ? OR loser_id = ?)
    AND date(created_at) = date('now')
    AND is_matchmade = 1
  `, [userId, userId]);
  return result?.count || 0;
}

/**
 * Get user's practice problem count for today
 */
async function getDailyPracticeCount(userId) {
  return getConsumerDailyUsage('practice_execution', `user:${userId}`);
}

async function getConsumerDailyUsage(metric, subjectId) {
  const result = await get(`
    SELECT usage_count
    FROM consumer_daily_usage
    WHERE usage_date = date('now') AND metric = ? AND subject_id = ?
  `, [String(metric), String(subjectId)]);
  return result?.usage_count || 0;
}

/**
 * Atomically checks and consumes one unit from every supplied daily counter.
 * This keeps per-user quotas and global cost circuit breakers in sync even
 * when requests arrive concurrently. Dates are UTC through SQLite date('now').
 */
async function tryConsumeConsumerDailyUsage(resources) {
  const normalized = (Array.isArray(resources) ? resources : []).map(resource => ({
    metric: String(resource.metric || ''),
    subjectId: String(resource.subjectId || ''),
    limit: Math.max(0, Number.parseInt(resource.limit, 10) || 0)
  })).filter(resource => resource.metric && resource.subjectId && resource.limit > 0);

  if (normalized.length === 0) {
    return { allowed: false, reason: 'invalid_quota', usage: [] };
  }

  return withTransaction(async () => {
    for (const resource of normalized) {
      await run(`
        INSERT OR IGNORE INTO consumer_daily_usage
          (usage_date, metric, subject_id, usage_count, updated_at)
        VALUES (date('now'), ?, ?, 0, CURRENT_TIMESTAMP)
      `, [resource.metric, resource.subjectId]);
    }

    const usage = [];
    for (const resource of normalized) {
      const used = await getConsumerDailyUsage(resource.metric, resource.subjectId);
      usage.push({ ...resource, used });
    }

    const exhausted = usage.find(resource => resource.used >= resource.limit);
    if (exhausted) {
      return {
        allowed: false,
        reason: exhausted.subjectId === 'global' ? 'global_limit' : 'user_limit',
        exhausted,
        usage
      };
    }

    for (const resource of normalized) {
      await run(`
        UPDATE consumer_daily_usage
        SET usage_count = usage_count + 1, updated_at = CURRENT_TIMESTAMP
        WHERE usage_date = date('now') AND metric = ? AND subject_id = ?
      `, [resource.metric, resource.subjectId]);
    }

    return {
      allowed: true,
      usage: usage.map(resource => ({
        ...resource,
        used: resource.used + 1,
        remaining: Math.max(0, resource.limit - resource.used - 1)
      }))
    };
  });
}

// ============================================
// LEARN MODE (beginner "Learn to code")
// ============================================

/** Count today's free-tutor messages for a user (daily-cap enforcement). */
async function getDailyTutorCount(userId) {
  const result = await get(`
    SELECT COUNT(*) as count FROM tutor_messages
    WHERE user_id = ?
    AND date(created_at) = date('now')
  `, [userId]);
  return result?.count || 0;
}

/** Log one tutor message (counts against the daily cap). */
async function logTutorMessage(userId) {
  await run(`INSERT INTO tutor_messages (user_id) VALUES (?)`, [userId]);
}

/** Get a cached lesson translation, or null. Returns { version, payload }. */
async function getLessonTranslation(lessonId, lang) {
  const row = await get(`
    SELECT version, payload FROM lesson_translations
    WHERE lesson_id = ? AND lang = ?
  `, [lessonId, lang]);
  return row || null;
}

/** Upsert a cached lesson translation (payload is a JSON string). */
async function saveLessonTranslation(lessonId, lang, version, payload) {
  await run(`
    INSERT INTO lesson_translations (lesson_id, lang, version, payload)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(lesson_id, lang) DO UPDATE SET
      version = excluded.version,
      payload = excluded.payload,
      created_at = CURRENT_TIMESTAMP
  `, [lessonId, lang, version, payload]);
}

/**
 * Check if user can start a matchmade battle
 * Returns { allowed: boolean, remaining: number, limit: number, isPro: boolean }
 */
async function canUserBattle(userId) {
  return {
    allowed: true,
    remaining: null,
    limit: null,
    isPro: false,
    accessModel: CODEARENA_PRODUCT_MODE.consumer.accessModel,
    todayCount: 0
  };
}

/**
 * Check if user can start a practice problem
 * Returns { allowed: boolean, remaining: number, limit: number, isPro: boolean }
 */
async function canUserPractice(userId) {
  const legacyIsPro = await isUserPro(userId);
  const todayCount = await getDailyPracticeCount(userId);
  return {
    ...getConsumerQuotaStatus(todayCount, FREE_DAILY_PRACTICE_LIMIT, legacyIsPro),
    todayCount
  };
}

/**
 * Guest solo practice quota: counts distinct new problems started today (rows with today's created_at).
 */
async function getGuestPracticeQuota(guestSessionId) {
  const g = normalizeGuestSessionIdForPractice(guestSessionId);
  if (!g) {
    return {
      limit: GUEST_DAILY_PRACTICE_LIMIT,
      used: 0,
      remaining: GUEST_DAILY_PRACTICE_LIMIT
    };
  }
  const row = await get(`
    SELECT COUNT(*) as cnt FROM guest_practice_attempts
    WHERE guest_session_id = ? AND date(created_at) = date('now')
  `, [g]);
  const used = row?.cnt || 0;
  const remaining = Math.max(0, GUEST_DAILY_PRACTICE_LIMIT - used);
  return {
    limit: GUEST_DAILY_PRACTICE_LIMIT,
    used,
    remaining
  };
}

/**
 * Whether a guest may run practice for this problem (retries on same problem always allowed).
 */
async function canGuestPracticeProblem(guestSessionId, problemId) {
  const g = normalizeGuestSessionIdForPractice(guestSessionId);
  if (!g || !problemId) {
    return { allowed: false, isNewProblem: false, guestLimitReached: false };
  }
  const pid = String(problemId);
  const existing = await get(`
    SELECT 1 AS ok FROM guest_practice_attempts
    WHERE guest_session_id = ? AND problem_id = ?
  `, [g, pid]);
  if (existing) {
    return { allowed: true, isNewProblem: false, guestLimitReached: false };
  }
  const row = await get(`
    SELECT COUNT(*) as cnt FROM guest_practice_attempts
    WHERE guest_session_id = ? AND date(created_at) = date('now')
  `, [g]);
  const usedToday = row?.cnt || 0;
  if (usedToday >= GUEST_DAILY_PRACTICE_LIMIT) {
    return { allowed: false, isNewProblem: true, guestLimitReached: true };
  }
  return { allowed: true, isNewProblem: true, guestLimitReached: false };
}

/** Record first guest attempt at a problem (after successful run). INSERT OR IGNORE. */
async function recordGuestPracticeProblemIfNew(guestSessionId, problemId) {
  const g = normalizeGuestSessionIdForPractice(guestSessionId);
  if (!g || !problemId) return { inserted: false };
  const result = await run(`
    INSERT OR IGNORE INTO guest_practice_attempts (guest_session_id, problem_id)
    VALUES (?, ?)
  `, [g, String(problemId)]);
  const changes = result?.changes ?? 0;
  return { inserted: changes > 0 };
}

/**
 * Check if user can use a specific language
 * Returns { allowed: boolean, availableLanguages: string[], isPro: boolean }
 */
async function canUserUseLanguage(userId, language) {
  // All languages free during beta testing
  const isPro = await isUserPro(userId);
  return { allowed: true, availableLanguages: ALL_LANGUAGES, isPro };
}

/**
 * Get available languages for a user
 */
async function getUserAvailableLanguages(userId) {
  // All languages free during beta testing
  const isPro = await isUserPro(userId);
  return {
    languages: ALL_LANGUAGES,
    isPro
  };
}

// ============================================
// ACTIVITY FEED FUNCTIONS
// ============================================

/**
 * Event types for activity feed:
 * - battle_win: User won a battle
 * - battle_loss: User lost a battle
 * - badge_earned: User earned a badge
 * - friend_added: Users became friends
 * - rank_up: User reached a new rank tier
 * - streak_milestone: User hit a win streak milestone
 * - weekly_completed: User completed weekly challenge
 * - practice_milestone: User hit practice milestone
 */

/**
 * Create a new activity event
 */
async function createActivityEvent(userId, eventType, eventData = {}, isPublic = true) {
  const result = await run(
    `INSERT INTO activity_events (user_id, event_type, event_data, is_public, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, eventType, JSON.stringify(eventData), isPublic ? 1 : 0, new Date().toISOString()]
  );
  return { id: result.lastID, user_id: userId, event_type: eventType, event_data: eventData };
}

/**
 * Get activity feed for a user (their own + friends' public events)
 */
async function getActivityFeed(userId, limit = 50, offset = 0) {
  // Get friend IDs
  const friendIds = await getUserFriendIds(userId);
  const allUserIds = [userId, ...friendIds];

  const placeholders = allUserIds.map(() => '?').join(',');

  const events = await all(`
    SELECT
      ae.id,
      ae.user_id,
      ae.event_type,
      ae.event_data,
      ae.is_public,
      ae.created_at,
      u.username,
      u.avatar
    FROM activity_events ae
    JOIN users u ON ae.user_id = u.id
    WHERE (ae.user_id = ? OR (ae.user_id IN (${placeholders}) AND ae.is_public = 1))
    ORDER BY ae.created_at DESC
    LIMIT ? OFFSET ?
  `, [userId, ...allUserIds, limit, offset]);

  return events.map(e => ({
    ...e,
    event_data: e.event_data ? JSON.parse(e.event_data) : {}
  }));
}

/**
 * Get activity events for a specific user
 */
async function getUserActivityEvents(userId, viewerId = null, limit = 20, offset = 0) {
  const isOwn = userId === viewerId;

  let query = `
    SELECT
      ae.id,
      ae.user_id,
      ae.event_type,
      ae.event_data,
      ae.is_public,
      ae.created_at,
      u.username,
      u.avatar
    FROM activity_events ae
    JOIN users u ON ae.user_id = u.id
    WHERE ae.user_id = ?
  `;

  // Only show public events if not viewing own profile
  if (!isOwn) {
    query += ' AND ae.is_public = 1';
  }

  query += ' ORDER BY ae.created_at DESC LIMIT ? OFFSET ?';

  const events = await all(query, [userId, limit, offset]);

  return events.map(e => ({
    ...e,
    event_data: e.event_data ? JSON.parse(e.event_data) : {}
  }));
}

/**
 * Get recent global activity (for homepage/discovery)
 */
async function getGlobalActivityFeed(limit = 30, offset = 0) {
  const events = await all(`
    SELECT
      ae.id,
      ae.user_id,
      ae.event_type,
      ae.event_data,
      ae.created_at,
      u.username,
      u.avatar
    FROM activity_events ae
    JOIN users u ON ae.user_id = u.id
    WHERE ae.is_public = 1
    AND ae.event_type IN ('badge_earned', 'rank_up', 'streak_milestone', 'weekly_completed')
    ORDER BY ae.created_at DESC
    LIMIT ? OFFSET ?
  `, [limit, offset]);

  return events.map(e => ({
    ...e,
    event_data: e.event_data ? JSON.parse(e.event_data) : {}
  }));
}

// ============================================
// PUSH NOTIFICATION FUNCTIONS
// ============================================

/**
 * Save a push subscription for a user
 */
async function savePushSubscription(userId, subscription) {
  const { endpoint, keys } = subscription;

  // Upsert - update if endpoint exists, insert if not
  await run(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth
  `, [userId, endpoint, keys.p256dh, keys.auth, new Date().toISOString()]);

  return { saved: true };
}

/**
 * Remove a push subscription
 */
async function removePushSubscription(endpoint) {
  await run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  return { removed: true };
}

/**
 * Get all push subscriptions for a user
 */
async function getUserPushSubscriptions(userId) {
  return all('SELECT * FROM push_subscriptions WHERE user_id = ?', [userId]);
}

/**
 * Get push subscriptions for multiple users (for batch notifications)
 */
async function getPushSubscriptionsForUsers(userIds) {
  if (!userIds.length) return [];
  const placeholders = userIds.map(() => '?').join(',');
  return all(`SELECT * FROM push_subscriptions WHERE user_id IN (${placeholders})`, userIds);
}

/**
 * Get activity preferences for a user
 */
async function getActivityPreferences(userId) {
  const prefs = await get(`
    SELECT activity_feed FROM user_email_preferences WHERE user_id = ?
  `, [userId]);
  return {
    activityFeed: prefs ? !!prefs.activity_feed : true
  };
}

/**
 * Update activity preferences
 */
async function setActivityPreferences(userId, { activityFeed }) {
  // Use INSERT ... ON CONFLICT to avoid race condition
  await run(`
    INSERT INTO user_email_preferences (user_id, activity_feed)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET activity_feed = excluded.activity_feed
  `, [userId, activityFeed ? 1 : 0]);

  return { activityFeed };
}

/**
 * Get user's read receipts preference
 * Returns true if they want to show read receipts to senders (default: true)
 */
async function getReadReceiptsPreference(userId) {
  const user = await get('SELECT show_read_receipts FROM users WHERE id = ?', [userId]);
  // Default to true if not set
  return user?.show_read_receipts !== 0;
}

/**
 * Update user's read receipts preference
 */
async function setReadReceiptsPreference(userId, showReadReceipts) {
  await run(
    'UPDATE users SET show_read_receipts = ? WHERE id = ?',
    [showReadReceipts ? 1 : 0, userId]
  );
  return { showReadReceipts };
}

// ============================================
// TOURNAMENT SYSTEM FUNCTIONS
// ============================================

/**
 * Generate a unique invite code for private tournaments
 */
function generateTournamentInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars (0/O, 1/I/L)
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Create a new tournament
 */
async function createTournament({ name, description, startTime, registrationDeadline, format = 'single_elimination', maxPlayers = 32, minPlayers = 4, prizeDescription, isProOnly = false, isPrivate = false, createdBy }) {
  // Generate invite code for private tournaments
  const inviteCode = isPrivate ? generateTournamentInviteCode() : null;

  const res = await run(
    `INSERT INTO tournaments (name, description, start_time, registration_deadline, format, max_players, min_players, prize_description, is_pro_only, is_private, invite_code, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, description, startTime, registrationDeadline, format, maxPlayers, minPlayers, prizeDescription, isProOnly ? 1 : 0, isPrivate ? 1 : 0, inviteCode, createdBy]
  );
  return { id: res.lastID, inviteCode };
}

/**
 * Get tournament by invite code
 */
async function getTournamentByInviteCode(inviteCode) {
  const tournament = await get(
    `SELECT t.*,
            (SELECT COUNT(*) FROM tournament_participants WHERE tournament_id = t.id) as participant_count,
            u.username as winner_username,
            creator.username as creator_username
     FROM tournaments t
     LEFT JOIN users u ON t.winner_id = u.id
     LEFT JOIN users creator ON t.created_by = creator.id
     WHERE t.invite_code = ?`,
    [inviteCode]
  );
  return tournament;
}

/**
 * Count private tournaments created by user in the past week (for rate limiting)
 */
async function getUserPrivateTournamentsThisWeek(userId) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await get(
    `SELECT COUNT(*) as count FROM tournaments
     WHERE created_by = ? AND is_private = 1 AND created_at >= ?`,
    [userId, weekAgo]
  );
  return result?.count || 0;
}

/**
 * Get tournament by ID with participant count
 */
async function getTournamentById(id) {
  const tournament = await get(
    `SELECT t.*,
            (SELECT COUNT(*) FROM tournament_participants WHERE tournament_id = t.id) as participant_count,
            u.username as winner_username,
            creator.username as creator_username
     FROM tournaments t
     LEFT JOIN users u ON t.winner_id = u.id
     LEFT JOIN users creator ON t.created_by = creator.id
     WHERE t.id = ?`,
    [id]
  );
  return tournament;
}

/**
 * Get all tournaments with filters
 * @param {Object} options - Filter options
 * @param {string|string[]} options.status - Filter by status
 * @param {boolean} options.isProOnly - Filter by Pro-only flag
 * @param {boolean} options.includePrivate - Include private tournaments (default: false)
 * @param {number} options.createdBy - Filter by creator (for showing user's own private tournaments)
 * @param {number} options.limit - Max results
 * @param {number} options.offset - Pagination offset
 */
async function getTournaments({ status, isProOnly, includePrivate = false, createdBy, limit = 20, offset = 0 } = {}) {
  const now = new Date().toISOString();
  let query = `
    SELECT t.*,
           (SELECT COUNT(*) FROM tournament_participants WHERE tournament_id = t.id) as participant_count,
           (SELECT COUNT(*) FROM tournament_participants WHERE tournament_id = t.id AND checked_in = 1) as checked_in_count,
           u.username as winner_username
    FROM tournaments t
    LEFT JOIN users u ON t.winner_id = u.id
    WHERE 1=1
  `;
  const params = [];

  // Filter out private tournaments unless explicitly requested or viewing own tournaments
  if (!includePrivate && !createdBy) {
    query += ' AND (t.is_private = 0 OR t.is_private IS NULL)';
  }

  // Filter by creator (for user's own tournaments including private)
  if (createdBy) {
    query += ' AND t.created_by = ?';
    params.push(createdBy);
  }

  if (status) {
    if (Array.isArray(status)) {
      query += ` AND t.status IN (${status.map(() => '?').join(',')})`;
      params.push(...status);
      // For upcoming/registration_open, also filter by future start time
      if (status.includes('upcoming') || status.includes('registration_open')) {
        query += ' AND (t.status NOT IN (\'upcoming\', \'registration_open\') OR t.start_time > ?)';
        params.push(now);
      }
    } else {
      query += ' AND t.status = ?';
      params.push(status);
      // For upcoming/registration_open, also filter by future start time
      if (status === 'upcoming' || status === 'registration_open') {
        query += ' AND t.start_time > ?';
        params.push(now);
      }
    }
  }

  if (isProOnly !== undefined) {
    query += ' AND t.is_pro_only = ?';
    params.push(isProOnly ? 1 : 0);
  }

  query += ' ORDER BY t.start_time ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return all(query, params);
}

/**
 * Get upcoming tournaments (registration open or upcoming)
 * Excludes private tournaments and past tournaments from public listing
 */
async function getUpcomingTournaments(limit = 10) {
  const now = new Date().toISOString();
  return all(
    `SELECT t.*,
            (SELECT COUNT(*) FROM tournament_participants WHERE tournament_id = t.id) as participant_count
     FROM tournaments t
     WHERE t.status IN ('upcoming', 'registration_open')
       AND (t.is_private = 0 OR t.is_private IS NULL)
       AND t.start_time > ?
     ORDER BY t.start_time ASC
     LIMIT ?`,
    [now, limit]
  );
}

/**
 * Register user for tournament
 */
async function registerForTournament(tournamentId, userId, language = 'python') {
  try {
    await run(
      `INSERT INTO tournament_participants (tournament_id, user_id, language) VALUES (?, ?, ?)`,
      [tournamentId, userId, language]
    );
    return { success: true };
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return { success: false, error: 'Already registered' };
    }
    throw err;
  }
}

/**
 * Unregister user from tournament
 */
async function unregisterFromTournament(tournamentId, userId) {
  const result = await run(
    `DELETE FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`,
    [tournamentId, userId]
  );
  return { success: result.changes > 0 };
}

/**
 * Get tournament participants with user info
 */
async function getTournamentParticipants(tournamentId) {
  return all(
    `SELECT tp.*, u.username, u.avatar, u.avatar_url, u.is_pro,
            (SELECT rating FROM user_stats WHERE user_id = u.id) as rating
     FROM tournament_participants tp
     JOIN users u ON tp.user_id = u.id
     WHERE tp.tournament_id = ?
     ORDER BY tp.seed ASC NULLS LAST, tp.registered_at ASC`,
    [tournamentId]
  );
}

/**
 * Check if user is registered for tournament
 */
async function isUserRegistered(tournamentId, userId) {
  const row = await get(
    `SELECT 1 FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`,
    [tournamentId, userId]
  );
  return !!row;
}

// Allow-list of tournaments columns that can be set via updateTournamentStatus's
// additionalFields. Derived from the tournaments table CREATE (migration 64).
// Anything else is dropped + warned (no throw) to preserve backwards-compatibility.
const ALLOWED_TOURNAMENT_FIELDS = [
  'name',
  'description',
  'start_time',
  'registration_deadline',
  'format',
  'max_players',
  'min_players',
  'prize_description',
  'is_pro_only',
  'current_round',
  'total_rounds',
  'winner_id',
  'created_by',
  'started_at',
  'completed_at'
];

/**
 * Update tournament status
 */
async function updateTournamentStatus(tournamentId, status, additionalFields = {}) {
  const updates = ['status = ?'];
  const params = [status];

  if (status === 'in_progress' && !additionalFields.started_at) {
    updates.push('started_at = ?');
    params.push(new Date().toISOString());
  }

  if (status === 'completed' && !additionalFields.completed_at) {
    updates.push('completed_at = ?');
    params.push(new Date().toISOString());
  }

  for (const [key, value] of Object.entries(additionalFields)) {
    if (!ALLOWED_TOURNAMENT_FIELDS.includes(key)) {
      logger.warn(`[updateTournamentStatus] Ignoring disallowed field: ${key}`);
      continue;
    }
    updates.push(`${key} = ?`);
    params.push(value);
  }

  params.push(tournamentId);

  await run(`UPDATE tournaments SET ${updates.join(', ')} WHERE id = ?`, params);
}

/**
 * Generate bracket for tournament - seeds players by rating, creates matches with byes
 */
async function generateBracket(tournamentId) {
  // Wrap entire bracket generation in transaction for atomicity
  return withTransaction(async () => {
    // Get participants sorted by rating (highest first for seeding)
    const participants = await all(
    `SELECT tp.user_id, tp.language,
            COALESCE((SELECT rating FROM user_stats WHERE user_id = tp.user_id), 1000) as rating
     FROM tournament_participants tp
     WHERE tp.tournament_id = ?
     ORDER BY rating DESC`,
    [tournamentId]
  );

  const numPlayers = participants.length;
  if (numPlayers < 2) {
    throw new Error('Need at least 2 participants');
  }

  // Calculate bracket size (next power of 2)
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(numPlayers)));
  const totalRounds = Math.log2(bracketSize);
  const numByes = bracketSize - numPlayers;

  // Seed players with byes going to top seeds
  const seededPlayers = [];
  for (let i = 0; i < bracketSize; i++) {
    if (i < numPlayers) {
      seededPlayers.push({ ...participants[i], seed: i + 1 });
    } else {
      seededPlayers.push(null); // Bye
    }
  }

  // Update seeds in database
  for (const player of seededPlayers) {
    if (player) {
      await run(
        `UPDATE tournament_participants SET seed = ? WHERE tournament_id = ? AND user_id = ?`,
        [player.seed, tournamentId, player.user_id]
      );
    }
  }

  // Create first round matches using standard "fold" bracket seeding so the
  // top seeds are spread across opposite halves of the bracket, seeds 1 and
  // 2 only meet in the final, top four only meet in the semifinals, etc.
  //
  // For N=16 this yields the canonical order:
  //   (1,16) (8,9) (5,12) (4,13) (3,14) (6,11) (7,10) (2,15)
  // The previous implementation paired (i, N-1-i) which placed seeds 1 and 2
  // adjacent in the bracket, so they collided in the semifinal.
  //
  // Recurrence: order(2) = [1, 2]; order(2N) = interleave(order(N), 2N+1-order(N)).
  const bracketOrder = (() => {
    let order = [1];
    while (order.length < bracketSize) {
      const n = order.length * 2;
      const next = [];
      for (const seed of order) {
        next.push(seed);
        next.push(n + 1 - seed);
      }
      order = next;
    }
    return order;
  })();

  const firstRoundMatches = bracketSize / 2;
  const matchups = [];
  for (let i = 0; i < firstRoundMatches; i++) {
    // bracketOrder is 1-indexed; seededPlayers is 0-indexed.
    const seedA = bracketOrder[i * 2] - 1;
    const seedB = bracketOrder[i * 2 + 1] - 1;
    matchups.push([seededPlayers[seedA], seededPlayers[seedB]]);
  }

  // Create round 1 matches
  for (let i = 0; i < matchups.length; i++) {
    const [player1, player2] = matchups[i];

    await run(
      `INSERT INTO tournament_matches (tournament_id, round, match_number, bracket_position, player1_id, player2_id, status)
       VALUES (?, 1, ?, ?, ?, ?, ?)`,
      [
        tournamentId,
        i + 1,
        i,
        player1 ? player1.user_id : null,
        player2 ? player2.user_id : null,
        // Auto-complete matches with byes
        (!player1 || !player2) ? 'completed' : 'pending'
      ]
    );

    // If one player has a bye, advance them
    if (player1 && !player2) {
      await run(
        `UPDATE tournament_matches SET winner_id = ?, completed_at = ? WHERE tournament_id = ? AND round = 1 AND match_number = ?`,
        [player1.user_id, new Date().toISOString(), tournamentId, i + 1]
      );
    } else if (!player1 && player2) {
      await run(
        `UPDATE tournament_matches SET winner_id = ?, completed_at = ? WHERE tournament_id = ? AND round = 1 AND match_number = ?`,
        [player2.user_id, new Date().toISOString(), tournamentId, i + 1]
      );
    }
  }

  // Create placeholder matches for subsequent rounds
  let matchesInRound = firstRoundMatches / 2;
  for (let round = 2; round <= totalRounds; round++) {
    for (let i = 0; i < matchesInRound; i++) {
      await run(
        `INSERT INTO tournament_matches (tournament_id, round, match_number, bracket_position, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [tournamentId, round, i + 1, i]
      );
    }
    matchesInRound = matchesInRound / 2;
  }

  // Create 3rd place match placeholder when there are enough players for semi-finals
  // (needs 4+ players so two losers exist to compete for 3rd)
  if (numPlayers >= 4) {
    await run(
      `INSERT INTO tournament_matches (tournament_id, round, match_number, bracket_position, status, is_third_place_match)
       VALUES (?, ?, 99, 99, 'pending', 1)`,
      [tournamentId, totalRounds]
    );
  }

  // Advance bye winners to round 2 matches
  // Get all completed round 1 matches (these are byes)
  const byeMatches = await all(
    `SELECT * FROM tournament_matches WHERE tournament_id = ? AND round = 1 AND status = 'completed'`,
    [tournamentId]
  );

  for (const byeMatch of byeMatches) {
    if (byeMatch.winner_id) {
      const nextMatchNumber = Math.ceil(byeMatch.match_number / 2);
      const isPlayer1 = byeMatch.match_number % 2 === 1;
      const updateField = isPlayer1 ? 'player1_id' : 'player2_id';

      await run(
        `UPDATE tournament_matches SET ${updateField} = ? WHERE tournament_id = ? AND round = 2 AND match_number = ? AND (is_third_place_match = 0 OR is_third_place_match IS NULL)`,
        [byeMatch.winner_id, tournamentId, nextMatchNumber]
      );
    }
  }

    // Update tournament with total rounds
    await run(`UPDATE tournaments SET total_rounds = ?, current_round = 1 WHERE id = ?`, [totalRounds, tournamentId]);

    return { bracketSize, totalRounds, numByes };
  }); // End withTransaction
}

/**
 * Get all matches for a tournament
 */
async function getTournamentMatches(tournamentId) {
  return all(
    `SELECT m.*,
            p1.username as player1_username, p1.avatar as player1_avatar,
            p2.username as player2_username, p2.avatar as player2_avatar,
            w.username as winner_username
     FROM tournament_matches m
     LEFT JOIN users p1 ON m.player1_id = p1.id
     LEFT JOIN users p2 ON m.player2_id = p2.id
     LEFT JOIN users w ON m.winner_id = w.id
     WHERE m.tournament_id = ?
     ORDER BY m.round ASC, m.match_number ASC`,
    [tournamentId]
  );
}

/**
 * Get a specific match
 */
async function getTournamentMatch(matchId) {
  return get(
    `SELECT m.*,
            p1.username as player1_username, p1.avatar as player1_avatar,
            p2.username as player2_username, p2.avatar as player2_avatar,
            tp1.language as player1_language, tp2.language as player2_language
     FROM tournament_matches m
     LEFT JOIN users p1 ON m.player1_id = p1.id
     LEFT JOIN users p2 ON m.player2_id = p2.id
     LEFT JOIN tournament_participants tp1 ON m.tournament_id = tp1.tournament_id AND m.player1_id = tp1.user_id
     LEFT JOIN tournament_participants tp2 ON m.tournament_id = tp2.tournament_id AND m.player2_id = tp2.user_id
     WHERE m.id = ?`,
    [matchId]
  );
}

/**
 * Get match by tournament, round and match number
 */
async function getTournamentMatchByPosition(tournamentId, round, matchNumber) {
  return get(
    `SELECT m.*,
            p1.username as player1_username,
            p2.username as player2_username
     FROM tournament_matches m
     LEFT JOIN users p1 ON m.player1_id = p1.id
     LEFT JOIN users p2 ON m.player2_id = p2.id
     WHERE m.tournament_id = ? AND m.round = ? AND m.match_number = ?`,
    [tournamentId, round, matchNumber]
  );
}

/**
 * Start a tournament match - sets battle UUID and status
 */
async function startTournamentMatch(matchId, battleUuid, problemId) {
  await run(
    `UPDATE tournament_matches SET battle_uuid = ?, problem_id = ?, status = 'in_progress', started_at = ? WHERE id = ?`,
    [battleUuid, problemId, new Date().toISOString(), matchId]
  );
}

/**
 * Complete a tournament match - sets winner and advances to next round.
 * Handles championship final, 3rd place match, and regular rounds.
 */
async function completeTournamentMatch(matchId, winnerId) {
  const match = await get(`SELECT * FROM tournament_matches WHERE id = ?`, [matchId]);
  if (!match) throw new Error('Match not found');

  const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;
  const now = new Date().toISOString();

  // Mark match as completed
  await run(
    `UPDATE tournament_matches SET winner_id = ?, status = 'completed', completed_at = ? WHERE id = ?`,
    [winnerId, now, matchId]
  );

  const tournament = await get(`SELECT * FROM tournaments WHERE id = ?`, [match.tournament_id]);

  // ─── 3RD PLACE MATCH ────────────────────────────────────────────────────
  if (match.is_third_place_match) {
    await run(
      `UPDATE tournament_participants SET final_placement = 3 WHERE tournament_id = ? AND user_id = ?`,
      [match.tournament_id, winnerId]
    );
    await run(
      `UPDATE tournament_participants SET final_placement = 4 WHERE tournament_id = ? AND user_id = ?`,
      [match.tournament_id, loserId]
    );

    // Tournament fully complete only when both final and 3rd place match are done
    const finalMatch = await get(
      `SELECT status FROM tournament_matches
       WHERE tournament_id = ? AND round = ? AND (is_third_place_match = 0 OR is_third_place_match IS NULL)`,
      [match.tournament_id, tournament.total_rounds]
    );
    const tournamentComplete = !finalMatch || finalMatch.status === 'completed';

    if (tournamentComplete) {
      await run(
        `UPDATE tournaments SET status = 'completed', completed_at = ? WHERE id = ?`,
        [now, match.tournament_id]
      );
    }

    return { tournamentComplete };
  }

  // ─── CHAMPIONSHIP FINAL ──────────────────────────────────────────────────
  if (match.round === tournament.total_rounds) {
    // Mark the runner-up as eliminated in the final round
    await run(
      `UPDATE tournament_participants SET eliminated_at = ?, eliminated_in_round = ? WHERE tournament_id = ? AND user_id = ?`,
      [now, match.round, match.tournament_id, loserId]
    );

    // Record champion and placements
    await run(`UPDATE tournaments SET winner_id = ? WHERE id = ?`, [winnerId, match.tournament_id]);
    await run(
      `UPDATE tournament_participants SET final_placement = 1 WHERE tournament_id = ? AND user_id = ?`,
      [match.tournament_id, winnerId]
    );
    await run(
      `UPDATE tournament_participants SET final_placement = 2 WHERE tournament_id = ? AND user_id = ?`,
      [match.tournament_id, loserId]
    );

    // Tournament fully complete only when both final and 3rd place match are done
    const thirdPlaceMatch = await get(
      `SELECT status FROM tournament_matches WHERE tournament_id = ? AND is_third_place_match = 1`,
      [match.tournament_id]
    );
    const tournamentComplete = !thirdPlaceMatch || thirdPlaceMatch.status === 'completed';

    if (tournamentComplete) {
      await run(
        `UPDATE tournaments SET status = 'completed', completed_at = ? WHERE id = ?`,
        [now, match.tournament_id]
      );
    }

    return { tournamentComplete, winnerId };
  }

  // ─── REGULAR ROUND MATCH ─────────────────────────────────────────────────

  // Mark loser as eliminated
  await run(
    `UPDATE tournament_participants SET eliminated_at = ?, eliminated_in_round = ? WHERE tournament_id = ? AND user_id = ?`,
    [now, match.round, match.tournament_id, loserId]
  );

  // If this is the semi-final round, route loser to 3rd place match
  if (match.round === tournament.total_rounds - 1) {
    const thirdPlaceMatch = await get(
      `SELECT * FROM tournament_matches WHERE tournament_id = ? AND is_third_place_match = 1`,
      [match.tournament_id]
    );
    if (thirdPlaceMatch) {
      // Atomically claim the first empty slot
      const claimed1 = await run(
        `UPDATE tournament_matches SET player1_id = ? WHERE id = ? AND player1_id IS NULL`,
        [loserId, thirdPlaceMatch.id]
      );
      if (!claimed1.changes) {
        await run(
          `UPDATE tournament_matches SET player2_id = ? WHERE id = ? AND player2_id IS NULL`,
          [loserId, thirdPlaceMatch.id]
        );
      }
    } else {
      // Fewer than 4 players, assign 3rd place directly (no match needed)
      await run(
        `UPDATE tournament_participants SET final_placement = 3 WHERE tournament_id = ? AND user_id = ?`,
        [match.tournament_id, loserId]
      );
    }
  }

  // Advance winner to next round (skip 3rd place match slot)
  const nextRound = match.round + 1;
  const nextMatchNumber = Math.ceil(match.match_number / 2);
  const isPlayer1Slot = match.match_number % 2 === 1;

  const nextMatch = await get(
    `SELECT * FROM tournament_matches
     WHERE tournament_id = ? AND round = ? AND match_number = ?
       AND (is_third_place_match = 0 OR is_third_place_match IS NULL)`,
    [match.tournament_id, nextRound, nextMatchNumber]
  );

  if (nextMatch) {
    const updateField = isPlayer1Slot ? 'player1_id' : 'player2_id';
    await run(
      `UPDATE tournament_matches SET ${updateField} = ? WHERE id = ?`,
      [winnerId, nextMatch.id]
    );

    const updatedNext = await get(`SELECT * FROM tournament_matches WHERE id = ?`, [nextMatch.id]);
    const nextMatchReady = !!(updatedNext.player1_id && updatedNext.player2_id);

    // Advance current_round once ALL regular matches in this round are done
    // (3rd place match lives in the final round and doesn't gate round progression)
    const pendingInRound = await get(
      `SELECT COUNT(*) as count FROM tournament_matches
       WHERE tournament_id = ? AND round = ? AND status != 'completed'
         AND (is_third_place_match = 0 OR is_third_place_match IS NULL)`,
      [match.tournament_id, match.round]
    );

    if (pendingInRound.count === 0) {
      await run(`UPDATE tournaments SET current_round = ? WHERE id = ?`, [nextRound, match.tournament_id]);
    }

    return { tournamentComplete: false, nextMatchId: nextMatch.id, nextMatchReady };
  }

  return { tournamentComplete: false };
}

/**
 * Count pending (not yet completed) matches in a given round.
 * Used to enforce round synchronization before starting next-round matches.
 */
async function getPendingMatchCountInRound(tournamentId, round) {
  const result = await get(
    `SELECT COUNT(*) as count FROM tournament_matches
     WHERE tournament_id = ? AND round = ? AND status != 'completed'`,
    [tournamentId, round]
  );
  return result?.count || 0;
}

/**
 * Get user's tournament history
 */
async function getUserTournamentHistory(userId, limit = 20) {
  return all(
    `SELECT t.id, t.name, t.status, t.start_time, t.completed_at,
            tp.seed, tp.final_placement, tp.eliminated_in_round,
            t.total_rounds,
            (SELECT username FROM users WHERE id = t.winner_id) as winner_username
     FROM tournament_participants tp
     JOIN tournaments t ON tp.tournament_id = t.id
     WHERE tp.user_id = ?
     ORDER BY t.start_time DESC
     LIMIT ?`,
    [userId, limit]
  );
}

/**
 * Get user's tournament stats
 */
async function getUserTournamentStats(userId) {
  const stats = await get(
    `SELECT
       COUNT(*) as tournaments_played,
       SUM(CASE WHEN final_placement = 1 THEN 1 ELSE 0 END) as tournaments_won,
       SUM(CASE WHEN final_placement = 2 THEN 1 ELSE 0 END) as finals_reached,
       MIN(final_placement) as best_placement
     FROM tournament_participants tp
     JOIN tournaments t ON tp.tournament_id = t.id
     WHERE tp.user_id = ? AND t.status = 'completed'`,
    [userId]
  );

  // Get match wins
  const matchStats = await get(
    `SELECT COUNT(*) as matches_won
     FROM tournament_matches m
     WHERE m.winner_id = ? AND m.status = 'completed'`,
    [userId]
  );

  return {
    ...stats,
    matches_won: matchStats?.matches_won || 0
  };
}

/**
 * Get pending matches for a user
 */
async function getUserPendingMatches(userId) {
  return all(
    `SELECT m.*, t.name as tournament_name, t.id as tournament_id,
            p1.username as player1_username, p2.username as player2_username
     FROM tournament_matches m
     JOIN tournaments t ON m.tournament_id = t.id
     LEFT JOIN users p1 ON m.player1_id = p1.id
     LEFT JOIN users p2 ON m.player2_id = p2.id
     WHERE (m.player1_id = ? OR m.player2_id = ?)
       AND m.status = 'pending'
       AND m.player1_id IS NOT NULL
       AND m.player2_id IS NOT NULL
       AND t.status = 'in_progress'
     ORDER BY t.start_time ASC`,
    [userId, userId]
  );
}

/**
 * Get tournaments needing status update (for scheduler)
 */
async function getTournamentsNeedingUpdate() {
  const now = new Date().toISOString();
  const checkInWindowMs = 10 * 60 * 1000; // 10 minutes before start
  const checkInStart = new Date(Date.now() + checkInWindowMs).toISOString();

  // Get upcoming tournaments that should open registration
  const toOpen = await all(
    `SELECT * FROM tournaments
     WHERE status = 'upcoming' AND registration_deadline > ?`,
    [now]
  );

  // Get tournaments past registration deadline
  const toClose = await all(
    `SELECT * FROM tournaments
     WHERE status = 'registration_open' AND registration_deadline <= ?`,
    [now]
  );

  // Get tournaments entering check-in window (10 min before start)
  const toCheckIn = await all(
    `SELECT t.*,
            (SELECT COUNT(*) FROM tournament_participants WHERE tournament_id = t.id) as participant_count
     FROM tournaments t
     WHERE t.status = 'registration_closed'
       AND t.start_time <= ?
       AND t.start_time > ?`,
    [checkInStart, now]
  );

  // Get tournaments past start time that need to start or be cancelled
  const toStartOrCancel = await all(
    `SELECT t.*,
            (SELECT COUNT(*) FROM tournament_participants WHERE tournament_id = t.id) as participant_count,
            (SELECT COUNT(*) FROM tournament_participants WHERE tournament_id = t.id AND checked_in = 1) as checked_in_count
     FROM tournaments t
     WHERE t.status IN ('registration_closed', 'check_in_open')
       AND t.start_time <= ?`,
    [now]
  );

  return { toOpen, toClose, toCheckIn, toStartOrCancel };
}

/**
 * Open check-in window for a tournament
 */
async function openTournamentCheckIn(tournamentId) {
  return run(
    `UPDATE tournaments SET status = 'check_in_open' WHERE id = ? AND status = 'registration_closed'`,
    [tournamentId]
  );
}

/**
 * Player check-in for tournament
 */
async function checkInForTournament(tournamentId, userId) {
  const tournament = await get(
    `SELECT * FROM tournaments WHERE id = ?`,
    [tournamentId]
  );

  if (!tournament) {
    return { success: false, error: 'Tournament not found' };
  }

  if (tournament.status !== 'check_in_open') {
    return { success: false, error: 'Check-in is not open for this tournament' };
  }

  const participant = await get(
    `SELECT * FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`,
    [tournamentId, userId]
  );

  if (!participant) {
    return { success: false, error: 'You are not registered for this tournament' };
  }

  if (participant.checked_in) {
    return { success: false, error: 'You are already checked in' };
  }

  await run(
    `UPDATE tournament_participants SET checked_in = 1 WHERE tournament_id = ? AND user_id = ?`,
    [tournamentId, userId]
  );

  return { success: true };
}

/**
 * Get check-in status for a tournament
 */
async function getTournamentCheckInStatus(tournamentId) {
  const participants = await all(
    `SELECT tp.*, u.username, u.avatar, u.avatar_url
     FROM tournament_participants tp
     JOIN users u ON tp.user_id = u.id
     WHERE tp.tournament_id = ?
     ORDER BY tp.checked_in DESC, tp.registered_at ASC`,
    [tournamentId]
  );

  const checkedIn = participants.filter(p => p.checked_in);
  const notCheckedIn = participants.filter(p => !p.checked_in);

  return {
    total: participants.length,
    checkedInCount: checkedIn.length,
    checkedIn,
    notCheckedIn
  };
}

/**
 * Cancel tournament (insufficient participants or past deadline)
 */
async function cancelTournament(tournamentId, reason = 'Insufficient participants') {
  await run(
    `UPDATE tournaments SET status = 'cancelled', completed_at = ? WHERE id = ?`,
    [new Date().toISOString(), tournamentId]
  );

  // Get participants to notify
  const participants = await all(
    `SELECT tp.user_id, u.email, u.username
     FROM tournament_participants tp
     JOIN users u ON tp.user_id = u.id
     WHERE tp.tournament_id = ?`,
    [tournamentId]
  );

  return { success: true, participants, reason };
}

/**
 * Count participants who have checked in. Used to gate a manual tournament start when check-in
 * is open (before pruning the non-checked-in), mirroring the auto-start scheduler.
 */
async function getCheckedInParticipantCount(tournamentId) {
  const row = await get(
    `SELECT COUNT(*) as count FROM tournament_participants WHERE tournament_id = ? AND checked_in = 1`,
    [tournamentId]
  );
  return row ? row.count : 0;
}

/**
 * Start tournament with only checked-in participants
 * Removes participants who didn't check in
 */
async function startTournamentWithCheckedIn(tournamentId) {
  // Remove participants who didn't check in
  await run(
    `DELETE FROM tournament_participants WHERE tournament_id = ? AND checked_in = 0`,
    [tournamentId]
  );

  // Update status
  await run(
    `UPDATE tournaments SET status = 'in_progress', started_at = ? WHERE id = ?`,
    [new Date().toISOString(), tournamentId]
  );

  return { success: true };
}

/**
 * Check if user can check in (within 10 min window before start)
 */
async function canCheckIn(tournamentId) {
  const tournament = await get(
    `SELECT * FROM tournaments WHERE id = ?`,
    [tournamentId]
  );

  if (!tournament) return { canCheckIn: false, reason: 'Tournament not found' };

  if (tournament.status === 'check_in_open') {
    return { canCheckIn: true, tournament };
  }

  if (tournament.status !== 'registration_closed') {
    return { canCheckIn: false, reason: 'Check-in not available yet' };
  }

  const now = Date.now();
  const startTime = new Date(tournament.start_time).getTime();
  const checkInWindowMs = 10 * 60 * 1000; // 10 minutes

  if (startTime - now <= checkInWindowMs && startTime > now) {
    return { canCheckIn: true, tournament };
  }

  return { canCheckIn: false, reason: 'Check-in window not open' };
}

// ============================================
// PRO USER WEEKLY PROGRESS DIGEST
// ============================================

/**
 * Get all Pro users with email for weekly digest (who opted in)
 */
async function getProUsersForWeeklyDigest() {
  return all(`
    SELECT u.id, u.email, u.username
    FROM users u
    LEFT JOIN user_email_preferences uep ON u.id = uep.user_id
    WHERE u.is_pro = 1
      AND u.email IS NOT NULL
      AND u.email != ''
      AND (uep.progress_digest IS NULL OR uep.progress_digest = 1)
  `);
}

/**
 * Get weekly stats for a user (for progress digest email)
 */
async function getUserWeeklyStats(userId) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const weekAgoStr = weekAgo.toISOString();
  const twoWeeksAgoStr = twoWeeksAgo.toISOString();

  // Get this week's stats
  const thisWeekPractice = await get(`
    SELECT COUNT(*) as count FROM practice_attempts
    WHERE user_id = ? AND solved = 1 AND created_at >= ?
  `, [userId, weekAgoStr]);

  const thisWeekBattles = await get(`
    SELECT
      COUNT(CASE WHEN winner_id = ? THEN 1 END) as wins,
      COUNT(*) as total
    FROM battles_history
    WHERE (winner_id = ? OR loser_id = ?) AND finished_at >= ?
  `, [userId, userId, userId, weekAgoStr]);

  // Get last week's stats for comparison
  const lastWeekPractice = await get(`
    SELECT COUNT(*) as count FROM practice_attempts
    WHERE user_id = ? AND solved = 1 AND created_at >= ? AND created_at < ?
  `, [userId, twoWeeksAgoStr, weekAgoStr]);

  const lastWeekBattles = await get(`
    SELECT
      COUNT(CASE WHEN winner_id = ? THEN 1 END) as wins
    FROM battles_history
    WHERE (winner_id = ? OR loser_id = ?) AND finished_at >= ? AND finished_at < ?
  `, [userId, userId, userId, twoWeeksAgoStr, weekAgoStr]);

  const problemsSolved = thisWeekPractice?.count || 0;
  const battlesWon = thisWeekBattles?.wins || 0;
  const lastWeekTotal = (lastWeekPractice?.count || 0) + (lastWeekBattles?.wins || 0);
  const thisWeekTotal = problemsSolved + battlesWon;

  // Calculate improvement percentage
  let improvement = 0;
  if (lastWeekTotal > 0) {
    improvement = Math.round(((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100);
  } else if (thisWeekTotal > 0) {
    improvement = 100; // First week with activity
  }

  // Get coder profile for personalized insight
  const profile = await get(`
    SELECT archetype, archetype_confidence FROM coder_profiles WHERE user_id = ?
  `, [userId]);

  // Generate simple insights based on data
  let insight = null;
  let focusArea = null;

  if (problemsSolved >= 10) {
    insight = "Impressive dedication this week! Your consistent practice is building strong problem-solving patterns.";
  } else if (problemsSolved >= 5) {
    insight = "Solid progress this week. Keep up the momentum to see continued improvement.";
  } else if (problemsSolved > 0) {
    insight = "You got some practice in this week. Try to increase your sessions for faster skill growth.";
  }

  if (battlesWon === 0 && (thisWeekBattles?.total || 0) > 0) {
    focusArea = "Focus on speed this week - try practice mode to build muscle memory before jumping into battles.";
  } else if (problemsSolved < 3) {
    focusArea = "Try to solve at least 1 problem per day this week to maintain your coding momentum.";
  } else if (profile?.archetype) {
    focusArea = `As a ${profile.archetype}, challenge yourself with problems outside your comfort zone this week.`;
  }

  return {
    problemsSolved,
    battlesWon,
    improvement,
    insight,
    focusArea
  };
}

// ============================================
// ANTI-CHEAT: Solution Fingerprints
// ============================================

async function storeSolutionFingerprint(problemId, battleId, userId, fingerprint, ngramFingerprints, language, codeLength, isWinning = false) {
  const createdAt = new Date().toISOString();
  await run(
    `INSERT INTO solution_fingerprints (problem_id, battle_id, user_id, fingerprint, ngram_fingerprints, language, code_length, is_winning_solution, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [problemId, battleId, userId, fingerprint, JSON.stringify(ngramFingerprints), language, codeLength, isWinning ? 1 : 0, createdAt]
  );
}

async function getSolutionFingerprints(problemId, limit = 100) {
  const rows = await all(
    `SELECT fingerprint, ngram_fingerprints, battle_id, user_id, language
     FROM solution_fingerprints
     WHERE problem_id = ? AND is_winning_solution = 1
     ORDER BY created_at DESC
     LIMIT ?`,
    [problemId, limit]
  );
  return rows.map(row => ({
    ...row,
    ngramFingerprints: row.ngram_fingerprints ? JSON.parse(row.ngram_fingerprints) : []
  }));
}

async function checkExactFingerprint(fingerprint) {
  return await get(
    `SELECT battle_id, user_id, problem_id FROM solution_fingerprints WHERE fingerprint = ? LIMIT 1`,
    [fingerprint]
  );
}

// ============================================
// ANTI-CHEAT: Browser Fingerprints
// ============================================

async function storeBrowserFingerprint(userId, fingerprint, userAgent, screenResolution, timezone) {
  const now = new Date().toISOString();
  await run(
    `INSERT INTO browser_fingerprints (user_id, fingerprint, user_agent, screen_resolution, timezone, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, fingerprint) DO UPDATE SET last_seen_at = ?`,
    [userId, fingerprint, userAgent, screenResolution, timezone, now, now, now]
  );
}

async function getUsersWithSameFingerprint(fingerprint, excludeUserId = null) {
  if (excludeUserId) {
    return await all(
      `SELECT DISTINCT user_id FROM browser_fingerprints WHERE fingerprint = ? AND user_id != ?`,
      [fingerprint, excludeUserId]
    );
  }
  return await all(
    `SELECT DISTINCT user_id FROM browser_fingerprints WHERE fingerprint = ?`,
    [fingerprint]
  );
}

async function getUserBrowserFingerprints(userId) {
  return await all(
    `SELECT fingerprint, user_agent, screen_resolution, timezone, first_seen_at, last_seen_at
     FROM browser_fingerprints WHERE user_id = ?`,
    [userId]
  );
}

// ============================================
// ANTI-CHEAT: Flagged Submissions
// ============================================

async function createFlaggedSubmission(battleId, userId, playerId, problemId, code, language, violations, totalSuspicion, recommendation) {
  const createdAt = new Date().toISOString();
  await run(
    `INSERT INTO flagged_submissions (battle_id, user_id, player_id, problem_id, code, language, violations, total_suspicion, recommendation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [battleId, userId, playerId, problemId, code, language, JSON.stringify(violations), totalSuspicion, recommendation, createdAt]
  );
}

async function getFlaggedSubmissions(status = 'pending', limit = 50) {
  return await all(
    `SELECT fs.*, u.username, u.email
     FROM flagged_submissions fs
     LEFT JOIN users u ON fs.user_id = u.id
     WHERE fs.review_status = ?
     ORDER BY fs.total_suspicion DESC, fs.created_at DESC
     LIMIT ?`,
    [status, limit]
  );
}

async function reviewFlaggedSubmission(submissionId, reviewerId, status, notes) {
  const reviewedAt = new Date().toISOString();
  await run(
    `UPDATE flagged_submissions
     SET review_status = ?, reviewed_by = ?, reviewed_at = ?, review_notes = ?
     WHERE id = ?`,
    [status, reviewerId, reviewedAt, notes, submissionId]
  );
}

async function getFlaggedSubmissionStats() {
  return await get(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END) as pending,
       SUM(CASE WHEN review_status = 'confirmed_cheat' THEN 1 ELSE 0 END) as confirmed,
       SUM(CASE WHEN review_status = 'false_positive' THEN 1 ELSE 0 END) as false_positives,
       SUM(CASE WHEN recommendation = 'auto_flag' THEN 1 ELSE 0 END) as auto_flagged
     FROM flagged_submissions`
  );
}

// ============================================
// GDPR DATA EXPORT
// ============================================

async function exportUserData(userId) {
  // Get user profile (excluding password)
  const user = await get(
    `SELECT id, email, username, avatar, bio, is_online, last_seen, created_at,
            is_pro, pro_expires_at, has_onboarded, username_chosen, username_changed_at
     FROM users WHERE id = ?`,
    [userId]
  );

  if (!user) return null;

  // Get user stats
  const stats = await get(
    `SELECT wins, losses, ties, total_battles, rating, win_streak, best_win_streak,
            avg_solve_time, fastest_solve, total_xp, level, daily_streak, best_daily_streak, updated_at
     FROM user_stats WHERE user_id = ?`,
    [userId]
  );

  // Get battle history
  // battles_history stores one row per battle with winner/loser columns, so
  // fold it into the exporting user's point of view.
  const battles = await all(
    `SELECT battle_uuid, problem_id,
            CASE WHEN is_tie = 1 THEN 'tie' WHEN winner_id = ? THEN 'won' ELSE 'lost' END AS result,
            is_forfeit, is_matchmade,
            CASE WHEN winner_id = ? THEN winner_time ELSE loser_time END AS time_seconds,
            CASE WHEN winner_id = ? THEN winner_language ELSE loser_language END AS language,
            CASE WHEN winner_id = ? THEN winner_code ELSE loser_code END AS code,
            CASE WHEN winner_id = ? THEN winner_tests_passed ELSE loser_tests_passed END AS tests_passed,
            CASE WHEN winner_id = ? THEN winner_rating_change ELSE loser_rating_change END AS rating_change,
            CASE WHEN winner_id = ? THEN loser_id ELSE winner_id END AS opponent_id,
            created_at, finished_at
     FROM battles_history WHERE winner_id = ? OR loser_id = ? ORDER BY created_at DESC`,
    [userId, userId, userId, userId, userId, userId, userId, userId, userId]
  );

  // Get messages sent
  const messagesSent = await all(
    `SELECT m.id, m.receiver_id, u.username as receiver_username, m.content, m.created_at
     FROM messages m
     LEFT JOIN users u ON m.receiver_id = u.id
     WHERE m.sender_id = ? ORDER BY m.created_at DESC`,
    [userId]
  );

  // Get messages received
  const messagesReceived = await all(
    `SELECT m.id, m.sender_id, u.username as sender_username, m.content, m.created_at
     FROM messages m
     LEFT JOIN users u ON m.sender_id = u.id
     WHERE m.receiver_id = ? ORDER BY m.created_at DESC`,
    [userId]
  );

  // Get friendships
  const friends = await all(
    `SELECT CASE WHEN f.user1_id = ? THEN f.user2_id ELSE f.user1_id END AS friend_id,
            u.username AS friend_username, f.created_at
     FROM friendships f
     LEFT JOIN users u ON u.id = CASE WHEN f.user1_id = ? THEN f.user2_id ELSE f.user1_id END
     WHERE f.user1_id = ? OR f.user2_id = ?`,
    [userId, userId, userId, userId]
  );

  // Get badges earned
  const badges = await all(
    `SELECT ub.badge_id, b.name, b.description, b.rarity, ub.earned_at
     FROM user_badges ub
     LEFT JOIN badges b ON ub.badge_id = b.id
     WHERE ub.user_id = ?`,
    [userId]
  );

  // Get practice attempts
  const practiceAttempts = await all(
    `SELECT problem_id, language, solved, solve_time, attempts, solution_code, solution_submitted_at, created_at
     FROM practice_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 500`,
    [userId]
  );

  // Get daily challenge attempts
  const challengeAttempts = await all(
    `SELECT challenge_date, completed, solve_time, language, prompt_text, prompt_score,
            passed_tier_id, started_at, completed_at
     FROM daily_challenge_attempts WHERE user_id = ? ORDER BY started_at DESC`,
    [userId]
  );

  // Get activity events
  const activityEvents = await all(
    `SELECT event_type, event_data, is_public, created_at
     FROM activity_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 500`,
    [userId]
  );

  // Get rating history
  const ratingHistory = await all(
    `SELECT rating, rating_change, battle_uuid, result, created_at
     FROM rating_history WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );

  // Get email preferences
  const emailPreferences = await get(
    `SELECT weekly_challenge, marketing, activity_feed, progress_digest, tournament_notifications,
            activity_reminders, creator_arena_emails, message_digest, updated_at
     FROM user_email_preferences WHERE user_id = ?`,
    [userId]
  );

  // Get tournament participation
  const tournaments = await all(
    `SELECT tp.tournament_id, t.name as tournament_name, tp.seed, tp.language, tp.eliminated_at,
            tp.eliminated_in_round, tp.final_placement, tp.registered_at, tp.checked_in
     FROM tournament_participants tp
     LEFT JOIN tournaments t ON tp.tournament_id = t.id
     WHERE tp.user_id = ?`,
    [userId]
  );

  return {
    profile: user,
    stats: stats || {},
    emailPreferences: emailPreferences || {},
    battles: battles || [],
    messages: {
      sent: messagesSent || [],
      received: messagesReceived || []
    },
    friends: friends || [],
    badges: badges || [],
    practiceAttempts: practiceAttempts || [],
    challengeAttempts: challengeAttempts || [],
    activityEvents: activityEvents || [],
    ratingHistory: ratingHistory || [],
    tournaments: tournaments || []
  };
}

// ============================================
// DATA RETENTION & CLEANUP (GDPR)
// ============================================

/**
 * Delete messages older than the specified number of months
 * Default: 12 months (as per privacy policy)
 */
async function cleanupOldMessages(monthsOld = 12) {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - monthsOld);
  const cutoffISO = cutoffDate.toISOString();

  await run(
    `DELETE FROM message_reactions
     WHERE message_id IN (SELECT id FROM messages WHERE created_at < ?)`,
    [cutoffISO]
  );

  const result = await run(
    `DELETE FROM messages WHERE created_at < ?`,
    [cutoffISO]
  );
  return result.changes || 0;
}

/**
 * Delete activity events older than the specified number of days
 * Default: 90 days (as per privacy policy)
 */
async function cleanupOldActivityLogs(daysOld = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  const cutoffISO = cutoffDate.toISOString();

  const result = await run(
    `DELETE FROM activity_events WHERE created_at < ?`,
    [cutoffISO]
  );
  return result.changes || 0;
}

/**
 * Delete coding sessions older than 6 months
 */
async function cleanupOldCodingSessions(monthsOld = 6) {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - monthsOld);
  const cutoffISO = cutoffDate.toISOString();

  const result = await run(
    `DELETE FROM coding_sessions WHERE start_time < ?`,
    [cutoffISO]
  );
  return result.changes || 0;
}

/**
 * Run all data retention cleanup tasks
 * Should be called periodically (e.g., daily via cron or on server startup)
 */
async function runDataRetentionCleanup() {
  const results = {
    messagesDeleted: 0,
    activityLogsDeleted: 0,
    codingSessionsDeleted: 0,
    timestamp: new Date().toISOString()
  };

  try {
    results.messagesDeleted = await cleanupOldMessages(12);
    results.activityLogsDeleted = await cleanupOldActivityLogs(90);
    results.codingSessionsDeleted = await cleanupOldCodingSessions(6);
  } catch (error) {
    logger.error('[DataRetention] Cleanup error:', error.message);
    results.error = error.message;
  }

  return results;
}

// ============================================
// CONSENT RECORDS (GDPR)
// ============================================

async function saveConsentRecord(data) {
  const { userId, anonymousId, analyticsConsent, functionalConsent, action, ipAddress, userAgent } = data;
  const createdAt = new Date().toISOString();

  return run(
    `INSERT INTO consent_records (user_id, anonymous_id, analytics_consent, functional_consent, action, ip_address, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId || null, anonymousId || null, analyticsConsent ? 1 : 0, functionalConsent ? 1 : 0, action, ipAddress || null, userAgent || null, createdAt]
  );
}

async function getConsentHistory(userId) {
  return all(
    `SELECT * FROM consent_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );
}

// Get user's cookie consent preferences from their account
async function getUserCookieConsent(userId) {
  const user = await get(
    `SELECT cookie_consent_analytics, cookie_consent_functional, cookie_consent_updated_at FROM users WHERE id = ?`,
    [userId]
  );
  if (!user) return null;
  // Return null if user hasn't set consent yet
  if (user.cookie_consent_analytics === null && user.cookie_consent_functional === null) {
    return null;
  }
  return {
    analytics: !!user.cookie_consent_analytics,
    functional: !!user.cookie_consent_functional,
    updatedAt: user.cookie_consent_updated_at
  };
}

// Save user's cookie consent preferences to their account
async function saveUserCookieConsent(userId, analytics, functional) {
  await run(
    `UPDATE users SET cookie_consent_analytics = ?, cookie_consent_functional = ?, cookie_consent_updated_at = ? WHERE id = ?`,
    [analytics ? 1 : 0, functional ? 1 : 0, new Date().toISOString(), userId]
  );
  return true;
}

// ============================================
// USER REPORTS & BANS
// ============================================

async function createUserReport(reporterId, reportedUserId, reason, description = null, screenshots = null) {
  const result = await run(
    `INSERT INTO user_reports (reporter_id, reported_user_id, reason, description, screenshots, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [reporterId, reportedUserId, reason, description, screenshots, new Date().toISOString()]
  );
  return { id: result.lastID, reporter_id: reporterId, reported_user_id: reportedUserId, reason };
}

async function getUserReports(status = null, limit = 50) {
  if (status) {
    return all(
      `SELECT r.*,
              reporter.username as reporter_username,
              reported.username as reported_username,
              reviewer.username as reviewer_username
       FROM user_reports r
       JOIN users reporter ON r.reporter_id = reporter.id
       JOIN users reported ON r.reported_user_id = reported.id
       LEFT JOIN users reviewer ON r.reviewed_by = reviewer.id
       WHERE r.status = ?
       ORDER BY r.created_at DESC
       LIMIT ?`,
      [status, limit]
    );
  }
  return all(
    `SELECT r.*,
            reporter.username as reporter_username,
            reported.username as reported_username,
            reviewer.username as reviewer_username
     FROM user_reports r
     JOIN users reporter ON r.reporter_id = reporter.id
     JOIN users reported ON r.reported_user_id = reported.id
     LEFT JOIN users reviewer ON r.reviewed_by = reviewer.id
     ORDER BY r.created_at DESC
     LIMIT ?`,
    [limit]
  );
}

async function getReportById(reportId) {
  return get(
    `SELECT r.*,
            reporter.username as reporter_username,
            reported.username as reported_username
     FROM user_reports r
     JOIN users reporter ON r.reporter_id = reporter.id
     JOIN users reported ON r.reported_user_id = reported.id
     WHERE r.id = ?`,
    [reportId]
  );
}

async function updateReportStatus(reportId, status, reviewerId, resolution = null) {
  return run(
    `UPDATE user_reports SET status = ?, reviewed_by = ?, reviewed_at = ?, resolution = ? WHERE id = ?`,
    [status, reviewerId, new Date().toISOString(), resolution, reportId]
  );
}

async function getReportsForUser(userId) {
  return all(
    `SELECT * FROM user_reports WHERE reported_user_id = ? ORDER BY created_at DESC`,
    [userId]
  );
}

async function getReportCountForUser(userId) {
  const result = await get(
    `SELECT COUNT(*) as count FROM user_reports WHERE reported_user_id = ?`,
    [userId]
  );
  return result?.count || 0;
}

async function hasUserReported(reporterId, reportedUserId) {
  const result = await get(
    `SELECT id FROM user_reports WHERE reporter_id = ? AND reported_user_id = ? AND status = 'pending'`,
    [reporterId, reportedUserId]
  );
  return !!result;
}

async function banUser(userId, bannedBy, reason, expiresAt = null, isPermanent = false) {
  // Create ban record
  await run(
    `INSERT INTO user_bans (user_id, banned_by, reason, expires_at, is_permanent, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, bannedBy, reason, expiresAt, isPermanent ? 1 : 0, new Date().toISOString()]
  );
  // Update user banned status
  await run(`UPDATE users SET is_banned = 1 WHERE id = ?`, [userId]);
  return true;
}

async function isUserBanned(userId) {
  const user = await get(`SELECT is_banned FROM users WHERE id = ?`, [userId]);
  if (!user) return false;
  if (!user.is_banned) return false;

  // Check if there's an active non-expired ban
  const ban = await get(
    `SELECT * FROM user_bans WHERE user_id = ?
     AND (is_permanent = 1 OR expires_at IS NULL OR expires_at > ?)
     ORDER BY created_at DESC LIMIT 1`,
    [userId, new Date().toISOString()]
  );

  // If no active ban found, unban the user
  if (!ban) {
    await unbanUser(userId);
    return false;
  }

  return ban;
}

async function getUserBanHistory(userId) {
  return all(
    `SELECT b.*, admin.username as banned_by_username
     FROM user_bans b
     LEFT JOIN users admin ON b.banned_by = admin.id
     WHERE b.user_id = ?
     ORDER BY b.created_at DESC`,
    [userId]
  );
}

// ============================================
// PROGRESSIVE CHEAT DISCIPLINE
// ============================================

/**
 * Get user's effective cheat offense count for progressive discipline
 *
 * Cool-off period: If user has been clean for 6+ months, their next offense
 * is treated as #2 (24h suspension) instead of escalating from where they were.
 * This gives reformed users a second chance while still having consequences.
 *
 * Note: Permanent bans are never affected by cool-off - must appeal those.
 */
async function getCheatOffenseCount(userId) {
  // Check if user has a permanent ban - no cool-off for those
  const hasPermanentBan = await get(
    `SELECT 1 FROM cheat_discipline WHERE user_id = ? AND action_taken = 'permanent_ban' LIMIT 1`,
    [userId]
  );

  if (hasPermanentBan) {
    // Return full count - permanent bans don't get cool-off
    const result = await get(
      `SELECT COUNT(*) as count FROM cheat_discipline WHERE user_id = ?`,
      [userId]
    );
    return result?.count || 0;
  }

  // Get the most recent offense
  const lastOffense = await get(
    `SELECT created_at FROM cheat_discipline WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (!lastOffense) {
    return 0; // No prior offenses
  }

  // Check if 6 months have passed since last offense
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const lastOffenseDate = new Date(lastOffense.created_at);

  if (lastOffenseDate < sixMonthsAgo) {
    // Cool-off period passed - treat as if they have 1 prior offense
    // So their next offense will be #2 (24h suspension), not #1 (warning)
    return 1;
  }

  // Within 6 months - return full count
  const result = await get(
    `SELECT COUNT(*) as count FROM cheat_discipline WHERE user_id = ?`,
    [userId]
  );
  return result?.count || 0;
}

/**
 * Get user's cheat discipline history
 */
async function getCheatDisciplineHistory(userId) {
  return all(
    `SELECT * FROM cheat_discipline
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId]
  );
}

/**
 * Apply progressive discipline for cheating
 * Returns: { action, message, suspensionHours, shouldNotify }
 *
 * Offense 1: Warning
 * Offense 2: 24-hour suspension
 * Offense 3: 7-day suspension
 * Offense 4+: Permanent ban with appeal option
 */
async function applyCheatDiscipline(userId, violationType, details, battleId = null) {
  const currentCount = await getCheatOffenseCount(userId);
  const offenseNumber = currentCount + 1;
  const now = new Date();

  let action, message, suspensionHours = null, expiresAt = null;

  if (offenseNumber === 1) {
    // First offense: Warning only
    action = 'warning';
    message = 'This is a warning. We detected patterns suggesting external code assistance. CodeArena is about growing your skills through real competition. Continued violations may result in suspension.';
  } else if (offenseNumber === 2) {
    // Second offense: 24-hour suspension
    action = 'suspension_24h';
    suspensionHours = 24;
    expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    message = 'Your account has been suspended for 24 hours due to repeated violations of our fair play policy. Further violations will result in longer suspensions.';

    // Apply the ban
    await banUser(userId, null, `Auto-suspension: ${violationType} (offense #${offenseNumber})`, expiresAt, false);
  } else if (offenseNumber === 3) {
    // Third offense: 7-day suspension
    action = 'suspension_7d';
    suspensionHours = 168; // 7 days
    expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    message = 'Your account has been suspended for 7 days due to continued fair play violations. One more violation will result in a permanent ban.';

    // Apply the ban
    await banUser(userId, null, `Auto-suspension: ${violationType} (offense #${offenseNumber})`, expiresAt, false);
  } else {
    // Fourth+ offense: Permanent ban
    action = 'permanent_ban';
    message = 'Your account has been permanently banned due to repeated fair play violations. You may appeal this decision by contacting support@codearena.co.';

    // Apply permanent ban
    await banUser(userId, null, `Auto-ban: ${violationType} (offense #${offenseNumber})`, null, true);
  }

  // Record the discipline action
  await run(
    `INSERT INTO cheat_discipline (user_id, offense_number, violation_type, details, action_taken, suspension_hours, expires_at, battle_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, offenseNumber, violationType, details, action, suspensionHours, expiresAt, battleId, now.toISOString()]
  );

  return {
    action,
    message,
    offenseNumber,
    suspensionHours,
    expiresAt,
    shouldNotify: true
  };
}

/**
 * Check if user has active cheat suspension
 */
async function hasActiveCheatSuspension(userId) {
  const result = await get(
    `SELECT * FROM cheat_discipline
     WHERE user_id = ?
     AND action_taken IN ('suspension_24h', 'suspension_7d', 'permanent_ban')
     AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY created_at DESC LIMIT 1`,
    [userId, new Date().toISOString()]
  );
  return result || null;
}

// ============================================
// USER BLOCKING
// ============================================

async function blockUser(blockerId, blockedId) {
  try {
    await run(
      `INSERT INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`,
      [blockerId, blockedId, new Date().toISOString()]
    );
    return true;
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return true; // Already blocked
    }
    throw err;
  }
}

async function unblockUser(blockerId, blockedId) {
  await run(
    `DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?`,
    [blockerId, blockedId]
  );
  return true;
}

async function isUserBlocked(blockerId, blockedId) {
  const result = await get(
    `SELECT id FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?`,
    [blockerId, blockedId]
  );
  return !!result;
}

async function getBlockedUsers(userId) {
  return all(
    `SELECT b.*, u.username, u.avatar, u.avatar_url
     FROM blocked_users b
     JOIN users u ON b.blocked_id = u.id
     WHERE b.blocker_id = ?
     ORDER BY b.created_at DESC`,
    [userId]
  );
}

async function isBlockedEitherWay(userId1, userId2) {
  const result = await get(
    `SELECT id FROM blocked_users
     WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
    [userId1, userId2, userId2, userId1]
  );
  return !!result;
}

// ============================================
// ADMIN FUNCTIONS
// ============================================

async function isUserAdmin(userId) {
  const user = await get(`SELECT is_admin FROM users WHERE id = ?`, [userId]);
  return user?.is_admin === 1;
}

// Log admin actions for security audit trail
async function logAdminAction(adminId, action, { targetType = null, targetId = null, details = null, ipAddress = null, userAgent = null } = {}) {
  await run(
    `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [adminId, action, targetType, targetId, details ? JSON.stringify(details) : null, ipAddress, userAgent]
  );
}

// Get admin audit log (for reviewing admin actions)
async function getAdminAuditLog(limit = 100, offset = 0) {
  return all(
    `SELECT al.*, u.username as admin_username
     FROM admin_audit_log al
     LEFT JOIN users u ON al.admin_id = u.id
     ORDER BY al.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

async function getAdminStats() {
  const totalUsers = await get(`SELECT COUNT(*) as count FROM users`);
  const bannedUsers = await get(`SELECT COUNT(*) as count FROM users WHERE is_banned = 1`);
  const pendingReports = await get(`SELECT COUNT(*) as count FROM user_reports WHERE status = 'pending'`);
  const totalReports = await get(`SELECT COUNT(*) as count FROM user_reports`);
  const proUsers = await get(`SELECT COUNT(*) as count FROM users WHERE pro_expires_at > datetime('now')`);
  const feedbackCount = await get(`SELECT COUNT(*) as count FROM user_feedback`);
  const bugReportsTotal = await get(`SELECT COUNT(*) as count FROM bug_reports`);
  const bugReportsNew = await get(`SELECT COUNT(*) as count FROM bug_reports WHERE status = 'new'`);

  return {
    totalUsers: totalUsers?.count || 0,
    bannedUsers: bannedUsers?.count || 0,
    pendingReports: pendingReports?.count || 0,
    totalReports: totalReports?.count || 0,
    proUsers: proUsers?.count || 0,
    feedbackCount: feedbackCount?.count || 0,
    bugReportsTotal: bugReportsTotal?.count || 0,
    bugReportsNew: bugReportsNew?.count || 0
  };
}

/**
 * Get weekly stats for changelog emails
 * Returns total battles in last 7 days and count of users who had positive rating changes
 */
async function getWeeklyStats() {
  // Get total battles in the last 7 days
  const battlesResult = await get(`
    SELECT COUNT(*) as count
    FROM battles_history
    WHERE created_at >= datetime('now', '-7 days')
  `);

  // Count rank-ups: users whose rating increased this week
  // A rank-up is when winner_rating_change > 0 (the winner gained rating)
  const rankUpsResult = await get(`
    SELECT COUNT(DISTINCT winner_id) as count
    FROM battles_history
    WHERE created_at >= datetime('now', '-7 days')
      AND winner_rating_change > 0
      AND winner_id IS NOT NULL
  `);

  return {
    battlesThisWeek: battlesResult?.count || 0,
    rankUps: rankUpsResult?.count || 0
  };
}

// ============================================
// USER FEEDBACK
// ============================================

async function saveUserFeedback(feedbackData) {
  const { id, battleId, playerId, playerName, rating, suggestion, email, winner, problemId, standalone, timestamp } = feedbackData;
  const createdAt = new Date().toISOString();

  await run(
    `INSERT INTO user_feedback (id, battle_id, player_id, player_name, rating, suggestion, email, winner, problem_id, standalone, timestamp, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, battleId || null, playerId || null, playerName, rating, suggestion || '', email || '', winner || null, problemId || null, standalone ? 1 : 0, timestamp, createdAt]
  );

  return { id };
}

async function getAllUserFeedback(limit = 100) {
  return await all(
    `SELECT * FROM user_feedback ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

async function getUserFeedbackCount() {
  const result = await get(`SELECT COUNT(*) as count FROM user_feedback`);
  return result?.count || 0;
}

async function deleteUserFeedback(feedbackId) {
  await run(`DELETE FROM user_feedback WHERE id = ?`, [feedbackId]);
}

// ============================================
// BUG REPORTS
// ============================================

async function saveBugReport(reportData) {
  const { id, userId, username, email, title, description, screenshotUrl, pageUrl, submitterIp } = reportData;
  const createdAt = new Date().toISOString();

  await run(
    `INSERT INTO bug_reports (id, user_id, username, email, title, description, screenshot_url, page_url, status, submitter_ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
    [id, userId || null, username || null, email || null, title, description, screenshotUrl || null, pageUrl || null, submitterIp || null, createdAt]
  );

  return { id };
}

async function getBugReportCountToday(identifier) {
  // Count bug reports from the same user_id or IP in the last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const result = await get(
    `SELECT COUNT(*) as count FROM bug_reports
     WHERE (user_id = ? OR submitter_ip = ?) AND created_at > ?`,
    [identifier, identifier, oneDayAgo]
  );

  return result?.count || 0;
}

async function getAllBugReports(status = null, limit = 100) {
  if (status && status !== 'all') {
    return await all(
      `SELECT * FROM bug_reports WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
      [status, limit]
    );
  }
  return await all(
    `SELECT * FROM bug_reports ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

async function getBugReportCount(status = 'new') {
  if (status === 'all') {
    const result = await get(`SELECT COUNT(*) as count FROM bug_reports`);
    return result?.count || 0;
  }
  const result = await get(`SELECT COUNT(*) as count FROM bug_reports WHERE status = ?`, [status]);
  return result?.count || 0;
}

async function updateBugReportStatus(reportId, status, adminNotes = null) {
  const updatedAt = new Date().toISOString();
  await run(
    `UPDATE bug_reports SET status = ?, admin_notes = ?, updated_at = ? WHERE id = ?`,
    [status, adminNotes, updatedAt, reportId]
  );
}

async function deleteBugReport(reportId) {
  await run(`DELETE FROM bug_reports WHERE id = ?`, [reportId]);
}

async function getBugReportById(reportId) {
  return await get(`SELECT * FROM bug_reports WHERE id = ?`, [reportId]);
}

// ============================================
// FEATURE REQUESTS
// ============================================

async function createFeatureRequest(requestData) {
  const { id, userId, username, email, title, description, category, priority, submitterIp } = requestData;
  const createdAt = new Date().toISOString();

  await run(
    `INSERT INTO feature_requests (id, user_id, username, email, title, description, category, priority, status, submitter_ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
    [id, userId || null, username || null, email || null, title, description, category || 'other', priority || 'medium', submitterIp || null, createdAt]
  );

  return { id };
}

async function getFeatureRequests(filters = {}, limit = 100) {
  const { status, category } = filters;
  let query = 'SELECT * FROM feature_requests';
  const params = [];
  const conditions = [];

  if (status && status !== 'all') {
    conditions.push('status = ?');
    params.push(status);
  }
  if (category && category !== 'all') {
    conditions.push('category = ?');
    params.push(category);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  return await all(query, params);
}

async function getFeatureRequestById(requestId) {
  return await get(`SELECT * FROM feature_requests WHERE id = ?`, [requestId]);
}

async function updateFeatureRequest(requestId, updates) {
  const { status, adminNotes, priority } = updates;
  const updatedAt = new Date().toISOString();
  await run(
    `UPDATE feature_requests SET status = COALESCE(?, status), admin_notes = COALESCE(?, admin_notes), priority = COALESCE(?, priority), updated_at = ? WHERE id = ?`,
    [status || null, adminNotes !== undefined ? adminNotes : null, priority || null, updatedAt, requestId]
  );
}

async function deleteFeatureRequest(requestId) {
  await run(`DELETE FROM feature_requests WHERE id = ?`, [requestId]);
}

async function getFeatureRequestCounts() {
  const total = await get(`SELECT COUNT(*) as count FROM feature_requests`);
  const newCount = await get(`SELECT COUNT(*) as count FROM feature_requests WHERE status = 'new'`);
  const planned = await get(`SELECT COUNT(*) as count FROM feature_requests WHERE status = 'planned'`);
  const inProgress = await get(`SELECT COUNT(*) as count FROM feature_requests WHERE status = 'in_progress'`);
  const completed = await get(`SELECT COUNT(*) as count FROM feature_requests WHERE status = 'completed'`);
  const declined = await get(`SELECT COUNT(*) as count FROM feature_requests WHERE status = 'declined'`);

  return {
    total: total?.count || 0,
    new: newCount?.count || 0,
    planned: planned?.count || 0,
    in_progress: inProgress?.count || 0,
    completed: completed?.count || 0,
    declined: declined?.count || 0
  };
}

async function getFeatureRequestCountToday(userId, submitterIp) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const result = await get(
    `SELECT COUNT(*) as count FROM feature_requests
     WHERE (user_id = ? OR submitter_ip = ?) AND created_at > ?`,
    [userId, submitterIp, oneDayAgo]
  );

  return result?.count || 0;
}

// ============================================
// BATTLE PERSISTENCE (Snapshots)
// ============================================

/**
 * Save a battle snapshot for persistence across server restarts
 * Only saves battles in 'waiting', 'ready', or 'coding' states
 */
async function saveBattleSnapshot(battleId, state, battleData) {
  const now = new Date().toISOString();
  const serialized = JSON.stringify(battleData);

  await run(
    `INSERT INTO battle_snapshots (battle_id, state, battle_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(battle_id) DO UPDATE SET
       state = excluded.state,
       battle_data = excluded.battle_data,
       updated_at = excluded.updated_at`,
    [battleId, state, serialized, now, now]
  );
}

/**
 * Get all active battle snapshots (for restoration on server startup)
 */
async function getActiveBattleSnapshots() {
  const rows = await all(
    `SELECT battle_id, state, battle_data, created_at, updated_at
     FROM battle_snapshots
     WHERE state IN ('waiting', 'ready', 'coding')
     ORDER BY created_at ASC`
  );

  const snapshots = [];
  for (const row of rows) {
    try {
      snapshots.push({
        battleId: row.battle_id,
        state: row.state,
        battleData: JSON.parse(row.battle_data),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });
    } catch (parseErr) {
      logger.error(`[BattlePersistence] Failed to parse snapshot ${row.battle_id}:`, parseErr);
      // Delete corrupted snapshot
      await run(`DELETE FROM battle_snapshots WHERE battle_id = ?`, [row.battle_id]);
    }
  }
  return snapshots;
}

/**
 * Delete a battle snapshot (when battle finishes or is abandoned)
 */
async function deleteBattleSnapshot(battleId) {
  await run(`DELETE FROM battle_snapshots WHERE battle_id = ?`, [battleId]);
}

/**
 * Clean up stale battle snapshots (older than 2 hours)
 */
async function cleanupStaleBattleSnapshots() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const result = await run(
    `DELETE FROM battle_snapshots WHERE updated_at < ?`,
    [twoHoursAgo]
  );
  return result.changes || 0;
}

/**
 * Get snapshot count (for monitoring)
 */
async function getBattleSnapshotCount() {
  const result = await get(`SELECT COUNT(*) as count FROM battle_snapshots`);
  return result?.count || 0;
}

// ============================================
// TRUST TIER SYSTEM
// ============================================

const TRUST_TIERS = {
  TRUSTED: { name: 'trusted', minScore: 90, thresholdMultiplier: 1.5 },
  STANDARD: { name: 'standard', minScore: 60, thresholdMultiplier: 1.0 },
  PROBATION: { name: 'probation', minScore: 30, thresholdMultiplier: 0.6 },
  RESTRICTED: { name: 'restricted', minScore: 0, thresholdMultiplier: 0.3 }
};

function getTierFromScore(score) {
  if (score >= 90) return TRUST_TIERS.TRUSTED;
  if (score >= 60) return TRUST_TIERS.STANDARD;
  if (score >= 30) return TRUST_TIERS.PROBATION;
  return TRUST_TIERS.RESTRICTED;
}

/**
 * Get user's trust tier info
 */
async function getUserTrustTier(userId) {
  const stats = await get(`
    SELECT trust_score, trust_tier, tier_updated_at, clean_battles_since_violation, total_violations
    FROM user_stats WHERE user_id = ?
  `, [userId]);

  if (!stats) {
    return {
      trust_score: 100,
      trust_tier: 'standard',
      tier_updated_at: null,
      clean_battles_since_violation: 0,
      total_violations: 0
    };
  }
  return stats;
}

/**
 * Update trust score with logging and tier transitions
 */
async function updateTrustScore(userId, change, reason, battleId = null) {
  const current = await getUserTrustTier(userId);
  const previousScore = current.trust_score || 100;
  const newScore = Math.max(0, Math.min(100, previousScore + change));
  const previousTier = current.trust_tier || 'standard';
  const newTier = getTierFromScore(newScore).name;
  const tierChanged = previousTier !== newTier;

  // Update user_stats
  await run(`
    UPDATE user_stats
    SET trust_score = ?,
        trust_tier = ?,
        tier_updated_at = CASE WHEN ? THEN datetime('now') ELSE tier_updated_at END,
        clean_battles_since_violation = CASE
          WHEN ? < 0 THEN 0
          ELSE clean_battles_since_violation + 1
        END
    WHERE user_id = ?
  `, [newScore, newTier, tierChanged, change, userId]);

  // Log score change
  await run(`
    INSERT INTO trust_score_log (user_id, previous_score, new_score, change_amount, reason, battle_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `, [userId, previousScore, newScore, change, reason, battleId]);

  // Log tier change if applicable
  if (tierChanged) {
    await run(`
      INSERT INTO trust_tier_history (user_id, previous_tier, new_tier, trust_score_at_change, reason, triggered_by, created_at)
      VALUES (?, ?, ?, ?, ?, 'system', datetime('now'))
    `, [userId, previousTier, newTier, newScore, reason]);
  }

  return { previousScore, newScore, previousTier, newTier, tierChanged };
}

/**
 * Get user behavior metrics for anomaly detection
 */
async function getUserBehaviorMetrics(userId) {
  return await get(`SELECT * FROM user_behavior_metrics WHERE user_id = ?`, [userId]);
}

/**
 * Update user behavior metrics using Welford's online algorithm
 * This provides accurate mean AND variance for z-score calculations
 *
 * Welford's algorithm:
 *   n = n + 1
 *   delta = x - mean
 *   mean = mean + delta / n
 *   delta2 = x - mean
 *   M2 = M2 + delta * delta2
 *   variance = M2 / (n - 1)  [for sample variance]
 */
async function updateUserBehaviorMetrics(userId, metrics) {
  const existing = await getUserBehaviorMetrics(userId);
  const typingSpeed = metrics.typingSpeed || 0;
  const pasteFreq = metrics.pasteFrequency || 0;
  const focusLoss = metrics.focusLossCount || 0;
  const solveTime = metrics.solveTime || null;
  const difficulty = metrics.difficulty || null;

  if (!existing) {
    // First observation - initialize with this value, variance = 0
    await run(`
      INSERT INTO user_behavior_metrics (
        user_id, avg_typing_speed, typing_speed_variance, typing_speed_m2,
        avg_paste_frequency, paste_freq_m2,
        avg_focus_loss_count, focus_loss_m2,
        avg_solve_time_easy, solve_time_easy_m2, solve_time_easy_count,
        avg_solve_time_medium, solve_time_medium_m2, solve_time_medium_count,
        avg_solve_time_hard, solve_time_hard_m2, solve_time_hard_count,
        battles_analyzed, updated_at
      ) VALUES (?, ?, 0, 0, ?, 0, ?, 0, NULL, 0, 0, NULL, 0, 0, NULL, 0, 0, 1, datetime('now'))
    `, [userId, typingSpeed, pasteFreq, focusLoss]);

    // Update solve time for difficulty if provided
    if (solveTime !== null && difficulty) {
      await updateSolveTimeForDifficulty(userId, difficulty, solveTime, true);
    }
  } else {
    const n = (existing.battles_analyzed || 0) + 1;

    // Welford update for typing speed
    const typingDelta = typingSpeed - (existing.avg_typing_speed || 0);
    const newTypingMean = (existing.avg_typing_speed || 0) + typingDelta / n;
    const typingDelta2 = typingSpeed - newTypingMean;
    const newTypingM2 = (existing.typing_speed_m2 || 0) + typingDelta * typingDelta2;
    const newTypingVar = n > 1 ? newTypingM2 / (n - 1) : 0;

    // Welford update for paste frequency
    const pasteDelta = pasteFreq - (existing.avg_paste_frequency || 0);
    const newPasteMean = (existing.avg_paste_frequency || 0) + pasteDelta / n;
    const pasteDelta2 = pasteFreq - newPasteMean;
    const newPasteM2 = (existing.paste_freq_m2 || 0) + pasteDelta * pasteDelta2;

    // Welford update for focus loss
    const focusDelta = focusLoss - (existing.avg_focus_loss_count || 0);
    const newFocusMean = (existing.avg_focus_loss_count || 0) + focusDelta / n;
    const focusDelta2 = focusLoss - newFocusMean;
    const newFocusM2 = (existing.focus_loss_m2 || 0) + focusDelta * focusDelta2;

    // Update rolling window for median (keep last 20)
    const recentSpeeds = JSON.parse(existing.recent_typing_speeds || '[]');
    recentSpeeds.push(typingSpeed);
    if (recentSpeeds.length > 20) recentSpeeds.shift();

    await run(`
      UPDATE user_behavior_metrics
      SET avg_typing_speed = ?, typing_speed_variance = ?, typing_speed_m2 = ?,
          avg_paste_frequency = ?, paste_freq_m2 = ?,
          avg_focus_loss_count = ?, focus_loss_m2 = ?,
          recent_typing_speeds = ?,
          battles_analyzed = ?, updated_at = datetime('now')
      WHERE user_id = ?
    `, [newTypingMean, newTypingVar, newTypingM2, newPasteMean, newPasteM2, newFocusMean, newFocusM2, JSON.stringify(recentSpeeds), n, userId]);

    // Update solve time for difficulty if provided
    if (solveTime !== null && difficulty) {
      await updateSolveTimeForDifficulty(userId, difficulty, solveTime, false, existing);
    }
  }
}

/**
 * Update solve time baseline for a specific difficulty using Welford's algorithm
 * Also maintains rolling window for median calculation
 */
async function updateSolveTimeForDifficulty(userId, difficulty, solveTime, isFirst, existing = null) {
  const diffLower = difficulty.toLowerCase();
  const validDiffs = ['easy', 'medium', 'hard'];
  if (!validDiffs.includes(diffLower)) return;

  const avgCol = `avg_solve_time_${diffLower}`;
  const m2Col = `solve_time_${diffLower}_m2`;
  const countCol = `solve_time_${diffLower}_count`;
  const varCol = `solve_time_variance_${diffLower}`;
  const recentCol = `recent_solve_times_${diffLower}`;

  if (isFirst || !existing) {
    // First solve for this difficulty
    await run(`
      UPDATE user_behavior_metrics
      SET ${avgCol} = ?, ${m2Col} = 0, ${countCol} = 1, ${varCol} = 0, ${recentCol} = ?
      WHERE user_id = ?
    `, [solveTime, JSON.stringify([solveTime]), userId]);
  } else {
    const oldAvg = existing[avgCol] || solveTime;
    const oldM2 = existing[m2Col] || 0;
    const oldCount = existing[countCol] || 0;
    const n = oldCount + 1;

    const delta = solveTime - oldAvg;
    const newMean = oldAvg + delta / n;
    const delta2 = solveTime - newMean;
    const newM2 = oldM2 + delta * delta2;
    const newVar = n > 1 ? newM2 / (n - 1) : 0;

    // Update rolling window for median (keep last 20)
    const recentTimes = JSON.parse(existing[recentCol] || '[]');
    recentTimes.push(solveTime);
    if (recentTimes.length > 20) recentTimes.shift();

    await run(`
      UPDATE user_behavior_metrics
      SET ${avgCol} = ?, ${m2Col} = ?, ${countCol} = ?, ${varCol} = ?, ${recentCol} = ?
      WHERE user_id = ?
    `, [newMean, newM2, n, newVar, JSON.stringify(recentTimes), userId]);
  }
}

/**
 * Save battle behavior snapshot
 */
async function saveBattleBehaviorSnapshot(battleId, userId, metrics) {
  await run(`
    INSERT INTO battle_behavior_snapshot
    (battle_id, user_id, total_keystrokes, paste_count, focus_losses, suspicion_score, violations, tier_at_battle, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    battleId, userId, metrics.totalKeystrokes || 0, metrics.pasteCount || 0,
    metrics.focusLosses || 0, metrics.suspicionScore || 0,
    JSON.stringify(metrics.violations || []), metrics.tierAtBattle || 'standard'
  ]);
}

/**
 * Create a user-facing violation explanation for transparency
 */
async function createViolationExplanation(battleId, userId, data) {
  await run(`
    INSERT INTO violation_explanations
    (battle_id, user_id, violation_type, user_facing_message, baseline_comparison, appealable, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    battleId,
    userId,
    data.violationType || 'unknown',
    data.userMessage || 'A concern was detected with your submission.',
    data.baselineComparison ? JSON.stringify(data.baselineComparison) : null,
    data.appealable !== false ? 1 : 0
  ]);
}

/**
 * Get user's violation explanations
 */
async function getUserViolationExplanations(userId, limit = 20) {
  return await all(`
    SELECT * FROM violation_explanations
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [userId, limit]);
}

/**
 * Update trust score with v2 daily cap checking
 */
async function updateTrustScoreWithCap(userId, change, reason, battleId = null) {
  // Check daily cap for gains
  if (change > 0) {
    const stats = await get(`
      SELECT last_trust_gain_date, daily_trust_gained
      FROM user_stats WHERE user_id = ?
    `, [userId]);

    const today = new Date().toISOString().split('T')[0];
    const dailyCap = 3.0;

    if (stats) {
      if (stats.last_trust_gain_date === today) {
        // Check if we'd exceed daily cap
        const remaining = dailyCap - (stats.daily_trust_gained || 0);
        if (remaining <= 0) {
          // Daily cap reached, no gain
          return { capped: true, actualChange: 0, reason: 'Daily trust gain cap reached' };
        }
        // Cap the change to remaining allowance
        change = Math.min(change, remaining);
      }
      // Update daily tracking
      await run(`
        UPDATE user_stats
        SET daily_trust_gained = CASE
              WHEN last_trust_gain_date = ? THEN daily_trust_gained + ?
              ELSE ?
            END,
            last_trust_gain_date = ?,
            last_active_date = datetime('now')
        WHERE user_id = ?
      `, [today, change, change, today, userId]);
    }
  }

  // Check for trust freeze (after violations)
  if (change > 0) {
    const frozen = await get(`
      SELECT trust_frozen_until FROM user_stats WHERE user_id = ?
    `, [userId]);
    if (frozen?.trust_frozen_until && new Date(frozen.trust_frozen_until) > new Date()) {
      return { frozen: true, actualChange: 0, reason: 'Trust gains frozen after violation' };
    }
  }

  // Apply the actual score update
  const result = await updateTrustScore(userId, change, reason, battleId);
  return { ...result, actualChange: change };
}

/**
 * Freeze trust gains for a period (after violations)
 */
async function freezeTrustGains(userId, hours = 24) {
  const freezeUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  await run(`
    UPDATE user_stats SET trust_frozen_until = ? WHERE user_id = ?
  `, [freezeUntil, userId]);
}

/**
 * Check and apply milestone bonuses (one-time)
 */
async function checkAndApplyMilestones(userId) {
  const stats = await get(`
    SELECT clean_battles_since_violation, milestone_streaks_claimed
    FROM user_stats WHERE user_id = ?
  `, [userId]);

  if (!stats) return [];

  const claimed = JSON.parse(stats.milestone_streaks_claimed || '[]');
  const streak = stats.clean_battles_since_violation || 0;
  const bonuses = [];

  // Define milestones
  const milestones = [
    { threshold: 10, bonus: 3, label: '10_streak' },
    { threshold: 25, bonus: 5, label: '25_streak' },
    { threshold: 50, bonus: 10, label: '50_streak' }
  ];

  for (const m of milestones) {
    if (streak >= m.threshold && !claimed.includes(m.label)) {
      await updateTrustScore(userId, m.bonus, `Milestone: ${m.threshold} clean battle streak`);
      claimed.push(m.label);
      bonuses.push({ milestone: m.label, bonus: m.bonus });
    }
  }

  if (bonuses.length > 0) {
    await run(`
      UPDATE user_stats SET milestone_streaks_claimed = ? WHERE user_id = ?
    `, [JSON.stringify(claimed), userId]);
  }

  return bonuses;
}

// ============================================
// APPEAL SYSTEM
// ============================================

/**
 * Submit an appeal for a violation
 */
async function submitTrustAppeal(userId, violationId, battleId, explanation) {
  // Check if user already has a pending appeal
  const existing = await get(`
    SELECT id FROM trust_appeals
    WHERE user_id = ? AND status = 'pending'
    LIMIT 1
  `, [userId]);

  if (existing) {
    throw new Error('You already have a pending appeal. Please wait for it to be reviewed.');
  }

  // Check for denial cooldown - 7 days after a denied appeal
  const lastDenied = await get(`
    SELECT resolved_at FROM trust_appeals
    WHERE user_id = ? AND status = 'denied'
    ORDER BY resolved_at DESC LIMIT 1
  `, [userId]);

  if (lastDenied?.resolved_at) {
    const cooldownEnd = new Date(lastDenied.resolved_at);
    cooldownEnd.setDate(cooldownEnd.getDate() + 7);
    if (new Date() < cooldownEnd) {
      const daysLeft = Math.ceil((cooldownEnd - new Date()) / (1000 * 60 * 60 * 24));
      throw new Error(`Appeal cooldown active. You can submit another appeal in ${daysLeft} day(s).`);
    }
  }

  // Check rate limit - max 3 appeals per week
  const recentAppeals = await get(`
    SELECT COUNT(*) as count FROM trust_appeals
    WHERE user_id = ? AND created_at > datetime('now', '-7 days')
  `, [userId]);

  if (recentAppeals.count >= 3) {
    throw new Error('You have reached the maximum number of appeals for this week.');
  }

  const result = await run(`
    INSERT INTO trust_appeals (user_id, violation_id, battle_id, user_explanation, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', datetime('now'))
  `, [userId, violationId, battleId, explanation]);

  return { appealId: result.lastInsertRowid };
}

/**
 * Get user's appeals
 */
async function getUserAppeals(userId, limit = 10) {
  return await all(`
    SELECT ta.*, ve.violation_type, ve.user_facing_message
    FROM trust_appeals ta
    LEFT JOIN violation_explanations ve ON ta.violation_id = ve.id
    WHERE ta.user_id = ?
    ORDER BY ta.created_at DESC
    LIMIT ?
  `, [userId, limit]);
}

/**
 * Get pending appeals for admin review
 */
async function getPendingAppeals(limit = 50) {
  return await all(`
    SELECT ta.*, u.username, u.avatar, u.avatar_url, us.trust_score, us.trust_tier,
           ve.violation_type, ve.user_facing_message, ve.baseline_comparison
    FROM trust_appeals ta
    JOIN users u ON ta.user_id = u.id
    LEFT JOIN user_stats us ON ta.user_id = us.user_id
    LEFT JOIN violation_explanations ve ON ta.violation_id = ve.id
    WHERE ta.status = 'pending'
    ORDER BY ta.created_at ASC
    LIMIT ?
  `, [limit]);
}

/**
 * Resolve an appeal (admin action)
 */
async function resolveAppeal(appealId, adminId, approved, adminResponse) {
  const appeal = await get(`SELECT * FROM trust_appeals WHERE id = ?`, [appealId]);
  if (!appeal) {
    throw new Error('Appeal not found');
  }
  if (appeal.status !== 'pending') {
    throw new Error('Appeal already resolved');
  }

  await run(`
    UPDATE trust_appeals
    SET status = ?, admin_id = ?, admin_response = ?, resolved_at = datetime('now')
    WHERE id = ?
  `, [approved ? 'approved' : 'denied', adminId, adminResponse, appealId]);

  // If approved, restore trust and mark violation as false positive
  if (approved) {
    await updateTrustScore(appeal.user_id, 5, 'Appeal approved - false positive cleared');
    await incrementFalsePositive(appeal.user_id);

    // Update the violation explanation if it exists
    if (appeal.violation_id) {
      await run(`
        UPDATE violation_explanations
        SET appeal_status = 'approved'
        WHERE id = ?
      `, [appeal.violation_id]);
    }
  } else {
    // Mark as denied
    if (appeal.violation_id) {
      await run(`
        UPDATE violation_explanations
        SET appeal_status = 'denied'
        WHERE id = ?
      `, [appeal.violation_id]);
    }
  }

  return { success: true, approved };
}

/**
 * Get appeal statistics
 */
async function getAppealStats() {
  return await get(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) as denied
    FROM trust_appeals
  `);
}

// ============================================
// SMURF DETECTION
// ============================================

/**
 * Record a device fingerprint for a user
 */
async function recordDeviceFingerprint(userId, fingerprint) {
  if (!fingerprint || fingerprint.length < 10) return;

  await run(`
    INSERT INTO user_device_fingerprints (user_id, fingerprint, first_seen, last_seen, times_seen)
    VALUES (?, ?, datetime('now'), datetime('now'), 1)
    ON CONFLICT(user_id, fingerprint) DO UPDATE SET
      last_seen = datetime('now'),
      times_seen = times_seen + 1
  `, [userId, fingerprint]);
}

/**
 * Check if a device fingerprint belongs to a restricted/banned user
 * Returns the worst trust tier associated with this device
 */
async function checkDeviceForRestrictedUsers(fingerprint) {
  if (!fingerprint || fingerprint.length < 10) return null;

  const result = await get(`
    SELECT udf.user_id, us.trust_tier, us.trust_score, u.username,
           ub.is_permanent as is_banned
    FROM user_device_fingerprints udf
    JOIN user_stats us ON udf.user_id = us.user_id
    JOIN users u ON udf.user_id = u.id
    LEFT JOIN user_bans ub ON udf.user_id = ub.user_id AND (ub.expires_at > datetime('now') OR ub.is_permanent = 1)
    WHERE udf.fingerprint = ?
      AND (us.trust_tier IN ('restricted', 'probation') OR ub.is_permanent = 1)
    ORDER BY
      CASE
        WHEN ub.is_permanent = 1 THEN 0
        WHEN us.trust_tier = 'restricted' THEN 1
        WHEN us.trust_tier = 'probation' THEN 2
        ELSE 3
      END
    LIMIT 1
  `, [fingerprint]);

  return result;
}

/**
 * Get the appropriate starting trust tier for a new user based on device history
 */
async function getStartingTierForDevice(fingerprint) {
  const restricted = await checkDeviceForRestrictedUsers(fingerprint);

  if (!restricted) {
    return { tier: 'standard', score: 50, reason: null };
  }

  if (restricted.is_banned) {
    return {
      tier: 'restricted',
      score: 10,
      reason: `Device associated with banned user: ${restricted.username}`
    };
  }

  if (restricted.trust_tier === 'restricted') {
    return {
      tier: 'probation',
      score: 30,
      reason: `Device associated with restricted user: ${restricted.username}`
    };
  }

  if (restricted.trust_tier === 'probation') {
    return {
      tier: 'standard',
      score: 45,
      reason: `Device associated with user on probation: ${restricted.username}`
    };
  }

  return { tier: 'standard', score: 50, reason: null };
}

/**
 * Get all device fingerprints for a user
 */
async function getUserDeviceFingerprints(userId) {
  return await all(`
    SELECT fingerprint, first_seen, last_seen, times_seen
    FROM user_device_fingerprints
    WHERE user_id = ?
    ORDER BY last_seen DESC
  `, [userId]);
}

/**
 * Get all users associated with a device fingerprint
 */
async function getUsersForDevice(fingerprint) {
  return await all(`
    SELECT udf.user_id, u.username, us.trust_tier, us.trust_score,
           udf.first_seen, udf.last_seen, udf.times_seen
    FROM user_device_fingerprints udf
    JOIN users u ON udf.user_id = u.id
    LEFT JOIN user_stats us ON udf.user_id = us.user_id
    WHERE udf.fingerprint = ?
    ORDER BY udf.first_seen ASC
  `, [fingerprint]);
}

/**
 * Apply trust decay to inactive users
 * - Starts after 30 days inactive
 * - Rate: -1 point per week of inactivity beyond 30 days
 * - Floor: 40 (clean history) or 25 (has violations)
 */
async function applyTrustDecay() {
  const results = { processed: 0, decayed: 0, errors: 0 };

  // Get users inactive for 30+ days with score above floor
  const inactiveUsers = await all(`
    SELECT us.user_id, us.trust_score, us.trust_tier, us.last_active_date, us.total_violations
    FROM user_stats us
    WHERE us.last_active_date < datetime('now', '-30 days')
      AND us.trust_score > 25
  `);

  // Handle case where query returns null/undefined (e.g., table doesn't exist yet)
  if (!inactiveUsers || !Array.isArray(inactiveUsers)) {
    return results;
  }

  for (const user of inactiveUsers) {
    results.processed++;

    // Calculate floor based on violation history
    const floor = (user.total_violations || 0) > 0 ? 25 : 40;

    if (user.trust_score <= floor) continue;

    // Calculate weeks inactive beyond 30 days
    const lastActive = new Date(user.last_active_date);
    const now = new Date();
    const daysInactive = Math.floor((now - lastActive) / (1000 * 60 * 60 * 24));
    const weeksOverThreshold = Math.floor((daysInactive - 30) / 7);

    if (weeksOverThreshold <= 0) continue;

    // Apply decay: -1 per week, but not below floor
    const decayAmount = Math.min(weeksOverThreshold, user.trust_score - floor);
    if (decayAmount <= 0) continue;

    try {
      await updateTrustScore(user.user_id, -decayAmount, `Inactivity decay (${daysInactive} days inactive)`);
      results.decayed++;
    } catch (err) {
      results.errors++;
    }
  }

  return results;
}

/**
 * Get trust tier distribution for admin dashboard
 */
async function getTrustTierDistribution() {
  return await all(`
    SELECT trust_tier, COUNT(*) as count
    FROM user_stats
    GROUP BY trust_tier
    ORDER BY
      CASE trust_tier
        WHEN 'trusted' THEN 1
        WHEN 'standard' THEN 2
        WHEN 'probation' THEN 3
        WHEN 'restricted' THEN 4
      END
  `);
}

/**
 * Get users on probation or restricted
 */
async function getProbationUsers(limit = 100) {
  return await all(`
    SELECT u.id, u.username, u.avatar, u.avatar_url, us.trust_score, us.trust_tier,
           us.total_violations, us.clean_battles_since_violation, us.tier_updated_at
    FROM users u
    JOIN user_stats us ON u.id = us.user_id
    WHERE us.trust_tier IN ('probation', 'restricted')
    ORDER BY us.trust_score ASC
    LIMIT ?
  `, [limit]);
}

/**
 * Get user trust score history
 */
async function getUserTrustHistory(userId, limit = 50) {
  return await all(`
    SELECT * FROM trust_score_log
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [userId, limit]);
}

/**
 * Get user tier change history
 */
async function getUserTierHistory(userId, limit = 20) {
  return await all(`
    SELECT * FROM trust_tier_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [userId, limit]);
}

/**
 * Admin override trust tier
 */
async function adminOverrideTrustTier(adminId, userId, newTier, newScore, reason) {
  const current = await getUserTrustTier(userId);

  // Update user_stats
  await run(`
    UPDATE user_stats
    SET trust_score = ?, trust_tier = ?, tier_updated_at = datetime('now')
    WHERE user_id = ?
  `, [newScore, newTier, userId]);

  // Log score change
  await run(`
    INSERT INTO trust_score_log (user_id, previous_score, new_score, change_amount, reason, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `, [userId, current.trust_score, newScore, newScore - current.trust_score, `Admin override: ${reason}`]);

  // Log tier change
  if (current.trust_tier !== newTier) {
    await run(`
      INSERT INTO trust_tier_history (user_id, previous_tier, new_tier, trust_score_at_change, reason, triggered_by, admin_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'admin', ?, datetime('now'))
    `, [userId, current.trust_tier, newTier, newScore, reason, adminId]);
  }
}

/**
 * Increment false positive count for user
 */
async function incrementFalsePositive(userId) {
  await run(`
    UPDATE user_behavior_metrics
    SET times_false_positive = times_false_positive + 1, updated_at = datetime('now')
    WHERE user_id = ?
  `, [userId]);
}

// ============================================
// USER SESSIONS
// ============================================

/**
 * Create a new user session
 * Deduplicates by device/browser/os - replaces existing session from same device
 * Also enforces a max of 20 sessions per user
 */
async function createUserSession(userId, tokenHash, sessionInfo = {}) {
  try {
    const { deviceType, browser, os, ipAddress, location } = sessionInfo;
    const now = new Date().toISOString();

    // Deduplicate: Delete existing sessions from same device/browser/os combination
    if (deviceType && browser && os) {
      await run(`
        DELETE FROM user_sessions
        WHERE user_id = ? AND device_type = ? AND browser = ? AND os = ?
      `, [userId, deviceType, browser, os]);
    }

    // Enforce max 20 sessions per user - delete oldest if over limit
    const sessionCount = await get(`
      SELECT COUNT(*) as count FROM user_sessions WHERE user_id = ?
    `, [userId]);

    if (sessionCount && sessionCount.count >= 20) {
      // Delete oldest sessions to make room (keep newest 19)
      await run(`
        DELETE FROM user_sessions
        WHERE user_id = ? AND id NOT IN (
          SELECT id FROM user_sessions
          WHERE user_id = ?
          ORDER BY last_active DESC
          LIMIT 19
        )
      `, [userId, userId]);
    }

    const result = await run(`
      INSERT INTO user_sessions (user_id, token_hash, device_type, browser, os, ip_address, location, last_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [userId, tokenHash, deviceType || null, browser || null, os || null, ipAddress || null, location || null, now, now]);

    return { id: result.lastID, userId, tokenHash };
  } catch (err) {
    if (err.message?.includes('no such table')) {
      logger.warn('[AUTH] user_sessions table not ready, skipping session creation');
      return { id: null, userId, tokenHash };
    }
    throw err;
  }
}

/**
 * Get all active sessions for a user (excludes sessions older than 30 days)
 */
async function getUserSessions(userId, currentTokenHash = null) {
  try {
    const sessions = await all(`
      SELECT id, token_hash, device_type, browser, os, ip_address, location, last_active, created_at
      FROM user_sessions
      WHERE user_id = ? AND last_active >= datetime('now', '-30 days')
      ORDER BY last_active DESC
    `, [userId]);

    // Mark the current session and remove token_hash from response
    return sessions.map(session => ({
      id: session.id,
      device_type: session.device_type,
      browser: session.browser,
      os: session.os,
      ip_address: session.ip_address,
      location: session.location,
      last_active: session.last_active,
      created_at: session.created_at,
      is_current: currentTokenHash ? session.token_hash === currentTokenHash : false
    }));
  } catch (err) {
    if (err.message?.includes('no such table')) {
      logger.warn('[AUTH] user_sessions table not ready, returning empty sessions');
      return [];
    }
    throw err;
  }
}

/**
 * Get session by token hash
 */
async function getSessionByTokenHash(tokenHash) {
  return get('SELECT * FROM user_sessions WHERE token_hash = ?', [tokenHash]);
}

/**
 * Update session last active time
 */
async function updateSessionLastActive(tokenHash) {
  await run(`
    UPDATE user_sessions SET last_active = datetime('now') WHERE token_hash = ?
  `, [tokenHash]);
}

/** Rotate the token hash after issuing a refreshed JWT. */
async function updateSessionTokenHash(sessionId, userId, tokenHash) {
  const result = await run(`
    UPDATE user_sessions
    SET token_hash = ?, last_active = datetime('now')
    WHERE id = ? AND user_id = ?
  `, [tokenHash, sessionId, userId]);
  return (result.changes || 0) > 0;
}

/**
 * Delete a specific session
 */
async function deleteSession(sessionId, userId) {
  await run('DELETE FROM user_sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
}

/**
 * Delete all sessions for a user except the current one
 */
async function deleteOtherSessions(userId, currentTokenHash) {
  await run(`
    DELETE FROM user_sessions WHERE user_id = ? AND token_hash != ?
  `, [userId, currentTokenHash]);
}

/**
 * Delete all sessions for a user
 */
async function deleteAllUserSessions(userId) {
  await run('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
}

/**
 * Cleanup expired sessions (older than 7 days of inactivity)
 * JWT can last 30 days, but inactive sessions are cleaned up sooner
 */
async function cleanupExpiredSessions() {
  try {
    const result = await run(`
      DELETE FROM user_sessions
      WHERE last_active < datetime('now', '-7 days')
    `);
    return { deletedCount: result.changes || 0 };
  } catch (err) {
    if (err.message?.includes('no such table')) {
      return { deletedCount: 0 };
    }
    throw err;
  }
}

// ============================================
// TWO-FACTOR AUTHENTICATION
// ============================================

/**
 * Save TOTP secret for user
 */
async function saveTotpSecret(userId, encryptedSecret) {
  await run('UPDATE users SET totp_secret = ? WHERE id = ?', [encryptedSecret, userId]);
}

/**
 * Get TOTP secret for user
 */
async function getTotpSecret(userId) {
  const user = await get('SELECT totp_secret FROM users WHERE id = ?', [userId]);
  return user?.totp_secret || null;
}

/**
 * Enable 2FA for user
 */
async function enable2FA(userId) {
  const now = new Date().toISOString();
  await run('UPDATE users SET is_2fa_enabled = 1, two_fa_enabled_at = ? WHERE id = ?', [now, userId]);
}

/**
 * Disable 2FA for user
 */
async function disable2FA(userId) {
  await run('UPDATE users SET is_2fa_enabled = 0, totp_secret = NULL, two_fa_enabled_at = NULL WHERE id = ?', [userId]);
  // Also delete backup codes
  await run('DELETE FROM two_factor_backup_codes WHERE user_id = ?', [userId]);
}

/**
 * Check if user has 2FA enabled
 */
async function is2FAEnabled(userId) {
  const user = await get('SELECT is_2fa_enabled FROM users WHERE id = ?', [userId]);
  return user?.is_2fa_enabled === 1;
}

/**
 * Save backup codes for user
 */
async function saveBackupCodes(userId, codeHashes) {
  const now = new Date().toISOString();
  // Delete old backup codes first
  await run('DELETE FROM two_factor_backup_codes WHERE user_id = ?', [userId]);
  // Insert new codes
  for (const codeHash of codeHashes) {
    await run(`
      INSERT INTO two_factor_backup_codes (user_id, code_hash, created_at)
      VALUES (?, ?, ?)
    `, [userId, codeHash, now]);
  }
}

/**
 * Verify and use a backup code
 */
async function useBackupCode(userId, codeHash) {
  // Look up the row id for the supplied code hash. The atomic CAS happens in
  // the UPDATE, never in JS, so even if two callers both find the same row
  // here, only one of the UPDATEs returns changes === 1.
  const code = await get(`
    SELECT id FROM two_factor_backup_codes
    WHERE user_id = ? AND code_hash = ? AND used = 0
  `, [userId, codeHash]);

  if (!code) return false;

  // Atomic compare-and-swap: only flip used 0 -> 1. If two requests race,
  // exactly one sees changes === 1 and is the legitimate consumer; the
  // other sees 0 and must be rejected even though it found a matching row
  // in the SELECT above.
  const result = await run(`
    UPDATE two_factor_backup_codes
    SET used = 1, used_at = datetime('now')
    WHERE id = ? AND used = 0
  `, [code.id]);

  return (result?.changes || 0) === 1;
}

/**
 * Get remaining backup codes count
 */
async function getBackupCodesCount(userId) {
  const result = await get(`
    SELECT COUNT(*) as count FROM two_factor_backup_codes
    WHERE user_id = ? AND used = 0
  `, [userId]);
  return result?.count || 0;
}

/**
 * Log 2FA action for security audit
 */
async function log2FAAction(userId, action, success, ipAddress, userAgent, details = null) {
  await run(`
    INSERT INTO two_factor_audit_log (user_id, action, success, ip_address, user_agent, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `, [userId, action, success ? 1 : 0, ipAddress, userAgent, details ? JSON.stringify(details) : null]);
}

/**
 * Get 2FA audit log for user
 */
async function get2FAAuditLog(userId, limit = 50) {
  const logs = await all(`
    SELECT * FROM two_factor_audit_log
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [userId, limit]);

  return logs.map(log => ({
    ...log,
    details: log.details ? JSON.parse(log.details) : null
  }));
}

/**
 * Save pending 2FA token (for login flow)
 */
async function save2FAPendingToken(userId, tokenHash, expiresAt) {
  await run(`
    UPDATE users
    SET two_factor_pending_token = ?, two_factor_pending_expires = ?
    WHERE id = ?
  `, [tokenHash, expiresAt, userId]);
}

/**
 * Verify and clear pending 2FA token
 */
async function verify2FAPendingToken(userId, tokenHash) {
  const user = await get(`
    SELECT two_factor_pending_token, two_factor_pending_expires
    FROM users
    WHERE id = ? AND two_factor_pending_token = ?
  `, [userId, tokenHash]);

  if (!user) return false;

  const now = Math.floor(Date.now() / 1000);
  if (user.two_factor_pending_expires && user.two_factor_pending_expires < now) {
    // Token expired, clear it
    await run('UPDATE users SET two_factor_pending_token = NULL, two_factor_pending_expires = NULL WHERE id = ?', [userId]);
    return false;
  }

  // Token is valid, clear it for single use
  await run('UPDATE users SET two_factor_pending_token = NULL, two_factor_pending_expires = NULL WHERE id = ?', [userId]);
  return true;
}

/**
 * Clear pending 2FA token
 */
async function clear2FAPendingToken(userId) {
  await run('UPDATE users SET two_factor_pending_token = NULL, two_factor_pending_expires = NULL WHERE id = ?', [userId]);
}

/**
 * Get user 2FA data (for login verification)
 */
async function getUser2FAData(userId) {
  return await get(`
    SELECT id, totp_secret, is_2fa_enabled, two_factor_pending_token, two_factor_pending_expires
    FROM users
    WHERE id = ?
  `, [userId]);
}

/**
 * Check rate limit for 2FA attempts
 */
async function check2FAAttempts(userId, windowMinutes = 15, maxAttempts = 10) {
  const result = await get(`
    SELECT COUNT(*) as count FROM two_factor_audit_log
    WHERE user_id = ?
    AND action IN ('2fa_verify_login', '2fa_recovery_attempt')
    AND success = 0
    AND created_at > datetime('now', '-' || ? || ' minutes')
  `, [userId, windowMinutes]);

  return (result?.count || 0) < maxAttempts;
}

// ============================================
// TRUSTED DEVICES FOR 2FA
// ============================================

/**
 * Add a trusted device for a user
 * Token should be hashed before storing
 */
async function addTrustedDevice(userId, deviceTokenHash, deviceInfo = {}) {
  const now = new Date().toISOString();
  // Default 30 days expiration
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const result = await run(`
    INSERT INTO trusted_devices (user_id, device_token_hash, device_name, browser, os, ip_address, last_used, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    userId,
    deviceTokenHash,
    deviceInfo.deviceName || null,
    deviceInfo.browser || null,
    deviceInfo.os || null,
    deviceInfo.ipAddress || null,
    now,
    now,
    expiresAt
  ]);

  return result.lastID;
}

/**
 * Verify a trusted device token and update last_used if valid
 * Returns the device record if valid, null otherwise
 */
async function verifyTrustedDevice(userId, deviceTokenHash) {
  const now = new Date().toISOString();

  const device = await get(`
    SELECT * FROM trusted_devices
    WHERE user_id = ? AND device_token_hash = ? AND expires_at > ?
  `, [userId, deviceTokenHash, now]);

  if (device) {
    // Update last_used timestamp
    await run(`
      UPDATE trusted_devices SET last_used = ? WHERE id = ?
    `, [now, device.id]);
  }

  return device;
}

/**
 * Get all trusted devices for a user
 */
async function getTrustedDevices(userId) {
  const now = new Date().toISOString();
  return await all(`
    SELECT id, device_name, browser, os, ip_address, last_used, created_at, expires_at
    FROM trusted_devices
    WHERE user_id = ? AND expires_at > ?
    ORDER BY last_used DESC
  `, [userId, now]);
}

/**
 * Revoke a specific trusted device
 */
async function revokeTrustedDevice(userId, deviceId) {
  const result = await run(`
    DELETE FROM trusted_devices WHERE id = ? AND user_id = ?
  `, [deviceId, userId]);
  return result.changes > 0;
}

/**
 * Revoke all trusted devices for a user
 */
async function revokeAllTrustedDevices(userId) {
  const result = await run(`
    DELETE FROM trusted_devices WHERE user_id = ?
  `, [userId]);
  return result.changes;
}

/**
 * Clean up expired trusted devices (can be run periodically)
 */
async function cleanupExpiredTrustedDevices() {
  const now = new Date().toISOString();
  const result = await run(`
    DELETE FROM trusted_devices WHERE expires_at <= ?
  `, [now]);
  return result.changes;
}

/**
 * Update user's last authentication timestamp
 */
async function updateLastAuthAt(userId) {
  const now = new Date().toISOString();
  await run(`
    UPDATE users SET last_auth_at = ? WHERE id = ?
  `, [now, userId]);
}

/**
 * Check if user has authenticated recently (within specified minutes)
 */
async function hasRecentAuth(userId, minutesThreshold = 15) {
  const user = await get(`
    SELECT last_auth_at FROM users WHERE id = ?
  `, [userId]);

  if (!user || !user.last_auth_at) {
    return false;
  }

  const lastAuthTime = new Date(user.last_auth_at).getTime();
  const thresholdTime = Date.now() - (minutesThreshold * 60 * 1000);

  return lastAuthTime >= thresholdTime;
}

/**
 * Get user with last_auth_at for re-auth check
 */
async function getUserWithLastAuth(userId) {
  return await get(`
    SELECT id, email, username, last_auth_at FROM users WHERE id = ?
  `, [userId]);
}

// ============================================
// AGENT CHALLENGES
// ============================================

/**
 * Create a new agent challenge
 */
async function createAgentChallenge(challenge) {
  const { id, type, title, description, requirement_type, requirement_value, reward_type, reward_value, starts_at, ends_at } = challenge;
  return await run(
    `INSERT INTO agent_challenges (id, type, title, description, requirement_type, requirement_value, reward_type, reward_value, starts_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, type, title, description, requirement_type, JSON.stringify(requirement_value), reward_type, JSON.stringify(reward_value), starts_at, ends_at]
  );
}

/**
 * Get active challenges (daily and/or weekly)
 */
async function getActiveChallenges(type = null) {
  const now = new Date().toISOString();
  let query = `SELECT * FROM agent_challenges WHERE starts_at <= ? AND ends_at > ?`;
  const params = [now, now];

  if (type) {
    query += ` AND type = ?`;
    params.push(type);
  }

  query += ` ORDER BY created_at DESC`;

  const challenges = await all(query, params);
  return challenges.map(c => ({
    ...c,
    requirement_value: JSON.parse(c.requirement_value),
    reward_value: JSON.parse(c.reward_value)
  }));
}

/**
 * Get agent challenge by ID
 */
async function getAgentChallengeById(challengeId) {
  const challenge = await get('SELECT * FROM agent_challenges WHERE id = ?', [challengeId]);
  if (challenge) {
    challenge.requirement_value = JSON.parse(challenge.requirement_value);
    challenge.reward_value = JSON.parse(challenge.reward_value);
  }
  return challenge;
}

/**
 * Get user's progress for a challenge
 */
async function getChallengeProgress(userId, challengeId) {
  return await get(
    'SELECT * FROM agent_challenge_progress WHERE user_id = ? AND challenge_id = ?',
    [userId, challengeId]
  );
}

/**
 * Get all user's challenge progress
 */
async function getUserChallengeProgress(userId) {
  return await all(
    `SELECT acp.*, ac.title, ac.type, ac.description, ac.requirement_type, ac.requirement_value, ac.reward_type, ac.reward_value, ac.ends_at
     FROM agent_challenge_progress acp
     JOIN agent_challenges ac ON acp.challenge_id = ac.id
     WHERE acp.user_id = ?`,
    [userId]
  );
}

/**
 * Update challenge progress
 */
async function updateChallengeProgress(userId, challengeId, progress, completed = 0, completedAt = null) {
  return await run(
    `INSERT INTO agent_challenge_progress (user_id, challenge_id, progress, completed, completed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, challenge_id)
     DO UPDATE SET progress = ?, completed = ?, completed_at = ?`,
    [userId, challengeId, progress, completed, completedAt, progress, completed, completedAt]
  );
}

/**
 * Mark challenge as claimed (after user claims reward)
 */
async function markChallengeClaimed(userId, challengeId) {
  return await run(
    `DELETE FROM agent_challenge_progress WHERE user_id = ? AND challenge_id = ?`,
    [userId, challengeId]
  );
}

/**
 * Clean up expired challenges
 */
async function cleanupExpiredChallenges() {
  const now = new Date().toISOString();

  // Delete expired challenges
  await run('DELETE FROM agent_challenges WHERE ends_at < ?', [now]);

  // Delete progress for expired challenges
  await run(
    `DELETE FROM agent_challenge_progress
     WHERE challenge_id NOT IN (SELECT id FROM agent_challenges)`
  );
}

// ============================================
// AGENT LOADOUTS
// ============================================

/**
 * Create a new agent loadout
 */
async function createAgentLoadout(data) {
  const {
    userId,
    name,
    description = '',
    model,
    systemPrompt = '',
    language,
    tools = '[]'
  } = data;

  const id = uuidv4();
  const createdAt = new Date().toISOString();

  await run(
    `INSERT INTO agent_loadouts (id, user_id, name, description, model, system_prompt, language, tools, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, name, description, model, systemPrompt, language, tools, createdAt, createdAt]
  );

  return { id, userId, name, description, model, systemPrompt, language, tools, created_at: createdAt };
}

// ============================================
// AGENT TOURNAMENTS
// ============================================

/**
 * Create a new agent tournament
 */
async function createAgentTournament(data) {
  const {
    name,
    description,
    format = 'single_elimination',
    maxParticipants = 32,
    entryFee = 0,
    prizePool = 0,
    startTime,
    registrationDeadline,
    createdBy
  } = data;

  const result = await run(
    `INSERT INTO agent_tournaments (name, description, format, max_participants, entry_fee, prize_pool, start_time, registration_deadline, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, description, format, maxParticipants, entryFee, prizePool, startTime, registrationDeadline, createdBy]
  );

  return { id: result.lastID };
}

/**
 * Get agent tournament by ID with participant count
 */
async function getAgentTournamentById(id) {
  const tournament = await get(
    `SELECT t.*,
            (SELECT COUNT(*) FROM agent_tournament_participants WHERE tournament_id = t.id) as participant_count,
            u.username as winner_username,
            creator.username as creator_username
     FROM agent_tournaments t
     LEFT JOIN users u ON t.winner_id = u.id
     LEFT JOIN users creator ON t.created_by = creator.id
     WHERE t.id = ?`,
    [id]
  );
  return tournament || null;
}

/**
 * Get all agent tournaments with filters
 */
async function getAgentTournaments(options = {}) {
  const { status, limit = 20, offset = 0 } = options;

  let query = `
    SELECT t.*,
           (SELECT COUNT(*) FROM agent_tournament_participants WHERE tournament_id = t.id) as participant_count,
           creator.username as creator_username
    FROM agent_tournaments t
    LEFT JOIN users creator ON t.created_by = creator.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    if (Array.isArray(status)) {
      query += ` AND t.status IN (${status.map(() => '?').join(',')})`;
      params.push(...status);
    } else {
      query += ` AND t.status = ?`;
      params.push(status);
    }
  }

  query += ` ORDER BY t.start_time ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return await all(query, params);
}

/**
 * Get upcoming agent tournaments
 */
async function getUpcomingAgentTournaments(limit = 5) {
  return await all(
    `SELECT t.*,
            (SELECT COUNT(*) FROM agent_tournament_participants WHERE tournament_id = t.id) as participant_count,
            creator.username as creator_username
     FROM agent_tournaments t
     LEFT JOIN users creator ON t.created_by = creator.id
     WHERE t.status IN ('upcoming', 'registration_open')
     ORDER BY t.start_time ASC
     LIMIT ?`,
    [limit]
  );
}

/**
 * Register user for agent tournament
 */
async function registerForAgentTournament(tournamentId, userId, loadoutId) {
  try {
    // Check if already registered
    const existing = await get(
      `SELECT id FROM agent_tournament_participants WHERE tournament_id = ? AND user_id = ?`,
      [tournamentId, userId]
    );

    if (existing) {
      return { success: false, error: 'Already registered for this tournament' };
    }

    // Check if tournament is full
    const tournament = await getAgentTournamentById(tournamentId);
    if (tournament.participant_count >= tournament.max_participants) {
      return { success: false, error: 'Tournament is full' };
    }

    // Verify loadout exists and belongs to user
    const loadout = await get(
      `SELECT id FROM agent_loadouts WHERE id = ? AND user_id = ?`,
      [loadoutId, userId]
    );

    if (!loadout) {
      return { success: false, error: 'Invalid loadout or loadout does not belong to you' };
    }

    await run(
      `INSERT INTO agent_tournament_participants (tournament_id, user_id, loadout_id, status)
       VALUES (?, ?, ?, 'registered')`,
      [tournamentId, userId, loadoutId]
    );

    return { success: true };
  } catch (err) {
    logger.error('Error registering for agent tournament:', err);
    return { success: false, error: 'Failed to register for tournament' };
  }
}

/**
 * Unregister user from agent tournament
 */
async function unregisterFromAgentTournament(tournamentId, userId) {
  const result = await run(
    `DELETE FROM agent_tournament_participants WHERE tournament_id = ? AND user_id = ?`,
    [tournamentId, userId]
  );

  return { success: result.changes > 0 };
}

/**
 * Check in user for agent tournament
 */
async function checkInForAgentTournament(tournamentId, userId) {
  try {
    const participant = await get(
      `SELECT id, status FROM agent_tournament_participants WHERE tournament_id = ? AND user_id = ?`,
      [tournamentId, userId]
    );

    if (!participant) {
      return { success: false, error: 'Not registered for this tournament' };
    }

    if (participant.status === 'checked_in') {
      return { success: false, error: 'Already checked in' };
    }

    await run(
      `UPDATE agent_tournament_participants SET status = 'checked_in', checked_in_at = ? WHERE tournament_id = ? AND user_id = ?`,
      [new Date().toISOString(), tournamentId, userId]
    );

    return { success: true };
  } catch (err) {
    logger.error('Error checking in for agent tournament:', err);
    return { success: false, error: 'Failed to check in' };
  }
}

/**
 * Get tournament participants
 */
async function getAgentTournamentParticipants(tournamentId) {
  return await all(
    `SELECT p.*,
            u.username,
            u.avatar,
            l.name as loadout_name,
            l.elo as loadout_elo,
            l.model as loadout_model,
            l.language as loadout_language
     FROM agent_tournament_participants p
     JOIN users u ON p.user_id = u.id
     JOIN agent_loadouts l ON p.loadout_id = l.id
     WHERE p.tournament_id = ?
     ORDER BY p.seed ASC, p.joined_at ASC`,
    [tournamentId]
  );
}

/**
 * Get tournament matches
 */
async function getAgentTournamentMatches(tournamentId) {
  return await all(
    `SELECT m.*,
            p1.username as player1_username,
            p2.username as player2_username,
            winner.username as winner_username,
            p1l.name as player1_loadout_name,
            p2l.name as player2_loadout_name
     FROM agent_tournament_matches m
     LEFT JOIN users p1 ON m.player1_id = p1.id
     LEFT JOIN users p2 ON m.player2_id = p2.id
     LEFT JOIN users winner ON m.winner_id = winner.id
     LEFT JOIN agent_tournament_participants p1p ON p1p.tournament_id = m.tournament_id AND p1p.user_id = m.player1_id
     LEFT JOIN agent_tournament_participants p2p ON p2p.tournament_id = m.tournament_id AND p2p.user_id = m.player2_id
     LEFT JOIN agent_loadouts p1l ON p1p.loadout_id = p1l.id
     LEFT JOIN agent_loadouts p2l ON p2p.loadout_id = p2l.id
     WHERE m.tournament_id = ?
     ORDER BY m.round ASC, m.match_number ASC`,
    [tournamentId]
  );
}

/**
 * Generate bracket for agent tournament (single elimination)
 */
async function generateAgentTournamentBracket(tournamentId) {
  try {
    const tournament = await getAgentTournamentById(tournamentId);
    if (!tournament) {
      throw new Error('Tournament not found');
    }

    // Get checked-in participants
    const participants = await all(
      `SELECT p.*, l.elo
       FROM agent_tournament_participants p
       JOIN agent_loadouts l ON p.loadout_id = l.id
       WHERE p.tournament_id = ? AND p.status = 'checked_in'
       ORDER BY l.elo DESC`,
      [tournamentId]
    );

    if (participants.length < 2) {
      throw new Error('Not enough participants to start tournament');
    }

    // Assign seeds based on ELO (higher ELO = lower seed number)
    for (let i = 0; i < participants.length; i++) {
      await run(
        `UPDATE agent_tournament_participants SET seed = ? WHERE id = ?`,
        [i + 1, participants[i].id]
      );
      // Also update the in-memory array
      participants[i].seed = i + 1;
    }

    // Calculate total rounds needed
    const totalRounds = Math.ceil(Math.log2(participants.length));

    // Update tournament with total rounds
    await run(
      `UPDATE agent_tournaments SET total_rounds = ?, current_round = 1 WHERE id = ?`,
      [totalRounds, tournamentId]
    );

    // Create first round matches
    const firstRoundMatches = Math.pow(2, totalRounds - 1);
    let matchNumber = 1;

    for (let i = 0; i < firstRoundMatches; i++) {
      const seed1 = i + 1;
      // Proper bracket seeding: pair seed i with seed (totalSlots - i + 1)
      const totalSlots = firstRoundMatches * 2;
      const seed2 = totalSlots - i;

      const player1 = seed1 <= participants.length ? participants.find(p => p.seed === seed1) : null;
      const player2 = seed2 <= participants.length ? participants.find(p => p.seed === seed2) : null;

      // Only create a match if at least one player exists
      if (!player1 && !player2) {
        continue;
      }

      await run(
        `INSERT INTO agent_tournament_matches (tournament_id, round, match_number, player1_id, player2_id, scheduled_at)
         VALUES (?, 1, ?, ?, ?, ?)`,
        [tournamentId, matchNumber, player1?.user_id || null, player2?.user_id || null, new Date().toISOString()]
      );

      // If no player2 (bye), automatically advance player1
      if (player1 && !player2) {
        await run(
          `UPDATE agent_tournament_matches SET winner_id = ?, completed_at = ? WHERE tournament_id = ? AND round = 1 AND match_number = ?`,
          [player1.user_id, new Date().toISOString(), tournamentId, matchNumber]
        );
      }

      matchNumber++;
    }

    return { success: true, totalRounds, participantCount: participants.length };
  } catch (err) {
    logger.error('Error generating agent tournament bracket:', err);
    throw err;
  }
}

/**
 * Update match result and advance winner
 */
async function updateAgentTournamentMatchResult(matchId, winnerId, battleId) {
  try {
    const match = await get(
      `SELECT * FROM agent_tournament_matches WHERE id = ?`,
      [matchId]
    );

    if (!match) {
      throw new Error('Match not found');
    }

    // Update match with winner
    await run(
      `UPDATE agent_tournament_matches SET winner_id = ?, battle_id = ?, completed_at = ? WHERE id = ?`,
      [winnerId, battleId, new Date().toISOString(), matchId]
    );

    // Mark loser as eliminated
    const loserId = match.player1_id === winnerId ? match.player2_id : match.player1_id;
    if (loserId) {
      await run(
        `UPDATE agent_tournament_participants SET status = 'eliminated', eliminated_at = ? WHERE tournament_id = ? AND user_id = ?`,
        [new Date().toISOString(), match.tournament_id, loserId]
      );
    }

    // Check if round is complete
    const roundMatches = await all(
      `SELECT * FROM agent_tournament_matches WHERE tournament_id = ? AND round = ?`,
      [match.tournament_id, match.round]
    );

    const allComplete = roundMatches.every(m => m.winner_id !== null);

    if (allComplete) {
      const tournament = await getAgentTournamentById(match.tournament_id);

      // Check if this was the final round
      if (match.round === tournament.total_rounds) {
        // Tournament complete
        await run(
          `UPDATE agent_tournaments SET status = 'completed', winner_id = ?, completed_at = ? WHERE id = ?`,
          [winnerId, new Date().toISOString(), match.tournament_id]
        );

        // Mark winner
        await run(
          `UPDATE agent_tournament_participants SET status = 'winner' WHERE tournament_id = ? AND user_id = ?`,
          [match.tournament_id, winnerId]
        );
      } else {
        // Create next round matches
        await createNextRoundMatches(match.tournament_id, match.round + 1);
      }
    }

    return { success: true };
  } catch (err) {
    logger.error('Error updating agent tournament match result:', err);
    throw err;
  }
}

/**
 * Create matches for next round
 */
async function createNextRoundMatches(tournamentId, nextRound) {
  const previousRound = nextRound - 1;
  const previousMatches = await all(
    `SELECT * FROM agent_tournament_matches WHERE tournament_id = ? AND round = ? ORDER BY match_number ASC`,
    [tournamentId, previousRound]
  );

  let matchNumber = 1;
  for (let i = 0; i < previousMatches.length; i += 2) {
    const match1 = previousMatches[i];
    const match2 = previousMatches[i + 1];

    const player1 = match1.winner_id;
    const player2 = match2?.winner_id || null;

    await run(
      `INSERT INTO agent_tournament_matches (tournament_id, round, match_number, player1_id, player2_id, scheduled_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tournamentId, nextRound, matchNumber, player1, player2, new Date().toISOString()]
    );

    // If no player2, automatically advance player1
    if (!player2) {
      await run(
        `UPDATE agent_tournament_matches SET winner_id = ?, completed_at = ? WHERE tournament_id = ? AND round = ? AND match_number = ?`,
        [player1, new Date().toISOString(), tournamentId, nextRound, matchNumber]
      );
    }

    matchNumber++;
  }

  // Update tournament current round
  await run(
    `UPDATE agent_tournaments SET current_round = ? WHERE id = ?`,
    [nextRound, tournamentId]
  );
}

/**
 * Update agent tournament status
 */
async function updateAgentTournamentStatus(tournamentId, status) {
  await run(
    `UPDATE agent_tournaments SET status = ?, updated_at = ? WHERE id = ?`,
    [status, new Date().toISOString(), tournamentId]
  );
}

/**
 * Check if user is registered for agent tournament
 */
async function isUserRegisteredForAgentTournament(tournamentId, userId) {
  const result = await get(
    `SELECT id FROM agent_tournament_participants WHERE tournament_id = ? AND user_id = ?`,
    [tournamentId, userId]
  );
  return !!result;
}

/**
 * Get user's pending agent tournament matches
 */
async function getUserPendingAgentTournamentMatches(userId) {
  return await all(
    `SELECT m.*,
            t.name as tournament_name,
            t.status as tournament_status,
            opp.username as opponent_username
     FROM agent_tournament_matches m
     JOIN agent_tournaments t ON m.tournament_id = t.id
     LEFT JOIN users opp ON (m.player1_id = ? AND m.player2_id = opp.id) OR (m.player2_id = ? AND m.player1_id = opp.id)
     WHERE (m.player1_id = ? OR m.player2_id = ?) AND m.winner_id IS NULL AND t.status = 'in_progress'
     ORDER BY m.scheduled_at ASC`,
    [userId, userId, userId, userId]
  );
}

/**
 * Get agent tournament check-in status
 */
async function getAgentTournamentCheckInStatus(tournamentId) {
  const result = await get(
    `SELECT
       COUNT(*) as total_registered,
       SUM(CASE WHEN status = 'checked_in' THEN 1 ELSE 0 END) as checked_in_count
     FROM agent_tournament_participants
     WHERE tournament_id = ?`,
    [tournamentId]
  );

  return {
    totalRegistered: result.total_registered || 0,
    checkedInCount: result.checked_in_count || 0
  };
}

// ============================================
// GAMES (AI Game Creator + Gallery)
// ============================================

async function createGame(creatorId, { title, description, gameType, htmlContent, tags, promptUsed = null }) {
  const result = await run(`
    INSERT INTO games (creator_id, title, description, game_type, html_content, tags)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [creatorId, title, description || null, gameType || 'browser', htmlContent, tags ? JSON.stringify(tags) : null]);
  // Also create first version
  await run(
    `INSERT INTO game_versions (game_id, version_number, html_content, prompt_used) VALUES (?, 1, ?, ?)`,
    [result.lastID, htmlContent, promptUsed || null]
  );
  return { id: result.lastID };
}

async function addGameVersion(gameId, { htmlContent, promptUsed = null }) {
  const latest = await get(`SELECT MAX(version_number) as max_v FROM game_versions WHERE game_id = ?`, [gameId]);
  const nextVersion = (latest?.max_v || 0) + 1;
  await run(
    `INSERT INTO game_versions (game_id, version_number, html_content, prompt_used) VALUES (?, ?, ?, ?)`,
    [gameId, nextVersion, htmlContent, promptUsed || null]
  );

  // Version history is useful, but an unlimited series of 500 KB snapshots can
  // grow the SQLite volume without bound. Retain the newest 50 per game.
  await run(`
    DELETE FROM game_verifications
    WHERE version_id IN (
      SELECT id FROM game_versions
      WHERE game_id = ?
      ORDER BY version_number DESC
      LIMIT -1 OFFSET 50
    )
  `, [gameId]);
  await run(`
    DELETE FROM game_versions
    WHERE id IN (
      SELECT id FROM game_versions
      WHERE game_id = ?
      ORDER BY version_number DESC
      LIMIT -1 OFFSET 50
    )
  `, [gameId]);
  return { versionNumber: nextVersion };
}

async function getGameById(gameId) {
  return get(`
    SELECT g.*, u.username as creator_username, u.avatar as creator_avatar,
           COALESCE(g.avg_rating, 0) as avg_rating, COALESCE(g.rating_count, 0) as rating_count
    FROM games g JOIN users u ON g.creator_id = u.id
    WHERE g.id = ? AND g.status != 'removed'
  `, [gameId]);
}

async function updateGame(gameId, { title, description, htmlContent, tags, promptUsed = null }) {
  return withTransaction(async () => {
    const updates = [];
    const params = [];
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (htmlContent !== undefined) { updates.push('html_content = ?'); params.push(htmlContent); }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(tags)); }
    updates.push("updated_at = datetime('now')");
    params.push(gameId);
    await run(`UPDATE games SET ${updates.join(', ')} WHERE id = ?`, params);

    if (htmlContent) {
      await addGameVersion(gameId, { htmlContent, promptUsed });
    }
  });
}

async function deleteGame(gameId) {
  await run(`UPDATE games SET status = 'removed', updated_at = datetime('now') WHERE id = ?`, [gameId]);
}

async function publishGame(gameId) {
  await run(`UPDATE games SET status = 'published', updated_at = datetime('now') WHERE id = ?`, [gameId]);
}

async function unpublishGame(gameId) {
  await run(`UPDATE games SET status = 'draft', updated_at = datetime('now') WHERE id = ?`, [gameId]);
}

async function getUserGames(userId) {
  return all(`
    SELECT id, title, description, game_type, status, play_count, vote_score, tags, created_at, updated_at
    FROM games WHERE creator_id = ? AND status != 'removed' ORDER BY updated_at DESC
  `, [userId]);
}

async function getPublishedGames({ sort = 'new', type, search, page = 1, limit = 20 }) {
  let where = "g.status = 'published'";
  const params = [];
  if (type && type !== 'all') { where += ' AND g.game_type = ?'; params.push(type); }
  if (search) { where += ' AND (g.title LIKE ? OR g.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  let orderBy = 'g.created_at DESC';
  if (sort === 'top') orderBy = 'g.vote_score DESC, g.created_at DESC';
  if (sort === 'hot') orderBy = 'g.play_count DESC, g.vote_score DESC';
  if (sort === 'rated') orderBy = 'g.avg_rating DESC, g.rating_count DESC, g.created_at DESC';

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const games = await all(`
    SELECT g.id, g.title, g.description, g.game_type, g.play_count, g.vote_score, g.tags, g.created_at,
           COALESCE(g.avg_rating, 0) as avg_rating, COALESCE(g.rating_count, 0) as rating_count,
           u.username as creator_username, u.avatar as creator_avatar
    FROM games g JOIN users u ON g.creator_id = u.id
    WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?
  `, params);

  const countParams = params.slice(0, -2);
  const total = await get(`SELECT COUNT(*) as count FROM games g WHERE ${where}`, countParams);

  return { games, total: total?.count || 0, page, limit };
}

async function incrementPlayCount(gameId) {
  await run(`UPDATE games SET play_count = play_count + 1 WHERE id = ?`, [gameId]);
}

async function upsertGameVote(gameId, userId, vote) {
  await run(`
    INSERT INTO game_votes (game_id, user_id, vote) VALUES (?, ?, ?)
    ON CONFLICT(game_id, user_id) DO UPDATE SET vote = ?, created_at = datetime('now')
  `, [gameId, userId, vote, vote]);
  await recalcGameVoteScore(gameId);
}

async function removeGameVote(gameId, userId) {
  await run(`DELETE FROM game_votes WHERE game_id = ? AND user_id = ?`, [gameId, userId]);
  await recalcGameVoteScore(gameId);
}

async function recalcGameVoteScore(gameId) {
  const result = await get(`SELECT COALESCE(SUM(vote), 0) as score FROM game_votes WHERE game_id = ?`, [gameId]);
  await run(`UPDATE games SET vote_score = ? WHERE id = ?`, [result.score, gameId]);
}

async function getUserVoteForGame(gameId, userId) {
  return get(`SELECT vote FROM game_votes WHERE game_id = ? AND user_id = ?`, [gameId, userId]);
}

async function getGameComments(gameId, userId = null) {
  return all(`
    SELECT gc.*, u.username, u.avatar,
           COALESCE(v.vote_score, 0) as vote_score,
           COALESCE(uv.vote, 0) as user_vote
    FROM game_comments gc JOIN users u ON gc.user_id = u.id
    LEFT JOIN (
      SELECT comment_id, SUM(vote) as vote_score
      FROM game_comment_votes
      GROUP BY comment_id
    ) v ON v.comment_id = gc.id
    LEFT JOIN game_comment_votes uv ON uv.comment_id = gc.id AND uv.user_id = ?
    WHERE gc.game_id = ? ORDER BY gc.created_at ASC
  `, [userId, gameId]);
}

async function createGameComment(gameId, userId, content, parentId) {
  const result = await run(`
    INSERT INTO game_comments (game_id, user_id, content, parent_id) VALUES (?, ?, ?, ?)
  `, [gameId, userId, content, parentId || null]);
  return { id: result.lastID };
}

async function deleteGameComment(commentId) {
  // Delete replies first (foreign keys are disabled, so no cascade)
  await run(`DELETE FROM game_comment_votes WHERE comment_id IN (SELECT id FROM game_comments WHERE parent_id = ?)`, [commentId]);
  await run(`DELETE FROM game_comments WHERE parent_id = ?`, [commentId]);
  await run(`DELETE FROM game_comment_votes WHERE comment_id = ?`, [commentId]);
  await run(`DELETE FROM game_comments WHERE id = ?`, [commentId]);
}

async function upsertGameCommentVote(commentId, userId, vote) {
  await run(`
    INSERT INTO game_comment_votes (comment_id, user_id, vote) VALUES (?, ?, ?)
    ON CONFLICT(comment_id, user_id) DO UPDATE SET vote = ?, created_at = datetime('now')
  `, [commentId, userId, vote, vote]);
}

async function removeGameCommentVote(commentId, userId) {
  await run(`DELETE FROM game_comment_votes WHERE comment_id = ? AND user_id = ?`, [commentId, userId]);
}

async function getUserVoteForGameComment(commentId, userId) {
  return get(`SELECT vote FROM game_comment_votes WHERE comment_id = ? AND user_id = ?`, [commentId, userId]);
}

async function getGameCommentVoteScore(commentId) {
  const result = await get(`SELECT COALESCE(SUM(vote), 0) as score FROM game_comment_votes WHERE comment_id = ?`, [commentId]);
  return result?.score || 0;
}

async function getGameVersions(gameId) {
  return all(`
    SELECT
      gv.id,
      gv.version_number,
      gv.prompt_used,
      gv.created_at,
      (
        SELECT overall_status
        FROM game_verifications v
        WHERE v.version_id = gv.id
        ORDER BY v.created_at DESC
        LIMIT 1
      ) as verification_status
    FROM game_versions gv
    WHERE gv.game_id = ?
    ORDER BY gv.version_number DESC
  `, [gameId]);
}

async function getLatestGameVersion(gameId) {
  return get(`
    SELECT id, game_id, version_number, html_content, prompt_used, created_at
    FROM game_versions
    WHERE game_id = ?
    ORDER BY version_number DESC
    LIMIT 1
  `, [gameId]);
}

async function getLatestGameVerificationForVersion(versionId) {
  const row = await get(`
    SELECT *
    FROM game_verifications
    WHERE version_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, [versionId]);

  if (!row) return null;

  return {
    ...row,
    spec_json: row.spec_json ? JSON.parse(row.spec_json) : null,
    findings_json: row.findings_json ? JSON.parse(row.findings_json) : [],
    artifacts_json: row.artifacts_json ? JSON.parse(row.artifacts_json) : {}
  };
}

async function getLatestGameVerificationForGame(gameId) {
  const row = await get(`
    SELECT gvf.*
    FROM game_verifications gvf
    JOIN game_versions gv ON gv.id = gvf.version_id
    WHERE gv.game_id = ?
    ORDER BY gv.version_number DESC, gvf.created_at DESC, gvf.id DESC
    LIMIT 1
  `, [gameId]);

  if (!row) return null;

  return {
    ...row,
    spec_json: row.spec_json ? JSON.parse(row.spec_json) : null,
    findings_json: row.findings_json ? JSON.parse(row.findings_json) : [],
    artifacts_json: row.artifacts_json ? JSON.parse(row.artifacts_json) : {}
  };
}

async function createGameVerification({
  gameId,
  versionId,
  spec,
  staticStatus,
  runtimeStatus,
  accuracyStatus,
  overallStatus,
  accuracyScore = 0,
  findings = [],
  artifacts = {},
  verifierVersion = null
}) {
  const result = await run(`
    INSERT INTO game_verifications (
      game_id, version_id, spec_json, static_status, runtime_status, accuracy_status,
      overall_status, accuracy_score, findings_json, artifacts_json, verifier_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    gameId,
    versionId,
    spec ? JSON.stringify(spec) : null,
    staticStatus,
    runtimeStatus,
    accuracyStatus,
    overallStatus,
    accuracyScore,
    JSON.stringify(findings || []),
    JSON.stringify(artifacts || {}),
    verifierVersion
  ]);

  return { id: result.lastID };
}

async function upsertGameRating(gameId, userId, rating) {
  await run(`
    INSERT INTO game_ratings (game_id, user_id, rating) VALUES (?, ?, ?)
    ON CONFLICT(game_id, user_id) DO UPDATE SET rating = ?, created_at = datetime('now')
  `, [gameId, userId, rating, rating]);
  await recalcGameRating(gameId);
}

async function removeGameRating(gameId, userId) {
  await run(`DELETE FROM game_ratings WHERE game_id = ? AND user_id = ?`, [gameId, userId]);
  await recalcGameRating(gameId);
}

async function recalcGameRating(gameId) {
  const result = await get(`SELECT ROUND(AVG(rating), 2) as avg_r, COUNT(*) as cnt FROM game_ratings WHERE game_id = ?`, [gameId]);
  await run(`UPDATE games SET avg_rating = ?, rating_count = ? WHERE id = ?`, [result.avg_r || 0, result.cnt || 0, gameId]);
}

async function getUserRatingForGame(gameId, userId) {
  return get(`SELECT rating FROM game_ratings WHERE game_id = ? AND user_id = ?`, [gameId, userId]);
}

async function getTopRatedGames(limit = 10) {
  return all(`
    SELECT g.id, g.title, g.description, g.game_type, g.play_count, g.vote_score,
           g.avg_rating, g.rating_count, g.created_at,
           u.username as creator_username, u.avatar as creator_avatar
    FROM games g JOIN users u ON g.creator_id = u.id
    WHERE g.status = 'published'
    ORDER BY g.avg_rating DESC, g.rating_count DESC, g.play_count DESC
    LIMIT ?
  `, [limit]);
}

async function updateUserGitHubToken(userId, token) {
  await run(`UPDATE users SET github_access_token = ? WHERE id = ?`, [token, userId]);
}

async function getUserGitHubToken(userId) {
  const row = await get(`SELECT github_access_token FROM users WHERE id = ?`, [userId]);
  return row?.github_access_token || null;
}

// ============================================
// IN-APP NOTIFICATIONS
// ============================================

async function createNotification(userId, { type, title, message, link }) {
  const result = await run(`
    INSERT INTO in_app_notifications (user_id, type, title, message, link)
    VALUES (?, ?, ?, ?, ?)
  `, [userId, type, title, message || null, link || null]);
  return { id: result.lastID };
}

async function getUserNotifications(userId, { limit = 20, unreadOnly = false } = {}) {
  const where = unreadOnly ? 'user_id = ? AND read = 0' : 'user_id = ?';
  return all(`
    SELECT * FROM in_app_notifications WHERE ${where}
    ORDER BY created_at DESC LIMIT ?
  `, [userId, limit]);
}

async function getUnreadNotificationCount(userId) {
  const row = await get(`SELECT COUNT(*) as count FROM in_app_notifications WHERE user_id = ? AND read = 0`, [userId]);
  return row?.count || 0;
}

async function markNotificationRead(notificationId, userId) {
  await run(`UPDATE in_app_notifications SET read = 1 WHERE id = ? AND user_id = ?`, [notificationId, userId]);
}

async function markAllNotificationsRead(userId) {
  await run(`UPDATE in_app_notifications SET read = 1 WHERE user_id = ? AND read = 0`, [userId]);
}

// ============================================
// CREDITS SYSTEM
// ============================================

const FREE_TRIAL_CREDITS = 0;
const PRO_MONTHLY_CREDITS = 500;
const CREDITS_PER_GENERATION = 5;
const CREDITS_PER_REVISION = 2;
const FREE_REVISIONS_PER_GAME = 0;

async function getUserCredits(userId) {
  let credits = await get('SELECT * FROM user_credits WHERE user_id = ?', [userId]);

  // First time user - grant free trial credits
  if (!credits) {
    await run(`
      INSERT INTO user_credits (user_id, balance, lifetime_earned)
      VALUES (?, ?, ?)
    `, [userId, FREE_TRIAL_CREDITS, FREE_TRIAL_CREDITS]);

    if (FREE_TRIAL_CREDITS > 0) {
      await run(`
        INSERT INTO credit_transactions (user_id, amount, type, description)
        VALUES (?, ?, 'trial_grant', 'Free trial credits for new users')
      `, [userId, FREE_TRIAL_CREDITS]);
    }

    credits = await get('SELECT * FROM user_credits WHERE user_id = ?', [userId]);
  }

  return credits;
}

async function deductCredits(userId, amount, description = null, gameId = null) {
  const normalizedAmount = Number.parseInt(amount, 10);
  if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
    return { success: false, error: 'Credit amount must be positive' };
  }

  return withTransaction(async () => {
    // Ensure the user_credits row exists (and trial credits are granted) before
    // the conditional debit. Keeping the balance update and ledger insert in
    // one transaction prevents a charge without a matching audit record.
    const credits = await getUserCredits(userId);
    const result = await run(`
      UPDATE user_credits
      SET balance = balance - ?, lifetime_spent = lifetime_spent + ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND balance >= ?
    `, [normalizedAmount, normalizedAmount, userId, normalizedAmount]);

    if (!result || result.changes === 0) {
      return { success: false, error: 'Insufficient credits', balance: credits.balance };
    }

    const transaction = await run(`
      INSERT INTO credit_transactions (user_id, amount, type, description, game_id)
      VALUES (?, ?, 'game_creation', ?, ?)
    `, [userId, -normalizedAmount, description || 'Game generation', gameId]);

    const updated = await getUserCredits(userId);
    return { success: true, balance: updated.balance, transactionId: transaction.lastID };
  });
}

async function refundCredits(userId, amount, description = null, gameId = null) {
  const normalizedAmount = Number.parseInt(amount, 10);
  if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
    return { success: false, error: 'Credit amount must be positive' };
  }

  return withTransaction(async () => {
    await getUserCredits(userId);
    await run(`
      UPDATE user_credits
      SET balance = balance + ?,
          lifetime_spent = MAX(0, lifetime_spent - ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `, [normalizedAmount, normalizedAmount, userId]);
    await run(`
      INSERT INTO credit_transactions (user_id, amount, type, description, game_id)
      VALUES (?, ?, 'game_creation_refund', ?, ?)
    `, [userId, normalizedAmount, description || 'Game generation refund', gameId]);

    const updated = await getUserCredits(userId);
    return { success: true, balance: updated.balance };
  });
}

async function addCredits(userId, amount, type, description = null) {
  await getUserCredits(userId); // Ensure record exists

  await run(`
    UPDATE user_credits
    SET balance = balance + ?, lifetime_earned = lifetime_earned + ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `, [amount, amount, userId]);

  await run(`
    INSERT INTO credit_transactions (user_id, amount, type, description)
    VALUES (?, ?, ?, ?)
  `, [userId, amount, type, description]);

  return getUserCredits(userId);
}

async function addPurchasedCredits(userId, amount, providerPaymentId, description = null) {
  const normalizedAmount = Number.parseInt(amount, 10);
  const normalizedPaymentId = String(providerPaymentId || '').trim();
  if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0 || !normalizedPaymentId) {
    throw new Error('A positive credit amount and provider payment ID are required');
  }

  return withTransaction(async () => {
    await getUserCredits(userId);
    const transaction = await run(`
      INSERT OR IGNORE INTO credit_transactions
        (user_id, amount, type, description, provider_payment_id)
      VALUES (?, ?, 'purchase', ?, ?)
    `, [userId, normalizedAmount, description, normalizedPaymentId]);

    if (!transaction || transaction.changes === 0) {
      return {
        credited: false,
        credits: await getUserCredits(userId)
      };
    }

    await run(`
      UPDATE user_credits
      SET balance = balance + ?, lifetime_earned = lifetime_earned + ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `, [normalizedAmount, normalizedAmount, userId]);

    return {
      credited: true,
      credits: await getUserCredits(userId),
      transactionId: transaction.lastID
    };
  });
}

async function revokePurchasedCredits(userId, targetAmount, providerPaymentId, description = null) {
  const normalizedAmount = Number.parseInt(targetAmount, 10);
  const normalizedPaymentId = String(providerPaymentId || '').trim();
  if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0 || !normalizedPaymentId) {
    throw new Error('A positive reversal amount and provider payment ID are required');
  }

  return withTransaction(async () => {
    await getUserCredits(userId);
    const existing = await get(`
      SELECT id, amount FROM credit_transactions
      WHERE provider_payment_id = ? AND type = 'purchase_reversal'
    `, [normalizedPaymentId]);
    const alreadyRevoked = existing ? Math.abs(existing.amount) : 0;

    if (normalizedAmount <= alreadyRevoked) {
      return {
        revoked: 0,
        credits: await getUserCredits(userId)
      };
    }

    const delta = normalizedAmount - alreadyRevoked;
    if (existing) {
      await run(`
        UPDATE credit_transactions
        SET amount = ?, description = ?
        WHERE id = ?
      `, [-normalizedAmount, description, existing.id]);
    } else {
      await run(`
        INSERT INTO credit_transactions
          (user_id, amount, type, description, provider_payment_id)
        VALUES (?, ?, 'purchase_reversal', ?, ?)
      `, [userId, -normalizedAmount, description, normalizedPaymentId]);
    }

    // A refunded pack may already have been spent. Allow a negative balance so
    // future purchases first repay that debt instead of silently losing the
    // clawback.
    await run(`
      UPDATE user_credits
      SET balance = balance - ?,
          lifetime_earned = MAX(0, lifetime_earned - ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `, [delta, delta, userId]);

    return {
      revoked: delta,
      credits: await getUserCredits(userId)
    };
  });
}

async function grantMonthlyCredits(userId, isPro) {
  // Ensure user_credits row exists.
  await getUserCredits(userId);

  // Current "month key" in YYYY-MM form. The last_monthly_grant column is TEXT
  // and only written by this function, so storing a month string is safe and
  // makes the atomic check a simple equality comparison.
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const grantAmount = isPro ? PRO_MONTHLY_CREDITS : 0;

  if (grantAmount > 0) {
    // Single atomic UPDATE: the WHERE clause re-asserts the row is still on a
    // PREVIOUS month, so two parallel callers cannot both succeed. Whichever
    // request wins the race flips last_monthly_grant to currentMonth; the
    // others see changes === 0 and short-circuit.
    const result = await run(`
      UPDATE user_credits
      SET balance = balance + ?,
          lifetime_earned = lifetime_earned + ?,
          last_monthly_grant = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
        AND (last_monthly_grant IS NULL OR last_monthly_grant != ?)
    `, [grantAmount, grantAmount, currentMonth, userId, currentMonth]);

    if (result && result.changes === 1) {
      await run(`
        INSERT INTO credit_transactions (user_id, amount, type, description)
        VALUES (?, ?, 'monthly_grant', 'Monthly Pro credits')
      `, [userId, grantAmount]);

      const updated = await getUserCredits(userId);
      return { granted: true, newBalance: updated.balance };
    }

    // Already granted this month (by a concurrent caller or an earlier call).
    return { granted: false };
  }

  // Free users: stamp the month so we don't reconsider until next month.
  // Same atomic guard, but no balance change and no transaction row.
  await run(`
    UPDATE user_credits
    SET last_monthly_grant = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
      AND (last_monthly_grant IS NULL OR last_monthly_grant != ?)
  `, [currentMonth, userId, currentMonth]);

  return { granted: false };
}

async function getCreditTransactions(userId, limit = 50) {
  return all(`
    SELECT ct.*, g.title as game_title
    FROM credit_transactions ct
    LEFT JOIN games g ON ct.game_id = g.id
    WHERE ct.user_id = ?
    ORDER BY ct.created_at DESC
    LIMIT ?
  `, [userId, limit]);
}

async function getRevisionCost(gameId) {
  if (!gameId) return CREDITS_PER_GENERATION;
  const game = await get('SELECT revision_count FROM games WHERE id = ?', [gameId]);
  if (!game) return CREDITS_PER_GENERATION;
  return CREDITS_PER_REVISION;
}

async function incrementRevisionCount(gameId) {
  await run('UPDATE games SET revision_count = revision_count + 1 WHERE id = ?', [gameId]);
}

async function canUserGenerate(userId, _legacyIsPro, cost = CREDITS_PER_GENERATION) {
  const credits = await getUserCredits(userId);

  if (credits.balance >= cost) {
    return { allowed: true, isPro: false, credits: credits.balance, cost };
  }

  return {
    allowed: false,
    isPro: false,
    credits: credits.balance,
    cost,
    reason: 'insufficient_credits'
  };
}

// ============================================
// REFERRAL SYSTEM
// ============================================

// Promotional model credits are disabled until a globally budgeted campaign
// mechanism exists. Referral tracking remains available without AI-cost grants.
const REFERRAL_BONUS_CREDITS = 0;

// Generate a unique 8-char referral code
function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 for readability
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function getUserReferralCode(userId) {
  const user = await get('SELECT referral_code FROM users WHERE id = ?', [userId]);
  if (user?.referral_code) {
    return user.referral_code;
  }

  // Generate a unique code for this user
  let code;
  let attempts = 0;
  while (attempts < 10) {
    code = generateReferralCode();
    const existing = await get('SELECT id FROM users WHERE referral_code = ?', [code]);
    if (!existing) break;
    attempts++;
  }

  await run('UPDATE users SET referral_code = ? WHERE id = ?', [code, userId]);
  return code;
}

async function getReferrerByCode(referralCode) {
  if (!referralCode) return null;
  const user = await get('SELECT id, username FROM users WHERE referral_code = ?', [referralCode.toUpperCase()]);
  return user;
}

async function createReferral(referrerId, refereeId, referralCode) {
  // Check if referee already has a referral record
  const existing = await get('SELECT id FROM referrals WHERE referee_id = ?', [refereeId]);
  if (existing) return null;

  // Can't refer yourself
  if (referrerId === refereeId) return null;

  await run(`
    INSERT INTO referrals (referrer_id, referee_id, referral_code, status)
    VALUES (?, ?, ?, 'pending')
  `, [referrerId, refereeId, referralCode.toUpperCase()]);

  // Promotional credits remain disabled until they have a global campaign cap.
  if (REFERRAL_BONUS_CREDITS > 0) {
    await addCredits(refereeId, REFERRAL_BONUS_CREDITS, 'referral_bonus', 'Referral signup bonus');
  }
  await run(`UPDATE referrals SET referee_credited = 1 WHERE referee_id = ?`, [refereeId]);

  return { refereeBonus: REFERRAL_BONUS_CREDITS };
}

async function completeReferral(refereeId) {
  // Called when referee creates their first game - grants credits to referrer
  const referral = await get(`
    SELECT * FROM referrals WHERE referee_id = ? AND status = 'pending' AND referrer_credited = 0
  `, [refereeId]);

  if (!referral) return null;

  if (REFERRAL_BONUS_CREDITS > 0) {
    await addCredits(referral.referrer_id, REFERRAL_BONUS_CREDITS, 'referral_reward',
      `Referral reward - friend created a game`);
  }

  // Mark referral as completed
  await run(`
    UPDATE referrals
    SET status = 'completed', referrer_credited = 1, completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [referral.id]);

  return { referrerId: referral.referrer_id, bonus: REFERRAL_BONUS_CREDITS };
}

async function getReferralStats(userId) {
  const stats = await get(`
    SELECT
      COUNT(*) as total_referrals,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_referrals,
      SUM(CASE WHEN referrer_credited = 1 THEN ? ELSE 0 END) as credits_earned
    FROM referrals WHERE referrer_id = ?
  `, [REFERRAL_BONUS_CREDITS, userId]);

  const code = await getUserReferralCode(userId);

  return {
    referralCode: code,
    totalReferrals: stats?.total_referrals || 0,
    completedReferrals: stats?.completed_referrals || 0,
    creditsEarned: stats?.credits_earned || 0,
    bonusPerReferral: REFERRAL_BONUS_CREDITS
  };
}

async function getRecentReferrals(userId, limit = 10) {
  return all(`
    SELECT r.*, u.username as referee_username
    FROM referrals r
    JOIN users u ON r.referee_id = u.id
    WHERE r.referrer_id = ?
    ORDER BY r.created_at DESC
    LIMIT ?
  `, [userId, limit]);
}

// ============================================
// CENTAUR MODE (solve-with-AI ranked sprints + battles)
// ============================================

/**
 * Get a user's Centaur stats, falling back to a fresh default row shape
 * (rating 1000) when they have not played a sprint yet.
 */
async function getCentaurStats(userId) {
  const row = await get(`SELECT * FROM centaur_stats WHERE user_id = ?`, [userId]);
  return row || {
    user_id: userId,
    rating: 1000,
    sprints: 0,
    best_time: null,
    current_streak: 0,
    best_streak: 0
  };
}

/**
 * Whether the user has previously solved this problem in Centaur mode.
 * Used to keep rating gains to first-solves only (anti-farming).
 */
async function hasSolvedCentaurProblem(userId, problemId) {
  const row = await get(
    `SELECT 1 FROM centaur_sprints WHERE user_id = ? AND problem_id = ? AND solved = 1 LIMIT 1`,
    [userId, problemId]
  );
  return !!row;
}

/**
 * Record a solved Centaur sprint: log it and upsert the aggregate stats
 * (rating, sprint count, fastest time, streaks). Only called on a solve.
 */
async function applyCentaurSprint(userId, { problemId, difficulty, language, solveTime, ratingChange, ratingAfter, usedAssist }) {
  await run(
    `INSERT INTO centaur_sprints (user_id, problem_id, difficulty, language, solved, solve_time, rating_change, rating_after, used_assist)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [userId, problemId, difficulty || null, language || null, solveTime, ratingChange, ratingAfter, usedAssist ? 1 : 0]
  );

  await run(
    `INSERT INTO centaur_stats (user_id, rating, sprints, best_time, current_streak, best_streak, updated_at)
     VALUES (?, ?, 1, ?, 1, 1, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       rating = ?,
       sprints = centaur_stats.sprints + 1,
       best_time = CASE WHEN centaur_stats.best_time IS NULL OR ? < centaur_stats.best_time THEN ? ELSE centaur_stats.best_time END,
       current_streak = centaur_stats.current_streak + 1,
       best_streak = MAX(centaur_stats.best_streak, centaur_stats.current_streak + 1),
       updated_at = datetime('now')`,
    [userId, ratingAfter, solveTime, ratingAfter, solveTime, solveTime]
  );

  return { success: true };
}

/**
 * Top Centaur players by rating, for the leaderboard.
 */
async function getCentaurLeaderboard(limit = 50) {
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  // Includes both async sprinters and real-time battle players (ranked by the
  // shared centaur rating). COALESCE keeps this safe before/after the wins/losses
  // columns land via migration 935.
  return all(
    `SELECT u.id AS user_id, u.username, cs.rating, cs.sprints,
            COALESCE(cs.wins, 0) AS wins, COALESCE(cs.losses, 0) AS losses,
            cs.best_time, cs.best_streak
     FROM centaur_stats cs
     JOIN users u ON u.id = cs.user_id
     WHERE cs.sprints > 0 OR COALESCE(cs.wins, 0) > 0 OR COALESCE(cs.losses, 0) > 0
     ORDER BY cs.rating DESC, (cs.sprints + COALESCE(cs.wins, 0)) DESC, cs.best_time ASC
     LIMIT ?`,
    [safeLimit]
  );
}

/**
 * Apply a real-time Centaur BATTLE result to centaur_stats (separate rating pool
 * from user_stats). Mirrors updateUserStatsWithElo but targets centaur_stats and
 * tracks wins/losses rather than the async sprint counter.
 */
async function updateCentaurStatsWithElo(userId, { result, ratingChange, solveTime }) {
  const now = new Date().toISOString();
  // Ensure a row exists (default rating 1000) before applying the delta.
  await run(
    `INSERT INTO centaur_stats (user_id, updated_at) VALUES (?, ?)
     ON CONFLICT(user_id) DO NOTHING`,
    [userId, now]
  );

  if (result === 'win') {
    await run(
      `UPDATE centaur_stats SET
         wins = COALESCE(wins, 0) + 1,
         current_streak = current_streak + 1,
         best_streak = MAX(best_streak, current_streak + 1),
         best_time = CASE WHEN ? IS NOT NULL AND (best_time IS NULL OR ? < best_time) THEN ? ELSE best_time END,
         rating = MIN(3500, MAX(100, rating + ?)),
         updated_at = ?
       WHERE user_id = ?`,
      [solveTime, solveTime, solveTime, ratingChange, now, userId]
    );
  } else {
    await run(
      `UPDATE centaur_stats SET
         losses = COALESCE(losses, 0) + 1,
         current_streak = 0,
         rating = MIN(3500, MAX(100, rating + ?)),
         updated_at = ?
       WHERE user_id = ?`,
      [ratingChange, now, userId]
    );
  }

  return { success: true };
}

/**
 * Aggregate Centaur beta metrics (ground truth from the DB) for the admin view.
 */
async function getCentaurBetaStats() {
  const players = (await get(`SELECT COUNT(*) AS c FROM centaur_stats`))?.c || 0;
  const uniqueSprinters = (await get(`SELECT COUNT(DISTINCT user_id) AS c FROM centaur_sprints`))?.c || 0;
  const sprintsSolved = (await get(`SELECT COUNT(*) AS c FROM centaur_sprints WHERE solved = 1`))?.c || 0;
  const sprintsLast24h = (await get(`SELECT COUNT(*) AS c FROM centaur_sprints WHERE solved = 1 AND created_at >= datetime('now','-1 day')`))?.c || 0;
  const battlesPlayed = (await get(`SELECT COALESCE(SUM(wins), 0) AS c FROM centaur_stats`))?.c || 0;
  const assist = await get(`SELECT COUNT(*) AS total, SUM(CASE WHEN used_assist = 1 THEN 1 ELSE 0 END) AS assisted FROM centaur_sprints WHERE solved = 1`);
  const copilotAssistRate = assist && assist.total > 0 ? (assist.assisted || 0) / assist.total : 0;
  const avg = await get(`SELECT AVG(solve_time) AS a FROM centaur_sprints WHERE solved = 1`);
  const avgSolveTimeSec = avg && avg.a != null ? Math.round(avg.a) : null;
  const byDifficulty = await all(`SELECT difficulty, COUNT(*) AS count FROM centaur_sprints WHERE solved = 1 GROUP BY difficulty ORDER BY count DESC`);
  const topPlayers = await all(
    `SELECT u.username, cs.rating, cs.sprints, COALESCE(cs.wins, 0) AS wins, COALESCE(cs.losses, 0) AS losses
     FROM centaur_stats cs JOIN users u ON u.id = cs.user_id
     ORDER BY cs.rating DESC, cs.sprints DESC
     LIMIT 10`
  );
  return {
    players,
    uniqueSprinters,
    sprintsSolved,
    sprintsLast24h,
    battlesPlayed,
    copilotAssistRate,
    avgSolveTimeSec,
    byDifficulty: byDifficulty.map(r => ({ difficulty: r.difficulty || 'Unknown', count: r.count })),
    topPlayers
  };
}

/**
 * Account audit for the admin panel: separates real members (accounts with real
 * email backing) from test/seed/dev accounts. Uses only HIGH-confidence test
 * signals so real OAuth users (player_* placeholders) are never mis-flagged, and
 * never flags an is_admin user. Read-only.
 */
async function getAccountAudit() {
  // Real email backing = a verified email OR an OAuth identity (OAuth emails are real/verified).
  const emailBacked = `(email_verified = 1 OR google_id IS NOT NULL OR github_id IS NOT NULL)`;
  // High-confidence test/seed/dev signals only.
  const isTest = `(is_admin = 0 AND (
      email LIKE '%@test.com'
      OR email LIKE '%@example.com'
      OR email LIKE '%@codearena.local'
      OR username LIKE 'tournament_user%'
      OR username LIKE 'localdev%'
      OR username LIKE 'testuser%'
  ))`;

  const total = (await get(`SELECT COUNT(*) AS c FROM users`))?.c || 0;
  const realMembers = (await get(`SELECT COUNT(*) AS c FROM users WHERE ${emailBacked} AND NOT ${isTest}`))?.c || 0;
  const suspectedTest = (await get(`SELECT COUNT(*) AS c FROM users WHERE ${isTest}`))?.c || 0;
  const oauth = (await get(`SELECT COUNT(*) AS c FROM users WHERE (google_id IS NOT NULL OR github_id IS NOT NULL) AND NOT ${isTest}`))?.c || 0;
  const emailVerifiedNonOauth = (await get(`SELECT COUNT(*) AS c FROM users WHERE email_verified = 1 AND google_id IS NULL AND github_id IS NULL AND NOT ${isTest}`))?.c || 0;
  const unverifiedNoOauth = (await get(`SELECT COUNT(*) AS c FROM users WHERE email_verified = 0 AND google_id IS NULL AND github_id IS NULL AND NOT ${isTest}`))?.c || 0;

  const suspected = await all(`
    SELECT id, username, email, created_at, email_verified, is_admin,
      CASE
        WHEN email LIKE '%@test.com' THEN 'test email (@test.com)'
        WHEN email LIKE '%@example.com' THEN 'test email (@example.com)'
        WHEN email LIKE '%@codearena.local' THEN 'dev email (@codearena.local)'
        WHEN username LIKE 'tournament_user%' THEN 'seed username (tournament_user*)'
        WHEN username LIKE 'localdev%' THEN 'dev account (localdev*)'
        WHEN username LIKE 'testuser%' THEN 'test username (testuser*)'
        ELSE 'test pattern'
      END AS reason
    FROM users
    WHERE ${isTest}
    ORDER BY created_at DESC
    LIMIT 500
  `);

  return {
    total,
    realMembers,
    suspectedTest,
    breakdown: { oauth, emailVerifiedNonOauth, unverifiedNoOauth },
    suspected
  };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  db,
  init,
  run,
  get,
  all,
  getCentaurStats,
  hasSolvedCentaurProblem,
  applyCentaurSprint,
  getCentaurLeaderboard,
  updateCentaurStatsWithElo,
  getCentaurBetaStats,
  getAccountAudit,
  withTransaction,

  // User functions
  createUser,
  getUserByEmail,
  getUserById,
  getUserByIdWithPassword,
  getUserByUsername,
  getUserByUsernameWithPassword,
  getUserByEmailWithPassword,
  getUserByGoogleId,
  createUserFromGoogle,
  linkGoogleAccount,
  getUserByGitHubId,
  createUserFromGitHub,
  linkGitHubAccount,
  isUsernameAvailable,
  updateUserProfile,
  updateUserPassword,
  setUserOnlineStatus,
  setUserAdminStatus,
  searchUsers,
  getRecentUsers,
  getAllUsersForAdmin,

  // Onboarding
  getUserOnboardingStatus,
  completeOnboarding,
  hasSeenPracticeDemo,
  claimPracticeDemo,

  // Password reset
  createPasswordReset,
  findValidResetByTokenHash,
  markResetUsed,

  // Email change
  createEmailChange,
  findValidEmailChangeByTokenHash,
  markEmailChangeUsed,
  updateUserEmail,
  isEmailAvailable,

  // Email verification
  createEmailVerification,
  findValidEmailVerificationByTokenHash,
  markEmailVerificationUsed,
  markUserEmailVerified,
  isUserEmailVerified,

  // Student verification
  createStudentVerification,
  findValidStudentVerificationByTokenHash,
  markStudentVerificationUsed,
  markStudentVerified,
  isStudentVerified,
  getStudentVerificationStatus,
  setUserSubscriptionType,
  cleanupExpiredStudentVerifications,

  // Student expiration warnings
  getUsersNeedingStudentExpirationWarning,
  recordStudentExpirationWarningSent,
  clearStudentExpirationWarning,

  // Battle history
  saveBattleResult,
  updateBattleRatingChanges,
  getUserBattleHistory,
  getGuestBattleHistory,
  getUserBattleCount,
  getBattleByUuid,

  // User stats
  getUserStats,
  adjustUserRating,
  updateUserStats,
  updateUserStatsWithElo,
  getLeaderboard,

  // Messaging
  createMessage,
  getConversationMessages,
  getUserConversations,
  markMessagesAsRead,
  getUnreadMessageCount,
  getMessageById,
  getMessageReactions,
  toggleMessageReaction,
  updateMessage,
  deleteMessage,

  // Group Chat
  createGroupConversation,
  getGroupById,
  getGroupMembers,
  isGroupMember,
  isGroupAdmin,
  addGroupMember,
  removeGroupMember,
  leaveGroup,
  updateGroupName,
  deleteGroup,
  getGroupConversations,
  createGroupMessage,
  getGroupMessages,
  getGroupMessageById,
  getGroupMessageReactions,
  toggleGroupMessageReaction,
  updateGroupMessage,
  deleteGroupMessage,

  // Challenges
  createChallenge,
  getChallengeById,
  getPendingChallengeForUser,
  updateChallengeStatus,
  expirePendingChallenges,
  hasPendingChallengeBetween,

  // Battle Invites
  createBattleInvite,
  getBattleInviteByCode,
  markBattleInviteUsed,
  atomicClaimBattleInvite,
  expireBattleInvite,
  expireBattleInvitesByBattleId,
  getActiveBattleInviteForBattle,

  // Friends
  sendFriendRequest,
  getPendingFriendRequests,
  getSentFriendRequests,
  getFriendRequestBetweenUsers,
  getFriendRequestById,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  getUserFriends,
  getFriendCount,
  areFriends,
  getOnlineUsers,
  removeFriend,
  getFriendshipStatus,
  getPendingFriendRequestCount,
  getUserFriendIds,

  // Anti-cheating
  logViolation,
  getBattleViolations,
  getUserViolations,
  getUserTrustScore,
  checkUserBanStatus,
  autoBanUser,
  banUser,
  unbanUser,
  getViolationStats,

  // Progressive Cheat Discipline
  getCheatOffenseCount,
  getCheatDisciplineHistory,
  applyCheatDiscipline,
  hasActiveCheatSuspension,

  // Anti-cheat: Solution Fingerprints
  storeSolutionFingerprint,
  getSolutionFingerprints,
  checkExactFingerprint,

  // Anti-cheat: Browser Fingerprints
  storeBrowserFingerprint,
  getUsersWithSameFingerprint,
  getUserBrowserFingerprints,

  // Anti-cheat: Flagged Submissions
  createFlaggedSubmission,
  getFlaggedSubmissions,
  reviewFlaggedSubmission,
  getFlaggedSubmissionStats,

  // Arena Challenges (Weekly)
  getCurrentWeekString,
  getTimeUntilNextWeek,
  getOrCreateArenaChallenge,
  getArenaChallenge,
  getArenaAttempt,
  startArenaAttempt,
  completeArenaAttempt,
  getArenaLeaderboard,
  getUserArenaHistory,
  getArenaChallengeStats,
  getUserArenaRank,
  getPastArenaChallenges,

  getUserEmailVerified,

  // Build (prompt-build) challenge, biweekly real-world themed
  createBuildChallenge,
  getBuildChallengeByPeriod,
  getBuildChallengeById,
  getCurrentBuildChallenge,
  listBuildChallenges,
  getBuildSubmissionForUser,
  getBuildSubmissionById,
  upsertBuildSubmission,
  getTopBuildSubmissionsByScore,
  markBuildShortlisted,
  shortlistAllBuildSubmissions,
  getBuildShortlist,
  getBuildSubmissionCount,
  getUserBuildVote,
  castBuildVote,
  getBuildWinnerCandidate,
  setBuildChallengeShortlisted,
  setBuildChallengeStatus,
  setBuildChallengeWinnerIfUnset,
  grantBuildChallengeReward,

  // Open builds, "take this further"
  OPEN_BUILD_STATUSES,
  upsertOpenBuild,
  getOpenBuildForUser,
  deleteOpenBuild,
  listOpenBuilds,

  // Judge-vs-rubric divergence telemetry
  logJudgeScore,
  getProblemDivergenceStats,
  getDivergenceLeaderboard,

  // Email Preferences
  getEmailPreferences,
  setEmailPreferences,
  getWeeklyChallengeSubscribers,
  getTournamentNotificationSubscribers,
  getMarketingSubscribers,
  unsubscribeFromWeeklyChallenge,
  unsubscribeFromMarketing,

  // Activity Reminder Notifications
  getLastActivityReminderSent,
  recordActivityReminderSent,
  getUsersNeedingActivityReminder,
  getPendingFriendRequestsForReminder,
  getUnreadMessagesForReminder,
  unsubscribeFromActivityReminders,
  unsubscribeFromCreatorArenaEmails,
  unsubscribeFromMessageDigest,
  getUsersForWeeklyMessageDigest,
  getWeeklyMessageDigestDetails,
  getPendingMatchCountInRound,
  tryRecordOneTimeNotification,
  getGameCommentCount,

  // Analytics
  recordRatingChange,
  getRatingHistory,
  getStatsByLanguage,
  getSolveTimeTrends,
  getUserAnalytics,

  // Practice Stats
  recordPracticeAttempt,
  getPracticeStats,
  getPracticeSolution,

  // Prompt practice
  recordPromptAttempt,
  getPromptPracticeStats,
  getPromptAttemptsToday,

  // Private Battle Stats
  updatePrivateBattleStats,
  getPrivateBattleStats,

  // Coding Sessions (Behavioral Tracking)
  startCodingSession,
  updateCodingSession,
  endCodingSession,
  getUserCodingSessions,
  getUserBehavioralStats,

  // Pro Status & Subscription
  isUserPro,
  setUserProStatus,
  getUserSubscription,
  isWebhookEventProcessed,
  markWebhookEventProcessed,
  startWebhookEventProcessing,
  completeWebhookEvent,
  failWebhookEvent,
  activateProIfNotAlready,

  // Campaign (LinkedIn Launch), capped Pro trial claims
  claimCampaignProTrial,
  getCampaignPublicStatus,
  getCampaignClaimForUser,
  getCampaignTrialMinutesUsed,
  getCampaignAiMinutesCap,
  getCampaignTrialMinuteCapStatus,
  setCampaignKillSwitch,
  setCampaignAiMinutesCap,
  getCampaignAdminSummary,

  getTokenVersion,
  incrementTokenVersion,
  isTokenVersionValid,

  // AI Coaching - Coder Profiles
  getCoderProfile,
  updateCoderProfile,

  // AI Coaching - Problem Category Stats
  updateProblemCategoryStats,
  getProblemCategoryStats,
  getWeakCategories,
  getStrongCategories,

  // Progress Dashboard (optimized batched query)
  getProgressDashboardData,

  // AI Coaching - Insights & Milestones
  saveCoachingInsight,
  getActiveInsights,
  dismissInsight,
  markInsightActedOn,
  recordMilestone,
  getRecentMilestones,
  checkForNewMilestones,

  // AI Coaching - Weekly Digests
  getWeeklyDigest,
  saveWeeklyDigest,
  getRecentDigests,

  // Pro User Weekly Progress Digest (emails)
  getProUsersForWeeklyDigest,
  getUserWeeklyStats,

  // AI Coaching - Comprehensive Analytics
  getComprehensiveCoachingData,
  cacheAIFeedback,
  getCachedAIFeedback,

  // Daily Usage Limits (Free tier)
  getDailyBattleCount,
  getDailyPracticeCount,
  getConsumerDailyUsage,
  tryConsumeConsumerDailyUsage,
  canUserBattle,
  canUserPractice,
  canUserUseLanguage,
  getUserAvailableLanguages,
  getGuestPracticeQuota,

  // Learn mode (beginner "Learn to code")
  getDailyTutorCount,
  logTutorMessage,
  getLessonTranslation,
  saveLessonTranslation,

  canGuestPracticeProblem,
  recordGuestPracticeProblemIfNew,

  // Badges System
  getAllBadges,
  getBadgeBySlug,
  getUserBadges,
  userHasBadge,
  awardBadge,
  batchAwardBadges,
  getUserBadgeSlugs,
  markBadgeNotified,
  markBadgesNotified,
  getUnnotifiedBadges,
  getUserBadgeStats,
  getBadgesWithUserStatus,
  getUserWinStreak,
  getUserFastestSolve,
  getUserWeeklyCompletionCount,
  getUserWeeklyStreak,
  checkAgentBattleBadges,
  getUserLeaderboardRank,

  // Agent Rivalries
  updateAgentRivalry,
  getAgentRivalry,
  getUserTopRivalries,
  checkRivalryBadges,

  // Activity Feed
  createActivityEvent,
  getActivityFeed,
  getUserActivityEvents,
  getGlobalActivityFeed,

  // Push Notifications
  savePushSubscription,
  removePushSubscription,
  getUserPushSubscriptions,
  getPushSubscriptionsForUsers,
  getActivityPreferences,
  setActivityPreferences,
  getReadReceiptsPreference,
  setReadReceiptsPreference,

  // Tournament System
  createTournament,
  getTournamentByInviteCode,
  deleteUserAccount,
  exportUserData,
  getUserPrivateTournamentsThisWeek,
  getTournamentById,
  getTournaments,
  getUpcomingTournaments,
  registerForTournament,
  unregisterFromTournament,
  getTournamentParticipants,
  isUserRegistered,
  updateTournamentStatus,
  generateBracket,
  getTournamentMatches,
  getTournamentMatch,
  getTournamentMatchByPosition,
  startTournamentMatch,
  completeTournamentMatch,
  getUserTournamentHistory,
  getUserTournamentStats,
  getUserPendingMatches,
  getTournamentsNeedingUpdate,
  openTournamentCheckIn,
  checkInForTournament,
  getTournamentCheckInStatus,
  cancelTournament,
  startTournamentWithCheckedIn,
  getCheckedInParticipantCount,
  canCheckIn,

  // GDPR Consent Records
  saveConsentRecord,
  getConsentHistory,
  getUserCookieConsent,
  saveUserCookieConsent,

  // GDPR Data Retention
  cleanupOldMessages,
  cleanupOldActivityLogs,
  cleanupOldCodingSessions,
  runDataRetentionCleanup,

  // User Reports & Moderation
  createUserReport,
  getUserReports,
  getReportById,
  updateReportStatus,
  getReportsForUser,
  getReportCountForUser,
  hasUserReported,

  // User Bans (banUser, unbanUser exported above in Anti-cheating section)
  isUserBanned,
  getUserBanHistory,

  // User Blocking
  blockUser,
  unblockUser,
  isUserBlocked,
  getBlockedUsers,
  isBlockedEitherWay,

  // Admin
  isUserAdmin,
  getAdminStats,
  getWeeklyStats,
  logAdminAction,
  getAdminAuditLog,

  // User Feedback
  saveUserFeedback,
  getAllUserFeedback,
  getUserFeedbackCount,
  deleteUserFeedback,

  // Bug Reports
  saveBugReport,
  getAllBugReports,
  getBugReportCount,
  getBugReportCountToday,
  updateBugReportStatus,
  deleteBugReport,
  getBugReportById,

  // Feature Requests
  createFeatureRequest,
  getFeatureRequests,
  getFeatureRequestById,
  updateFeatureRequest,
  deleteFeatureRequest,
  getFeatureRequestCounts,
  getFeatureRequestCountToday,

  // Battle Persistence (Snapshots)
  saveBattleSnapshot,
  getActiveBattleSnapshots,
  deleteBattleSnapshot,
  cleanupStaleBattleSnapshots,
  getBattleSnapshotCount,

  // Trust Tier System
  getUserTrustTier,
  updateTrustScore,
  updateTrustScoreWithCap,
  getUserBehaviorMetrics,
  updateUserBehaviorMetrics,
  saveBattleBehaviorSnapshot,
  createViolationExplanation,
  getUserViolationExplanations,
  freezeTrustGains,
  checkAndApplyMilestones,
  getTrustTierDistribution,
  getProbationUsers,
  getUserTrustHistory,
  getUserTierHistory,
  adminOverrideTrustTier,
  incrementFalsePositive,

  // Appeal System
  submitTrustAppeal,
  getUserAppeals,
  getPendingAppeals,
  resolveAppeal,
  getAppealStats,

  // Smurf Detection
  recordDeviceFingerprint,
  checkDeviceForRestrictedUsers,
  getStartingTierForDevice,
  getUserDeviceFingerprints,
  getUsersForDevice,

  // Trust Decay
  applyTrustDecay,

  // User Sessions
  createUserSession,
  getUserSessions,
  getSessionByTokenHash,
  updateSessionLastActive,
  updateSessionTokenHash,
  deleteSession,
  deleteOtherSessions,
  deleteAllUserSessions,
  cleanupExpiredSessions,

  // Two-Factor Authentication
  saveTotpSecret,
  getTotpSecret,
  enable2FA,
  disable2FA,
  is2FAEnabled,
  saveBackupCodes,
  useBackupCode,
  getBackupCodesCount,
  log2FAAction,
  get2FAAuditLog,
  save2FAPendingToken,
  verify2FAPendingToken,
  clear2FAPendingToken,
  getUser2FAData,
  check2FAAttempts,

  // Trusted Devices (for 2FA "Remember this device")
  addTrustedDevice,
  verifyTrustedDevice,
  getTrustedDevices,
  revokeTrustedDevice,
  revokeAllTrustedDevices,
  cleanupExpiredTrustedDevices,

  // Re-authentication
  updateLastAuthAt,
  hasRecentAuth,
  getUserWithLastAuth,

  // Agent Challenges
  createAgentChallenge,
  getActiveChallenges,
  getAgentChallengeById,
  getChallengeProgress,
  getUserChallengeProgress,
  updateChallengeProgress,
  markChallengeClaimed,
  cleanupExpiredChallenges,

  // Agent Loadouts
  createAgentLoadout,

  // Agent Tournaments
  createAgentTournament,
  getAgentTournamentById,
  getAgentTournaments,
  getUpcomingAgentTournaments,
  registerForAgentTournament,
  unregisterFromAgentTournament,
  checkInForAgentTournament,
  getAgentTournamentParticipants,
  getAgentTournamentMatches,
  generateAgentTournamentBracket,
  updateAgentTournamentMatchResult,
  updateAgentTournamentStatus,
  isUserRegisteredForAgentTournament,
  getUserPendingAgentTournamentMatches,
  getAgentTournamentCheckInStatus,
  getGroupMemberValidationDetails,
  getActivityReminderDetailsForUsers,

  // Games (AI Game Creator + Gallery)
  createGame,
  getGameById,
  updateGame,
  deleteGame,
  publishGame,
  unpublishGame,
  getUserGames,
  getPublishedGames,
  incrementPlayCount,
  upsertGameVote,
  removeGameVote,
  getUserVoteForGame,
  getGameComments,
  createGameComment,
  deleteGameComment,
  upsertGameCommentVote,
  removeGameCommentVote,
  getUserVoteForGameComment,
  getGameCommentVoteScore,
  addGameVersion,
  getGameVersions,
  getLatestGameVersion,
  getLatestGameVerificationForVersion,
  getLatestGameVerificationForGame,
  createGameVerification,
  upsertGameRating,
  removeGameRating,
  getUserRatingForGame,
  getTopRatedGames,
  updateUserGitHubToken,
  getUserGitHubToken,

  // In-App Notifications
  createNotification,
  getUserNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,

  // Credits System
  getUserCredits,
  deductCredits,
  refundCredits,
  addCredits,
  addPurchasedCredits,
  revokePurchasedCredits,
  grantMonthlyCredits,
  getCreditTransactions,
  canUserGenerate,
  getRevisionCost,
  incrementRevisionCount,
  CREDITS_PER_GENERATION,
  CREDITS_PER_REVISION,
  FREE_REVISIONS_PER_GAME,

  // Referral system
  getUserReferralCode,
  getReferrerByCode,
  createReferral,
  completeReferral,
  getReferralStats,
  getRecentReferrals,
  REFERRAL_BONUS_CREDITS,

};

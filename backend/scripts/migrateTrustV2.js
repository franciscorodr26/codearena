#!/usr/bin/env node
/**
 * Trust Tier v2 Migration Script
 *
 * Recalculates trust scores for all existing users based on their history.
 * Run this ONCE after deploying the v2 schema changes.
 *
 * Usage: node scripts/migrateTrustV2.js [--dry-run]
 */

const db = require('../db');

const DRY_RUN = process.argv.includes('--dry-run');

// v2 tier thresholds
const TIERS = {
  trusted: { min: 85, max: 100 },
  standard: { min: 50, max: 84 },
  probation: { min: 25, max: 49 },
  restricted: { min: 0, max: 24 }
};

function getTierFromScore(score) {
  if (score >= 85) return 'trusted';
  if (score >= 50) return 'standard';
  if (score >= 25) return 'probation';
  return 'restricted';
}

async function migrateUser(user) {
  const userId = user.id;

  // Get user's account age
  const createdAt = new Date(user.created_at);
  const now = new Date();
  const accountAgeDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

  // Get battle history (last 90 days)
  const battles = await db.all(`
    SELECT b.winner_id, b.loser_id, b.is_forfeit
    FROM battles_history b
    WHERE (b.winner_id = ? OR b.loser_id = ?)
      AND b.created_at > datetime('now', '-90 days')
  `, [userId, userId]);

  // Get violation count (last 90 days)
  const violations = await db.get(`
    SELECT COUNT(*) as count FROM battle_violations
    WHERE user_id = ?
      AND created_at > datetime('now', '-90 days')
      AND severity IN ('serious', 'critical')
  `, [userId]);

  // Calculate new trust score
  let newScore = 50; // Base score

  // +5 if account is older than 30 days
  if (accountAgeDays > 30) {
    newScore += 5;
  }

  // +2 per 10 clean battles (battles without violations)
  const cleanBattles = battles.length - (violations?.count || 0);
  const cleanBattleSets = Math.floor(cleanBattles / 10);
  newScore += cleanBattleSets * 2;

  // -5 per violation
  const violationCount = violations?.count || 0;
  newScore -= violationCount * 5;

  // Clamp to valid range, max 85 (can't start as Trusted)
  newScore = Math.max(0, Math.min(85, newScore));

  const newTier = getTierFromScore(newScore);
  const oldScore = user.trust_score || 100;
  const oldTier = user.trust_tier || 'standard';

  return {
    userId,
    username: user.username,
    accountAgeDays,
    totalBattles: battles.length,
    cleanBattles,
    violationCount,
    oldScore,
    oldTier,
    newScore,
    newTier,
    changed: oldScore !== newScore || oldTier !== newTier
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║     Trust Tier v2 Migration Script         ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  } else {
    console.log('⚠️  LIVE MODE - Changes will be applied\n');
  }

  // Get all users with stats
  const users = await db.all(`
    SELECT u.id, u.username, u.created_at, us.trust_score, us.trust_tier
    FROM users u
    LEFT JOIN user_stats us ON u.id = us.user_id
    WHERE u.id > 0
    ORDER BY u.id
  `);

  console.log(`Found ${users.length} users to process\n`);

  const results = {
    total: users.length,
    unchanged: 0,
    upgraded: 0,
    downgraded: 0,
    errors: 0
  };

  const migrations = [];

  for (const user of users) {
    try {
      const migration = await migrateUser(user);
      migrations.push(migration);

      if (!migration.changed) {
        results.unchanged++;
      } else if (migration.newScore > migration.oldScore) {
        results.upgraded++;
      } else {
        results.downgraded++;
      }
    } catch (err) {
      console.error(`Error processing user ${user.id}:`, err.message);
      results.errors++;
    }
  }

  // Display migration summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('MIGRATION PREVIEW');
  console.log('═══════════════════════════════════════════════════════════════');

  // Show tier distribution changes
  const oldDistribution = { trusted: 0, standard: 0, probation: 0, restricted: 0 };
  const newDistribution = { trusted: 0, standard: 0, probation: 0, restricted: 0 };

  for (const m of migrations) {
    oldDistribution[m.oldTier]++;
    newDistribution[m.newTier]++;
  }

  console.log('\nTier Distribution Changes:');
  console.log('┌─────────────┬──────────┬──────────┬──────────┐');
  console.log('│ Tier        │ Before   │ After    │ Change   │');
  console.log('├─────────────┼──────────┼──────────┼──────────┤');
  for (const tier of ['trusted', 'standard', 'probation', 'restricted']) {
    const before = oldDistribution[tier];
    const after = newDistribution[tier];
    const change = after - before;
    const changeStr = change > 0 ? `+${change}` : change.toString();
    console.log(`│ ${tier.padEnd(11)} │ ${before.toString().padStart(8)} │ ${after.toString().padStart(8)} │ ${changeStr.padStart(8)} │`);
  }
  console.log('└─────────────┴──────────┴──────────┴──────────┘');

  console.log(`\nSummary:`);
  console.log(`  Total users: ${results.total}`);
  console.log(`  Unchanged:   ${results.unchanged}`);
  console.log(`  Upgraded:    ${results.upgraded}`);
  console.log(`  Downgraded:  ${results.downgraded}`);
  console.log(`  Errors:      ${results.errors}`);

  // Show sample changes
  const changedUsers = migrations.filter(m => m.changed).slice(0, 10);
  if (changedUsers.length > 0) {
    console.log('\nSample Changes (first 10):');
    console.log('┌────────────────────┬───────────┬───────────┬────────────┬────────────┐');
    console.log('│ Username           │ Old Score │ New Score │ Old Tier   │ New Tier   │');
    console.log('├────────────────────┼───────────┼───────────┼────────────┼────────────┤');
    for (const m of changedUsers) {
      const username = (m.username || 'User#' + m.userId).substring(0, 18).padEnd(18);
      console.log(`│ ${username} │ ${m.oldScore.toString().padStart(9)} │ ${m.newScore.toString().padStart(9)} │ ${m.oldTier.padEnd(10)} │ ${m.newTier.padEnd(10)} │`);
    }
    console.log('└────────────────────┴───────────┴───────────┴────────────┴────────────┘');
  }

  // Apply changes if not dry run
  if (!DRY_RUN && migrations.length > 0) {
    console.log('\n🚀 Applying changes...\n');

    for (const m of migrations) {
      if (m.changed) {
        try {
          await db.run(`
            UPDATE user_stats
            SET trust_score = ?,
                trust_tier = ?,
                tier_updated_at = datetime('now'),
                milestone_streaks_claimed = '[]',
                daily_trust_gained = 0,
                last_trust_gain_date = NULL
            WHERE user_id = ?
          `, [m.newScore, m.newTier, m.userId]);

          // Log the migration
          await db.run(`
            INSERT INTO trust_score_log (user_id, previous_score, new_score, change_amount, reason, created_at)
            VALUES (?, ?, ?, ?, 'Trust v2 migration', datetime('now'))
          `, [m.userId, m.oldScore, m.newScore, m.newScore - m.oldScore]);

          if (m.oldTier !== m.newTier) {
            await db.run(`
              INSERT INTO trust_tier_history (user_id, previous_tier, new_tier, trust_score_at_change, reason, triggered_by, created_at)
              VALUES (?, ?, ?, ?, 'Trust v2 migration', 'migration_script', datetime('now'))
            `, [m.userId, m.oldTier, m.newTier, m.newScore]);
          }

          console.log(`  ✓ ${m.username || 'User#' + m.userId}: ${m.oldScore} → ${m.newScore} (${m.oldTier} → ${m.newTier})`);
        } catch (err) {
          console.error(`  ✗ ${m.username || 'User#' + m.userId}: ${err.message}`);
        }
      }
    }

    console.log('\n✅ Migration complete!');
  } else if (DRY_RUN) {
    console.log('\n📋 Dry run complete. Run without --dry-run to apply changes.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

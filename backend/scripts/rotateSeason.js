#!/usr/bin/env node

/**
 * Season Rotation Script
 *
 * Manually rotate agent battle seasons:
 * - Ends current season and snapshots rankings
 * - Resets all loadout ELOs
 * - Starts a new season
 *
 * Usage:
 *   node scripts/rotateSeason.js "Season 2: Ascension" --duration 30 --soft-reset
 *
 * Options:
 *   --duration <days>  Duration of new season in days (default: 30)
 *   --soft-reset      Use soft ELO reset (recommended)
 *   --hard-reset      Use hard ELO reset (everyone back to 1000)
 */

const seasonService = require('../services/seasonService');
const logger = require('../utils/logger');
const db = require('../db');

async function rotateSeason() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const seasonName = args[0];

    let durationDays = 30;
    let softReset = true;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--duration' && args[i + 1]) {
        durationDays = parseInt(args[i + 1]);
        i++;
      } else if (args[i] === '--soft-reset') {
        softReset = true;
      } else if (args[i] === '--hard-reset') {
        softReset = false;
      }
    }

    if (!seasonName) {
      console.error('Error: Please provide a season name');
      console.log('Usage: node scripts/rotateSeason.js "Season 2: Ascension" --duration 30 --soft-reset');
      process.exit(1);
    }

    console.log('\n=== Agent Battle Season Rotation ===\n');
    console.log(`New Season Name: ${seasonName}`);
    console.log(`Duration: ${durationDays} days`);
    console.log(`ELO Reset Type: ${softReset ? 'Soft Reset' : 'Hard Reset'}\n`);

    // Confirm
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const confirmed = await new Promise((resolve) => {
      readline.question('This will end the current season. Continue? (yes/no): ', (answer) => {
        readline.close();
        resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
      });
    });

    if (!confirmed) {
      console.log('Season rotation cancelled.');
      process.exit(0);
    }

    console.log('\nStarting season rotation...\n');

    // Initialize database
    await db.init();

    // Rotate season
    const result = await seasonService.rotateSeason(seasonName, durationDays, softReset);

    if (result.success) {
      console.log('Season rotation completed successfully!\n');
      console.log(`Old Season ID: ${result.oldSeasonId}`);
      console.log(`New Season ID: ${result.newSeasonId}`);
      console.log(`New Season Number: ${result.newSeasonNumber}`);
      console.log(`Participants in ended season: ${result.participants}\n`);
      console.log('All loadout rankings have been snapshotted.');
      console.log(`ELO reset applied: ${softReset ? 'Soft (halfway to 1000)' : 'Hard (back to 1000)'}\n`);
      console.log('Players can now claim their season rewards!');
    } else {
      console.error('Season rotation failed:', result.error);
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    console.error('Fatal error during season rotation:', err);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  rotateSeason();
}

module.exports = rotateSeason;

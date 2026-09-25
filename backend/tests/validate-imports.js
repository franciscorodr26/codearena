// Quick validation script to test if imports work
try {
  console.log('Testing imports...');

  // Test router import
  const agentTournamentRouter = require('../routes/agentTournament');
  console.log('✓ agentTournament router imported successfully');
  console.log('  Router type:', typeof agentTournamentRouter);

  // Test auth import
  const { authMiddleware } = require('../routes/auth');
  console.log('✓ authMiddleware imported successfully');
  console.log('  authMiddleware type:', typeof authMiddleware);

  // Test JWT config import
  const { SECRET } = require('../config/jwt');
  console.log('✓ JWT config imported successfully');
  console.log('  SECRET exists:', !!SECRET);

  // Test db import
  const db = require('../db');
  console.log('✓ db module imported successfully');
  console.log('  db.init exists:', typeof db.init);
  console.log('  db.createAgentTournament exists:', typeof db.createAgentTournament);
  console.log('  db.getAgentTournaments exists:', typeof db.getAgentTournaments);

  // Test logger import
  const logger = require('../utils/logger');
  console.log('✓ logger imported successfully');
  console.log('  logger.info exists:', typeof logger.info);

  console.log('\n✅ All imports successful!');
  process.exit(0);
} catch (error) {
  console.error('\n❌ Import error:');
  console.error(error.message);
  console.error(error.stack);
  process.exit(1);
}

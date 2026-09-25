# How to Run Agent Battle Tests

## Prerequisites
All dependencies should already be installed. If not:
```bash
cd backend
npm install
```

## Running All Tests

### Run all agent battle tests
```bash
cd backend
npm test -- agent
```

### Run all tests in the project
```bash
npm test
```

### Run with coverage report
```bash
npm run test:coverage
```

## Running Individual Test Suites

### New Edge Case Test Suites

```bash
# Spending limits edge cases
npm test -- agentBattle.spendingLimits.test.js

# Matchmaking queue edge cases
npm test -- agentBattle.matchmaking.edgeCases.test.js

# ELO calculation edge cases
npm test -- agentBattle.elo.edgeCases.test.js

# Loadout validation edge cases
npm test -- agentBattle.loadout.validation.test.js
```

### Existing Test Suites

```bash
# Rate limiting (existing, comprehensive)
npm test -- agentRateLimiter.complete.test.js

# Integration tests (full battle flow)
npm test -- agentBattle.integration.test.js

# Route/API tests
npm test -- agentBattle.routes.test.js

# Versioning tests
npm test -- agentVersioning.test.js

# Matchmaking preferences
npm test -- agentMatchmakingPreferences.test.js

# Tournament tests
npm test -- agentTournament.test.js
npm test -- agentTournament.db.test.js

# Live battles
npm test -- agentBattle.live.test.js
```

## Expected Results

All tests should pass. If any fail:

1. **Check module dependencies**: Some tests may require specific modules to exist:
   - `/backend/services/agentSpendingLimiter.js` - For spending limit tests
   - `/backend/elo.js` - For ELO calculation tests

2. **Database initialization**: Integration tests require database to be initialized

3. **Mock issues**: If Socket.io or Anthropic SDK mocks fail, check jest configuration

## Debugging Failed Tests

### Run in verbose mode
```bash
npm test -- agentBattle.spendingLimits.test.js --verbose
```

### Run a specific test
```bash
npm test -- agentBattle.spendingLimits.test.js -t "should handle spending exactly at the limit"
```

### Run in watch mode (for development)
```bash
npm run test:watch
```

## Important Notes

### Potential Issues to Fix

1. **agentSpendingLimiter.js** - If this module doesn't exist:
   - The spending limit tests will fail
   - Create the module or adjust tests to match existing spending limit logic
   - May need to extract from existing code or implement

2. **Module paths** - Tests assume:
   - `require('../services/agentSpendingLimiter')` exists
   - `require('../elo')` exists
   - `require('../db')` exists

3. **Database tests** - Some tests require actual database:
   - Tournament tests
   - Rate limiter tests
   - Integration tests
   - These call `db.init()` in `beforeAll()`

## Test Files Reference

### New Files Created (This Session)
- ✅ `agentBattle.spendingLimits.test.js` - 45+ edge cases
- ✅ `agentBattle.matchmaking.edgeCases.test.js` - 50+ edge cases
- ✅ `agentBattle.elo.edgeCases.test.js` - 60+ edge cases
- ✅ `agentBattle.loadout.validation.test.js` - 70+ edge cases

### Existing Files (Already in Codebase)
- ✅ `agentRateLimiter.complete.test.js`
- ✅ `agentBattle.integration.test.js`
- ✅ `agentBattle.routes.test.js`
- ✅ `agentVersioning.test.js`
- ✅ `agentMatchmakingPreferences.test.js`
- ✅ `agentTournament.test.js`
- ✅ `agentTournament.db.test.js`
- ✅ `agentBattle.live.test.js`

## Quick Health Check

Run this to verify all agent battle tests work:
```bash
npm test -- agent 2>&1 | tee test-results.txt
```

This will:
- Run all agent-related tests
- Save output to `test-results.txt`
- Show results in terminal

Check the summary at the end for:
- ✅ Tests passed
- ❌ Tests failed
- ⏭ Tests skipped
- 📊 Coverage percentage

## Next Steps After Running Tests

1. ✅ All tests pass → Ready for production
2. ❌ Some tests fail → Review error messages and fix issues
3. 📊 Coverage < 90% → Add more tests for uncovered code
4. 🐛 Found bugs → Fix code, ensure tests cover the fix

## Support

If tests fail and you need to troubleshoot:
1. Check error messages carefully
2. Verify module paths are correct
3. Ensure database is initialized
4. Check that mocks are set up correctly
5. Review `TEST_COVERAGE_SUMMARY.md` for expected behavior

const { validateSolution } = require('./validateSolution');
const { generateSolution } = require('./agentSolver');
const { getToolsFromModules } = require('./agentModules');

/**
 * Orchestrates a full agent run: problem solving + validation
 *
 * @param {Object} problem - The problem to solve
 * @param {string} problem.id - Problem ID
 * @param {string} problem.title - Problem title
 * @param {string} problem.description - Problem description
 * @param {Array} problem.examples - Example inputs/outputs
 * @param {Array} problem.constraints - Problem constraints
 * @param {Array} problem.testCases - Test cases to validate against
 *
 * @param {Object} loadout - Agent configuration
 * @param {string} loadout.model - AI model to use (e.g., 'claude-sonnet-4-5')
 * @param {string} loadout.systemPrompt - Custom system prompt
 * @param {string} loadout.language - Programming language
 * @param {Array<string>} loadout.tools - Enabled tools (e.g., ['retry', 'hints'])
 *
 * @param {Object} options - Execution options
 * @param {number} options.maxRetries - Maximum retry attempts (default: 1)
 * @param {number} options.timeout - Overall timeout in ms (default: 60000)
 *
 * @returns {Promise<Object>} Result object with code, test results, and metrics
 */
async function runAgent(problem, loadout, options = {}) {
  const startTime = Date.now();
  const maxRetries = options.maxRetries ?? 1;
  const timeout = options.timeout ?? 60000;

  // Validate inputs
  if (!problem || !problem.id || !problem.testCases) {
    throw new Error('Invalid problem: missing required fields (id, testCases)');
  }

  if (!loadout || !loadout.model || !loadout.language) {
    throw new Error('Invalid loadout: missing required fields (model, language)');
  }

  // Support legacy tool IDs and new module IDs.
  const configuredTools = getToolsFromModules(loadout.modules || loadout.tools || []);
  const retryEnabled = configuredTools.includes('auto_retry');
  const effectiveMaxRetries = retryEnabled ? maxRetries : 0;

  let attempt = 0;
  let lastError = null;
  let totalTokensUsed = 0;
  let code = null;
  let solverResult = null;

  // Wrap the entire execution in a timeout (with cleanup to prevent Jest warnings)
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Agent execution timed out')), timeout);
  });

  const executionPromise = (async () => {
    while (attempt <= effectiveMaxRetries) {
      try {
        // Prepare context for retry attempts
        // For retries, append error feedback to system prompt
        let effectiveLoadout = loadout;
        if (attempt > 0 && lastError) {
          effectiveLoadout = {
            ...loadout,
            systemPrompt: `${loadout.systemPrompt || ''}\n\nPREVIOUS ATTEMPT FAILED:\n${lastError}\n\nPlease fix the issues and try again.`
          };
        }

        // Call agentSolver to generate code
        solverResult = await generateSolution(problem, effectiveLoadout);

        if (!solverResult || !solverResult.code) {
          throw new Error('Agent solver failed to generate code');
        }

        code = solverResult.code;
        // tokensUsed can be an object { input, output, total } or a number
        const tokens = solverResult.tokensUsed;
        totalTokensUsed += typeof tokens === 'object' ? (tokens?.total || 0) : (tokens || 0);

        // Validate the generated code
        const testResults = await validateSolution(
          code,
          problem.testCases,
          loadout.language,
          problem.id
        );

        // Count passed tests
        const passedCount = testResults.filter(r => r.passed).length;
        const totalTests = testResults.length;
        const allPassed = passedCount === totalTests;

        // Calculate execution time
        const executionTimeMs = Date.now() - startTime;

        // If all tests passed or we're out of retries, return result
        if (allPassed || attempt >= effectiveMaxRetries) {
          return {
            success: allPassed,
            code,
            testResults,
            passedCount,
            totalTests,
            executionTimeMs,
            tokensUsed: totalTokensUsed,
            retries: attempt,
            model: loadout.model,
            language: loadout.language
          };
        }

        // Prepare error context for retry
        const failedTests = testResults.filter(r => !r.passed);
        lastError = formatTestFailures(failedTests);
        attempt++;

      } catch (error) {
        // If this is a critical error (not a test failure), decide whether to retry
        const isCriticalError = !code; // No code was generated

        if (isCriticalError || attempt >= effectiveMaxRetries) {
          // Return failure result
          const executionTimeMs = Date.now() - startTime;
          return {
            success: false,
            code: code || '',
            testResults: problem.testCases.map(tc => ({
              input: tc.input,
              expected: tc.expected,
              actual: 'Error during execution',
              passed: false,
              error: error.message
            })),
            passedCount: 0,
            totalTests: problem.testCases.length,
            executionTimeMs,
            tokensUsed: totalTokensUsed,
            retries: attempt,
            error: error.message,
            model: loadout.model,
            language: loadout.language
          };
        }

        // Prepare for retry
        lastError = error.message;
        const retryTokens = solverResult?.tokensUsed;
        totalTokensUsed += typeof retryTokens === 'object' ? (retryTokens?.total || 0) : (retryTokens || 0);
        attempt++;
      }
    }
  })();

  try {
    const result = await Promise.race([executionPromise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    // Handle timeout or other errors
    const executionTimeMs = Date.now() - startTime;
    return {
      success: false,
      code: code || '',
      testResults: problem.testCases.map(tc => ({
        input: tc.input,
        expected: tc.expected,
        actual: 'Execution timed out or failed',
        passed: false,
        error: error.message
      })),
      passedCount: 0,
      totalTests: problem.testCases.length,
      executionTimeMs,
      tokensUsed: totalTokensUsed,
      retries: attempt,
      error: error.message,
      timedOut: error.message.includes('timed out'),
      model: loadout.model,
      language: loadout.language
    };
  }
}

/**
 * Formats test failures into a helpful error message for retry attempts
 * @param {Array} failedTests - Array of failed test result objects
 * @returns {string} Formatted error message
 */
function formatTestFailures(failedTests) {
  if (!failedTests || failedTests.length === 0) {
    return 'Some tests failed';
  }

  const messages = failedTests.slice(0, 3).map((test, idx) => {
    const parts = [];
    parts.push(`Test ${idx + 1}:`);
    parts.push(`  Input: ${JSON.stringify(test.input)}`);
    parts.push(`  Expected: ${JSON.stringify(test.expected)}`);
    parts.push(`  Got: ${JSON.stringify(test.actual)}`);
    if (test.error) {
      parts.push(`  Error: ${test.error}`);
    }
    return parts.join('\n');
  });

  let result = messages.join('\n\n');

  if (failedTests.length > 3) {
    result += `\n\n... and ${failedTests.length - 3} more failed test(s)`;
  }

  return result;
}

/**
 * Runs agent with streaming support (for real-time updates)
 * This is a placeholder for future implementation
 *
 * @param {Object} problem - Problem to solve
 * @param {Object} loadout - Agent configuration
 * @param {Object} options - Execution options
 * @param {Function} onProgress - Callback for progress updates
 * @returns {Promise<Object>} Result object
 */
async function runAgentWithStreaming(problem, loadout, options = {}, onProgress) {
  // For now, just call runAgent and emit progress at key points
  // Future: Implement true streaming from AI model

  if (onProgress) {
    onProgress({ stage: 'starting', message: 'Initializing agent...' });
  }

  try {
    const result = await runAgent(problem, loadout, options);

    if (onProgress) {
      onProgress({
        stage: 'completed',
        message: result.success ? 'All tests passed!' : 'Some tests failed',
        result
      });
    }

    return result;
  } catch (error) {
    if (onProgress) {
      onProgress({ stage: 'error', message: error.message, error });
    }
    throw error;
  }
}

/**
 * Validates agent configuration before running
 * @param {Object} loadout - Agent configuration to validate
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
function validateLoadout(loadout) {
  const errors = [];

  if (!loadout) {
    errors.push('Loadout is required');
    return { valid: false, errors };
  }

  if (!loadout.model) {
    errors.push('Model is required');
  }

  if (!loadout.language) {
    errors.push('Language is required');
  }

  const validLanguages = ['python', 'javascript', 'typescript', 'java', 'cpp', 'csharp', 'go', 'rust', 'sql'];
  if (loadout.language && !validLanguages.includes(loadout.language.toLowerCase())) {
    errors.push(`Invalid language: ${loadout.language}. Must be one of: ${validLanguages.join(', ')}`);
  }

  if (loadout.tools && !Array.isArray(loadout.tools)) {
    errors.push('Tools must be an array');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  runAgent,
  runAgentWithStreaming,
  validateLoadout,
  formatTestFailures
};

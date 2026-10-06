const agentRunner = require('../services/agentRunner');

// Mock dependencies
jest.mock('../services/agentSolver', () => ({
  generateSolution: jest.fn()
}));

jest.mock('../services/validateSolution', () => ({
  validateSolution: jest.fn()
}));

const { generateSolution } = require('../services/agentSolver');
const { validateSolution } = require('../services/validateSolution');

describe('AgentRunner - runAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Input Validation', () => {
    it('should reject invalid problem (missing id)', async () => {
      const problem = {
        title: 'Test',
        description: 'Test',
        testCases: []
      };

      const loadout = {
        model: 'haiku',
        language: 'python'
      };

      await expect(agentRunner.runAgent(problem, loadout)).rejects.toThrow(
        'Invalid problem: missing required fields (id, testCases)'
      );
    });

    it('should reject invalid problem (missing testCases)', async () => {
      const problem = {
        id: 'test-1',
        title: 'Test',
        description: 'Test'
      };

      const loadout = {
        model: 'haiku',
        language: 'python'
      };

      await expect(agentRunner.runAgent(problem, loadout)).rejects.toThrow(
        'Invalid problem: missing required fields (id, testCases)'
      );
    });

    it('should reject invalid loadout (missing model)', async () => {
      const problem = {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        testCases: [{ input: 1, expected: 2 }]
      };

      const loadout = {
        language: 'python'
      };

      await expect(agentRunner.runAgent(problem, loadout)).rejects.toThrow(
        'Invalid loadout: missing required fields (model, language)'
      );
    });

    it('should reject invalid loadout (missing language)', async () => {
      const problem = {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        testCases: [{ input: 1, expected: 2 }]
      };

      const loadout = {
        model: 'haiku'
      };

      await expect(agentRunner.runAgent(problem, loadout)).rejects.toThrow(
        'Invalid loadout: missing required fields (model, language)'
      );
    });
  });

  describe('Successful Execution', () => {
    it('should successfully run agent and pass all tests', async () => {
      generateSolution.mockResolvedValue({
        code: 'def solve(n):\n    return n * 2',
        tokensUsed: { input: 100, output: 50, total: 150 },
        success: true
      });

      validateSolution.mockResolvedValue([
        { input: 1, expected: 2, actual: 2, passed: true },
        { input: 5, expected: 10, actual: 10, passed: true }
      ]);

      const problem = {
        id: 'test-1',
        title: 'Double Number',
        description: 'Return double',
        testCases: [
          { input: 1, expected: 2 },
          { input: 5, expected: 10 }
        ]
      };

      const loadout = {
        model: 'haiku',
        language: 'python',
        systemPrompt: 'Be efficient'
      };

      const result = await agentRunner.runAgent(problem, loadout);

      expect(result.success).toBe(true);
      expect(result.code).toContain('def solve');
      expect(result.passedCount).toBe(2);
      expect(result.totalTests).toBe(2);
      expect(result.tokensUsed).toBe(150);
      expect(result.retries).toBe(0);
      expect(result.model).toBe('haiku');
      expect(result.language).toBe('python');
      // Execution time may be 0 in fast tests, just verify it's defined and a number
      expect(typeof result.executionTimeMs).toBe('number');
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle partial test passage', async () => {
      generateSolution.mockResolvedValue({
        code: 'def solve(n):\n    return n + 1',
        tokensUsed: { input: 100, output: 50, total: 150 },
        success: true
      });

      validateSolution.mockResolvedValue([
        { input: 1, expected: 2, actual: 2, passed: true },
        { input: 5, expected: 10, actual: 6, passed: false }
      ]);

      const problem = {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        testCases: [
          { input: 1, expected: 2 },
          { input: 5, expected: 10 }
        ]
      };

      const loadout = {
        model: 'haiku',
        language: 'python'
      };

      const result = await agentRunner.runAgent(problem, loadout);

      expect(result.success).toBe(false);
      expect(result.passedCount).toBe(1);
      expect(result.totalTests).toBe(2);
    });
  });

  describe('Retry Mechanism', () => {
    it('should not retry when retry tool is not enabled', async () => {
      generateSolution.mockResolvedValue({
        code: 'def solve(n):\n    return n + 1',
        tokensUsed: { input: 100, output: 50, total: 150 },
        success: true
      });

      validateSolution.mockResolvedValue([
        { input: 1, expected: 2, actual: 2, passed: true },
        { input: 5, expected: 10, actual: 6, passed: false }
      ]);

      const problem = {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        testCases: [
          { input: 1, expected: 2 },
          { input: 5, expected: 10 }
        ]
      };

      const loadout = {
        model: 'haiku',
        language: 'python',
        tools: [] // No retry tool
      };

      const result = await agentRunner.runAgent(problem, loadout);

      expect(result.retries).toBe(0);
      expect(generateSolution).toHaveBeenCalledTimes(1);
    });

    it('should retry when retry tool is enabled and tests fail', async () => {
      // First attempt fails
      generateSolution
        .mockResolvedValueOnce({
          code: 'def solve(n):\n    return n + 1',
          tokensUsed: { input: 100, output: 50, total: 150 },
          success: true
        })
        // Second attempt succeeds
        .mockResolvedValueOnce({
          code: 'def solve(n):\n    return n * 2',
          tokensUsed: { input: 120, output: 60, total: 180 },
          success: true
        });

      validateSolution
        .mockResolvedValueOnce([
          { input: 1, expected: 2, actual: 2, passed: true },
          { input: 5, expected: 10, actual: 6, passed: false }
        ])
        .mockResolvedValueOnce([
          { input: 1, expected: 2, actual: 2, passed: true },
          { input: 5, expected: 10, actual: 10, passed: true }
        ]);

      const problem = {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        testCases: [
          { input: 1, expected: 2 },
          { input: 5, expected: 10 }
        ]
      };

      const loadout = {
        model: 'haiku',
        language: 'python',
        tools: ['retry']
      };

      const options = {
        maxRetries: 1
      };

      const result = await agentRunner.runAgent(problem, loadout, options);

      expect(result.success).toBe(true);
      expect(result.retries).toBe(1);
      expect(generateSolution).toHaveBeenCalledTimes(2);
      expect(result.tokensUsed).toBe(330); // 150 + 180
    });

    it('should include error feedback in retry attempts', async () => {
      generateSolution
        .mockResolvedValueOnce({
          code: 'def solve(n):\n    return n + 1',
          tokensUsed: { input: 100, output: 50, total: 150 },
          success: true
        })
        .mockResolvedValueOnce({
          code: 'def solve(n):\n    return n * 2',
          tokensUsed: { input: 120, output: 60, total: 180 },
          success: true
        });

      validateSolution
        .mockResolvedValueOnce([
          { input: 5, expected: 10, actual: 6, passed: false, error: 'Wrong output' }
        ])
        .mockResolvedValueOnce([
          { input: 5, expected: 10, actual: 10, passed: true }
        ]);

      const problem = {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        testCases: [{ input: 5, expected: 10 }]
      };

      const loadout = {
        model: 'haiku',
        language: 'python',
        tools: ['retry']
      };

      const options = { maxRetries: 1 };

      await agentRunner.runAgent(problem, loadout, options);

      // Check that second call includes error feedback
      const secondCallArgs = generateSolution.mock.calls[1];
      expect(secondCallArgs[1].systemPrompt).toContain('PREVIOUS ATTEMPT FAILED');
    });

    it('should stop retrying after maxRetries', async () => {
      generateSolution.mockResolvedValue({
        code: 'def solve(n):\n    return 0',
        tokensUsed: { input: 100, output: 50, total: 150 },
        success: true
      });

      validateSolution.mockResolvedValue([
        { input: 5, expected: 10, actual: 0, passed: false }
      ]);

      const problem = {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        testCases: [{ input: 5, expected: 10 }]
      };

      const loadout = {
        model: 'haiku',
        language: 'python',
        tools: ['retry']
      };

      const options = { maxRetries: 2 };

      const result = await agentRunner.runAgent(problem, loadout, options);

      expect(result.success).toBe(false);
      expect(result.retries).toBe(2);
      expect(generateSolution).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  describe('Error Handling', () => {
    it('should handle solver failure gracefully', async () => {
      generateSolution.mockResolvedValue({
        code: null,
        success: false,
        error: 'API timeout'
      });

      const problem = {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        testCases: [{ input: 5, expected: 10 }]
      };

      const loadout = {
        model: 'haiku',
        language: 'python'
      };

      const result = await agentRunner.runAgent(problem, loadout);

      expect(result.success).toBe(false);
      expect(result.code).toBe('');
      // The runner wraps the original error with its own message
      expect(result.error).toContain('Agent solver failed to generate code');
      expect(result.passedCount).toBe(0);
      expect(result.testResults).toHaveLength(1);
      expect(result.testResults[0].passed).toBe(false);
    });

    it('should handle validation errors', async () => {
      generateSolution.mockResolvedValue({
        code: 'def solve(n):\n    return n * 2',
        tokensUsed: { input: 100, output: 50, total: 150 },
        success: true
      });

      validateSolution.mockRejectedValue(new Error('Validation service unavailable'));

      const problem = {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        testCases: [{ input: 5, expected: 10 }]
      };

      const loadout = {
        model: 'haiku',
        language: 'python'
      };

      const result = await agentRunner.runAgent(problem, loadout);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Validation service unavailable');
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout after specified duration', async () => {
      generateSolution.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              code: 'def solve(n):\n    return n',
              tokensUsed: { input: 100, output: 50, total: 150 },
              success: true
            });
          }, 2000); // Takes 2 seconds
        });
      });

      const problem = {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        testCases: [{ input: 5, expected: 10 }]
      };

      const loadout = {
        model: 'haiku',
        language: 'python'
      };

      const options = {
        timeout: 500 // 500ms timeout
      };

      const result = await agentRunner.runAgent(problem, loadout, options);

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      expect(result.timedOut).toBe(true);
    }, 10000);

    it('should complete successfully within timeout', async () => {
      generateSolution.mockResolvedValue({
        code: 'def solve(n):\n    return n * 2',
        tokensUsed: { input: 100, output: 50, total: 150 },
        success: true
      });

      validateSolution.mockResolvedValue([
        { input: 5, expected: 10, actual: 10, passed: true }
      ]);

      const problem = {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        testCases: [{ input: 5, expected: 10 }]
      };

      const loadout = {
        model: 'haiku',
        language: 'python'
      };

      const options = {
        timeout: 10000 // 10 second timeout
      };

      const result = await agentRunner.runAgent(problem, loadout, options);

      expect(result.success).toBe(true);
      expect(result.timedOut).toBeUndefined();
    });
  });

  describe('Default Options', () => {
    it('should use default maxRetries of 1', async () => {
      generateSolution.mockResolvedValue({
        code: 'def solve(n):\n    return n',
        tokensUsed: { input: 100, output: 50, total: 150 },
        success: true
      });

      validateSolution.mockResolvedValue([
        { input: 5, expected: 10, actual: 5, passed: false }
      ]);

      const problem = {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        testCases: [{ input: 5, expected: 10 }]
      };

      const loadout = {
        model: 'haiku',
        language: 'python',
        tools: ['retry']
      };

      const result = await agentRunner.runAgent(problem, loadout);

      // Should retry once by default
      expect(generateSolution).toHaveBeenCalledTimes(2);
    });

    it('should use default timeout of 60000ms', async () => {
      // This is implicitly tested by other tests
      // Just verify the function accepts no options
      generateSolution.mockResolvedValue({
        code: 'def solve(n):\n    return n',
        tokensUsed: { input: 100, output: 50, total: 150 },
        success: true
      });

      validateSolution.mockResolvedValue([
        { input: 5, expected: 10, actual: 10, passed: true }
      ]);

      const problem = {
        id: 'test-1',
        title: 'Test',
        description: 'Test',
        testCases: [{ input: 5, expected: 10 }]
      };

      const loadout = {
        model: 'haiku',
        language: 'python'
      };

      const result = await agentRunner.runAgent(problem, loadout);
      expect(result.success).toBe(true);
    });
  });
});

describe('AgentRunner - validateLoadout', () => {
  it('should validate correct loadout', () => {
    const loadout = {
      model: 'haiku',
      language: 'python',
      tools: ['retry']
    };

    const result = agentRunner.validateLoadout(loadout);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject missing loadout', () => {
    const result = agentRunner.validateLoadout(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Loadout is required');
  });

  it('should reject missing model', () => {
    const loadout = {
      language: 'python'
    };

    const result = agentRunner.validateLoadout(loadout);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Model is required');
  });

  it('should reject missing language', () => {
    const loadout = {
      model: 'haiku'
    };

    const result = agentRunner.validateLoadout(loadout);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Language is required');
  });

  it('should reject invalid language', () => {
    const loadout = {
      model: 'haiku',
      language: 'brainfuck'
    };

    const result = agentRunner.validateLoadout(loadout);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid language'))).toBe(true);
  });

  it('should accept valid languages', () => {
    const validLanguages = [
      'python', 'javascript', 'typescript', 'java',
      'cpp', 'csharp', 'go', 'rust', 'sql'
    ];

    for (const lang of validLanguages) {
      const loadout = {
        model: 'haiku',
        language: lang
      };

      const result = agentRunner.validateLoadout(loadout);
      expect(result.valid).toBe(true);
    }
  });

  it('should reject non-array tools', () => {
    const loadout = {
      model: 'haiku',
      language: 'python',
      tools: 'retry'
    };

    const result = agentRunner.validateLoadout(loadout);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Tools must be an array');
  });

  it('should accept valid tools array', () => {
    const loadout = {
      model: 'haiku',
      language: 'python',
      tools: ['retry', 'hints']
    };

    const result = agentRunner.validateLoadout(loadout);
    expect(result.valid).toBe(true);
  });

  it('should handle case-insensitive language', () => {
    const loadout = {
      model: 'haiku',
      language: 'PYTHON'
    };

    const result = agentRunner.validateLoadout(loadout);
    expect(result.valid).toBe(true);
  });
});

describe('AgentRunner - formatTestFailures', () => {
  it('should format test failures correctly', () => {
    const failedTests = [
      { input: 1, expected: 2, actual: 3, error: 'Wrong value' },
      { input: 5, expected: 10, actual: 15 }
    ];

    const formatted = agentRunner.formatTestFailures(failedTests);

    expect(formatted).toContain('Test 1:');
    expect(formatted).toContain('Input: 1');
    expect(formatted).toContain('Expected: 2');
    expect(formatted).toContain('Got: 3');
    expect(formatted).toContain('Error: Wrong value');
    expect(formatted).toContain('Test 2:');
  });

  it('should limit to 3 failures and show count', () => {
    const failedTests = [
      { input: 1, expected: 2, actual: 3 },
      { input: 2, expected: 4, actual: 5 },
      { input: 3, expected: 6, actual: 7 },
      { input: 4, expected: 8, actual: 9 },
      { input: 5, expected: 10, actual: 11 }
    ];

    const formatted = agentRunner.formatTestFailures(failedTests);

    expect(formatted).toContain('Test 1:');
    expect(formatted).toContain('Test 2:');
    expect(formatted).toContain('Test 3:');
    expect(formatted).not.toContain('Test 4:');
    expect(formatted).toContain('and 2 more failed test(s)');
  });

  it('should handle empty array', () => {
    const formatted = agentRunner.formatTestFailures([]);
    expect(formatted).toBe('Some tests failed');
  });

  it('should handle null/undefined', () => {
    const formatted = agentRunner.formatTestFailures(null);
    expect(formatted).toBe('Some tests failed');
  });
});

describe('AgentRunner - runAgentWithStreaming', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call onProgress callback', async () => {
    generateSolution.mockResolvedValue({
      code: 'def solve(n):\n    return n * 2',
      tokensUsed: { input: 100, output: 50, total: 150 },
      success: true
    });

    validateSolution.mockResolvedValue([
      { input: 5, expected: 10, actual: 10, passed: true }
    ]);

    const problem = {
      id: 'test-1',
      title: 'Test',
      description: 'Test',
      testCases: [{ input: 5, expected: 10 }]
    };

    const loadout = {
      model: 'haiku',
      language: 'python'
    };

    const progressUpdates = [];
    const onProgress = (update) => {
      progressUpdates.push(update);
    };

    const result = await agentRunner.runAgentWithStreaming(
      problem,
      loadout,
      {},
      onProgress
    );

    expect(result.success).toBe(true);
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[0].stage).toBe('starting');
    expect(progressUpdates[progressUpdates.length - 1].stage).toBe('completed');
  });

  it('should work without onProgress callback', async () => {
    generateSolution.mockResolvedValue({
      code: 'def solve(n):\n    return n * 2',
      tokensUsed: { input: 100, output: 50, total: 150 },
      success: true
    });

    validateSolution.mockResolvedValue([
      { input: 5, expected: 10, actual: 10, passed: true }
    ]);

    const problem = {
      id: 'test-1',
      title: 'Test',
      description: 'Test',
      testCases: [{ input: 5, expected: 10 }]
    };

    const loadout = {
      model: 'haiku',
      language: 'python'
    };

    const result = await agentRunner.runAgentWithStreaming(problem, loadout);

    expect(result.success).toBe(true);
  });

  it('should handle failure and emit completed stage with error result', async () => {
    generateSolution.mockResolvedValue({
      code: null,
      success: false,
      error: 'API failure'
    });

    const problem = {
      id: 'test-1',
      title: 'Test',
      description: 'Test',
      testCases: [{ input: 5, expected: 10 }]
    };

    const loadout = {
      model: 'haiku',
      language: 'python'
    };

    const progressUpdates = [];
    const onProgress = (update) => {
      progressUpdates.push(update);
    };

    // runAgentWithStreaming returns a result, doesn't throw
    const result = await agentRunner.runAgentWithStreaming(problem, loadout, {}, onProgress);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Should emit starting and completed stages
    expect(progressUpdates.find(u => u.stage === 'starting')).toBeDefined();
    expect(progressUpdates.find(u => u.stage === 'completed')).toBeDefined();
  });
});

// Agent battles in the open edition: two agents solve an open problem, their
// code is graded by the real arena runner (local executor, no model spend),
// and the agent whose code passes every test wins. The model client is mocked.
const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })));

process.env.CODEARENA_RUNNER = 'local';
const validate = require('../services/validateSolution');
const { localExecutor } = require('../arena/runner');
const problemsLoader = require('../problemsLoader');
const { runAgent } = require('../services/agentRunner');

const reference = fs.readFileSync(path.join(__dirname, '..', 'arena', 'solutions', 'fair-pairs.py'), 'utf8');
const wrong = 'def max_fair_pairs(ratings, k):\n    return len(ratings) // 2\n';

describe('open-edition agent battle', () => {
  beforeAll(() => validate.setExecutor(localExecutor()));

  test('two agents race on an open problem and the correct one wins', async () => {
    mockCreate.mockImplementation(async ({ system }) => ({
      content: [{ type: 'text', text: '```python\n' + (system.includes('CAREFUL') ? reference : wrong) + '\n```' }],
      usage: { input_tokens: 100, output_tokens: 50 }
    }));
    const problem = problemsLoader.getAgentProblem('fair-pairs');
    const careful = { model: 'haiku', language: 'python', systemPrompt: 'CAREFUL: think about sorting first.' };
    const hasty = { model: 'haiku', language: 'python', systemPrompt: 'Answer fast.' };

    const [a, b] = await Promise.all([runAgent(problem, careful), runAgent(problem, hasty)]);
    const allPassed = r => r.testResults.length === problem.testCases.length && r.testResults.every(t => t.passed);

    expect(allPassed(a)).toBe(true);
    expect(allPassed(b)).toBe(false);
    const winner = allPassed(a) && !allPassed(b) ? 'careful' : 'hasty';
    expect(winner).toBe('careful');

    // The agent is told which function to write, from the server's starter code.
    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('def max_fair_pairs(ratings, k):');
    expect(prompt).toContain('Fair Pairs');
    // Hidden tests are graded but never put in the prompt, which keeps it small.
    const hiddenInput = problem.testCases[problem.testCases.length - 1].input;
    expect(prompt).not.toContain(hiddenInput.slice(0, 40));
    expect(prompt.length).toBeLessThan(6000);
  });
});

// Found by a real-model battle: replies with prose after the fence left the
// fence in the submitted code, so every test failed with a syntax error.
describe('agent reply code extraction', () => {
  const { extractCode } = require('../services/agentSolver');
  test.each([
    ['```python\ndef f(x):\n    return x\n```\n\nThe solution works as follows:\n1. Sort', 'python', 'def f(x):\n    return x'],
    ['Here you go:\n```javascript\nfunction f(x) { return x }\n```\nDone.', 'javascript', 'function f(x) { return x }'],
    ['```py\ndef g():\n    pass\n```', 'python', 'def g():\n    pass'],
    ['```\nfunction h() {}\n```', 'javascript', 'function h() {}'],
    ['def plain():\n    return 1', 'python', 'def plain():\n    return 1']
  ])('extracts clean code from %#', (reply, language, expected) => {
    expect(extractCode(reply, language)).toBe(expected);
  });
});

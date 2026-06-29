import { ErrorType, classifyError, withRetry } from './errorHandling';

describe('errorHandling retry classification', () => {
  test.each([
    new Error('Failed to fetch'),
    new Error('Load failed'),
    new Error('Network request failed'),
    new Error('Connection failed. Please check your internet connection and try again.'),
    new Error('Request timed out. Please check your connection and try again.')
  ])('classifies transient fetch error "%s" as network', (error) => {
    expect(classifyError(error)).toBe(ErrorType.NETWORK);
  });

  test('retries timeout-like errors', async () => {
    const operation = jest.fn()
      .mockRejectedValueOnce(new Error('Request timed out. Please check your connection and try again.'))
      .mockResolvedValueOnce('dashboard data');

    await expect(withRetry(operation, { maxRetries: 1, initialDelay: 1, maxDelay: 1 }))
      .resolves.toBe('dashboard data');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  test('retries attached server responses', async () => {
    const error = new Error('Failed to fetch dashboard data');
    error.response = { status: 503 };

    const operation = jest.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('dashboard data');

    await expect(withRetry(operation, { maxRetries: 1, initialDelay: 1, maxDelay: 1 }))
      .resolves.toBe('dashboard data');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  test('does not retry rate limit responses', async () => {
    const error = new Error('Too many requests');
    error.response = { status: 429 };
    const operation = jest.fn().mockRejectedValue(error);

    await expect(withRetry(operation, { maxRetries: 2, initialDelay: 1, maxDelay: 1 }))
      .rejects.toThrow('Too many requests');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

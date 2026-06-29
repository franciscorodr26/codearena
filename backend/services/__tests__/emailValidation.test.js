const { validateAndNormalize } = require('../emailValidation');

describe('validateAndNormalize', () => {
  test('accepts and normalizes a valid address', () => {
    expect(validateAndNormalize('  Alice@Example.COM ')).toEqual({
      valid: true, normalized: 'alice@example.com', suggestion: null
    });
  });

  test('rejects malformed addresses', () => {
    for (const bad of ['', 'nope', 'a@b', 'a@@b.com', 'a b@c.com', null, undefined]) {
      expect(validateAndNormalize(bad).valid).toBe(false);
    }
  });

  test('suggests a correction for common domain typos', () => {
    expect(validateAndNormalize('bob@gmial.com').suggestion).toBe('bob@gmail.com');
    expect(validateAndNormalize('bob@gmail.con').suggestion).toBe('bob@gmail.com');
    expect(validateAndNormalize('jo@hotmial.com').suggestion).toBe('jo@hotmail.com');
    expect(validateAndNormalize('jo@yahooo.com').suggestion).toBe('jo@yahoo.com');
  });

  test('does not "correct" legitimate uncommon domains', () => {
    const r = validateAndNormalize('dev@acme-engineering.io');
    expect(r.valid).toBe(true);
    expect(r.suggestion).toBeNull();
  });

  test('valid address that is already correct has no suggestion', () => {
    expect(validateAndNormalize('user@gmail.com').suggestion).toBeNull();
  });
});

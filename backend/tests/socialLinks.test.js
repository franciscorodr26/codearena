/**
 * Tests for social link URL validation
 */

// URL patterns (same as in routes/auth.js)
const githubPattern = /^https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_-]+\/?$/;
const linkedinPattern = /^https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?$/;
const twitterPattern = /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/?$/;

describe('Social Link URL Validation', () => {
  describe('GitHub URL validation', () => {
    describe('valid URLs', () => {
      test('basic github URL', () => {
        expect(githubPattern.test('https://github.com/username')).toBe(true);
      });

      test('with www', () => {
        expect(githubPattern.test('https://www.github.com/username')).toBe(true);
      });

      test('http protocol', () => {
        expect(githubPattern.test('http://github.com/username')).toBe(true);
      });

      test('with trailing slash', () => {
        expect(githubPattern.test('https://github.com/username/')).toBe(true);
      });

      test('username with numbers', () => {
        expect(githubPattern.test('https://github.com/user123')).toBe(true);
      });

      test('username with hyphens', () => {
        expect(githubPattern.test('https://github.com/user-name')).toBe(true);
      });

      test('username with underscores', () => {
        expect(githubPattern.test('https://github.com/user_name')).toBe(true);
      });

      test('single character username', () => {
        expect(githubPattern.test('https://github.com/a')).toBe(true);
      });

      test('mixed case username', () => {
        expect(githubPattern.test('https://github.com/UserName123')).toBe(true);
      });
    });

    describe('invalid URLs', () => {
      test('missing protocol', () => {
        expect(githubPattern.test('github.com/username')).toBe(false);
      });

      test('wrong domain', () => {
        expect(githubPattern.test('https://gitlab.com/username')).toBe(false);
      });

      test('repo path (not profile)', () => {
        expect(githubPattern.test('https://github.com/user/repo')).toBe(false);
      });

      test('empty username', () => {
        expect(githubPattern.test('https://github.com/')).toBe(false);
      });

      test('username with spaces', () => {
        expect(githubPattern.test('https://github.com/user name')).toBe(false);
      });

      test('username with special chars', () => {
        expect(githubPattern.test('https://github.com/user@name')).toBe(false);
      });
    });
  });

  describe('LinkedIn URL validation', () => {
    describe('valid URLs', () => {
      test('basic linkedin URL', () => {
        expect(linkedinPattern.test('https://linkedin.com/in/username')).toBe(true);
      });

      test('with www', () => {
        expect(linkedinPattern.test('https://www.linkedin.com/in/username')).toBe(true);
      });

      test('http protocol', () => {
        expect(linkedinPattern.test('http://linkedin.com/in/username')).toBe(true);
      });

      test('with trailing slash', () => {
        expect(linkedinPattern.test('https://linkedin.com/in/username/')).toBe(true);
      });

      test('username with numbers', () => {
        expect(linkedinPattern.test('https://linkedin.com/in/john-doe-123')).toBe(true);
      });

      test('username with hyphens', () => {
        expect(linkedinPattern.test('https://linkedin.com/in/john-doe')).toBe(true);
      });

      test('username with underscores', () => {
        expect(linkedinPattern.test('https://linkedin.com/in/john_doe')).toBe(true);
      });
    });

    describe('invalid URLs', () => {
      test('missing protocol', () => {
        expect(linkedinPattern.test('linkedin.com/in/username')).toBe(false);
      });

      test('wrong path (company)', () => {
        expect(linkedinPattern.test('https://linkedin.com/company/acme')).toBe(false);
      });

      test('missing /in/ path', () => {
        expect(linkedinPattern.test('https://linkedin.com/username')).toBe(false);
      });

      test('empty username', () => {
        expect(linkedinPattern.test('https://linkedin.com/in/')).toBe(false);
      });

      test('with query params', () => {
        // Current regex doesn't allow query params - this is expected behavior
        expect(linkedinPattern.test('https://linkedin.com/in/user?locale=en')).toBe(false);
      });
    });
  });

  describe('Twitter/X URL validation', () => {
    describe('valid URLs', () => {
      test('twitter.com URL', () => {
        expect(twitterPattern.test('https://twitter.com/username')).toBe(true);
      });

      test('x.com URL', () => {
        expect(twitterPattern.test('https://x.com/username')).toBe(true);
      });

      test('with www on twitter', () => {
        expect(twitterPattern.test('https://www.twitter.com/username')).toBe(true);
      });

      test('with www on x.com', () => {
        expect(twitterPattern.test('https://www.x.com/username')).toBe(true);
      });

      test('with trailing slash', () => {
        expect(twitterPattern.test('https://twitter.com/username/')).toBe(true);
      });

      test('username with numbers', () => {
        expect(twitterPattern.test('https://twitter.com/user123')).toBe(true);
      });

      test('username with underscores', () => {
        expect(twitterPattern.test('https://twitter.com/user_name')).toBe(true);
      });

      test('http protocol', () => {
        expect(twitterPattern.test('http://x.com/username')).toBe(true);
      });
    });

    describe('invalid URLs', () => {
      test('missing protocol', () => {
        expect(twitterPattern.test('twitter.com/username')).toBe(false);
      });

      test('wrong domain', () => {
        expect(twitterPattern.test('https://facebook.com/username')).toBe(false);
      });

      test('status URL (not profile)', () => {
        expect(twitterPattern.test('https://twitter.com/user/status/123')).toBe(false);
      });

      test('empty username', () => {
        expect(twitterPattern.test('https://twitter.com/')).toBe(false);
      });

      test('username with hyphens (not allowed on Twitter)', () => {
        // Twitter usernames can only have letters, numbers, and underscores
        expect(twitterPattern.test('https://twitter.com/user-name')).toBe(false);
      });
    });
  });

  describe('URL normalization', () => {
    // Helper to simulate frontend normalization
    const normalizeUrl = (url) => {
      let normalized = url.trim();
      if (normalized && !normalized.match(/^https?:\/\//)) {
        normalized = 'https://' + normalized;
      }
      return normalized;
    };

    test('adds https:// to github.com/user', () => {
      expect(normalizeUrl('github.com/username')).toBe('https://github.com/username');
    });

    test('adds https:// to linkedin.com/in/user', () => {
      expect(normalizeUrl('linkedin.com/in/username')).toBe('https://linkedin.com/in/username');
    });

    test('preserves existing https://', () => {
      expect(normalizeUrl('https://github.com/username')).toBe('https://github.com/username');
    });

    test('preserves existing http://', () => {
      expect(normalizeUrl('http://github.com/username')).toBe('http://github.com/username');
    });

    test('trims whitespace', () => {
      expect(normalizeUrl('  github.com/username  ')).toBe('https://github.com/username');
    });

    test('handles empty string', () => {
      expect(normalizeUrl('')).toBe('');
    });
  });
});

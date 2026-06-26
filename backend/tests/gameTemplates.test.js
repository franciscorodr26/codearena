const {
  MINIMAL_CANVAS_TEMPLATE,
  MINIMAL_DOM_TEMPLATE,
  MINIMAL_TEXT_TEMPLATE,
  validateGameHtml,
  autoFixHtml
} = require('../services/gameTemplates');

describe('gameTemplates', () => {
  describe('minimal templates', () => {
    it('canvas template passes all validation checks', () => {
      const issues = validateGameHtml(MINIMAL_CANVAS_TEMPLATE);
      expect(issues.length).toBe(0);
    });

    it('DOM template passes all validation checks', () => {
      const issues = validateGameHtml(MINIMAL_DOM_TEMPLATE);
      expect(issues.length).toBe(0);
    });

    it('text template passes all validation checks', () => {
      const issues = validateGameHtml(MINIMAL_TEXT_TEMPLATE);
      expect(issues.length).toBe(0);
    });

    it('canvas template contains required elements', () => {
      expect(MINIMAL_CANVAS_TEMPLATE).toContain('<!DOCTYPE html>');
      expect(MINIMAL_CANVAS_TEMPLATE).toContain('<canvas');
      expect(MINIMAL_CANVAS_TEMPLATE).toContain('requestAnimationFrame');
      expect(MINIMAL_CANVAS_TEMPLATE).toContain('addEventListener');
    });

    it('text template contains required elements', () => {
      expect(MINIMAL_TEXT_TEMPLATE).toContain('<!DOCTYPE html>');
      expect(MINIMAL_TEXT_TEMPLATE).toContain('<input');
      expect(MINIMAL_TEXT_TEMPLATE).toContain('addEventListener');
    });
  });

  describe('validateGameHtml', () => {
    it('detects missing DOCTYPE', () => {
      const html = '<html><head></head><body><script></script></body></html>';
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'hasDoctype')).toBe(true);
    });

    it('detects missing script tag', () => {
      const html = '<!DOCTYPE html><html><head></head><body></body></html>';
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'hasScript')).toBe(true);
    });

    it('detects external dependencies with http', () => {
      const html = '<!DOCTYPE html><html><head><script src="https://example.com/lib.js"></script></head><body><script>test</script></body></html>';
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'noExternalDeps')).toBe(true);
    });

    it('detects external dependencies with protocol-relative URLs', () => {
      const html = '<!DOCTYPE html><html><head><script src="//example.com/lib.js"></script></head><body><style>*{}</style><script>document.addEventListener("click",()=>{});setInterval(()=>{},100)</script></body></html>';
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'noExternalDeps')).toBe(true);
    });

    it('detects CDN links in href/src attributes', () => {
      const html = '<!DOCTYPE html><html><head><link href="https://cdn.example.com/style.css"></head><body><style>*{}</style><script>setInterval()</script></body></html>';
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'noCDN')).toBe(true);
    });

    it('does not flag cdn in JavaScript strings (no false positive)', () => {
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body>
        <script>
          document.addEventListener('click', () => {});
          setInterval(() => {}, 100);
          const url = "cdn.test.com";
        </script>
      </body></html>`;
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'noCDN')).toBe(false);
    });

    it('detects missing game loop', () => {
      const html = '<!DOCTYPE html><html><head><style>*{}</style></head><body><script>console.log("no loop")</script></body></html>';
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'hasGameLoop')).toBe(true);
    });

    it('detects while(true) infinite loop', () => {
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body>
        <script>document.addEventListener("click",()=>{});while(true) { console.log('infinite'); }</script>
      </body></html>`;
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'potentialInfiniteLoop')).toBe(true);
    });

    it('detects while (true) with space', () => {
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body>
        <script>document.addEventListener("click",()=>{});while (true) { console.log('infinite'); }</script>
      </body></html>`;
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'potentialInfiniteLoop')).toBe(true);
    });

    it('detects while(1) infinite loop', () => {
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body>
        <script>document.addEventListener("click",()=>{});while(1) { console.log('infinite'); }</script>
      </body></html>`;
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'potentialInfiniteLoop')).toBe(true);
    });

    it('detects for(;;) infinite loop', () => {
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body>
        <script>document.addEventListener("click",()=>{});for(;;) { console.log('infinite'); }</script>
      </body></html>`;
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'potentialInfiniteLoop')).toBe(true);
    });

    it('does not flag infinite loop with break', () => {
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body>
        <script>document.addEventListener("click",()=>{});while(true) { if (done) break; }</script>
      </body></html>`;
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'potentialInfiniteLoop')).toBe(false);
    });

    it('handles lowercase doctype', () => {
      const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body><script>document.addEventListener("click",()=>{});setInterval(()=>{},100)</script></body></html>';
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'hasDoctype')).toBe(false);
    });

    it('passes valid minimal game', () => {
      const validHtml = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width">
  <style>body{margin:0}</style>
</head>
<body>
  <canvas id="c"></canvas>
  <script>
    document.addEventListener('click', () => {});
    requestAnimationFrame(function loop() { requestAnimationFrame(loop); });
  </script>
</body>
</html>`;
      const issues = validateGameHtml(validHtml);
      expect(issues.length).toBe(0);
    });

    it('recognizes text games with various input IDs', () => {
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body>
        <input type="text" id="user-input" />
        <script>
          document.addEventListener('keypress', () => {});
        </script>
      </body></html>`;
      const issues = validateGameHtml(html);
      // Text games with text input and event handlers should pass hasGameLoop
      expect(issues.some(i => i.name === 'hasGameLoop')).toBe(false);
    });
  });

  describe('autoFixHtml', () => {
    it('adds DOCTYPE if missing', () => {
      const html = '<html><head></head><body></body></html>';
      const fixed = autoFixHtml(html);
      expect(fixed).toContain('<!DOCTYPE html>');
    });

    it('does not add duplicate DOCTYPE for lowercase', () => {
      const html = '<!doctype html><html><head></head><body></body></html>';
      const fixed = autoFixHtml(html);
      const count = (fixed.match(/<!doctype/gi) || []).length;
      expect(count).toBe(1);
    });

    it('adds viewport meta if missing', () => {
      const html = '<!DOCTYPE html><html><head></head><body></body></html>';
      const fixed = autoFixHtml(html);
      expect(fixed).toContain('viewport');
    });

    it('adds charset if missing', () => {
      const html = '<!DOCTYPE html><html><head></head><body></body></html>';
      const fixed = autoFixHtml(html);
      expect(fixed).toContain('charset');
    });

    it('adds box-sizing reset for canvas games', () => {
      const html = '<!DOCTYPE html><html><head><style></style></head><body><canvas></canvas></body></html>';
      const fixed = autoFixHtml(html);
      expect(fixed).toContain('box-sizing');
    });

    it('adds overflow hidden only for actual canvas elements', () => {
      const html = '<!DOCTYPE html><html><head><style></style></head><body><canvas></canvas></body></html>';
      const fixed = autoFixHtml(html);
      expect(fixed).toContain('overflow: hidden');
    });

    it('does not add overflow hidden for canvas mentioned in text', () => {
      const html = '<!DOCTYPE html><html><head><style></style></head><body><p>Draw on canvas</p></body></html>';
      const fixed = autoFixHtml(html);
      expect(fixed).not.toContain('overflow: hidden');
    });

    it('preserves existing content', () => {
      const html = '<!DOCTYPE html><html><head><style>body{color:red}</style></head><body><canvas></canvas><script>alert(1)</script></body></html>';
      const fixed = autoFixHtml(html);
      expect(fixed).toContain('color:red');
      expect(fixed).toContain('alert(1)');
    });
  });
});

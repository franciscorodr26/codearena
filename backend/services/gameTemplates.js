/**
 * Game Templates Service
 * Provides reliable code patterns and templates for game generation.
 * These patterns have been tested to work in sandboxed iframes.
 */

// Minimal working game template - guaranteed to work in iframe sandbox
const MINIMAL_CANVAS_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Game</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0f;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      font-family: system-ui, -apple-system, sans-serif;
      color: #fff;
      overflow: hidden;
    }
    #game-container { position: relative; }
    canvas {
      display: block;
      background: #111;
      border-radius: 8px;
      box-shadow: 0 0 40px rgba(0,0,0,0.5);
    }
    #ui {
      position: absolute;
      top: 10px;
      left: 10px;
      right: 10px;
      display: flex;
      justify-content: space-between;
      font-size: 14px;
      pointer-events: none;
    }
    #instructions {
      margin-top: 16px;
      font-size: 12px;
      color: #666;
    }
  </style>
</head>
<body>
  <div id="game-container">
    <canvas id="canvas"></canvas>
    <div id="ui">
      <span id="score">Score: 0</span>
      <span id="status">Playing</span>
    </div>
  </div>
  <div id="instructions">Arrow keys to move, Space to action</div>
  <script>
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const W = 600, H = 400;
    canvas.width = W; canvas.height = H;

    let score = 0;
    let gameOver = false;
    let keys = {};

    // Input handling (works in iframe sandbox)
    document.addEventListener('keydown', e => { keys[e.code] = true; e.preventDefault(); });
    document.addEventListener('keyup', e => { keys[e.code] = false; });

    // Game state
    const player = { x: W/2, y: H - 50, w: 40, h: 40, speed: 5 };

    function update() {
      if (gameOver) return;

      // Player movement
      if (keys['ArrowLeft'] || keys['KeyA']) player.x -= player.speed;
      if (keys['ArrowRight'] || keys['KeyD']) player.x += player.speed;
      if (keys['ArrowUp'] || keys['KeyW']) player.y -= player.speed;
      if (keys['ArrowDown'] || keys['KeyS']) player.y += player.speed;

      // Bounds
      player.x = Math.max(0, Math.min(W - player.w, player.x));
      player.y = Math.max(0, Math.min(H - player.h, player.y));
    }

    function draw() {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, W, H);

      // Draw player
      ctx.fillStyle = '#4f46e5';
      ctx.fillRect(player.x, player.y, player.w, player.h);

      // Update UI
      document.getElementById('score').textContent = 'Score: ' + score;
    }

    function gameLoop() {
      update();
      draw();
      requestAnimationFrame(gameLoop);
    }

    gameLoop();
  </script>
</body>
</html>`;

const MINIMAL_DOM_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Game</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2f 100%);
      min-height: 100vh;
      font-family: system-ui, -apple-system, sans-serif;
      color: #fff;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
    }
    h1 { margin-bottom: 10px; font-size: 24px; }
    #game-area {
      position: relative;
      width: 500px;
      height: 400px;
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      overflow: hidden;
    }
    .game-element {
      position: absolute;
      border-radius: 4px;
      transition: transform 0.1s;
    }
    #ui-bar {
      width: 500px;
      display: flex;
      justify-content: space-between;
      margin-top: 15px;
      font-size: 14px;
      color: #888;
    }
    #instructions {
      margin-top: 10px;
      font-size: 12px;
      color: #555;
    }
    button {
      background: #4f46e5;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      margin-top: 15px;
    }
    button:hover { background: #4338ca; }
  </style>
</head>
<body>
  <h1>Game Title</h1>
  <div id="game-area"></div>
  <div id="ui-bar">
    <span>Score: <span id="score">0</span></span>
    <span>Time: <span id="timer">60</span>s</span>
  </div>
  <div id="instructions">Click to play</div>
  <button id="restart" style="display:none;">Play Again</button>
  <script>
    const gameArea = document.getElementById('game-area');
    const scoreEl = document.getElementById('score');
    const timerEl = document.getElementById('timer');
    const restartBtn = document.getElementById('restart');

    let score = 0;
    let timeLeft = 60;
    let gameActive = true;
    let gameLoop;

    function updateScore(points) {
      score += points;
      scoreEl.textContent = score;
    }

    function endGame() {
      gameActive = false;
      clearInterval(gameLoop);
      restartBtn.style.display = 'block';
    }

    function startGame() {
      score = 0;
      timeLeft = 60;
      gameActive = true;
      scoreEl.textContent = '0';
      timerEl.textContent = '60';
      restartBtn.style.display = 'none';

      gameLoop = setInterval(() => {
        if (!gameActive) return;
        timeLeft--;
        timerEl.textContent = timeLeft;
        if (timeLeft <= 0) endGame();
      }, 1000);
    }

    restartBtn.addEventListener('click', startGame);
    startGame();
  </script>
</body>
</html>`;

const MINIMAL_TEXT_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Text Adventure</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0f;
      min-height: 100vh;
      font-family: 'Courier New', monospace;
      color: #0f0;
      padding: 20px;
      display: flex;
      flex-direction: column;
    }
    #output {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      background: rgba(0,255,0,0.03);
      border: 1px solid #0f02;
      border-radius: 8px;
      margin-bottom: 15px;
      max-height: 400px;
    }
    .message { margin-bottom: 15px; line-height: 1.6; }
    .system { color: #888; }
    .player { color: #4f9; }
    #input-area {
      display: flex;
      gap: 10px;
    }
    #command {
      flex: 1;
      background: #111;
      border: 1px solid #0f03;
      color: #0f0;
      padding: 12px 15px;
      border-radius: 6px;
      font-family: inherit;
      font-size: 14px;
    }
    #command:focus { outline: none; border-color: #0f06; }
    button {
      background: #0f03;
      color: #0f0;
      border: 1px solid #0f06;
      padding: 12px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
    }
    button:hover { background: #0f05; }
    #status-bar {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      font-size: 12px;
      color: #666;
      border-top: 1px solid #0f02;
      margin-top: 15px;
    }
  </style>
</head>
<body>
  <div id="output"></div>
  <div id="input-area">
    <input type="text" id="command" placeholder="Enter command..." autocomplete="off" />
    <button onclick="submitCommand()">Enter</button>
  </div>
  <div id="status-bar">
    <span>Location: <span id="location">Start</span></span>
    <span>Inventory: <span id="inventory">empty</span></span>
  </div>
  <script>
    const output = document.getElementById('output');
    const commandInput = document.getElementById('command');
    const locationEl = document.getElementById('location');
    const inventoryEl = document.getElementById('inventory');

    // Game state
    const state = {
      location: 'start',
      inventory: [],
      flags: {}
    };

    const locations = {
      start: {
        description: 'You are at the beginning of your adventure.',
        exits: { north: 'forest' }
      },
      forest: {
        description: 'A dense forest surrounds you.',
        exits: { south: 'start' }
      }
    };

    function print(text, className = '') {
      const div = document.createElement('div');
      div.className = 'message ' + className;
      div.textContent = text;
      output.appendChild(div);
      output.scrollTop = output.scrollHeight;
    }

    function updateUI() {
      locationEl.textContent = state.location;
      inventoryEl.textContent = state.inventory.length ? state.inventory.join(', ') : 'empty';
    }

    function processCommand(cmd) {
      const parts = cmd.toLowerCase().trim().split(/\\s+/);
      const verb = parts[0];
      const noun = parts.slice(1).join(' ');

      print('> ' + cmd, 'player');

      const loc = locations[state.location];

      if (verb === 'look' || verb === 'l') {
        print(loc.description);
        if (loc.exits) {
          print('Exits: ' + Object.keys(loc.exits).join(', '), 'system');
        }
      } else if (verb === 'go' || ['north','south','east','west','n','s','e','w'].includes(verb)) {
        const dir = noun || verb;
        const fullDir = {n:'north',s:'south',e:'east',w:'west'}[dir] || dir;
        if (loc.exits && loc.exits[fullDir]) {
          state.location = loc.exits[fullDir];
          print('You go ' + fullDir + '.');
          print(locations[state.location].description);
        } else {
          print("You can't go that way.");
        }
      } else if (verb === 'help' || verb === 'h') {
        print('Commands: look, go [direction], help', 'system');
      } else {
        print("I don't understand that command. Type 'help' for commands.", 'system');
      }

      updateUI();
    }

    function submitCommand() {
      const cmd = commandInput.value.trim();
      if (cmd) {
        processCommand(cmd);
        commandInput.value = '';
      }
      commandInput.focus();
    }

    commandInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') submitCommand();
    });

    // Start game
    print('Welcome to the adventure!', 'system');
    print(locations[state.location].description);
    print("Type 'help' for commands.", 'system');
    commandInput.focus();
  </script>
</body>
</html>`;

// Tested patterns that work reliably in sandboxed iframes
const RELIABLE_PATTERNS = {
  // Input handling that works in sandboxed iframe
  inputHandling: `
// Reliable input handling for sandboxed iframes
const keys = {};
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  // Prevent scrolling with arrow keys
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

// Mouse/touch handling
let mouse = { x: 0, y: 0, down: false };
document.addEventListener('mousedown', e => { mouse.down = true; });
document.addEventListener('mouseup', e => { mouse.down = false; });
document.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
});

// Touch support
document.addEventListener('touchstart', e => {
  mouse.down = true;
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.touches[0].clientX - rect.left;
  mouse.y = e.touches[0].clientY - rect.top;
});
document.addEventListener('touchend', e => { mouse.down = false; });
document.addEventListener('touchmove', e => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.touches[0].clientX - rect.left;
  mouse.y = e.touches[0].clientY - rect.top;
});`,

  // Game loop pattern
  gameLoop: `
let lastTime = 0;
const FPS = 60;
const frameTime = 1000 / FPS;

function gameLoop(timestamp) {
  if (timestamp - lastTime >= frameTime) {
    update();
    draw();
    lastTime = timestamp;
  }
  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);`,

  // Collision detection
  collision: `
function rectCollision(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function circleCollision(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist < a.r + b.r;
}`,

  // Particle system
  particles: `
const particles = [];

function createParticle(x, y, color) {
  particles.push({
    x, y, color,
    vx: (Math.random() - 0.5) * 8,
    vy: (Math.random() - 0.5) * 8,
    life: 1,
    decay: 0.02 + Math.random() * 0.02
  });
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles(ctx) {
  particles.forEach(p => {
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  });
  ctx.globalAlpha = 1;
}`,

  // Object pooling for performance
  objectPool: `
class ObjectPool {
  constructor(factory, initialSize = 20) {
    this.factory = factory;
    this.pool = [];
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(factory());
    }
  }

  get() {
    return this.pool.length > 0 ? this.pool.pop() : this.factory();
  }

  release(obj) {
    this.pool.push(obj);
  }
}`
};

// Common issues and their fixes
const COMMON_ISSUES = {
  'NaN position': 'Initialize all numeric values explicitly (x: 0, y: 0)',
  'Canvas not found': 'Ensure canvas element exists and script runs after DOM ready',
  'Input not working': 'Add event listeners to document, not canvas',
  'Game freezes': 'Use requestAnimationFrame, not setInterval for game loop',
  'Mobile not working': 'Add touch event handlers alongside mouse handlers',
  'Scaling issues': 'Use fixed canvas size (600x400) for consistency'
};

/**
 * Helper to strip comments and string literals from JavaScript for heuristic checks.
 * This reduces false positives from patterns appearing in comments or strings.
 */
function stripCommentsAndStrings(code) {
  // Remove single-line comments
  let stripped = code.replace(/\/\/[^\n]*/g, '');
  // Remove multi-line comments
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove template literals (backticks)
  stripped = stripped.replace(/`[^`]*`/g, '""');
  // Remove double-quoted strings
  stripped = stripped.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  // Remove single-quoted strings
  stripped = stripped.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return stripped;
}

/**
 * Check if HTML contains an actual canvas element (not just the word "canvas" in text)
 */
function hasCanvasElement(html) {
  // Match <canvas with optional attributes
  return /<canvas[\s>]/i.test(html);
}

// Validation checklist for generated games
// Note: hasGameLoop is only required for canvas/animation games, not text games
const VALIDATION_CHECKLIST = [
  // FIX BUG #3: Case-insensitive DOCTYPE check
  { name: 'hasDoctype', check: html => /<!DOCTYPE\s+html>/i.test(html), fix: 'Add <!DOCTYPE html>' },
  { name: 'hasHtmlTag', check: html => /<html[^>]*>/i.test(html), fix: 'Wrap in <html> tags' },
  { name: 'hasHead', check: html => /<head>/i.test(html), fix: 'Add <head> section' },
  { name: 'hasBody', check: html => /<body>/i.test(html), fix: 'Add <body> section' },
  { name: 'hasViewport', check: html => html.includes('viewport'), fix: 'Add viewport meta tag' },
  { name: 'hasStyle', check: html => /<style>/i.test(html), fix: 'Add CSS styles' },
  { name: 'hasScript', check: html => /<script>/i.test(html), fix: 'Add JavaScript' },
  // FIX BUG #1: Also detect protocol-relative URLs (//example.com)
  {
    name: 'noExternalDeps',
    check: html => {
      // Check for http/https URLs in src attributes
      if (/src\s*=\s*["']https?:\/\//i.test(html)) return false;
      // Check for protocol-relative URLs (//example.com)
      if (/src\s*=\s*["']\/\/[^"']+/i.test(html)) return false;
      return true;
    },
    fix: 'Remove external dependencies'
  },
  // FIX BUG #5: Only check for CDN in actual URL contexts, not in JS strings
  {
    name: 'noCDN',
    check: html => {
      // Check for CDN URLs in href/src attributes specifically
      const cdnPattern = /(href|src)\s*=\s*["'][^"']*(?:cdn\.|unpkg\.|jsdelivr\.)[^"']*/i;
      return !cdnPattern.test(html);
    },
    fix: 'Remove CDN links'
  },
  // FIX BUG #6: Broader text game detection
  {
    name: 'hasGameLoop',
    check: html => {
      // If it's a text/interactive game (has text input), game loop is not required
      // Broader detection: any text input element suggests event-driven game
      const hasTextInput = /type\s*=\s*["']text["']/i.test(html);
      const hasSubmitMechanism = /onsubmit|onclick|addEventListener\s*\(\s*["'](?:click|keypress|keydown|submit)["']/i.test(html);
      if (hasTextInput && hasSubmitMechanism) return true;
      // For canvas/animation games, require a game loop
      return html.includes('requestAnimationFrame') || html.includes('setInterval');
    },
    fix: 'Add game loop (requestAnimationFrame or setInterval)'
  },
  { name: 'hasInput', check: html => html.includes('addEventListener') || html.includes('onclick'), fix: 'Add input handling' },
  { name: 'closedTags', check: html => /<\/html>/i.test(html) && /<\/body>/i.test(html), fix: 'Close all HTML tags' }
];

/**
 * Validate generated HTML and return issues found
 */
function validateGameHtml(html) {
  const issues = [];

  for (const check of VALIDATION_CHECKLIST) {
    if (!check.check(html)) {
      issues.push({ name: check.name, fix: check.fix });
    }
  }

  // Check for common JS errors
  if (html.includes('undefined') && html.includes('=') && html.match(/=\s*undefined/)) {
    issues.push({ name: 'undefinedAssignment', fix: 'Initialize variables with proper values' });
  }

  // FIX BUG #2: Improved infinite loop detection with flexible whitespace
  // Also catches while(1), for(;;), etc.
  const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  if (scriptMatch) {
    const scriptContent = stripCommentsAndStrings(scriptMatch[1]);
    // Match while(true), while (true), while(1), while (1)
    const hasWhileTrue = /while\s*\(\s*(?:true|1)\s*\)/.test(scriptContent);
    // Match for(;;)
    const hasForInfinite = /for\s*\(\s*;\s*;\s*\)/.test(scriptContent);

    if ((hasWhileTrue || hasForInfinite) && !scriptContent.includes('break')) {
      issues.push({ name: 'potentialInfiniteLoop', fix: 'Add break condition to while loops' });
    }
  }

  return issues;
}

/**
 * Apply automatic fixes to common issues
 */
function autoFixHtml(html) {
  let fixed = html;

  // FIX BUG #4: Case-insensitive DOCTYPE check to avoid duplicates
  if (!/<!DOCTYPE/i.test(fixed)) {
    fixed = '<!DOCTYPE html>\n' + fixed;
  }

  // Add viewport if missing
  if (!fixed.includes('viewport') && /<head>/i.test(fixed)) {
    fixed = fixed.replace(/<head>/i, '<head>\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">');
  }

  // Add charset if missing
  if (!fixed.includes('charset') && /<head>/i.test(fixed)) {
    fixed = fixed.replace(/<head>/i, '<head>\n  <meta charset="UTF-8">');
  }

  // Fix common CSS issues
  if (!fixed.includes('box-sizing')) {
    const styleInsert = '* { box-sizing: border-box; } ';
    if (/<style>/i.test(fixed)) {
      fixed = fixed.replace(/<style>/i, '<style>' + styleInsert);
    }
  }

  // Ensure body doesn't scroll unexpectedly - only for actual canvas elements
  if (!fixed.includes('overflow') && hasCanvasElement(fixed)) {
    const noScroll = 'body { overflow: hidden; } ';
    if (/<style>/i.test(fixed)) {
      fixed = fixed.replace(/<style>/i, '<style>' + noScroll);
    }
  }

  return fixed;
}

module.exports = {
  MINIMAL_CANVAS_TEMPLATE,
  MINIMAL_DOM_TEMPLATE,
  MINIMAL_TEXT_TEMPLATE,
  RELIABLE_PATTERNS,
  COMMON_ISSUES,
  VALIDATION_CHECKLIST,
  validateGameHtml,
  autoFixHtml,
  // Export helpers for testing
  stripCommentsAndStrings,
  hasCanvasElement
};

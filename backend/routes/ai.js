const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { containsProfanityForGames } = require('../utils/contentFilter');
const db = require('../db');
const { sendReferralCompletedEmail } = require('../services/email');
const {
  MINIMAL_CANVAS_TEMPLATE,
  MINIMAL_DOM_TEMPLATE,
  MINIMAL_TEXT_TEMPLATE,
  RELIABLE_PATTERNS,
  validateGameHtml,
  autoFixHtml
} = require('../services/gameTemplates');

const authRouterForGames = require('./auth');
const gameAuthMiddleware = authRouterForGames.authMiddleware;

// Initialize Anthropic client if API key is available
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ============================================
// GAME GENERATION
// ============================================

const gameGenLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many game generation requests. Please wait a moment.' }
});

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

const CREATORARENA_MODEL = process.env.CREATORARENA_MODEL || 'claude-sonnet-4-6';
const CREATORARENA_REVISION_MODEL = process.env.CREATORARENA_REVISION_MODEL || 'claude-haiku-4-5-20251001';
const CREATORARENA_MAX_TOKENS = boundedPositiveInteger(process.env.CREATORARENA_MAX_TOKENS, 7000, 8000);
const CREATORARENA_REVISION_MAX_TOKENS = boundedPositiveInteger(process.env.CREATORARENA_REVISION_MAX_TOKENS, 3000, 4000);
const CREATORARENA_REPAIR_MAX_TOKENS = boundedPositiveInteger(process.env.CREATORARENA_REPAIR_MAX_TOKENS, 2500, 3000);
const CREATORARENA_MAX_PROMPT_CHARS = 4000;
const CREATORARENA_MAX_SECTION_CHARS = 2500;
const CREATORARENA_MAX_COMBINED_INPUT_CHARS = 8000;
const CREATORARENA_SKIP_MODERATION_FOR_REVISIONS =
  process.env.CREATORARENA_SKIP_MODERATION_FOR_REVISIONS !== 'false';
const CREATORARENA_REVISION_HTML_CONTEXT_LIMIT =
  boundedPositiveInteger(process.env.CREATORARENA_REVISION_HTML_CONTEXT_LIMIT, 40000, 50000);

function getRevisionHtmlContext(existingHtml) {
  if (!existingHtml || typeof existingHtml !== 'string') return '';
  if (existingHtml.length <= CREATORARENA_REVISION_HTML_CONTEXT_LIMIT) return existingHtml;

  const keepHead = Math.floor(CREATORARENA_REVISION_HTML_CONTEXT_LIMIT * 0.6);
  const keepTail = CREATORARENA_REVISION_HTML_CONTEXT_LIMIT - keepHead;
  return `${existingHtml.slice(0, keepHead)}

<!-- CODEARENA_CONTEXT_TRUNCATED_FOR_SPEED -->

${existingHtml.slice(-keepTail)}`;
}

/**
 * Build the enhanced system prompt for game generation.
 * This is the core improvement - a much more specific and structured prompt.
 */
function buildGameSystemPrompt(isTextGame, gameType) {
  // Use full template to avoid truncation issues (CRITIC FIX: template preview was truncated)
  const baseTemplate = isTextGame ? MINIMAL_TEXT_TEMPLATE : MINIMAL_CANVAS_TEMPLATE;

  if (isTextGame) {
    return `You are an expert game developer AI. Generate a complete, working text adventure game as a single HTML file.

## CRITICAL REQUIREMENTS (MUST FOLLOW EXACTLY):
1. Output ONLY raw HTML. No markdown, no \`\`\`, no explanation text.
2. The file must be completely self-contained with NO external dependencies.
3. The game MUST work in a sandboxed iframe (sandbox="allow-scripts").
4. All JavaScript must be inline in a single <script> tag.
5. All CSS must be inline in a single <style> tag.

## MANDATORY HTML STRUCTURE:
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[Game Title]</title>
  <style>
    /* Reset and base styles */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { /* dark theme, monospace font */ }
    /* Game-specific styles */
  </style>
</head>
<body>
  <!-- Game UI elements -->
  <script>
    // All game logic here
  </script>
</body>
</html>

## TEXT GAME REQUIREMENTS:
1. Include a scrollable output area (#output) for narrative text
2. Include a text input (#command) with autocomplete="off"
3. Include a submit button that works with both click and Enter key
4. Include a status bar showing location and inventory
5. Implement a command parser that handles: look, go [direction], get [item], use [item], inventory, help
6. Define at least 5 interconnected locations with descriptions
7. Include at least 3 collectible items
8. Have a clear win condition and end state
9. Print narrative text with proper spacing and styling

## INPUT HANDLING (REQUIRED):
- Text input must respond to Enter key
- Button click must also submit
- Focus input after each command
- Clear input after submission

## COMMON MISTAKES TO AVOID:
- DO NOT use external fonts, libraries, or CDNs
- DO NOT use ES6 modules or import statements
- DO NOT use async/await without proper error handling
- DO NOT leave variables undefined
- DO NOT use document.write()
- DO NOT create infinite loops (while(true) without break)

## COMPLETE WORKING EXAMPLE:
${baseTemplate}

Generate a COMPLETE, WORKING game following this exact structure. Test mentally that every function is defined before use.`;
  }

  // Browser game (canvas-based)
  return `You are an expert game developer AI. Generate a complete, working browser game as a single HTML file.

## CRITICAL REQUIREMENTS (MUST FOLLOW EXACTLY):
1. Output ONLY raw HTML. No markdown, no \`\`\`, no explanation text.
2. The file must be completely self-contained with NO external dependencies.
3. The game MUST work in a sandboxed iframe (sandbox="allow-scripts").
4. All JavaScript must be inline in a single <script> tag.
5. All CSS must be inline in a single <style> tag.
6. Canvas size must be exactly 600x400 pixels.

## MANDATORY HTML STRUCTURE:
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[Game Title]</title>
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
    canvas {
      display: block;
      background: #111;
      border-radius: 8px;
    }
    /* Additional styles */
  </style>
</head>
<body>
  <div id="game-container">
    <canvas id="canvas" width="600" height="400"></canvas>
    <div id="ui"><!-- Score, lives, etc --></div>
  </div>
  <div id="instructions"><!-- Control instructions --></div>
  <script>
    // Canvas setup (REQUIRED - DO NOT MODIFY)
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const W = 600, H = 400;

    // Game state
    let gameOver = false;
    let score = 0;

    // Input handling (REQUIRED PATTERN)
    const keys = {};
    document.addEventListener('keydown', e => {
      keys[e.code] = true;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    document.addEventListener('keyup', e => { keys[e.code] = false; });

    // Mouse handling
    let mouse = { x: 0, y: 0, down: false };
    canvas.addEventListener('mousedown', e => { mouse.down = true; });
    canvas.addEventListener('mouseup', e => { mouse.down = false; });
    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    });

    // Touch support
    canvas.addEventListener('touchstart', e => {
      mouse.down = true;
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.touches[0].clientX - rect.left;
      mouse.y = e.touches[0].clientY - rect.top;
      e.preventDefault();
    });
    canvas.addEventListener('touchend', e => { mouse.down = false; });
    canvas.addEventListener('touchmove', e => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.touches[0].clientX - rect.left;
      mouse.y = e.touches[0].clientY - rect.top;
    });

    // Game objects and logic here...

    // Update function
    function update() {
      if (gameOver) return;
      // Update game state
    }

    // Draw function
    function draw() {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, W, H);
      // Draw game objects
    }

    // Game loop (REQUIRED PATTERN)
    function gameLoop() {
      update();
      draw();
      requestAnimationFrame(gameLoop);
    }

    // Start game
    gameLoop();
  </script>
</body>
</html>

## GAME REQUIREMENTS:
1. Player must have clear, responsive controls appropriate to the game type (keyboard, mouse/click, touch, or a combination)
2. Include at least one type of enemy/obstacle
3. Implement collision detection
4. Track and display score
5. Have a clear game over condition
6. Show instructions below the canvas
7. Include a restart mechanism (press R or click to restart)
8. SCOPE RULE: A working game with fewer features is ALWAYS better than a broken game with many features. Implement the core mechanic correctly first. For multi-level games, implement 2-3 levels max.

## COLLISION DETECTION (USE THIS):
function rectCollision(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

## COMMON MISTAKES TO AVOID:
- DO NOT use external fonts, libraries, or CDNs
- DO NOT use ES6 modules or import statements
- DO NOT forget to initialize variables (causes NaN errors)
- DO NOT use setInterval for game loop (use requestAnimationFrame)
- DO NOT forget to clear canvas each frame
- DO NOT create entities at undefined positions
- DO NOT call functions before they are defined
- DO NOT use document.write()
- DO NOT create infinite loops (while(true) without break)

## VISUAL POLISH CHECKLIST:
- Use a consistent color palette (3-5 colors)
- Add smooth movement (no jerky animation)
- Include visual feedback for player actions
- Display score prominently
- Use rounded corners (border-radius) for UI elements

## COMPLETE WORKING EXAMPLE:
${baseTemplate}

The example above shows keyboard, mouse, and touch input scaffolding. Adapt the GAME LOGIC to use the input method that fits the game described:
- Mouse/click games (puzzles, card games, tower defense): use mouse/touch events for primary interaction, NOT keyboard movement
- Physics games (golf, pool, slingshot): use click-drag for aiming, NOT arrow keys
- Turn-based games (blackjack, memory): use click handlers, NOT a continuous game loop for input
- Keyboard games (platformers, shooters, snake): use the keyboard pattern shown above

Generate a COMPLETE, WORKING game. The player should be able to play immediately without any errors.`;
}

/**
 * Build system prompt for game updates/modifications
 */
function buildUpdateSystemPrompt(mode, existingHtml) {
  const modeInstructions = {
    update_mechanics: `You are modifying an existing HTML game. Change ONLY the game logic and mechanics.
- Keep the visual style (CSS) exactly the same
- Keep the story/narrative elements the same
- Modify JavaScript game logic as requested
- Ensure the game still works after changes`,

    update_graphics: `You are modifying an existing HTML game. Change ONLY the visual style.
- Keep the game logic (JavaScript) exactly the same
- Keep the story/narrative elements the same
- Modify CSS colors, animations, visual effects
- Ensure the game still works after changes`,

    update_story: `You are modifying an existing HTML game. Change ONLY the narrative content.
- Keep the game mechanics exactly the same
- Keep the visual style the same
- Modify text content, dialogue, descriptions
- Ensure the game still works after changes`,

    fix: `You are fixing bugs in an existing HTML game.
- Identify and fix JavaScript errors
- Fix broken game logic
- Fix UI/display issues
- DO NOT change the game design, just make it work
- Preserve all existing features`,

    revise: `You are improving an existing HTML game based on user feedback.
- Apply the specific changes the user requested
- Keep everything else intact
- Ensure the game still works after changes
- Maintain the existing style and feel`
  };

  return `${modeInstructions[mode] || 'Modify the game as requested.'}

## CRITICAL REQUIREMENTS:
1. Output ONLY the complete modified HTML file
2. No markdown, no explanation, no code fences
3. Keep it as a single self-contained HTML file
4. Test mentally that the game still works

## EXISTING GAME TO MODIFY:
${existingHtml}`;
}

/**
 * Extract clean HTML from model response, handling various edge cases
 */
function extractHtmlFromResponse(response) {
  let html = response || '';

  // Strip markdown code fences (various formats)
  html = html.replace(/^```html?\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '').trim();

  // If wrapped in fences with text before/after, extract the HTML block
  const fenceMatch = html.match(/```html?\s*\n([\s\S]*?)\n\s*```/i);
  if (fenceMatch) {
    html = fenceMatch[1].trim();
  }

  // If model prefixed with explanation, find the actual HTML (case-insensitive)
  if (!/^<!doctype/i.test(html) && !html.toLowerCase().startsWith('<html')) {
    const docTypeMatch = html.match(/<!DOCTYPE\s+html>/i);
    const htmlTagMatch = html.match(/<html/i);
    const docTypeIdx = docTypeMatch ? html.indexOf(docTypeMatch[0]) : -1;
    const htmlIdx = htmlTagMatch ? html.toLowerCase().indexOf('<html') : -1;
    const startIdx = docTypeIdx >= 0 ? docTypeIdx : htmlIdx;
    if (startIdx > 0) {
      html = html.substring(startIdx).trim();
    }
  }

  // Trim any trailing explanation after </html>
  const htmlEndMatch = html.match(/<\/html>/i);
  if (htmlEndMatch) {
    const htmlEndIdx = html.toLowerCase().lastIndexOf('</html>');
    if (htmlEndIdx > 0) {
      html = html.substring(0, htmlEndIdx + 7);
    }
  }

  return html;
}

/**
 * Validate that the generated HTML is playable
 */
function validateGeneratedGame(html, isTextGame) {
  const issues = validateGameHtml(html);

  // Additional game-specific checks
  if (!isTextGame) {
    // Canvas game checks
    if (!/canvas/i.test(html)) {
      issues.push({ name: 'missingCanvas', fix: 'Add canvas element' });
    }
    if (!html.includes('getContext')) {
      issues.push({ name: 'missingContext', fix: 'Get 2D context from canvas' });
    }
    if (!html.includes('requestAnimationFrame') && !html.includes('setInterval')) {
      issues.push({ name: 'missingGameLoop', fix: 'Add game loop' });
    }
  } else {
    // Text game checks
    if (!/input/i.test(html)) {
      issues.push({ name: 'missingInput', fix: 'Add text input element' });
    }
  }

  return issues;
}

/** GET /api/ai/credits: Get user's credit balance */
router.get('/credits', gameAuthMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const credits = await db.getUserCredits(userId);
    const canGenerate = await db.canUserGenerate(userId, false);

    res.json({
      success: true,
      credits: credits.balance,
      isPro: false,
      canGenerate: canGenerate.allowed,
      cost: db.CREDITS_PER_GENERATION
    });
  } catch (error) {
    console.error('Get credits error:', error);
    res.status(500).json({ error: 'Failed to get credits' });
  }
});

/** POST /api/ai/generate-game: Generate a playable HTML game from a prompt */
router.post('/generate-game', gameAuthMiddleware, gameGenLimiter, async (req, res) => {
  const { prompt, gameType, mode, existingHtml, sections, gameId: requestGameId } = req.body;
  const userId = req.user.sub;
  let targetGame = null;

  if (requestGameId) {
    targetGame = await db.getGameById(requestGameId);
    if (!targetGame || targetGame.creator_id !== userId) {
      return res.status(403).json({ error: 'You do not have access to this game' });
    }
  }

  const isRevision = mode === 'revise' || mode === 'fix';
  const cost = isRevision
    ? (requestGameId ? await db.getRevisionCost(requestGameId) : db.CREDITS_PER_REVISION)
    : db.CREDITS_PER_GENERATION;

  if (!prompt && !sections) {
    return res.status(400).json({ error: 'A prompt or sections are required' });
  }
  if (sections != null && (typeof sections !== 'object' || Array.isArray(sections))) {
    return res.status(400).json({ error: 'sections must be an object' });
  }

  const rawCreatorInputs = [
    { name: 'prompt', value: prompt, limit: CREATORARENA_MAX_PROMPT_CHARS },
    { name: 'mechanics', value: sections?.mechanics, limit: CREATORARENA_MAX_SECTION_CHARS },
    { name: 'graphics', value: sections?.graphics, limit: CREATORARENA_MAX_SECTION_CHARS },
    { name: 'story', value: sections?.story, limit: CREATORARENA_MAX_SECTION_CHARS }
  ];
  const invalidInput = rawCreatorInputs.find(
    field => field.value != null && typeof field.value !== 'string'
  );
  if (invalidInput) {
    return res.status(400).json({ error: `${invalidInput.name} must be text` });
  }
  const creatorInputs = rawCreatorInputs.filter(field => typeof field.value === 'string');

  const oversizedInput = creatorInputs.find(field => field.value.length > field.limit);
  if (oversizedInput) {
    return res.status(413).json({
      error: `${oversizedInput.name} is too long (maximum ${oversizedInput.limit} characters)`
    });
  }

  const combinedInputLength = creatorInputs.reduce((sum, field) => sum + field.value.length, 0);
  if (combinedInputLength > CREATORARENA_MAX_COMBINED_INPUT_CHARS) {
    return res.status(413).json({
      error: `Combined game description is too long (maximum ${CREATORARENA_MAX_COMBINED_INPUT_CHARS} characters)`
    });
  }

  if (typeof existingHtml === 'string' && existingHtml.length > 500000) {
    return res.status(413).json({ error: 'Existing game is too large to revise' });
  }

  // Revision/fix modes skip the 10-word minimum (feedback can be short)
  const isRevisionMode = mode === 'revise' || mode === 'fix';
  if (!isRevisionMode) {
    // Each non-empty field must have at least 10 words
    const countWords = (text) => (text || '').trim().split(/\s+/).filter(w => w.length > 0).length;
    const fields = [
      { name: 'prompt', text: prompt },
      { name: 'mechanics', text: sections?.mechanics },
      { name: 'graphics', text: sections?.graphics },
      { name: 'story', text: sections?.story }
    ].filter(f => f.text && f.text.trim().length > 0);

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one prompt field with 10+ words.' });
    }

    for (const field of fields) {
      if (countWords(field.text) < 10) {
        return res.status(400).json({ error: `The ${field.name} field needs at least 10 words (currently ${countWords(field.text)}).` });
      }
    }
  } else if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Please describe what you want to change.' });
  }

  // Layer 1: Word-level filter, catches slurs, sexual terms, hate speech (not gameplay words like "kill")
  const textsToCheck = [prompt, sections?.mechanics, sections?.graphics, sections?.story].filter(Boolean);
  for (const text of textsToCheck) {
    if (containsProfanityForGames(text)) {
      return res.status(400).json({ error: 'Your prompt contains inappropriate content. Please revise and try again.' });
    }
  }

  if (!anthropic) {
    return res.json({
      success: true,
      html: `<!DOCTYPE html><html><head><title>Demo Game</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#111;color:#0f0;font-family:monospace;font-size:24px;}</style></head><body><div>Game preview (API key not configured)</div></body></html>`
    });
  }

  const description = isRevision
    ? `Revision: ${(prompt || 'Game').slice(0, 50)}`
    : `Generated: ${(prompt || 'Game').slice(0, 50)}`;
  const reservation = await db.deductCredits(userId, cost, description, requestGameId || null);
  if (!reservation.success) {
    return res.status(402).json({
      error: 'Purchase CreatorArena credits to create games',
      code: 'INSUFFICIENT_CREDITS',
      credits: reservation.balance,
      cost,
      isPro: false
    });
  }

  let reservationActive = true;
  const refundReservation = async (reason) => {
    if (!reservationActive) return;
    reservationActive = false;
    try {
      await db.refundCredits(userId, cost, `CreatorArena generation refund: ${reason}`, requestGameId || null);
    } catch (refundError) {
      console.error('[GAME-GEN] Failed to refund reserved credits:', refundError.message);
    }
  };

  // Layer 2: AI-powered content moderation, catches thematic/contextual offensiveness
  if (!(isRevisionMode && CREATORARENA_SKIP_MODERATION_FOR_REVISIONS)) {
    try {
      const allText = textsToCheck.join('\n');
      const moderationRes = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        system: `You are a strict content moderation system for a family-friendly coding education platform used by minors. You must be VERY conservative. Mark as UNSAFE if the prompt contains ANY of these, even mildly:

- Racism, bigotry, stereotypes, or discrimination of any kind
- Violence, gore, torture, abuse, or cruelty
- Sexual content, kissing, dating, romance, or objectification of people
- Drug or alcohol use as a game mechanic
- Bullying, harassment, or humiliation themes
- Slavery, colonialism glorification, or historical atrocities as gameplay
- Weapons targeting people (shooting people, stabbing, etc.)
- Horror involving real-world trauma (school shootings, terrorism, etc.)
- Gambling with real-money mechanics
- Any content inappropriate for a 13-year-old audience

Games about fantasy combat (space shooters, medieval knights, zombies) are SAFE.
Games objectifying or sexualizing real people are UNSAFE.
When in doubt, mark UNSAFE.

Respond with ONLY one word: "SAFE" or "UNSAFE". Nothing else.`,
        messages: [{ role: 'user', content: allText }]
      });
      const verdict = (moderationRes.content[0]?.text || '').trim().toUpperCase();
      if (verdict === 'UNSAFE') {
        await refundReservation('content rejected');
        return res.status(400).json({ error: 'Your prompt contains themes or content that violate our community guidelines. Please revise and try again.' });
      }
    } catch (modErr) {
      // If moderation check fails, continue (don't block legitimate users due to API errors)
      console.error('[GAME-GEN] Moderation check failed:', modErr.message);
    }
  }

  try {
    const isTextGame = gameType === 'text';
    const isUpdate = mode && mode !== 'full' && existingHtml;
    const revisionHtmlContext = isUpdate ? getRevisionHtmlContext(existingHtml) : existingHtml;

    // Build the appropriate system prompt
    let systemPrompt;
    if (isUpdate) {
      systemPrompt = buildUpdateSystemPrompt(mode, revisionHtmlContext);
    } else {
      systemPrompt = buildGameSystemPrompt(isTextGame, gameType);
    }

    // Build user prompt from sections
    let userPrompt = prompt || '';
    if (sections) {
      const parts = [];
      if (sections.mechanics) parts.push(`GAME MECHANICS:\n${sections.mechanics}`);
      if (sections.graphics) parts.push(`VISUAL STYLE:\n${sections.graphics}`);
      if (sections.story) parts.push(`STORY/THEME:\n${sections.story}`);
      if (parts.length > 0) userPrompt += (userPrompt ? '\n\n' : '') + parts.join('\n\n');
    }
    // Add explicit instruction to output only HTML
    userPrompt += '\n\nIMPORTANT: Output ONLY the complete HTML file. Start with <!DOCTYPE html> and end with </html>. No other text.';

    console.log('[GAME-GEN] Generating game for user:', userId, 'Type:', gameType, 'Mode:', mode || 'full');

    // First generation attempt
    const generationModel = isRevisionMode ? CREATORARENA_REVISION_MODEL : CREATORARENA_MODEL;
    const maxTokens = isRevisionMode ? CREATORARENA_REVISION_MAX_TOKENS : CREATORARENA_MAX_TOKENS;

    let response = await anthropic.messages.create({
      model: generationModel,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    let html = extractHtmlFromResponse(response.content[0]?.text);

    // Validate the generated HTML
    const validationIssues = validateGeneratedGame(html, isTextGame);

    // If critical issues found, attempt a fix pass
    if (validationIssues.length > 0) {
      console.log('[GAME-GEN] Validation issues found:', validationIssues.map(i => i.name).join(', '));

      // Apply automatic fixes first
      html = autoFixHtml(html);

      // Re-validate after auto-fix
      const remainingIssues = validateGeneratedGame(html, isTextGame);

      // If still has critical issues, do a repair pass
      const criticalIssues = remainingIssues.filter(i =>
        ['hasScript', 'hasGameLoop', 'missingCanvas', 'missingInput'].includes(i.name)
      );

      if (criticalIssues.length > 0 && !isUpdate) {
        console.log('[GAME-GEN] Critical issues remain, attempting repair pass');

        const repairPrompt = `The following HTML game has issues that need to be fixed:

ISSUES FOUND:
${criticalIssues.map(i => `- ${i.name}: ${i.fix}`).join('\n')}

CURRENT HTML:
${html}

Fix these issues and output ONLY the corrected HTML. No explanation, no markdown.`;

        try {
          const repairResponse = await anthropic.messages.create({
            model: CREATORARENA_REVISION_MODEL,
            max_tokens: CREATORARENA_REPAIR_MAX_TOKENS,
            system: 'You are a code repair AI. Fix the HTML game code to make it work. Output ONLY the fixed HTML.',
            messages: [{ role: 'user', content: repairPrompt }]
          });

          const repairedHtml = extractHtmlFromResponse(repairResponse.content[0]?.text);

          // CRITIC FIX: Re-validate repaired HTML against full checklist, not just basic checks
          const repairedIssues = validateGeneratedGame(repairedHtml, isTextGame);
          const repairedCriticalIssues = repairedIssues.filter(i =>
            ['hasScript', 'hasGameLoop', 'missingCanvas', 'missingInput'].includes(i.name)
          );

          // Only use repaired version if it has fewer critical issues
          if (repairedCriticalIssues.length < criticalIssues.length ||
              (repairedCriticalIssues.length === 0 && /<html/i.test(repairedHtml) && /<script>/i.test(repairedHtml))) {
            html = repairedHtml;
            console.log('[GAME-GEN] Repair pass completed, issues reduced from', criticalIssues.length, 'to', repairedCriticalIssues.length);
          } else {
            console.log('[GAME-GEN] Repair pass did not improve issues, keeping original');
          }
        } catch (repairErr) {
          console.error('[GAME-GEN] Repair pass failed:', repairErr.message);
          // Continue with original HTML
        }
      }
    }

    // Final validation
    if (!/<html/i.test(html) && !/<!DOCTYPE/i.test(html) && !/<head/i.test(html) && !/<body/i.test(html)) {
      console.log('[GAME-GEN] No valid HTML in response. First 300 chars:', html.substring(0, 300));
      await refundReservation('invalid model output');
      return res.status(400).json({ error: 'Unable to generate this game. Your prompt may contain inappropriate content or be too vague. Please revise and try again.' });
    }

    // Apply final auto-fixes
    html = autoFixHtml(html);

    // Increment revision count if this was a revision
    if (isRevision && requestGameId) {
      await db.incrementRevisionCount(requestGameId);
    }

    // Do not persist revisions here. The editor must keep generated HTML as an
    // explicit unsaved draft until the creator presses Save. Persisting only a
    // game_versions row here allowed verification/publish to approve that row
    // while Gallery still served the older games.html_content value.

    reservationActive = false;
    const creditsRemaining = reservation.balance;

    // Complete referral (grants credits to referrer on first game creation)
    try {
      const referralResult = await db.completeReferral(userId);
      if (referralResult && referralResult.bonus > 0) {
        console.log(`[REFERRAL] Completed: referrer ${referralResult.referrerId} earned ${referralResult.bonus} credits`);

        // Send email notification to referrer
        try {
          const referrer = await db.getUserById(referralResult.referrerId);
          const referee = await db.getUserById(userId);
          const referrerCredits = await db.getUserCredits(referralResult.referrerId);

          if (referrer?.email) {
            await sendReferralCompletedEmail({
              to: referrer.email,
              referrerUsername: referrer.username,
              refereeUsername: referee?.username || 'A friend',
              creditsEarned: referralResult.bonus,
              totalCredits: referrerCredits?.balance || referralResult.bonus
            });
            console.log(`[REFERRAL] Email sent to ${referrer.email}`);
          }
        } catch (emailErr) {
          console.error('[REFERRAL] Email send error:', emailErr.message);
          // Don't fail if email fails
        }
      }
    } catch (refErr) {
      console.error('[REFERRAL] Error completing referral:', refErr);
      // Don't fail game generation if referral fails
    }

    console.log('[GAME-GEN] Success. HTML size:', html.length, 'bytes');
    // Calculate next revision cost for the frontend
    let nextRevisionCost = 0;
    let freeRevisionsLeft = db.FREE_REVISIONS_PER_GAME;
    if (requestGameId) {
      const gameAfter = await db.getGameById(requestGameId);
      if (gameAfter) {
        const revCount = gameAfter.revision_count || 0;
        freeRevisionsLeft = Math.max(0, db.FREE_REVISIONS_PER_GAME - revCount);
        nextRevisionCost = freeRevisionsLeft > 0 ? 0 : db.CREDITS_PER_REVISION;
      }
    }

    res.json({ success: true, html, credits: creditsRemaining, isPro: false, revisionCost: nextRevisionCost, freeRevisionsLeft });
  } catch (error) {
    console.error('Game generation error:', error?.message || error);
    await refundReservation(error?.message || 'generation failed');
    if (error?.status === 429) {
      return res.status(429).json({ error: 'AI rate limit reached. Please wait a moment and try again.' });
    }
    if (error?.message?.includes('timeout') || error?.message?.includes('ETIMEDOUT')) {
      return res.status(504).json({ error: 'Game generation timed out. Try a simpler prompt or try again.' });
    }
    if (error?.error?.type === 'overloaded_error') {
      return res.status(503).json({ error: 'AI service is temporarily overloaded. Please try again in a minute.' });
    }
    res.status(500).json({ error: 'Failed to generate game. This may be due to high demand, please try again.' });
  }
});

// ============================================
// REFERRAL SYSTEM
// ============================================

/** GET /api/ai/referral: Get user's referral code and stats */
router.get('/referral', gameAuthMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const stats = await db.getReferralStats(userId);
    const recentReferrals = await db.getRecentReferrals(userId, 5);

    res.json({
      success: true,
      ...stats,
      recentReferrals: recentReferrals.map(r => ({
        username: r.referee_username,
        status: r.status,
        createdAt: r.created_at,
        completedAt: r.completed_at
      }))
    });
  } catch (error) {
    console.error('Get referral stats error:', error);
    res.status(500).json({ error: 'Failed to get referral info' });
  }
});

/** GET /api/ai/referral/validate/:code: Validate a referral code (public) */
router.get('/referral/validate/:code', async (req, res) => {
  try {
    const { code } = req.params;
    if (!code || code.length < 6) {
      return res.json({ valid: false });
    }

    const referrer = await db.getReferrerByCode(code);
    res.json({
      valid: !!referrer,
      referrerUsername: referrer?.username || null,
      bonus: db.REFERRAL_BONUS_CREDITS
    });
  } catch (error) {
    console.error('Validate referral code error:', error);
    res.json({ valid: false });
  }
});

module.exports = router;

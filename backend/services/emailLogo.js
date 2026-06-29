/**
 * Canonical CodeArena email logo, mint C-mark + wordmark.
 *
 * Mirrors frontend/components/Logo.js so emails match the in-app brand.
 * Path data and stroke color are intentionally identical.
 *
 * The mark is inline SVG (Gmail / Apple Mail / iOS Mail render it). Outlook's
 * Word renderer ignores SVG and falls back to the "CodeArena" wordmark text,
 * which keeps brand recognition intact even on the weakest client.
 *
 * Usage in an email template:
 *
 *   const { getEmailLogoHtml } = require('./emailLogo');
 *   ...
 *   <table role="presentation" ...>
 *     ${getEmailLogoHtml()}
 *     ... rest of email ...
 *   </table>
 */

const MARK_PATH =
  'M390 388 L124 388 L124 124 L390 124 L390 184 L208 184 L208 328 L390 328 Z';
const MARK_STROKE = '#5EEAD4';

/**
 * Returns an email-safe <tr> containing the CodeArena logo.
 *
 * @param {object} [opts]
 * @param {'left'|'center'} [opts.align='left'] - Horizontal alignment.
 * @param {number} [opts.iconSize=32] - SVG render size in px.
 * @param {boolean} [opts.wordmark=true] - Show "CodeArena" text next to mark.
 * @param {string} [opts.wordmarkColor='#FAFAFA'] - Wordmark text color.
 * @param {string} [opts.padding='24px 0 32px'] - Cell padding.
 */
function getEmailLogoHtml({
  align = 'left',
  iconSize = 32,
  wordmark = true,
  wordmarkColor = '#FAFAFA',
  padding = '24px 0 32px'
} = {}) {
  const svg = `<svg width="${iconSize}" height="${iconSize}" viewBox="92 92 328 328" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; display: inline-block;" aria-hidden="true"><path d="${MARK_PATH}" stroke="${MARK_STROKE}" stroke-width="40" stroke-linejoin="round" stroke-linecap="round" fill="none"></path></svg>`;

  const text = wordmark
    ? `<span style="color: ${wordmarkColor}; font-size: 20px; font-weight: 700; vertical-align: middle; margin-left: 10px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">CodeArena</span>`
    : '';

  return `
  <tr>
    <td align="${align}" style="padding: ${padding};">
      ${svg}${text}
    </td>
  </tr>`;
}

/**
 * Returns just the inline mark + wordmark (no <tr> wrapper), for templates
 * that put the logo inside an existing row alongside other content.
 */
function getEmailLogoInline({
  iconSize = 28,
  wordmark = true,
  wordmarkColor = '#FAFAFA'
} = {}) {
  const svg = `<svg width="${iconSize}" height="${iconSize}" viewBox="92 92 328 328" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; display: inline-block;" aria-hidden="true"><path d="${MARK_PATH}" stroke="${MARK_STROKE}" stroke-width="40" stroke-linejoin="round" stroke-linecap="round" fill="none"></path></svg>`;
  const text = wordmark
    ? `<span style="color: ${wordmarkColor}; font-size: 18px; font-weight: 700; vertical-align: middle; margin-left: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">CodeArena</span>`
    : '';
  return `${svg}${text}`;
}

/**
 * Plain-text equivalent for the text/plain email body.
 */
function getEmailLogoText() {
  return 'CodeArena';
}

module.exports = {
  getEmailLogoHtml,
  getEmailLogoInline,
  getEmailLogoText,
  MARK_PATH,
  MARK_STROKE
};

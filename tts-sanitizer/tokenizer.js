'use strict';

/**
 * Simple linear tokenizer.
 * Splits cleaned text into words while preserving basic punctuation
 * as separate tokens when useful for TTS rhythm.
 */

/**
 * Tokenize a cleaned string into an array of word-like tokens.
 * Punctuation that is useful for TTS (.,!?…) is kept as its own token.
 * Everything else is discarded or treated as whitespace.
 *
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text) return [];

  const tokens = [];
  let current = '';

  for (const ch of text) {
    if (/\p{L}|\p{N}/u.test(ch)) {
      current += ch;
    } else if (/[.,!?;:…—–]/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      // Keep single meaningful punctuation
      tokens.push(ch);
    } else {
      // whitespace or other symbols → word boundary
      if (current) {
        tokens.push(current);
        current = '';
      }
    }
  }

  if (current) tokens.push(current);
  return tokens;
}

/**
 * Rebuild a readable string from tokens, collapsing excess spaces.
 * Punctuation attaches to the preceding word; a space is inserted
 * after punctuation before the next word.
 * @param {string[]} tokens
 * @returns {string}
 */
function rebuild(tokens) {
  if (!tokens || tokens.length === 0) return '';

  let result = '';
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;

    const isPunct = /^[.,!?;:…—–]$/.test(tok);

    if (isPunct) {
      // Attach directly to previous token
      result += tok;
    } else {
      // Space before word unless we are at the start
      // or the previous character is already whitespace
      if (result.length > 0 && !/\s$/.test(result)) {
        result += ' ';
      }
      result += tok;
    }
  }

  return result.replace(/\s+/g, ' ').trim();
}

module.exports = {
  tokenize,
  rebuild,
};

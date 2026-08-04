'use strict';

const { tokenize, rebuild } = require('./tokenizer');
const { normalizeWord, cleanWordForDisplay, isNoisyWord } = require('./normalizer');
const { computeFeatures, lowEntropyScore, wordRepetitionScore } = require('./entropy');
const { runAllDetectors, applyActions } = require('./detectors');
const { onlyLetters, clamp } = require('./utils');

/**
 * Configuration constants – no magic numbers scattered in logic.
 */
const CONFIG = {
  /** Hard limit on final string length (characters). */
  DEFAULT_MAX_LENGTH: 200,

  /** Maximum length of a single word before forced truncation. */
  MAX_WORD_LENGTH: 18,

  /** Score thresholds that decide cleaning aggressiveness. */
  SCORE: {
    LIGHT: 0.25,   // mild cleaning only
    MEDIUM: 0.45,  // apply detectors
    HEAVY: 0.7,    // aggressive collapse + early exit possible
  },

  /** Minimum letter count before entropy analysis kicks in. */
  MIN_LETTERS_FOR_ENTROPY: 18,

  /** If after cleaning nothing readable remains, return empty. */
  MIN_READABLE_CHARS: 1,
};

/**
 * Remove Discord-specific markup and most non-speech content.
 * Uses a small set of focused replacements; each does one job.
 * Order matters: code blocks before inline code, etc.
 *
 * @param {string} text
 * @returns {string}
 */
function cleanDiscordMarkup(text) {
  if (!text) return '';

  let out = text;

  // Multi-line code blocks (``` … ```)
  out = out.replace(/```[\s\S]*?```/g, ' ');

  // Inline code (`…`)
  out = out.replace(/`[^`]*`/g, ' ');

  // Markdown links [label](url) → keep label
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Bare URLs
  out = out.replace(/https?:\/\/\S+/gi, ' ');

  // Discord timestamps <t:…>
  out = out.replace(/<t:\d+(?::[tTdDfFR])?>/g, ' ');

  // Custom emoji <:name:id> or <a:name:id> → keep name only
  out = out.replace(/<a?:([a-zA-Z0-9_]+):\d+>/g, '$1');

  // User mentions <@id> / <@!id>
  out = out.replace(/<@!?\d+>/g, ' ');

  // Role mentions <@&id>
  out = out.replace(/<@&\d+>/g, ' ');

  // Channel mentions <#id>
  out = out.replace(/<#\d+>/g, ' ');

  // Remaining Discord-style tags
  out = out.replace(/<\/?[a-zA-Z0-9_:-]+>/g, ' ');

  // Unicode emoji (Extended_Pictographic)
  out = out.replace(/\p{Extended_Pictographic}/gu, ' ');

  // Zero-width and other invisible characters
  out = out.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');

  // Keep letters, numbers, basic punctuation and whitespace; drop the rest
  out = out.replace(/[^\p{L}\p{N}\s.,!?;:'"«»…—–-]/gu, ' ');

  // Collapse whitespace early
  out = out.replace(/\s+/g, ' ').trim();

  return out;
}

/**
 * Per-token cleaning pass: collapse internal repeats and truncate long words.
 * @param {string[]} tokens
 * @returns {string[]}
 */
function cleanTokens(tokens) {
  return tokens.map((tok) => {
    if (/^[.,!?;:…—–]$/.test(tok)) return tok;
    return cleanWordForDisplay(tok, { maxWordLen: CONFIG.MAX_WORD_LENGTH });
  });
}

/**
 * Compute an overall spam score in [0, 1] from features + detector signals.
 * @param {object} features
 * @param {number} detectorActionCount
 * @returns {number}
 */
function computeSpamScore(features, detectorActionCount) {
  let score = 0;

  score += lowEntropyScore(features) * 0.55;
  score += wordRepetitionScore(features) * 0.35;

  // Detector activity itself is a strong signal
  if (detectorActionCount >= 3) score += 0.35;
  else if (detectorActionCount >= 1) score += 0.15;

  // Extreme average word length
  if (features.avgWordLen > 14) score += 0.2;
  else if (features.avgWordLen > 10) score += 0.1;

  // High digit ratio often indicates generated spam
  if (features.digitRatio > 0.25 && features.tokenCount > 3) score += 0.15;

  return clamp(score, 0, 1);
}

/**
 * Decide how aggressively to clean based on score.
 * @param {number} score
 * @returns {'none'|'light'|'medium'|'heavy'}
 */
function decideAggressiveness(score) {
  if (score >= CONFIG.SCORE.HEAVY) return 'heavy';
  if (score >= CONFIG.SCORE.MEDIUM) return 'medium';
  if (score >= CONFIG.SCORE.LIGHT) return 'light';
  return 'none';
}

/**
 * Main sanitization pipeline.
 *
 * Pipeline stages (each is a pure transformation):
 * 1. cleanDiscordMarkup
 * 2. tokenize
 * 3. cleanTokens          (char/syllable collapse + length limit)
 * 4. run detectors + apply collapses according to spam score
 * 5. rebuild
 * 6. final length & emptiness guard
 *
 * @param {string} text - raw Discord message
 * @param {number} [maxLength=200]
 * @returns {string} text safe for TTS
 */
function sanitizeText(text, maxLength = CONFIG.DEFAULT_MAX_LENGTH) {
  if (text == null || typeof text !== 'string') return '';
  if (text.length === 0) return '';

  // ── Stage 1: Discord markup removal ──────────────────────────────
  let cleaned = cleanDiscordMarkup(text);
  if (!cleaned) return '';

  // Early exit only for pure single-character (or almost pure) spam
  // with no word boundaries. Messages that still contain spaces are
  // handled by the normal pipeline so that "сссссер" can be cleaned
  // into a readable word instead of being truncated.
  const letters = onlyLetters(cleaned);
  if (letters.length >= CONFIG.MIN_LETTERS_FOR_ENTROPY && !/\s/.test(cleaned)) {
    const unique = new Set(letters.toLocaleLowerCase('ru-RU')).size;
    if (unique <= 2) {
      // Classic "аааааааа" style
      return letters.slice(0, 8) + '…';
    }
  }

  // ── Stage 2: Tokenize ────────────────────────────────────────────
  let tokens = tokenize(cleaned);
  if (tokens.length === 0) return '';

  // ── Stage 3: Per-word cleaning ───────────────────────────────────
  tokens = cleanTokens(tokens);

  // Drop pure-noise tokens (mostly digits after a short letter prefix)
  tokens = tokens.filter((t) => {
    if (/^[.,!?;:…—–]$/.test(t)) return true;
    return !isNoisyWord(t);
  });

  if (tokens.length === 0) return '';

  // ── Stage 4: Feature extraction + detectors ──────────────────────
  const bases = tokens.map((t) =>
    /^[.,!?;:…—–]$/.test(t) ? t : normalizeWord(t)
  );
  const features = computeFeatures(cleaned, bases);
  const actions = runAllDetectors(tokens);
  const spamScore = computeSpamScore(features, actions.length);
  const level = decideAggressiveness(spamScore);

  // Detectors already found concrete spam patterns — apply them.
  // Score only modulates how aggressive we are with borderline actions.
  if (actions.length > 0) {
    if (level === 'heavy' || level === 'medium' || level === 'light') {
      tokens = applyActions(tokens, actions);
    } else {
      // Even on "none" still apply very strong detections
      const strong = actions.filter((a) => a.strength >= 0.6);
      if (strong.length > 0) {
        tokens = applyActions(tokens, strong);
      }
    }
  }

  // ── Stage 5: Rebuild ─────────────────────────────────────────────
  let result = rebuild(tokens);

  // Final safety: collapse any residual multi-spaces
  result = result.replace(/\s+/g, ' ').trim();

  // If nothing readable left
  if (!/[\p{L}\p{N}]/u.test(result)) return '';

  // ── Stage 6: Hard length limit ───────────────────────────────────
  if (result.length > maxLength) {
    result = result.slice(0, maxLength).trim() + '…';
  }

  return result;
}

module.exports = {
  sanitizeText,
  cleanDiscordMarkup,
  CONFIG,
};

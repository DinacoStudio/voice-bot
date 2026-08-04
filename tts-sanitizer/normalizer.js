'use strict';

const {
  toLower,
  collapseCharRepeats,
  collapseSyllableRepeats,
  truncateLongWord,
  isLetter,
  isDigit,
} = require('./utils');

/**
 * Word normalization: turn noisy variants into a stable base form
 * so that "приветA01", "приветB999", "привееееет" all map to the same key.
 */

/**
 * Strip trailing/leading non-letter noise and collapse internal repeats.
 * Produces a "base form" used for similarity detection.
 *
 * Examples:
 *   приветA01  → привет
 *   приветB999 → привет
 *   HELLO123   → hello
 *   сссссер    → сер
 *   привееееет → привет
 *
 * @param {string} word - original token
 * @returns {string} normalized base form (lowercase, letters only, collapsed)
 */
function normalizeWord(word) {
  if (!word) return '';

  // First pass: keep letters only
  let base = '';
  for (const ch of word) {
    if (isLetter(ch)) base += ch;
  }

  if (base.length === 0) {
    // Pure numeric or symbol token – keep a short version
    return word.slice(0, 6);
  }

  base = toLower(base);
  base = collapseCharRepeats(base, 2);
  base = collapseSyllableRepeats(base, 2);

  // Strip short trailing "noise" letters that often appear in spam suffixes
  // (single latin letter after a long cyrillic stem, or vice-versa)
  if (base.length >= 5) {
    const cyr = /[а-яё]/u;
    const lat = /[a-z]/;
    const last = base[base.length - 1];
    const rest = base.slice(0, -1);
    if (
      (cyr.test(rest) && lat.test(last)) ||
      (lat.test(rest) && cyr.test(last))
    ) {
      base = rest;
    }
  }

  // Extremely long base → truncate for safety
  if (base.length > 24) {
    base = base.slice(0, 16);
  }

  return base;
}

/**
 * Produce a display-ready version of a single word:
 * collapse char/syllable spam, truncate if absurdly long.
 * Does NOT strip digits (they may be meaningful, e.g. "год2024").
 * @param {string} word
 * @param {object} options
 * @param {number} [options.maxWordLen=18]
 * @returns {string}
 */
function cleanWordForDisplay(word, options = {}) {
  const maxWordLen = options.maxWordLen ?? 18;

  if (!word) return '';

  let cleaned = collapseCharRepeats(word, 2);
  cleaned = collapseSyllableRepeats(cleaned, 2);
  cleaned = truncateLongWord(cleaned, maxWordLen);

  // Guard against long runs of consonants or vowels that survived
  // (rare after collapse, but possible with mixed scripts)
  if (cleaned.length > 12) {
    const lower = toLower(cleaned);
    const hasLongConsonantRun = /[бвгджзйклмнпрстфхцчшщbcdfghjklmnpqrstvwxz]{7,}/u.test(lower);
    const hasLongVowelRun = /[аеёиоуыэюяaeiouy]{7,}/u.test(lower);
    if (hasLongConsonantRun || hasLongVowelRun) {
      cleaned = cleaned.slice(0, 8) + '…';
    }
  }

  return cleaned;
}

/**
 * Decide whether a word is pure noise that should be dropped entirely
 * (almost no letters, mostly digits/symbols). Words like "abc001" are
 * kept so detectors can still see the pattern; they will be collapsed later.
 * @param {string} word
 * @returns {boolean}
 */
function isNoisyWord(word) {
  if (word.length < 5) return false;

  let letters = 0;
  let digits = 0;
  for (const ch of word) {
    if (isLetter(ch)) letters++;
    else if (isDigit(ch)) digits++;
  }

  // Only drop tokens that are overwhelmingly digits with almost no letters
  if (letters <= 1 && digits >= 4) return true;
  if (letters === 0 && word.length >= 5) return true;

  return false;
}

module.exports = {
  normalizeWord,
  cleanWordForDisplay,
  isNoisyWord,
};

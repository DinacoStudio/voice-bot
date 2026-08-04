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

  // Strip typical spam suffixes from the raw token first.
  // Only remove a trailing "letter(s)+digits" or pure-digits tail —
  // never peel letters off a pure alphabetic word.
  let stripped = word;
  if (/\p{N}/u.test(word)) {
    // Has digits: remove trailing digits, then a short letter prefix of those digits
    // e.g. "приветA01" → "приветA" → "привет"
    // e.g. "hello42"   → "hello"
    // e.g. "abc001"    → "abc"
    stripped = stripped.replace(/[\p{N}]+$/u, '');
    // If what remains ends with 1–3 letters that look like a spam tag
    // (short relative to stem), drop them.
    stripped = stripped.replace(/(\p{L}{1,3})$/u, (suffix, offset) => {
      if (offset >= 4) return '';
      return suffix;
    });
  }

  // Keep only letters for the base form
  let base = '';
  for (const ch of stripped) {
    if (isLetter(ch)) base += ch;
  }

  if (base.length === 0) {
    // Pure numeric or symbol token – keep a short version
    return word.slice(0, 6);
  }

  base = toLower(base);
  base = collapseCharRepeats(base, 2);
  base = collapseSyllableRepeats(base, 2);

  // Strip trailing mixed-script noise (cyr stem + latin tail, or vice-versa)
  if (base.length >= 4) {
    const isCyr = (ch) => /[а-яё]/u.test(ch);
    const isLat = (ch) => /[a-z]/.test(ch);

    let cyrCount = 0;
    let latCount = 0;
    const half = Math.ceil(base.length / 2);
    for (let i = 0; i < half; i++) {
      if (isCyr(base[i])) cyrCount++;
      else if (isLat(base[i])) latCount++;
    }
    const stemIsCyr = cyrCount >= latCount;

    while (base.length >= 4) {
      const last = base[base.length - 1];
      const lastIsForeign = stemIsCyr ? isLat(last) : isCyr(last);
      if (!lastIsForeign) break;
      base = base.slice(0, -1);
    }
  }

  // Strip trailing spam tag letter when the ORIGINAL token is mixed-case:
  // lowercase stem + uppercase tail letter (бляА, блюГ, helloX).
  // Does NOT touch ALL-CAPS words (HELLO) or normal Title Case (Hello).
  if (word.length >= 4) {
    const lastOrig = word[word.length - 1];
    if (isLetter(lastOrig)) {
      const isUpper =
        lastOrig === lastOrig.toLocaleUpperCase('ru-RU') &&
        lastOrig !== lastOrig.toLocaleLowerCase('ru-RU');
      // Require at least one lowercase letter in the stem portion
      const stemOrig = word.slice(0, -1);
      const hasLower = [...stemOrig].some((ch) => {
        if (!isLetter(ch)) return false;
        return (
          ch === ch.toLocaleLowerCase('ru-RU') &&
          ch !== ch.toLocaleUpperCase('ru-RU')
        );
      });
      if (isUpper && hasLower && base.length >= 4) {
        const prev = base[base.length - 2];
        const last = base[base.length - 1];
        if (last !== prev) {
          base = base.slice(0, -1);
        }
      }
    }
  }

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

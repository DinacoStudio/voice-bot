'use strict';

/**
 * Shared utility helpers for the TTS sanitizer.
 * All functions are pure and side-effect free.
 */

/**
 * Clamp a number between min and max.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Count occurrences of each item in an array.
 * @template T
 * @param {T[]} items
 * @returns {Map<T, number>}
 */
function frequencyMap(items) {
  const map = new Map();
  for (const item of items) {
    map.set(item, (map.get(item) || 0) + 1);
  }
  return map;
}

/**
 * Shannon entropy of a sequence of tokens (characters or words).
 * @param {string[]|string} sequence - array of tokens or a string (treated as chars)
 * @returns {number} entropy in bits
 */
function shannonEntropy(sequence) {
  if (!sequence || sequence.length === 0) return 0;

  const tokens = typeof sequence === 'string' ? [...sequence] : sequence;
  const freq = frequencyMap(tokens);
  const total = tokens.length;
  let entropy = 0;

  for (const count of freq.values()) {
    const p = count / total;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Ratio of unique items to total items.
 * @param {string[]|string} sequence
 * @returns {number} value in [0, 1]
 */
function uniquenessRatio(sequence) {
  if (!sequence || sequence.length === 0) return 0;
  const tokens = typeof sequence === 'string' ? [...sequence] : sequence;
  return new Set(tokens).size / tokens.length;
}

/**
 * Extract only letter characters (Unicode letters).
 * @param {string} text
 * @returns {string}
 */
function onlyLetters(text) {
  return text.replace(/[^\p{L}]/gu, '');
}

/**
 * Check whether a character is a Unicode letter.
 * @param {string} char
 * @returns {boolean}
 */
function isLetter(char) {
  return /\p{L}/u.test(char);
}

/**
 * Check whether a character is a Unicode digit.
 * @param {string} char
 * @returns {boolean}
 */
function isDigit(char) {
  return /\p{N}/u.test(char);
}

/**
 * Safe lowercase that works for Cyrillic and Latin.
 * @param {string} str
 * @returns {string}
 */
function toLower(str) {
  return str.toLocaleLowerCase('ru-RU');
}

/**
 * Longest common prefix length of two strings (case-insensitive).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function commonPrefixLength(a, b) {
  const la = toLower(a);
  const lb = toLower(b);
  const minLen = Math.min(la.length, lb.length);
  let i = 0;
  while (i < minLen && la[i] === lb[i]) i++;
  return i;
}

/**
 * Longest common suffix length of two strings (case-insensitive).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function commonSuffixLength(a, b) {
  const la = toLower(a);
  const lb = toLower(b);
  const minLen = Math.min(la.length, lb.length);
  let i = 0;
  while (i < minLen && la[la.length - 1 - i] === lb[lb.length - 1 - i]) i++;
  return i;
}

/**
 * Collapse consecutive identical characters down to `max` repeats.
 * Linear pass, O(n).
 * @param {string} word
 * @param {number} max
 * @returns {string}
 */
function collapseCharRepeats(word, max = 2) {
  if (word.length <= max) return word;

  let result = '';
  let prev = '';
  let count = 0;

  for (const ch of word) {
    if (ch === prev) {
      count++;
      if (count <= max) result += ch;
    } else {
      prev = ch;
      count = 1;
      result += ch;
    }
  }
  return result;
}

/**
 * Detect and collapse simple syllable / digram repeats.
 * e.g. "ахахахахах" → "ахах", "lolololol" → "lolol"
 * Uses a linear scan looking for repeated short patterns of length 2-4.
 * @param {string} word
 * @param {number} maxRepeats - how many times the pattern may stay
 * @returns {string}
 */
function collapseSyllableRepeats(word, maxRepeats = 2) {
  if (word.length < 6) return word;

  const lower = toLower(word);
  // Try pattern lengths from 2 to 4
  for (let patLen = 2; patLen <= 4; patLen++) {
    if (word.length < patLen * (maxRepeats + 1)) continue;

    const pattern = lower.slice(0, patLen);
    let repeats = 1;
    let pos = patLen;

    while (pos + patLen <= lower.length && lower.slice(pos, pos + patLen) === pattern) {
      repeats++;
      pos += patLen;
    }

    // If the whole (or almost whole) word is made of this pattern
    if (repeats >= maxRepeats + 1 && pos >= word.length * 0.8) {
      return word.slice(0, patLen * maxRepeats);
    }
  }
  return word;
}

/**
 * Truncate a word that is unreasonably long, keeping a readable prefix.
 * @param {string} word
 * @param {number} maxLen
 * @returns {string}
 */
function truncateLongWord(word, maxLen = 18) {
  if (word.length <= maxLen) return word;
  return word.slice(0, Math.max(6, Math.floor(maxLen * 0.6))) + '…';
}

module.exports = {
  clamp,
  frequencyMap,
  shannonEntropy,
  uniquenessRatio,
  onlyLetters,
  isLetter,
  isDigit,
  toLower,
  commonPrefixLength,
  commonSuffixLength,
  collapseCharRepeats,
  collapseSyllableRepeats,
  truncateLongWord,
};

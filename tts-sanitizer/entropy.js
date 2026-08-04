'use strict';

const {
  shannonEntropy,
  uniquenessRatio,
  onlyLetters,
  frequencyMap,
  toLower,
} = require('./utils');

/**
 * Text feature extraction and entropy-based spam signals.
 * All metrics are computed in linear time.
 */

const VOWELS_RE = /[аеёиоуыэюяaeiouy]/u;
const CONSONANTS_RE = /[бвгджзйклмнпрстфхцчшщbcdfghjklmnpqrstvwxz]/u;

/**
 * Heuristic: does this single token look like keyboard gibberish?
 * @param {string} token
 * @returns {boolean}
 */
function isGibberishToken(token) {
  if (!token || token.length < 2) return false;
  if (/^[.,!?;:…—–]$/.test(token)) return false;

  const lower = toLower(token);
  const letters = onlyLetters(lower);
  if (letters.length < 2) return true; // pure noise fragment

  let vowels = 0;
  let consonants = 0;
  for (const ch of letters) {
    if (VOWELS_RE.test(ch)) vowels++;
    else if (CONSONANTS_RE.test(ch)) consonants++;
  }

  const letterCount = letters.length;

  // No vowels at all in a 4+ letter token
  if (letterCount >= 4 && vowels === 0) return true;

  // Extremely low vowel ratio
  if (letterCount >= 5 && vowels / letterCount < 0.12) return true;

  // Alternating short consonant soup mixed with digits
  if (letterCount >= 3 && /\d/.test(token) && vowels <= 1) return true;

  // Long run of consonants inside the token
  if (/[бвгджзйклмнпрстфхцчшщbcdfghjklmnpqrstvwxz]{5,}/u.test(lower)) return true;

  return false;
}

/**
 * Compute a rich set of statistical features for a message.
 * @param {string} text - already cleaned Discord markup, still may contain spam
 * @param {string[]} tokens - tokenized words (lowercased base forms preferred)
 * @returns {object} feature vector
 */
function computeFeatures(text, tokens) {
  const letters = onlyLetters(text);
  const letterLen = letters.length;
  const tokenCount = tokens.length;

  // Character-level
  const charEntropy = shannonEntropy(letters);
  const charUniqueness = uniquenessRatio(letters);

  // Bigrams / trigrams (character level)
  const bigrams = [];
  const trigrams = [];
  for (let i = 0; i < letterLen - 1; i++) {
    bigrams.push(letters.slice(i, i + 2));
    if (i < letterLen - 2) {
      trigrams.push(letters.slice(i, i + 3));
    }
  }
  const bigramUniqueness = uniquenessRatio(bigrams);
  const trigramUniqueness = uniquenessRatio(trigrams);

  // Word-level (exclude pure punctuation tokens)
  const wordTokensOnly = tokens.filter((t) => !/^[.,!?;:…—–]$/.test(t));
  const wordEntropy =
    wordTokensOnly.length > 0 ? shannonEntropy(wordTokensOnly) : 0;
  const wordUniqueness = uniquenessRatio(wordTokensOnly);

  // Average word length
  const avgWordLen =
    wordTokensOnly.length > 0
      ? wordTokensOnly.reduce((sum, t) => sum + t.length, 0) /
        wordTokensOnly.length
      : 0;

  // Character class ratios (on original cleaned text for digits / scripts)
  let digitCount = 0;
  let latinCount = 0;
  let cyrillicCount = 0;
  let punctCount = 0;
  let vowelCount = 0;
  let consonantCount = 0;

  for (const ch of text) {
    if (/\p{N}/u.test(ch)) digitCount++;
    else if (/[a-zA-Z]/.test(ch)) latinCount++;
    else if (/[а-яА-ЯёЁ]/.test(ch)) cyrillicCount++;
    else if (/[.,!?;:'"«»…—–\-\/\\]/.test(ch)) punctCount++;

    if (VOWELS_RE.test(ch)) vowelCount++;
    else if (CONSONANTS_RE.test(ch)) consonantCount++;
  }

  const totalChars = Math.max(1, text.length);
  const digitRatio = digitCount / totalChars;
  const latinRatio = latinCount / totalChars;
  const cyrillicRatio = cyrillicCount / totalChars;
  const punctRatio = punctCount / totalChars;

  const vcTotal = Math.max(1, vowelCount + consonantCount);
  const vowelRatio = vowelCount / vcTotal;

  // Gibberish token ratio
  let gibberishTokens = 0;
  let realWordTokens = 0;
  for (const t of tokens) {
    if (/^[.,!?;:…—–]$/.test(t)) continue;
    realWordTokens++;
    if (isGibberishToken(t)) gibberishTokens++;
  }
  const gibberishRatio =
    realWordTokens > 0 ? gibberishTokens / realWordTokens : 0;

  // Max frequency of any single word token (punctuation excluded)
  const freq = frequencyMap(wordTokensOnly);
  let maxTokenFreq = 0;
  for (const count of freq.values()) {
    if (count > maxTokenFreq) maxTokenFreq = count;
  }
  const maxTokenRatio =
    wordTokensOnly.length > 0 ? maxTokenFreq / wordTokensOnly.length : 0;

  // Short fragment density: many 1–3 letter tokens
  let shortTokens = 0;
  for (const t of tokens) {
    if (!/^[.,!?;:…—–]$/.test(t) && t.length <= 3) shortTokens++;
  }
  const shortTokenRatio =
    realWordTokens > 0 ? shortTokens / realWordTokens : 0;

  return {
    charEntropy,
    charUniqueness,
    bigramUniqueness,
    trigramUniqueness,
    wordEntropy,
    wordUniqueness,
    avgWordLen,
    tokenCount,
    letterLen,
    digitRatio,
    latinRatio,
    cyrillicRatio,
    punctRatio,
    vowelRatio,
    gibberishRatio,
    shortTokenRatio,
    maxTokenRatio,
    uniqueTokenCount: freq.size,
    realWordTokens,
  };
}

/**
 * Low-entropy / repetitive character spam detector.
 * Returns a score contribution in [0, 1].
 * @param {object} features
 * @returns {number}
 */
function lowEntropyScore(features) {
  let score = 0;

  // Extremely low character entropy on a reasonably long string
  if (features.letterLen >= 20) {
    if (features.charEntropy < 1.5) score += 0.7;
    else if (features.charEntropy < 2.2) score += 0.4;
    else if (features.charEntropy < 2.8) score += 0.2;
  }

  // Very low uniqueness of characters
  if (features.letterLen >= 15 && features.charUniqueness < 0.15) {
    score += 0.5;
  } else if (features.letterLen >= 25 && features.charUniqueness < 0.25) {
    score += 0.3;
  }

  // Low bigram / trigram diversity indicates periodic patterns (abababab)
  if (features.letterLen >= 20) {
    if (features.bigramUniqueness < 0.2) score += 0.35;
    if (features.trigramUniqueness < 0.25) score += 0.25;
  }

  return Math.min(1, score);
}

/**
 * Word-level repetition score.
 * @param {object} features
 * @returns {number}
 */
function wordRepetitionScore(features) {
  let score = 0;

  if (features.tokenCount >= 4) {
    if (features.maxTokenRatio >= 0.7) score += 0.6;
    else if (features.maxTokenRatio >= 0.5) score += 0.35;
    else if (features.maxTokenRatio >= 0.35) score += 0.2;

    if (features.wordUniqueness < 0.25) score += 0.4;
    else if (features.wordUniqueness < 0.4) score += 0.2;
  }

  return Math.min(1, score);
}

/**
 * Keyboard-mash / gibberish score.
 * Catches messages like "ghf;h.;fg.h;f" or "sfiuysdhfshd hsduif husdh".
 * @param {object} features
 * @returns {number} score in [0, 1]
 */
function gibberishScore(features) {
  let score = 0;
  const letters = features.letterLen;
  const words = features.realWordTokens || 0;

  // Not enough content to judge
  if (letters < 12 && words < 4) return 0;

  // High share of gibberish tokens
  if (features.gibberishRatio >= 0.7) score += 0.55;
  else if (features.gibberishRatio >= 0.5) score += 0.35;
  else if (features.gibberishRatio >= 0.35) score += 0.2;

  // Very low vowel ratio across the whole message
  if (letters >= 15) {
    if (features.vowelRatio < 0.12) score += 0.45;
    else if (features.vowelRatio < 0.2) score += 0.25;
    else if (features.vowelRatio < 0.28) score += 0.1;
  }

  // Dense punctuation interleaved with short fragments
  if (features.punctRatio >= 0.2 && words >= 5) score += 0.35;
  else if (features.punctRatio >= 0.12 && words >= 8) score += 0.2;

  // Many tiny tokens (keyboard fragments)
  if (features.shortTokenRatio >= 0.6 && words >= 8) score += 0.3;
  else if (features.shortTokenRatio >= 0.45 && words >= 10) score += 0.15;

  // Very short average word length with many tokens
  if (words >= 10 && features.avgWordLen < 3.5) score += 0.25;
  else if (words >= 8 && features.avgWordLen < 4.0) score += 0.12;

  // High uniqueness of short tokens = random mash, not repeated spam
  // (repeated spam is handled elsewhere; here we want random garbage)
  if (
    words >= 10 &&
    features.wordUniqueness > 0.7 &&
    features.gibberishRatio >= 0.4
  ) {
    score += 0.2;
  }

  return Math.min(1, score);
}

module.exports = {
  computeFeatures,
  lowEntropyScore,
  wordRepetitionScore,
  gibberishScore,
  isGibberishToken,
};

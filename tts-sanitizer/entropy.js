'use strict';

const {
  shannonEntropy,
  uniquenessRatio,
  onlyLetters,
  frequencyMap,
} = require('./utils');

/**
 * Text feature extraction and entropy-based spam signals.
 * All metrics are computed in linear time.
 */

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

  // Word-level
  const wordEntropy = tokenCount > 0 ? shannonEntropy(tokens) : 0;
  const wordUniqueness = uniquenessRatio(tokens);

  // Average word length
  const avgWordLen =
    tokenCount > 0
      ? tokens.reduce((sum, t) => sum + t.length, 0) / tokenCount
      : 0;

  // Character class ratios (on original cleaned text for digits / scripts)
  let digitCount = 0;
  let latinCount = 0;
  let cyrillicCount = 0;
  let otherCount = 0;

  for (const ch of text) {
    if (/\p{N}/u.test(ch)) digitCount++;
    else if (/[a-zA-Z]/.test(ch)) latinCount++;
    else if (/[а-яА-ЯёЁ]/.test(ch)) cyrillicCount++;
    else if (/\p{L}/u.test(ch)) otherCount++;
  }

  const totalChars = Math.max(1, text.length);
  const digitRatio = digitCount / totalChars;
  const latinRatio = latinCount / totalChars;
  const cyrillicRatio = cyrillicCount / totalChars;

  // Max frequency of any single token
  const freq = frequencyMap(tokens);
  let maxTokenFreq = 0;
  for (const count of freq.values()) {
    if (count > maxTokenFreq) maxTokenFreq = count;
  }
  const maxTokenRatio = tokenCount > 0 ? maxTokenFreq / tokenCount : 0;

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
    maxTokenRatio,
    uniqueTokenCount: freq.size,
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

module.exports = {
  computeFeatures,
  lowEntropyScore,
  wordRepetitionScore,
};

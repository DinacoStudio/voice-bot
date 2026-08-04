'use strict';

const {
  toLower,
  commonPrefixLength,
  commonSuffixLength,
  frequencyMap,
} = require('./utils');
const { normalizeWord } = require('./normalizer');

/**
 * Collection of independent spam detectors.
 * Each detector returns a list of "actions" describing how to collapse
 * groups of tokens. The main sanitizer applies the strongest actions.
 *
 * All algorithms are linear or near-linear in the number of tokens.
 */

/**
 * @typedef {object} CollapseAction
 * @property {number} start - inclusive start index in tokens array
 * @property {number} end - exclusive end index
 * @property {string} replacement - string that replaces the whole range
 * @property {number} strength - how aggressive this collapse is (0-1)
 * @property {string} reason - detector name for debugging
 */

/**
 * Detect runs of identical words: "да да да да да" → "да…"
 * @param {string[]} tokens
 * @param {string[]} bases - parallel array of normalized base forms
 * @returns {CollapseAction[]}
 */
function detectIdenticalWordRuns(tokens, bases) {
  const actions = [];
  let i = 0;

  while (i < tokens.length) {
    // Skip pure punctuation
    if (/^[.,!?;:…—–]$/.test(tokens[i])) {
      i++;
      continue;
    }

    const base = bases[i];
    let j = i + 1;
    while (j < tokens.length && bases[j] === base) j++;

    // Absorb neighbouring ladder-like forms: one base is the other
    // with a few extra repeated characters (сер / ссер / сссер).
    const isLadderNeighbour = (a, b) => {
      if (!a || !b) return false;
      const longer = a.length >= b.length ? a : b;
      const shorter = a.length < b.length ? a : b;
      if (longer.length - shorter.length > 4) return false;
      // After removing one repeated character from the longer form,
      // do we get the shorter form?
      for (let p = 0; p < longer.length; p++) {
        if (p > 0 && longer[p] !== longer[p - 1]) continue;
        const candidate = longer.slice(0, p) + longer.slice(p + 1);
        if (candidate === shorter) return true;
      }
      return longer.includes(shorter) && shorter.length >= 2;
    };

    while (
      i > 0 &&
      !/^[.,!?;:…—–]$/.test(tokens[i - 1]) &&
      isLadderNeighbour(base, bases[i - 1])
    ) {
      i--;
    }
    while (
      j < tokens.length &&
      !/^[.,!?;:…—–]$/.test(tokens[j]) &&
      isLadderNeighbour(base, bases[j])
    ) {
      j++;
    }

    const runLen = j - i;
    if (runLen >= 4) {
      // Prefer shortest original token; if all have trailing noise,
      // fall back to the clean base form for a natural TTS reading.
      let shortest = tokens[i];
      for (let k = i; k < j; k++) {
        if (
          !/^[.,!?;:…—–]$/.test(tokens[k]) &&
          tokens[k].length < shortest.length
        ) {
          shortest = tokens[k];
        }
      }
      const base = bases[i];
      const display =
        base.length >= 3 && base.length < shortest.length ? base : shortest;
      actions.push({
        start: i,
        end: j,
        replacement: display + '…',
        strength: Math.min(1, 0.4 + runLen * 0.1),
        reason: 'identical-word-run',
      });
    }
    i = Math.max(j, i + 1);
  }
  return actions;
}

/**
 * Detect runs of words that share a long common prefix.
 * "приветA01 приветB02 приветC03 приветD04" → "привет…"
 * @param {string[]} tokens
 * @param {string[]} bases
 * @returns {CollapseAction[]}
 */
function detectCommonPrefixRuns(tokens, bases) {
  const actions = [];
  const n = tokens.length;
  let i = 0;

  while (i < n) {
    if (/^[.,!?;:…—–]$/.test(tokens[i]) || bases[i].length < 3) {
      i++;
      continue;
    }

    // Look ahead for a cluster of similar prefixes
    const seed = bases[i];
    let j = i + 1;
    let similar = 1;

    while (j < n) {
      if (/^[.,!?;:…—–]$/.test(tokens[j])) {
        j++;
        continue;
      }
      const prefixLen = commonPrefixLength(seed, bases[j]);
      // Require a meaningful shared prefix relative to length
      if (prefixLen >= 3 && prefixLen >= Math.min(seed.length, bases[j].length) * 0.55) {
        similar++;
        j++;
      } else {
        break;
      }
    }

    if (similar >= 4) {
      // Prefer the normalized base (already cleaned) for a readable replacement
      const display = (seed.length >= 3 ? seed : tokens[i].replace(/[\p{N}]+$/u, '')).slice(0, 12);
      actions.push({
        start: i,
        end: j,
        replacement: display + '…',
        strength: Math.min(1, 0.45 + similar * 0.08),
        reason: 'common-prefix-run',
      });
      i = j;
    } else {
      i++;
    }
  }
  return actions;
}

/**
 * Detect runs that share a long common suffix (rarer, but happens with numbers).
 * "AAA123 BBB123 CCC123" → "123…" or just collapse.
 * @param {string[]} tokens
 * @param {string[]} bases
 * @returns {CollapseAction[]}
 */
function detectCommonSuffixRuns(tokens, bases) {
  const actions = [];
  const n = tokens.length;
  let i = 0;

  while (i < n) {
    if (/^[.,!?;:…—–]$/.test(tokens[i]) || bases[i].length < 3) {
      i++;
      continue;
    }

    const seed = bases[i];
    let j = i + 1;
    let similar = 1;

    while (j < n) {
      if (/^[.,!?;:…—–]$/.test(tokens[j])) {
        j++;
        continue;
      }
      const suffixLen = commonSuffixLength(seed, bases[j]);
      if (suffixLen >= 3 && suffixLen >= Math.min(seed.length, bases[j].length) * 0.55) {
        similar++;
        j++;
      } else {
        break;
      }
    }

    if (similar >= 4) {
      actions.push({
        start: i,
        end: j,
        replacement: '…',
        strength: Math.min(1, 0.4 + similar * 0.07),
        reason: 'common-suffix-run',
      });
      i = j;
    } else {
      i++;
    }
  }
  return actions;
}

/**
 * Detect "ladder" patterns where each next word is the previous plus one more letter.
 * сер → ссер → сссер → ссссер
 * Also catches gradual lengthening of the same base.
 * @param {string[]} tokens
 * @param {string[]} bases
 * @returns {CollapseAction[]}
 */
function detectLadderPatterns(tokens, bases) {
  const actions = [];
  const n = tokens.length;
  let i = 0;

  while (i < n - 2) {
    if (/^[.,!?;:…—–]$/.test(tokens[i])) {
      i++;
      continue;
    }

    // Look for a sequence where each base contains the previous as prefix
    // and length grows (or stays similar after collapse)
    let j = i + 1;
    let ladderLen = 1;
    let prev = bases[i];

    while (j < n) {
      if (/^[.,!?;:…—–]$/.test(tokens[j])) {
        j++;
        continue;
      }
      const cur = bases[j];
      // Ladder: current starts with previous (or vice-versa) and is longer
      if (
        (cur.startsWith(prev) || prev.startsWith(cur)) &&
        Math.abs(cur.length - prev.length) <= 3 &&
        cur.length >= 2
      ) {
        ladderLen++;
        prev = cur.length >= prev.length ? cur : prev;
        j++;
      } else {
        break;
      }
    }

    if (ladderLen >= 4) {
      // Prefer the shortest form
      let shortest = tokens[i];
      for (let k = i; k < j; k++) {
        if (tokens[k].length < shortest.length && !/^[.,!?;:…—–]$/.test(tokens[k])) {
          shortest = tokens[k];
        }
      }
      actions.push({
        start: i,
        end: j,
        replacement: shortest + '…',
        strength: 0.55 + Math.min(0.3, ladderLen * 0.05),
        reason: 'ladder-pattern',
      });
      i = j;
    } else {
      i++;
    }
  }
  return actions;
}

/**
 * Detect near-identical words that differ only by a few repeated letters
 * at the end: hello, helloo, hellooo, helloooo
 * @param {string[]} tokens
 * @param {string[]} bases
 * @returns {CollapseAction[]}
 */
function detectNearDuplicateRuns(tokens, bases) {
  const actions = [];
  const n = tokens.length;
  let i = 0;

  while (i < n) {
    if (/^[.,!?;:…—–]$/.test(tokens[i]) || bases[i].length < 3) {
      i++;
      continue;
    }

    const seed = bases[i];
    let j = i + 1;
    let similar = 1;

    while (j < n) {
      if (/^[.,!?;:…—–]$/.test(tokens[j])) {
        j++;
        continue;
      }
      const other = bases[j];
      // After normalization they may already be equal; if not, check edit distance lightly
      if (other === seed) {
        similar++;
        j++;
        continue;
      }
      // One is prefix of the other and the extra part is mostly the same letter
      const longer = other.length >= seed.length ? other : seed;
      const shorter = other.length < seed.length ? other : seed;
      if (
        longer.startsWith(shorter) &&
        longer.length - shorter.length <= 4 &&
        /^(\p{L})\1*$/u.test(longer.slice(shorter.length))
      ) {
        similar++;
        j++;
      } else {
        break;
      }
    }

    if (similar >= 4) {
      actions.push({
        start: i,
        end: j,
        replacement: tokens[i] + '…',
        strength: 0.5 + Math.min(0.3, similar * 0.07),
        reason: 'near-duplicate-run',
      });
      i = j;
    } else {
      i++;
    }
  }
  return actions;
}

/**
 * Detect mass spam of many tokens that share the same normalized base
 * (not necessarily a tight consecutive run).
 * e.g. 50× "приветA01"/"приветB02"/… → "привет…"
 * e.g. бля/блю/хап repeated in a loop → most frequent base + "…"
 *
 * When several bases are frequent, pick the single most frequent one
 * and collapse the whole spam-dominated span to that base.
 *
 * @param {string[]} tokens
 * @param {string[]} bases
 * @returns {CollapseAction[]}
 */
function detectMassSimilarSpam(tokens, bases) {
  const actions = [];
  const wordCount = bases.filter(
    (b) => b.length >= 2 && !/^[.,!?;:…—–]$/.test(b)
  ).length;
  if (wordCount < 4) return actions;

  const freq = frequencyMap(bases.filter((b) => b.length >= 2));

  // Rank by frequency, highest first
  const ranked = [...freq.entries()]
    .filter(([b, c]) => b.length >= 2 && c >= 4)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) return actions;

  const [topBase, topCount] = ranked[0];
  const topRelative = topCount / wordCount;

  // Treat all reasonably frequent bases as part of the same spam cluster
  const frequentBases = new Set(
    ranked
      .filter(([, c]) => c >= 4 && c / wordCount >= 0.08)
      .map(([b]) => b)
  );
  frequentBases.add(topBase);

  const spamIndices = [];
  for (let i = 0; i < bases.length; i++) {
    if (frequentBases.has(bases[i])) spamIndices.push(i);
  }
  if (spamIndices.length < 4) return actions;

  const start = spamIndices[0];
  const end = spamIndices[spamIndices.length - 1] + 1;
  const span = end - start;
  const dominatesSpan = spamIndices.length / span >= 0.4;
  const massAbsolute = topCount >= 6;

  if ((dominatesSpan || massAbsolute) && (topRelative >= 0.15 || topCount >= 8)) {
    actions.push({
      start,
      end,
      replacement: topBase + '…',
      strength: Math.min(1, 0.6 + topCount * 0.03),
      reason: 'mass-similar-spam',
    });
  }

  return actions;
}

/**
 * Run all detectors and return a merged, non-overlapping set of actions.
 * Higher-strength actions win when ranges overlap.
 * @param {string[]} tokens
 * @returns {CollapseAction[]}
 */
function runAllDetectors(tokens) {
  const bases = tokens.map((t) =>
    /^[.,!?;:…—–]$/.test(t) ? t : normalizeWord(t)
  );

  const all = [
    ...detectIdenticalWordRuns(tokens, bases),
    ...detectCommonPrefixRuns(tokens, bases),
    ...detectCommonSuffixRuns(tokens, bases),
    ...detectLadderPatterns(tokens, bases),
    ...detectNearDuplicateRuns(tokens, bases),
    ...detectMassSimilarSpam(tokens, bases),
  ];

  if (all.length === 0) return [];

  // Sort by strength descending, then by start ascending
  all.sort((a, b) => b.strength - a.strength || a.start - b.start);

  // Greedy non-overlapping selection
  const selected = [];
  const occupied = new Array(tokens.length).fill(false);

  for (const action of all) {
    let free = true;
    for (let i = action.start; i < action.end; i++) {
      if (occupied[i]) {
        free = false;
        break;
      }
    }
    if (!free) continue;

    for (let i = action.start; i < action.end; i++) occupied[i] = true;
    selected.push(action);
  }

  // Sort selected by position so we can apply them left-to-right
  selected.sort((a, b) => a.start - b.start);
  return selected;
}

/**
 * Apply a list of collapse actions to a token array.
 * Returns a new token array.
 * @param {string[]} tokens
 * @param {CollapseAction[]} actions - already sorted by start, non-overlapping
 * @returns {string[]}
 */
function applyActions(tokens, actions) {
  if (actions.length === 0) return tokens.slice();

  const result = [];
  let cursor = 0;

  for (const action of actions) {
    // Copy tokens before the action
    while (cursor < action.start) {
      result.push(tokens[cursor]);
      cursor++;
    }
    result.push(action.replacement);
    cursor = action.end;
  }

  // Remaining tokens
  while (cursor < tokens.length) {
    result.push(tokens[cursor]);
    cursor++;
  }

  return result;
}

module.exports = {
  detectIdenticalWordRuns,
  detectCommonPrefixRuns,
  detectCommonSuffixRuns,
  detectLadderPatterns,
  detectNearDuplicateRuns,
  detectMassSimilarSpam,
  runAllDetectors,
  applyActions,
};

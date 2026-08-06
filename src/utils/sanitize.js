"use strict";

/*
 * Text accepted by a speech engine is deliberately much smaller than text
 * accepted by Discord.  This module is dependency-free and all transformations
 * are deterministic: markup is removed first, then individual noise tokens and
 * finally generated/repeated sequences.  Returning an empty string means that
 * the message must not be queued for TTS.
 */

const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:[-'][\p{L}\p{M}\p{N}]+)*/gu;
const CYR_VOWELS = "аеёиоуыэюя";
const LAT_VOWELS = "aeiouy";

function stripDiscordAndMarkdown(value) {
  let text = value.normalize("NFC").replace(/\r\n?/g, "\n");

  // Content which is not prose.
  text = text
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<a?:[A-Za-z0-9_~]+:\d+>/g, " ")
    .replace(/<@!?\d+>|<@&\d+>|<#\d+>|<t:\d+(?::[tTdDfFR])?>|<\/?[A-Za-z][^>\n]*>/g, " ")
    .replace(/\[([^\]\n]+)]\([^\n)]*\)/g, "$1")
    .replace(/\b(?:https?|ftp):\/\/[^\s<>()]+|\bwww\.[^\s<>()]+/giu, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>+|[-+*]\s+|\d+[.)]\s+)\s*/gm, "")
    .replace(/^\s*\[[ xX]\]\s*/gm, "")
    .replace(/(?:\*\*\*|___|\*\*|__|~~|\|\||\*|_)/g, "")
    .replace(/^\s*[-*_]{3,}\s*$/gm, " ")
    .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}\uFE0E\uFE0F\u200D\u20E3]/gu, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "");

  // Only characters which can usefully affect pronunciation or pauses survive.
  return text
    .replace(/[^\p{L}\p{M}\p{N}\s.,!?;:'"«»()\-—–…]/gu, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, ". ")
    .replace(/([.,!?;:])\1+/g, "$1")
    .replace(/\.{2,}/g, "…")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function lettersOnly(word) {
  return word.toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{M}]/gu, "");
}

function collapseRuns(word) {
  return word.replace(/(\p{L})\1{2,}/giu, "$1$1");
}

function repeatingUnit(word) {
  const value = lettersOnly(word);
  if (value.length < 10) return null;
  for (let offset = 0; offset < Math.min(8, value.length); offset++) {
    const tail = value.slice(offset);
    for (let size = 1; size <= Math.min(8, Math.floor(tail.length / 4)); size++) {
      const unit = tail.slice(0, size);
      let repeats = 0;
      while (tail.startsWith(unit, repeats * size)) repeats++;
      const covered = repeats * size;
      if (repeats >= 3 && covered >= value.length * 0.5) {
        return unit;
      }
    }
  }
  return null;
}

function tokenLooksNoisy(word) {
  const value = lettersOnly(word);
  if (!value) return false;
  if (/^([\p{L}\p{N}]{2,8})(?:-\1){2,}/iu.test(word)) return true;
  if (repeatingUnit(value)) return true;
  const hyphenParts = word.split(/[-—–]/).filter(Boolean);
  if (hyphenParts.length >= 4 && hyphenParts.filter((part) => lettersOnly(part).length <= 2).length / hyphenParts.length >= 0.6) return true;
  const digits = (word.match(/\p{N}/gu) || []).length;
  if (word.length >= 6 && value.length > 0 && digits / word.length >= 0.6) return true;

  const chars = [...value];
  const maxFrequency = Math.max(...[...new Set(chars)].map((ch) => chars.filter((x) => x === ch).length));
  if (value.length >= 8 && maxFrequency / value.length >= 0.48) return true;

  if (/^[а-яё]+$/iu.test(value)) {
    if (new RegExp(`[^${CYR_VOWELS}]{6,}`, "iu").test(value)) return true;
    if (new RegExp(`[${CYR_VOWELS}]{6,}`, "iu").test(value)) return true;
  }
  if (/^[a-z]+$/iu.test(value)) {
    if (new RegExp(`[^${LAT_VOWELS}]{5,}`, "iu").test(value)) return true;
  }
  return false;
}

function baseForm(word) {
  return lettersOnly(collapseRuns(word)).replace(/(.)\1+/gu, "$1");
}

function removeSequenceSpam(words) {
  if (words.length < 4) return words;
  const bases = words.map(baseForm);
  const dropped = new Set();

  for (let start = 0; start < words.length;) {
    let end = start + 1;
    while (end < words.length) {
      const a = bases[start];
      const b = bases[end];
      if (!a || !b) break;
      let prefix = 0;
      while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
      const similar = a === b || (prefix >= 3 && prefix >= Math.min(a.length, b.length) * 0.6);
      if (!similar) break;
      end++;
    }
    if (end - start >= 4) for (let i = start; i < end; i++) dropped.add(i);
    start = end;
  }

  // A generated family may be interspersed instead of contiguous.
  const frequency = new Map();
  bases.forEach((base, i) => {
    if (base.length < 2) return;
    const key = base.slice(0, Math.min(5, base.length));
    const list = frequency.get(key) || [];
    list.push(i);
    frequency.set(key, list);
  });
  for (const indexes of frequency.values()) {
    if (indexes.length >= 6 && indexes.length / words.length >= 0.35) indexes.forEach((i) => dropped.add(i));
  }
  return words.filter((_, i) => !dropped.has(i));
}

function isGibberishCollection(words) {
  if (words.length < 4) return false;
  let suspicious = 0;
  let latin = 0;
  for (const word of words) {
    const value = lettersOnly(word);
    if (/^[a-z]+$/i.test(value)) {
      latin++;
      const vowelCount = [...value].filter((c) => LAT_VOWELS.includes(c.toLowerCase())).length;
      if (/[^aeiouy]{3,}/i.test(value) || vowelCount / Math.max(1, value.length) < 0.18) suspicious++;
    } else if (tokenLooksNoisy(word)) suspicious++;
  }
  const allLetters = words.map(lettersOnly).join("");
  const frequency = new Map();
  for (const char of allLetters) frequency.set(char, (frequency.get(char) || 0) + 1);
  const dominant = allLetters.length ? Math.max(...frequency.values()) / allLetters.length : 0;
  const shortWords = words.filter((word) => lettersOnly(word).length <= 3).length / words.length;
  const averageLength = allLetters.length / words.length;
  return (words.length >= 8 && suspicious / words.length >= 0.58) ||
    (words.length >= 8 && latin / words.length >= 0.8 && suspicious / words.length >= 0.42) ||
    (dominant >= 0.32 && shortWords >= 0.45) ||
    (dominant >= 0.45 && averageLength <= 4.5);
}

function isPeriodicNoise(text) {
  const value = text.toLocaleLowerCase("ru-RU").replace(/\s+/g, "");
  if (value.length < 30) return false;
  for (let size = 1; size <= Math.min(16, Math.floor(value.length / 5)); size++) {
    const unit = value.slice(0, size);
    let matches = 0;
    for (let i = 0; i < value.length; i++) if (value[i] === unit[i % size]) matches++;
    if (matches / value.length >= 0.86) return true;
  }
  return false;
}

function truncateNaturally(text, maxLength) {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, Math.max(1, maxLength - 1));
  const boundary = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("."), cut.lastIndexOf(","));
  return `${(boundary >= maxLength * 0.65 ? cut.slice(0, boundary) : cut).trim()}…`;
}

function sanitizeText(input, maxLength = 200) {
  if (typeof input !== "string" || !input.trim()) return "";
  const limit = Number.isFinite(maxLength) ? Math.max(1, Math.floor(maxLength)) : 200;
  let text = stripDiscordAndMarkdown(input);
  if (!/[\p{L}\p{N}]/u.test(text)) return "";
  if (isPeriodicNoise(text)) return "";
  const compactLength = text.replace(/\s/g, "").length;
  const punctuationLength = (text.match(/[.,!?;:'"()\-—–…]/g) || []).length;
  const letterLength = (text.match(/[\p{L}\p{M}]/gu) || []).length;
  if (compactLength >= 12 && punctuationLength / compactLength >= 0.42 && letterLength <= 40) return "";

  const rawWords = text.match(WORD_RE) || [];
  const rejected = new Set(rawWords.filter(tokenLooksNoisy));
  let cleanWords = rawWords.filter((word) => !rejected.has(word));
  cleanWords = removeSequenceSpam(cleanWords);
  if (isGibberishCollection(cleanWords)) return "";
  const allowed = new Map();
  for (const word of cleanWords) allowed.set(word, (allowed.get(word) || 0) + 1);

  text = text.replace(WORD_RE, (word) => {
    const count = allowed.get(word) || 0;
    if (!count) return " ";
    allowed.set(word, count - 1);
    return collapseRuns(word);
  });

  // Four or more identical spoken words are spam; two/three can be natural.
  text = text
    .replace(/\b([\p{L}\p{M}\p{N}]{2,})(?:[\s.,!?;:]+\1){3,}\b/giu, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/^[\s.,!?;:…—-]+|[\s,;:—-]+$/g, "")
    .replace(/([.,!?;:])(?:\s*[.,!?;:])+/g, "$1")
    .trim();

  if (!/[\p{L}\p{N}]/u.test(text)) return "";
  if (isGibberishCollection(text.match(WORD_RE) || [])) return "";
  return truncateNaturally(text, limit);
}

module.exports = { sanitizeText, stripDiscordAndMarkdown };

/**
 * Sanitizes user message text before sending it to Text-To-Speech API.
 * Removes URLs, code blocks, custom emojis, user/role/channel mentions, extra spaces,
 * and prevents character/syllable/word spamming.
 *
 * @param {string} text - Raw input text
 * @param {number} maxLength - Maximum character length allowed (default 200)
 * @returns {string} Sanitized string ready for TTS
 */
/**
 * Sanitizes user message text before sending it to Text-To-Speech API.
 * Removes URLs, code blocks, custom emojis, mentions, extra spaces,
 * and heavily prevents character/syllable/pattern spamming.
 *
 * @param {string} text - Raw input text
 * @param {number} maxLength - Maximum character length allowed (default 200)
 * @returns {string} Sanitized string ready for TTS
 */
function sanitizeText(text, maxLength = 200) {
  if (!text || typeof text !== "string") return "";

  let cleaned = text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    // Remove URLs
    .replace(/https?:\/\/\S+/gi, "")
    // Remove Discord timestamps and commands
    .replace(/<t:\d+(?::[tTdDfFR])?>/g, "")
    .replace(/<\/[a-zA-Z0-9_-]+:\d+>/g, "")
    // Replace custom emojis
    .replace(/<a?:([a-zA-Z0-9_]+):\d+>/g, "$1")
    // Remove mentions (users, channels, roles)
    .replace(/<@!?\d+>/g, "")
    .replace(/<#\d+>/g, "")
    .replace(/<@&\d+>/g, "")
    // Keep Markdown link captions
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    // Keep punctuation, remove service symbols
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[^\p{L}\p{N}\s.,!?;:'"«»…—–-]/gu, " ")

    // ==========================================
    // 🛡️ АНТИСПАМ БЛОК (Продвинутый)
    // ==========================================

    // 1. Спам словами с цифрами ("бля1 бля2 блю3..." -> "бля1...")
    .replace(/([\p{L}]+\d+)(?:[\s.,!?]+[\p{L}]+\d+){3,}/giu, "$1... ")

    // 2. Спам одинаковыми словами ("да да да да да" -> "да...")
    .replace(/([\p{L}]+)(?:[\s.,!?]+\1){3,}/giu, "$1... ")

    // 3. Спам "ломаным" регистром ("бляА бляБ хапЖ блюАА" -> "бляА...")
    // Ищет слова, где после строчных букв идут заглавные. 3 таких слова подряд = спам.
    .replace(
      /(\b\p{Ll}+\p{Lu}+\b)(?:[\s.,!?]+\b\p{Ll}+\p{Lu}+\b){2,}/gu,
      "$1... ",
    )

    // 4. Спам однотипными короткими словами ("бляа блюб блюв блюг" -> "бляа...")
    // Ищет 4+ слова (длиной 3-6 букв), которые начинаются на одни и те же 2 буквы (например, "бл").
    .replace(
      /(\b(\p{L}{2})\p{L}{1,4}\b)(?:[\s.,!?]+\2\p{L}{1,4}\b){3,}/giu,
      "$1... ",
    )

    // 5. Залипание клавиш ("ыыыыыыыы" -> "ыыы")
    .replace(/(.)\1{3,}/gi, "$1$1$1")

    // 6. Спам слогами ("ахахахахахах" -> "ахах")
    .replace(/(..+?)\1{3,}/gi, "$1$1")

    // 7. Удары по клавиатуре (гигантские слова без пробелов)
    // Ищет любую последовательность из 25+ символов без пробелов и оставляет только первые 8.
    .replace(/([^\s]{8})[^\s]{17,}/g, "$1... ")

    // ==========================================

    // Replace multiple whitespaces/newlines with single space
    .replace(/\s+/g, " ")
    .trim();

  // Punctuation-only messages block
  if (!/[\p{L}\p{N}]/u.test(cleaned)) {
    return "";
  }

  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength) + "...";
  }

  return cleaned;
}

module.exports = { sanitizeText };

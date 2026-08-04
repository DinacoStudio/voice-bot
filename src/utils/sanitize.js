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
 * Очищает текст перед отправкой в TTS.
 * Отлично справляется с длинными словами, режет паттерны, залипания и низкоэнтропийный спам.
 */
function sanitizeText(text, maxLength = 200) {
  if (!text || typeof text !== "string") return "";

  let cleaned = text
    // 1. Базовая очистка Discord-мусора
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/<t:\d+(?::[tTdDfFR])?>/g, "")
    .replace(/<\/[a-zA-Z0-9_-]+:\d+>/g, "")
    .replace(/<a?:([a-zA-Z0-9_]+):\d+>/g, "$1")
    .replace(/<@!?\d+>/g, "")
    .replace(/<#\d+>/g, "")
    .replace(/<@&\d+>/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[^\p{L}\p{N}\s.,!?;:'"«»…—–-]/gu, " ");

  // ==========================================
  // 🛡️ ЭТАП 1: РАННЕЕ СЖАТИЕ ЗАЛИПАНИЙ
  // ==========================================
  // Сжимаем 3 и более одинаковых символа подряд до 2-х.
  // "сссссссерррр" моментально превращается в "ссерр".
  cleaned = cleaned.replace(/(.)\1{2,}/gi, "$1$1");

  // ==========================================
  // 🛡️ ЭТАП 2: ЭНТРОПИЙНЫЙ АНАЛИЗ (Убийца перестановок)
  // ==========================================
  // Извлекаем только буквы и считаем, сколько уникальных символов использовал юзер.
  const onlyLetters = cleaned.replace(/[^\p{L}]/gu, "").toLowerCase();

  if (onlyLetters.length > 25) {
    // Set оставляет только уникальные символы
    const uniqueLettersCount = new Set(onlyLetters).size;

    // Если букв больше 25, но уникальных из них 4 или меньше — это 100% спам-генератор.
    if (uniqueLettersCount <= 4) {
      return cleaned.substring(0, 15).trim() + "...";
    }
  }

  // ==========================================
  // 🛡️ ЭТАП 3: АНАЛИЗАТОР СЛОВ И ПАТТЕРНОВ
  // ==========================================
  cleaned = cleaned.replace(/[\p{L}\p{N}]+/gu, (word) => {
    // Слишком длинное слово
    if (word.length > 38) return word.substring(0, 8) + "...";
    // Длинное слово с цифрами внутри (вап43рп3)
    if (word.length > 15 && /\d/.test(word))
      return word.substring(0, 8) + "...";
    // Нечитаемый набор: 6+ согласных или 6+ гласных подряд
    if (
      /[бвгджзйклмнпрстфхцчшщbcdfghjklmnpqrstvwxz]{6,}/i.test(word) ||
      /[аеёиоуыэюяaeiouy]{6,}/i.test(word)
    ) {
      return word.substring(0, 5) + "...";
    }
    return word;
  });

  cleaned = cleaned
    // Одинаковое начало слова ("приветA01 приветB02 приветC03")
    .replace(
      /(\b\p{L}{3,})[\p{L}\p{N}]*(?:[\s.,!?]+\1[\p{L}\p{N}]*){3,}/giu,
      "$1... ",
    )
    // Спам абсолютно одинаковыми словами ("да да да да да")
    .replace(/([\p{L}]+)(?:[\s.,!?]+\1){3,}/giu, "$1... ")
    // Спам слогами ("ахахахахахах" -> "ахах")
    .replace(/(..+?)\1{3,}/gi, "$1$1")
    // Финальная очистка пробелов
    .replace(/\s+/g, " ")
    .trim();

  // Если остались только знаки препинания — молчим
  if (!/[\p{L}\p{N}]/u.test(cleaned)) {
    return "";
  }

  // Финальная защита от слишком длинных сообщений
  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength) + "...";
  }

  return cleaned;
}

module.exports = { sanitizeText };

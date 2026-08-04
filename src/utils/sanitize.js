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
 * Отлично справляется с настоящими длинными словами, но беспощадно режет спам.
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
  // 🛡️ ПРОДВИНУТЫЙ АНАЛИЗАТОР СЛОВ
  // ==========================================

  // Проходимся по каждому "слову" (последовательности букв и цифр)
  cleaned = cleaned.replace(/[\p{L}\p{N}]+/gu, (word) => {
    // Правило 1: Экстремальная длина.
    // Самое длинное русское слово ~35 букв. Если слово больше 38 букв - это 100% спам.
    if (word.length > 38) {
      return word.substring(0, 8) + "...";
    }

    // Правило 2: Цифры в длинном тексте.
    // Если слово длиннее 15 символов и внутри есть цифры (вап43рп3уа32) - это мусор.
    // Нормальные длинные слова не содержат цифр внутри.
    if (word.length > 15 && /\d/.test(word)) {
      return word.substring(0, 8) + "...";
    }

    // Правило 3: Нечитаемый набор букв (Согласные/Гласные).
    // В нормальном языке редко бывает больше 4 согласных или 3 гласных подряд.
    // Если видим 6+ согласных или 5+ гласных подряд — это удар по клавиатуре.
    if (
      /[бвгджзйклмнпрстфхцчшщbcdfghjklmnpqrstvwxz]{6,}/i.test(word) ||
      /[аеёиоуыэюяaeiouy]{5,}/i.test(word)
    ) {
      return word.substring(0, 5) + "...";
    }

    // Если слово прошло все проверки, возвращаем его нетронутым
    return word;
  });

  // ==========================================
  // 🧹 ФИНАЛЬНЫЕ РЕГУЛЯРКИ ДЛЯ ВСЕЙ СТРОКИ
  // ==========================================
  cleaned = cleaned
    // Залипание клавиш ("бляяяяяяяяяяяяя яяяяяяяяяяяяя" -> "бляяя яяя")
    .replace(/(.)\1{3,}/gi, "$1$1$1")
    // Спам слогами ("ахахахахахах" -> "ахах")
    .replace(/(..+?)\1{3,}/gi, "$1$1")
    // Лишние пробелы
    .replace(/\s+/g, " ")
    .trim();

  // Проверка на то, осталось ли что-то кроме знаков препинания
  if (!/[\p{L}\p{N}]/u.test(cleaned)) {
    return "";
  }

  // Финальная обрезка всего сообщения (чтобы не читал войну и мир)
  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength) + "...";
  }

  return cleaned;
}

module.exports = { sanitizeText };

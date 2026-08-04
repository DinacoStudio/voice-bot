/**
 * Sanitizes user message text before sending it to Text-To-Speech API.
 * Removes URLs, code blocks, custom emojis, user/role/channel mentions, and extra spaces.
 *
 * @param {string} text - Raw input text
 * @param {number} maxLength - Maximum character length allowed (default 200)
 * @returns {string} Sanitized string ready for TTS
 */
function sanitizeText(text, maxLength = 200) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    // Remove URLs
    .replace(/https?:\/\/\S+/gi, '')
    // Remove Discord timestamps, slash-command mentions and other tagged entities
    .replace(/<t:\d+(?::[tTdDfFR])?>/g, '')
    .replace(/<\/[a-zA-Z0-9_-]+:\d+>/g, '')
    // Replace custom emojis <:emoji_name:123456> with emoji name
    .replace(/<a?:([a-zA-Z0-9_]+):\d+>/g, '$1')
    // Remove user mentions <@123456> or <@!123456>
    .replace(/<@!?\d+>/g, '')
    // Remove channel mentions <#123456>
    .replace(/<#\d+>/g, '')
    // Remove role mentions <@&\d+>
    .replace(/<@&\d+>/g, '')
    // Keep the caption of Markdown links, but skip their destination
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    // Keep natural speech punctuation, but remove slashes, emoji and service symbols
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[^\p{L}\p{N}\s.,!?;:'"«»…—–-]/gu, ' ')
    // Replace multiple whitespaces/newlines with single space
    .replace(/\s+/g, ' ')
    .trim();

  // Punctuation-only messages must not reach TTS. Otherwise the player adds
  // the author prefix and Discord hears only "<name> говорит".
  if (!/[\p{L}\p{N}]/u.test(cleaned)) {
    return '';
  }

  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength) + '...';
  }

  return cleaned;
}

module.exports = { sanitizeText };

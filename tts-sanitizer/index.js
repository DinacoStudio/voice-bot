'use strict';

/**
 * tts-sanitizer
 *
 * Public entry point. Import this module in your Discord bot:
 *
 *   const { sanitizeText } = require('./tts-sanitizer');
 *   const safe = sanitizeText(message.content);
 */

const { sanitizeText, cleanDiscordMarkup, CONFIG } = require('./sanitize');

module.exports = {
  sanitizeText,
  cleanDiscordMarkup,
  CONFIG,
};

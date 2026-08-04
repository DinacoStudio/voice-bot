const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const googleTTS = require('google-tts-api');
const { Readable } = require('stream');
const config = require('../../config.json');

/**
 * Synthesizes text to audio stream or audio URLs using Microsoft Edge Neural TTS or Google TTS.
 * Completely free, no API keys or payments required.
 *
 * @param {string} text - Cleaned text to synthesize
 * @param {string} voiceName - Voice identifier (e.g. 'ru-RU-SvetlanaNeural', 'ru-RU-DmitryNeural', 'google-ru')
 * @returns {Promise<Array<string|Readable>>} Array of stream objects or HTTP audio URLs
 */
async function getTTSAudioSources(text, voiceName = config.defaultVoice, options = {}) {
  if (!text || text.trim().length === 0) return [];
  const rate = Number(options.rate) || 1;
  const pitchValue = Math.round(Number(options.pitch) || 0);
  const pitch = `${pitchValue >= 0 ? '+' : ''}${pitchValue}%`;
  const volume = Math.round(Number(options.volume) || 100);

  // Fallback to Google TTS if requested
  if (voiceName && voiceName.startsWith('google')) {
    try {
      const lang = voiceName.split('-')[1] || 'ru';
      const urls = googleTTS.getAllAudioUrls(text, {
        lang: lang,
        slow: rate < 0.9,
        host: 'https://translate.google.com',
        splitPunct: ',.?!',
      });
      return urls.map((u) => u.url);
    } catch (err) {
      console.error('[Google TTS Error]:', err);
      const singleUrl = googleTTS.getAudioUrl(text, { lang: 'ru', slow: false });
      return [singleUrl];
    }
  }

  // Microsoft Edge Neural TTS (Free, high-definition neural voice)
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { rate, pitch, volume });

    if (!(audioStream instanceof Readable)) {
      throw new TypeError('msedge-tts did not return a readable audio stream');
    }

    return [audioStream];
  } catch (error) {
    console.error(`[MsEdgeTTS Error for voice ${voiceName}]:`, error.message);
    console.log('[TTS Fallback]: Switching to Google TTS...');
    // Fallback to Google TTS
    const urls = googleTTS.getAllAudioUrls(text, { lang: 'ru', slow: false });
    return urls.map((u) => u.url);
  }
}

module.exports = { getTTSAudioSources };

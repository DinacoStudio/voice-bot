const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const googleTTS = require('google-tts-api');
const { Readable } = require('stream');
const config = require('../../config.json');

async function getSileroAudio(text, voiceName, options) {
  const baseUrl = process.env.SILERO_TTS_URL || 'http://silero:8000';
  const rate = Math.min(100, Math.max(0, Math.round(50 + ((Number(options.rate) || 1) - 1) * 50)));
  const pitch = Math.min(100, Math.max(0, Math.round((Number(options.pitch) || 0) + 50)));
  const url = new URL('/generate', baseUrl);
  url.search = new URLSearchParams({
    text,
    speaker: voiceName.slice('silero:'.length),
    sample_rate: '48000',
    pitch: String(pitch),
    rate: String(rate),
  }).toString();

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Silero returned HTTP ${response.status}`);
  }

  return Readable.fromWeb(response.body);
}

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

  if (voiceName.startsWith('silero:')) {
    try {
      return [await getSileroAudio(text, voiceName, options)];
    } catch (error) {
      console.error(`[Silero TTS Error for voice ${voiceName}]:`, error.message);
      console.log('[TTS Fallback]: Switching to Microsoft Edge TTS...');
      voiceName = config.defaultVoice;
    }
  }

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

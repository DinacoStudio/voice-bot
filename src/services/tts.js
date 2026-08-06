const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const googleTTS = require('google-tts-api');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const { sanitizeText } = require('../utils/sanitize');
const config = require('../../config.json');
const RHVOICE_TIMEOUT_MS = 30_000;
const EDGE_TTS_TIMEOUT_MS = 45_000;
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;

function guardEdgeTTSStreams(tts) {
  const streams = tts._streams || {};
  const unknownStream = {
    turnEnded: false,
    audio: { push() {} },
    metadata: { push() {} },
  };
  tts._streams = new Proxy(streams, {
    get(target, property, receiver) {
      if (typeof property === 'symbol' || Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver);
      }
      return unknownStream;
    },
  });

  for (const methodName of ['_pushAudioData', '_pushMetadata']) {
    const original = tts[methodName];
    if (typeof original !== 'function') continue;
    tts[methodName] = function guardedPush(data, requestId) {
      if (!requestId || !Object.prototype.hasOwnProperty.call(this._streams, requestId)) {
        console.warn(`[MsEdgeTTS]: ignored ${methodName} for unknown request ${requestId || '<missing>'}`);
        return;
      }
      return original.call(this, data, requestId);
    };
  }
  return tts;
}

function readAudioStream(stream, timeoutMs = EDGE_TTS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      callback(value);
    };
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_AUDIO_BYTES) {
        stream.destroy();
        finish(reject, new Error('Edge TTS audio exceeded the safety limit'));
        return;
      }
      chunks.push(Buffer.from(chunk));
    };
    const onEnd = () => {
      const audio = Buffer.concat(chunks);
      if (!audio.length) finish(reject, new Error('Edge TTS returned empty audio'));
      else finish(resolve, audio);
    };
    const onError = (error) => finish(reject, error);
    const timer = setTimeout(() => {
      stream.destroy();
      finish(reject, new Error('Edge TTS synthesis timed out'));
    }, timeoutMs);

    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
  });
}

function getGoogleAudioUrls(text, lang = 'ru', slow = false) {
  const urls = googleTTS.getAllAudioUrls(text, {
    lang,
    slow,
    host: 'https://translate.google.com',
    splitPunct: ',.?!',
  });
  return urls.map((item) => item.url);
}

async function getRHVoiceAudio(text, voiceName, options) {
  const rate = Math.min(200, Math.max(50, Math.round((Number(options.rate) || 1) * 100)));
  const pitch = Math.min(150, Math.max(50, Math.round(100 + (Number(options.pitch) || 0))));
  const volume = Math.min(100, Math.max(20, Math.round(Number(options.volume) || 100)));
  const args = [
    '-p', voiceName.slice('rhvoice:'.length),
    '-r', String(rate),
    '-t', String(pitch),
    '-v', String(volume),
    '-R', '24000',
    '-q', 'standard',
    '-o', '-',
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('RHVoice-test', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error('RHVoice synthesis timed out'));
    }, RHVOICE_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_AUDIO_BYTES) {
        child.kill('SIGKILL');
        finish(reject, new Error('RHVoice audio exceeded the safety limit'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (errorBytes < 64 * 1024) {
        stderr.push(chunk);
        errorBytes += chunk.length;
      }
    });
    child.on('error', (error) => {
      finish(reject, error);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        finish(reject, new Error(Buffer.concat(stderr).toString('utf8').trim() || `RHVoice exited with code ${code}`));
        return;
      }
      const audio = Buffer.concat(stdout);
      if (audio.length < 44) {
        finish(reject, new Error('RHVoice returned an empty WAV file'));
        return;
      }
      finish(resolve, Readable.from(audio));
    });

    child.stdin.on('error', (error) => finish(reject, error));
    child.stdin.end(text, 'utf8');
  });
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
  // Last line of defence: every route, including future ones, is sanitized at
  // the actual external TTS boundary rather than relying only on its caller.
  text = sanitizeText(text, 1000);
  if (!text) return [];
  const rate = Number(options.rate) || 1;
  const pitchValue = Math.round(Number(options.pitch) || 0);
  const pitch = `${pitchValue >= 0 ? '+' : ''}${pitchValue}%`;
  const volume = Math.round(Number(options.volume) || 100);

  if (voiceName.startsWith('rhvoice:')) {
    try {
      return [await getRHVoiceAudio(text, voiceName, options)];
    } catch (error) {
      console.error(`[RHVoice TTS Error for voice ${voiceName}]:`, error.message);
      console.log('[TTS Fallback]: Switching to Microsoft Edge TTS...');
      voiceName = config.defaultVoice;
    }
  }

  // Fallback to Google TTS if requested
  if (voiceName && voiceName.startsWith('google')) {
    try {
      const lang = voiceName.split('-')[1] || 'ru';
      return getGoogleAudioUrls(text, lang, rate < 0.9);
    } catch (err) {
      console.error('[Google TTS Error]:', err);
      const singleUrl = googleTTS.getAudioUrl(text, { lang: 'ru', slow: false });
      return [singleUrl];
    }
  }

  // Microsoft Edge Neural TTS (Free, high-definition neural voice)
  try {
    const tts = guardEdgeTTSStreams(new MsEdgeTTS());
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { rate, pitch, volume });

    if (!(audioStream instanceof Readable)) {
      throw new TypeError('msedge-tts did not return a readable audio stream');
    }

    // toStream() returns before WebSocket callbacks run. Buffering here makes
    // those later stream failures awaitable, so this catch can use the fallback.
    const audio = await readAudioStream(audioStream);
    return [Readable.from(audio)];
  } catch (error) {
    console.error(`[MsEdgeTTS Error for voice ${voiceName}]:`, error.message);
    console.log('[TTS Fallback]: Switching to Google TTS...');
    // Fallback to Google TTS
    return getGoogleAudioUrls(text, 'ru', false);
  }
}

module.exports = { getTTSAudioSources, guardEdgeTTSStreams, readAudioStream };

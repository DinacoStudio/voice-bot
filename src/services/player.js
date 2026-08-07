const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  getVoiceConnection,
} = require('@discordjs/voice');
const sodium = require('libsodium-wrappers');
const { Readable } = require('stream');
const { getTTSAudioSources } = require('./tts');
const { sanitizeText, sanitizeTextWithDiagnostics } = require('../utils/sanitize');
const { logSanitizerDrop } = require('../utils/sanitizerLog');
const config = require('../../config.json');

const MAX_QUEUE_SIZE = 50;
const PLAYBACK_TIMEOUT_MS = 120_000;

class GuildPlayerManager {
  constructor() {
    this.guilds = new Map();
    this.sodiumReady = sodium.ready;
  }

  getGuildState(guildId) {
    if (!this.guilds.has(guildId)) {
      const player = createAudioPlayer();
      this.guilds.set(guildId, {
        connection: null,
        player: player,
        queue: [],
        isPlaying: false,
        isProcessing: false,
        playbackTimer: null,
        generation: 0,
        voice: config.defaultVoice,
        currentChannelId: null,
      });

      const state = this.guilds.get(guildId);

      state.player.on(AudioPlayerStatus.Idle, () => {
        this.clearPlaybackTimer(state);
        state.isPlaying = false;
        state.isProcessing = false;
        this.processQueue(guildId);
      });

      state.player.on('error', (error) => {
        console.error(`[AudioPlayer Error in guild ${guildId}]:`, error.message);
        this.clearPlaybackTimer(state);
        state.isPlaying = false;
        state.isProcessing = false;
        this.processQueue(guildId);
      });
    }
    return this.guilds.get(guildId);
  }

  clearPlaybackTimer(state) {
    if (state.playbackTimer) {
      clearTimeout(state.playbackTimer);
      state.playbackTimer = null;
    }
  }

  async joinChannel(voiceChannel) {
    await this.sodiumReady;

    const guildId = voiceChannel.guild.id;
    const state = this.getGuildState(guildId);

    // If already connected to this channel, return existing connection
    if (
      state.connection &&
      state.currentChannelId === voiceChannel.id &&
      state.connection.state.status !== VoiceConnectionStatus.Destroyed &&
      state.connection.state.status !== VoiceConnectionStatus.Disconnected
    ) {
      await entersState(state.connection, VoiceConnectionStatus.Ready, 20_000);
      return state.connection;
    }

    // Destroy existing connection if moving to a new channel
    if (state.connection) {
      state.generation += 1;
      state.queue = [];
      state.isPlaying = false;
      this.clearPlaybackTimer(state);
      state.player.stop(true);
      try {
        state.connection.destroy();
      } catch (error) {
        console.error(`[Voice Move Error in guild ${guildId}]:`, error);
      }
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    state.connection = connection;
    state.currentChannelId = voiceChannel.id;
    connection.subscribe(state.player);

    connection.on('error', (error) => {
      console.error(`[Voice Connection Error in guild ${guildId}]:`, error);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch (error) {
        if (state.connection === connection) {
          try { connection.destroy(); } catch (e) {}
          state.connection = null;
          state.currentChannelId = null;
        }
      }
    });

    // Do not report a successful join until Discord can actually receive audio.
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      return connection;
    } catch (error) {
      try { connection.destroy(); } catch (e) {}
      state.connection = null;
      state.currentChannelId = null;
      throw new Error(
        `Не удалось подключиться к голосовому каналу (status: ${connection.state.status}).`
      );
    }
  }

  leaveChannel(guildId) {
    const state = this.guilds.get(guildId);

    if (state) {
      state.generation += 1;
      state.queue = [];
      state.isPlaying = false;
      state.isProcessing = false;
      this.clearPlaybackTimer(state);
      state.player.stop(true);
    }

    // Use both our state and discord.js' connection registry. This also
    // handles a stale/lost manager state and guarantees that /leave really
    // removes the active voice connection.
    const connections = new Set([
      state?.connection,
      getVoiceConnection(guildId),
    ].filter(Boolean));

    let disconnected = false;
    for (const connection of connections) {
      try {
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
          connection.destroy();
        }
        disconnected = true;
      } catch (error) {
        console.error(`[Voice Leave Error in guild ${guildId}]:`, error);
      }
    }

    if (state) {
      state.connection = null;
      state.currentChannelId = null;
    }

    this.guilds.delete(guildId);
    return disconnected;
  }

  async enqueue(guildId, text, authorName = null, userOptions = {}) {
    const state = this.getGuildState(guildId);
    if (!state.connection) return false;

    // Filter the body before adding the author. A valid author name must not
    // make an empty or spam-only message meaningful at the TTS boundary.
    const sanitized = sanitizeTextWithDiagnostics(text, 1000);
    const cleanText = sanitized.text;
    if (!cleanText) {
      logSanitizerDrop('player-enqueue', sanitized, text);
      return false;
    }
    const cleanAuthor = authorName ? sanitizeText(authorName, 80) : '';
    const fullText = cleanAuthor ? `${cleanAuthor} говорит: ${cleanText}` : cleanText;

    if (state.queue.length >= MAX_QUEUE_SIZE) {
      console.warn(`[Queue Full in guild ${guildId}]: message dropped`);
      return false;
    }

    state.queue.push({
      type: 'text',
      text: fullText,
      voice: userOptions.voice || state.voice,
      options: { ...userOptions },
    });
    this.processQueue(guildId);
    return true;
  }

  async processQueue(guildId) {
    const state = this.guilds.get(guildId);
    if (!state || state.isProcessing || state.isPlaying) return;

    if (state.queue.length === 0) {
      state.isPlaying = false;
      return;
    }

    const connection = state.connection;
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
      state.queue = [];
      return;
    }

    state.isProcessing = true;
    const generation = state.generation;
    const item = state.queue.shift();

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

      let source;
      if (item.type === 'text') {
        const sources = await getTTSAudioSources(item.text, item.voice, item.options);
        if (!sources.length) throw new Error('TTS returned no audio sources');
        source = sources.shift();

        if (generation !== state.generation || state.connection !== connection) {
          state.isProcessing = false;
          this.processQueue(guildId);
          return;
        }
        state.queue.unshift(...sources.map((audioSource) => ({ type: 'audio', source: audioSource })));
      } else {
        source = item.source;
      }

      // /leave or a reconnect may have invalidated this async synthesis.
      if (generation !== state.generation || state.connection !== connection) {
        state.isProcessing = false;
        this.processQueue(guildId);
        return;
      }

      let resource;
      if (typeof source === 'string') {
        resource = createAudioResource(source, {
          inputType: StreamType.Arbitrary,
        });
      } else if (source instanceof Readable) {
        resource = createAudioResource(source, {
          inputType: StreamType.Arbitrary,
        });
      } else {
        throw new TypeError(
          `Unsupported TTS audio source: ${Object.prototype.toString.call(source)}`
        );
      }

      state.isPlaying = true;
      state.player.play(resource);
      state.playbackTimer = setTimeout(() => {
        console.error(`[Playback Timeout in guild ${guildId}]: skipping stuck audio`);
        state.player.stop(true);
      }, PLAYBACK_TIMEOUT_MS);
    } catch (error) {
      console.error(`[Queue Processing Error in guild ${guildId}]:`, error);
      state.isPlaying = false;
      state.isProcessing = false;
      this.processQueue(guildId);
    }
  }

  skip(guildId) {
    const state = this.guilds.get(guildId);
    if (state && state.player) {
      state.generation += 1;
      this.clearPlaybackTimer(state);
      const stopped = state.player.stop(true);
      if (!stopped && !state.isProcessing) this.processQueue(guildId);
    }
  }

  leaveAll() {
    for (const guildId of [...this.guilds.keys()]) {
      this.leaveChannel(guildId);
    }
  }

  setVoice(guildId, voiceKeyOrName) {
    const state = this.getGuildState(guildId);
    const available = config.availableVoices;

    if (available[voiceKeyOrName]) {
      state.voice = available[voiceKeyOrName].voice;
    } else {
      state.voice = voiceKeyOrName;
    }
    return state.voice;
  }

  getState(guildId) {
    return this.guilds.get(guildId);
  }
}

module.exports = new GuildPlayerManager();

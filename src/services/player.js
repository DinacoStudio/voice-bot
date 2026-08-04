const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType
} = require('@discordjs/voice');
const sodium = require('libsodium-wrappers');
const { Readable } = require('stream');
const { getTTSAudioSources } = require('./tts');
const config = require('../../config.json');

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
        voice: config.defaultVoice,
        currentChannelId: null,
      });

      const state = this.guilds.get(guildId);

      state.player.on(AudioPlayerStatus.Idle, () => {
        state.isPlaying = false;
        this.processQueue(guildId);
      });

      state.player.on('error', (error) => {
        console.error(`[AudioPlayer Error in guild ${guildId}]:`, error.message);
        state.isPlaying = false;
        this.processQueue(guildId);
      });
    }
    return this.guilds.get(guildId);
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
      return state.connection;
    }

    // Destroy existing connection if moving to a new channel
    if (state.connection) {
      try {
        state.connection.destroy();
      } catch (e) {}
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
    if (state && state.connection) {
      try {
        state.connection.destroy();
      } catch (e) {}
      state.connection = null;
      state.currentChannelId = null;
      state.queue = [];
      state.isPlaying = false;
      state.player.stop();
    }
  }

  async enqueue(guildId, text, authorName = null, userOptions = {}) {
    const state = this.getGuildState(guildId);
    if (!state.connection) return false;

    const fullText = authorName ? `${authorName} говорит: ${text}` : text;

    try {
      await entersState(state.connection, VoiceConnectionStatus.Ready, 10_000);

      const voice = userOptions.voice || state.voice;
      const sources = await getTTSAudioSources(fullText, voice, userOptions);
      for (const source of sources) {
        state.queue.push(source);
      }

      if (!state.isPlaying) {
        this.processQueue(guildId);
      }
      return true;
    } catch (error) {
      console.error(`[Enqueue Error in guild ${guildId}]:`, error);
      return false;
    }
  }

  processQueue(guildId) {
    const state = this.guilds.get(guildId);
    if (!state || state.queue.length === 0) {
      if (state) state.isPlaying = false;
      return;
    }

    state.isPlaying = true;
    const source = state.queue.shift();

    try {
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

      state.player.play(resource);
    } catch (error) {
      console.error(`[Play Resource Error in guild ${guildId}]:`, error);
      state.isPlaying = false;
      this.processQueue(guildId);
    }
  }

  skip(guildId) {
    const state = this.guilds.get(guildId);
    if (state && state.player) {
      state.player.stop();
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

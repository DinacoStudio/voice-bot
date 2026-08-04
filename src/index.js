require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, Events, MessageFlags } = require('discord.js');
const sodium = require('libsodium-wrappers');
const playerManager = require('./services/player');
const settings = require('./services/settings');
const { registerSlashCommands, handleSlashCommand } = require('./commands/slashCommands');
const { sanitizeText } = require('./utils/sanitize');
const config = require('../config.json');
const pendingMessages = new Map();

async function flushMessages(key) {
  const pending = pendingMessages.get(key);
  if (!pending) return;
  pendingMessages.delete(key);

  const guildSettings = settings.getGuild(pending.guildId);
  if (!guildSettings.autoTts) return;

  const text = sanitizeText(pending.parts.join('. '), guildSettings.maxTextLength);
  if (!text) return;

  const authorName = guildSettings.readAuthorName ? pending.authorName : null;
  const userSettings = settings.getUser(pending.userId);
  await playerManager.enqueue(pending.guildId, text, authorName, userSettings);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

// Use ClientReady event (or 'ready')
client.once(Events.ClientReady, async () => {
  // Ensure libsodium encryption is ready
  await sodium.ready;

  console.log(`=========================================`);
  console.log(`🤖 TTS Bot вошел как ${client.user.tag}`);
  console.log(`=========================================`);

  // Register Slash Commands (/)
  const token = process.env.DISCORD_TOKEN;
  if (token) {
    await registerSlashCommands(client.user.id, token);
  }

  client.user.setActivity(`/help | Neural TTS Voice Bot`, { type: ActivityType.Listening });
});

// Handle Slash Commands (/)
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await handleSlashCommand(interaction);
  } catch (error) {
    console.error('[Interaction Error]:', error);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: '❌ Произошла ошибка при выполнении команды!', flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content: '❌ Произошла ошибка при выполнении команды!', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

// Auto TTS Logic for Voice Channel Members
client.on(Events.MessageCreate, async (message) => {
  // Ignore bots, DMs
  if (message.author.bot || !message.guild) return;

  const state = playerManager.getState(message.guild.id);

  // Check if bot is connected to a voice channel in this guild
  if (state && state.connection && state.currentChannelId) {
    const guildSettings = settings.getGuild(message.guild.id);
    if (!guildSettings.autoTts) return;

    const memberVoice = message.member?.voice;

    // Check if message sender is in the SAME voice channel as the bot
    if (memberVoice && memberVoice.channelId === state.currentChannelId) {

      // If config.readOnlyMuted is enabled, only read if user's mic is muted
      if (guildSettings.readOnlyMuted) {
        const isMuted = memberVoice.selfMute || memberVoice.serverMute;
        if (!isMuted) return;
      }

      // Clean the text
      const cleanText = sanitizeText(message.content, guildSettings.maxTextLength);
      if (!cleanText) return;

      // Merge consecutive messages from the same member. The timer restarts for
      // every new message and fires when the member has stopped sending text.
      const key = `${message.guild.id}:${message.author.id}`;
      const pending = pendingMessages.get(key) || {
        guildId: message.guild.id,
        userId: message.author.id,
        authorName: message.member.displayName,
        parts: [],
      };
      pending.parts.push(cleanText);
      clearTimeout(pending.timer);
      pending.timer = setTimeout(() => {
        flushMessages(key).catch((error) => console.error('[Message Merge Error]:', error));
      }, guildSettings.mergeDelayMs);
      pendingMessages.set(key, pending);

      message.react('🎙️').catch(() => {});
    }
  }
});

// Auto-disconnect when bot is left alone in voice channel
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guildId = oldState.guild.id;
  const state = playerManager.getState(guildId);

  if (state && state.connection && state.currentChannelId) {
    const channel = oldState.guild.channels.cache.get(state.currentChannelId);
    if (channel) {
      const humanMembers = channel.members.filter((m) => !m.user.bot);
      if (humanMembers.size === 0) {
        console.log(`[Voice] Guild ${guildId}: Голосовой канал пуст. Отключение...`);
        playerManager.leaveChannel(guildId);
      }
    }
  }
});

client.on('error', (err) => console.error('[Client Error]:', err));
process.on('unhandledRejection', (err) => console.error('[Unhandled Rejection]:', err));

const token = process.env.DISCORD_TOKEN;
if (!token || token === 'your_bot_token_here') {
  console.error('❌ ОШИБКА: DISCORD_TOKEN не указан в файле .env!');
  process.exit(1);
}

client.login(token);

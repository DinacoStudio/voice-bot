const {
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const playerManager = require('../services/player');
const settings = require('../services/settings');
const { sanitizeText } = require('../utils/sanitize');
const config = require('../../config.json');

// 1. Define Slash Commands data
const commands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Подключить бота к вашему текущему голосовому каналу'),

  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Отключить бота от голосового канала'),

  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Озвучить текст в голосовом канале')
    .addStringOption((option) =>
      option
        .setName('text')
        .setDescription('Текст для озвучивания')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Выбрать ваш личный голос TTS')
    .addStringOption((option) =>
      option
        .setName('select')
        .setDescription('Выберите голос из списка')
        .setRequired(true)
        .addChoices(
          { name: 'Svetlana (Женский 🇷🇺 - Edge Neural)', value: 'svetlana' },
          { name: 'Dmitry (Мужской 🇷🇺 - Edge Neural)', value: 'dmitry' },
          { name: 'Ava (English 🇺🇸 - Edge Neural)', value: 'ava' },
          { name: 'Google TTS (Стандарт)', value: 'google' }
        )
    ),

  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Настроить ваш голос и скорость речи')
    .addStringOption((option) =>
      option.setName('voice').setDescription('Ваш голос').addChoices(
        { name: 'Svetlana (Женский 🇷🇺)', value: 'svetlana' },
        { name: 'Dmitry (Мужской 🇷🇺)', value: 'dmitry' },
        { name: 'Ava (English 🇺🇸)', value: 'ava' },
        { name: 'Google TTS', value: 'google' }
      )
    )
    .addNumberOption((option) =>
      option
        .setName('speed')
        .setDescription('Скорость речи: 0.5–2.0 (обычная — 1.0)')
        .setMinValue(0.5)
        .setMaxValue(2)
    )
    .addIntegerOption((option) =>
      option.setName('pitch').setDescription('Тон голоса: от -50% до +50%').setMinValue(-50).setMaxValue(50)
    )
    .addIntegerOption((option) =>
      option.setName('volume').setDescription('Громкость: 20–100%').setMinValue(20).setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Открыть панель управления TTS')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Пропустить текущую озвучку'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Показать справку по боту и авто-озвучке'),
];

function buildAdminPanel(guildId) {
  const guild = settings.getGuild(guildId);
  const enabled = (value) => (value ? '🟢 Включено' : '🔴 Выключено');
  const embed = new EmbedBuilder()
    .setColor(guild.autoTts ? 0x57f287 : 0xed4245)
    .setTitle('⚙️ Панель управления TTS')
    .setDescription('Настройки применяются сразу и сохраняются после перезапуска.')
    .addFields(
      { name: '🎙️ Автоозвучка', value: enabled(guild.autoTts), inline: true },
      { name: '👤 Имя автора', value: enabled(guild.readAuthorName), inline: true },
      { name: '🔇 Только без микрофона', value: enabled(guild.readOnlyMuted), inline: true },
      { name: '⏱️ Объединение', value: `${guild.mergeDelayMs / 1000} сек. тишины`, inline: true },
      { name: '📝 Лимит текста', value: `${guild.maxTextLength} символов`, inline: true },
      { name: '🗄️ Хранение', value: 'SQLite • WAL • persistent', inline: true }
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tts_admin:autoTts').setLabel('Авто TTS').setEmoji('🎙️').setStyle(guild.autoTts ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tts_admin:readAuthorName').setLabel('Имя автора').setEmoji('👤').setStyle(guild.readAuthorName ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tts_admin:readOnlyMuted').setLabel('Только muted').setEmoji('🔇').setStyle(guild.readOnlyMuted ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
  const delayRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('tts_admin_select:mergeDelayMs')
      .setPlaceholder('⏱️ Пауза для склейки сообщений')
      .addOptions([500, 1000, 1500, 2500, 4000].map((value) => ({
        label: `${value / 1000} сек.`, value: String(value), default: guild.mergeDelayMs === value,
      })))
  );
  const lengthRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('tts_admin_select:maxTextLength')
      .setPlaceholder('📝 Максимальная длина текста')
      .addOptions([100, 200, 350, 500, 1000].map((value) => ({
        label: `${value} символов`, value: String(value), default: guild.maxTextLength === value,
      })))
  );
  return { embeds: [embed], components: [row, delayRow, lengthRow] };
}

function buildUserPanel(userId) {
  const user = settings.getUser(userId);
  const voiceEntry = Object.entries(config.availableVoices).find(([, item]) => item.voice === user.voice);
  const voiceName = voiceEntry?.[1].name || user.voice;
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🎧 Мой TTS-профиль')
    .setDescription('Все параметры личные и сохраняются в SQLite.')
    .addFields(
      { name: '🎙️ Голос', value: voiceName, inline: true },
      { name: '⏩ Скорость', value: `${user.rate}×`, inline: true },
      { name: '🎵 Тон', value: `${user.pitch > 0 ? '+' : ''}${user.pitch}%`, inline: true },
      { name: '🔊 Громкость', value: `${user.volume}%`, inline: true }
    );
  const select = (id, placeholder, values, current, suffix = '') => new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`tts_user:${id}`).setPlaceholder(placeholder).addOptions(
      values.map((value) => ({ label: `${value}${suffix}`, value: String(value), default: Number(current) === Number(value) }))
    )
  );
  const voiceRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('tts_user:voice').setPlaceholder('🎙️ Выберите голос').addOptions(
      Object.entries(config.availableVoices).map(([key, item]) => ({ label: item.name, value: key, default: item.voice === user.voice }))
    )
  );
  return {
    embeds: [embed],
    components: [
      voiceRow,
      select('rate', '⏩ Скорость', [0.5, 0.75, 1, 1.25, 1.5, 2], user.rate, '×'),
      select('pitch', '🎵 Тон', [-40, -20, 0, 20, 40], user.pitch, '%'),
      select('volume', '🔊 Громкость', [20, 40, 60, 80, 100], user.volume, '%'),
    ],
  };
}

/**
 * Register Slash Commands globally via REST API.
 */
async function registerSlashCommands(clientId, token) {
  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('🔄 Регистрация слеш-команд (/)...');
    await rest.put(Routes.applicationCommands(clientId), {
      body: commands.map((cmd) => cmd.toJSON()),
    });
    console.log('✅ Слеш-команды (/) успешно зарегистрированы!');
  } catch (error) {
    console.error('❌ Ошибка при регистрации слеш-команд:', error);
  }
}

/**
 * Handle incoming Slash Command Interactions.
 */
async function handleSlashCommand(interaction) {
  if (interaction.isButton() && interaction.customId.startsWith('tts_admin:')) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Эта панель доступна только администраторам.', flags: MessageFlags.Ephemeral });
    }
    const key = interaction.customId.split(':')[1];
    const guild = settings.getGuild(interaction.guildId);
    settings.updateGuild(interaction.guildId, { [key]: !guild[key] });
    return interaction.update(buildAdminPanel(interaction.guildId));
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('tts_admin_select:')) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Эта панель доступна только администраторам.', flags: MessageFlags.Ephemeral });
    }
    const key = interaction.customId.split(':')[1];
    settings.updateGuild(interaction.guildId, { [key]: Number(interaction.values[0]) });
    return interaction.update(buildAdminPanel(interaction.guildId));
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('tts_user:')) {
    const key = interaction.customId.split(':')[1];
    const rawValue = interaction.values[0];
    const value = key === 'voice' ? config.availableVoices[rawValue]?.voice : Number(rawValue);
    if (value === undefined) {
      return interaction.reply({ content: '❌ Неверная настройка.', flags: MessageFlags.Ephemeral });
    }
    settings.updateUser(interaction.user.id, { [key]: value });
    return interaction.update(buildUserPanel(interaction.user.id));
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, guildId, member } = interaction;

  switch (commandName) {
    case 'join': {
      const voiceChannel = member?.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({
          content: '❌ Вы должны находиться в голосовом канале!',
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply();
      try {
        await playerManager.joinChannel(voiceChannel);
        return interaction.editReply(`🔊 Подключился к каналу **${voiceChannel.name}**!`);
      } catch (err) {
        return interaction.editReply(`❌ Ошибка подключения: ${err.message}`);
      }
    }

    case 'leave': {
      playerManager.leaveChannel(guildId);
      return interaction.reply('👋 Отключился от голосового канала.');
    }

    case 'say': {
      const state = playerManager.getState(guildId);
      if (!state || !state.connection) {
        return interaction.reply({
          content: '❌ Бот не подключен к голосовому каналу. Используйте `/join`!',
          flags: MessageFlags.Ephemeral,
        });
      }

      const rawText = options.getString('text');
      const guildSettings = settings.getGuild(guildId);
      const cleanText = sanitizeText(rawText, guildSettings.maxTextLength);

      if (!cleanText) {
        return interaction.reply({
          content: '❌ Укажите корректный текст для озвучки!',
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply();
      const userSettings = settings.getUser(interaction.user.id);
      const authorName = guildSettings.readAuthorName ? member.displayName : null;
      const success = await playerManager.enqueue(guildId, cleanText, authorName, userSettings);

      if (success) {
        return interaction.editReply(`🗣️ Добавлено в очередь озвучки: "${cleanText}"`);
      } else {
        return interaction.editReply('❌ Ошибка при добавлении в очередь озвучки.');
      }
    }

    case 'voice': {
      const selectedVoice = options.getString('select');
      const voiceName = config.availableVoices[selectedVoice]?.voice || config.defaultVoice;
      settings.updateUser(interaction.user.id, { voice: voiceName });

      return interaction.reply({ ...buildUserPanel(interaction.user.id), flags: MessageFlags.Ephemeral });
    }

    case 'settings': {
      const selectedVoice = options.getString('voice');
      const selectedSpeed = options.getNumber('speed');
      const selectedPitch = options.getInteger('pitch');
      const selectedVolume = options.getInteger('volume');
      const changes = {};
      if (selectedVoice) changes.voice = config.availableVoices[selectedVoice].voice;
      if (selectedSpeed !== null) changes.rate = selectedSpeed;
      if (selectedPitch !== null) changes.pitch = selectedPitch;
      if (selectedVolume !== null) changes.volume = selectedVolume;
      if (Object.keys(changes).length) settings.updateUser(interaction.user.id, changes);
      return interaction.reply({ ...buildUserPanel(interaction.user.id), flags: MessageFlags.Ephemeral });
    }

    case 'admin': {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Нужно право Administrator.', flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ ...buildAdminPanel(guildId), flags: MessageFlags.Ephemeral });
    }

    case 'skip': {
      playerManager.skip(guildId);
      return interaction.reply('⏭️ Пропущено.');
    }

    case 'help': {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎙️ TTS Voice Bot (Бесплатный Нейросетевой TTS)')
        .setDescription(
          'Бот автоматически озвучивает в голосовом канале сообщения участников (например, у кого выключен микрофон!).'
        )
        .addFields(
          { name: '`/join`', value: 'Подключить бота к вашему голосовому каналу' },
          { name: '`/leave`', value: 'Отключить бота от голосового канала' },
          { name: '`/say <текст>`', value: 'Озвучить произвольный текст в канале' },
          { name: '`/voice <выбор>`', value: 'Сменить нейросетевой голос (Svetlana, Dmitry, Ava, Google)' },
          { name: '`/settings`', value: 'Ваши личные голос и скорость речи' },
          { name: '`/admin`', value: 'Панель управления для администраторов' },
          { name: '`/skip`', value: 'Пропустить текущую озвучку' },
          { name: '`/help`', value: 'Показать эту справку' }
        )
        .setFooter({
          text: '💡 Авто-озвучка: Отправьте обычное текстовое сообщение в чат, когда вы в голосовом канале с ботом!',
        });

      return interaction.reply({ embeds: [embed] });
    }

    default:
      break;
  }
}

module.exports = {
  commands,
  registerSlashCommands,
  handleSlashCommand,
};

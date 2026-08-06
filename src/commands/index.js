const playerManager = require("../services/player");
const { sanitizeText } = require("../utils/sanitize");
const config = require("../../config.json");

async function handleCommand(message, prefix) {
  if (!message.content.startsWith(prefix) || message.author.bot) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  switch (command) {
    case "join":
    case "j": {
      const voiceChannel = message.member?.voice?.channel;
      if (!voiceChannel) {
        return message.reply("❌ Вы должны находиться в голосовом канале!");
      }

      try {
        await playerManager.joinChannel(voiceChannel);
        return message.reply(
          `🔊 Подключился к каналу **${voiceChannel.name}**!`,
        );
      } catch (err) {
        console.error(err);
        return message.reply(`❌ Ошибка подключения: ${err.message}`);
      }
    }

    case "leave":
    case "l":
    case "stop": {
      playerManager.leaveChannel(message.guild.id);
      return message.reply("👋 Отключился от голосового канала.");
    }

    case "say":
    case "s":
    case "tts": {
      const state = playerManager.getState(message.guild.id);
      if (!state || !state.connection) {
        return message.reply(
          "❌ Бот не подключен к голосовому каналу. Используйте `!join`!",
        );
      }

      const rawText = args.join(" ");
      const text = sanitizeText(rawText, config.maxTextLength);

      if (!text) {
        return message.reply("❌ Укажите текст для озвучки!");
      }

      playerManager.enqueue(
        message.guild.id,
        text,
        config.readAuthorName ? message.member.displayName : null,
      );
      return message.react("🗣️").catch(() => {});
    }

    case "skip": {
      playerManager.skip(message.guild.id);
      return message.reply("⏭️ Озвучка пропущена.");
    }

    case "lang": {
      const newLang = args[0];
      if (!newLang) {
        const state = playerManager.getState(message.guild.id);
        const currentLang = state ? state.lang : config.defaultLang;
        return message.reply(
          `🌐 Текущий язык TTS: **${currentLang}**. Изменить: \`!lang <код_языка>\` (например: \`ru\`, \`en\`, \`de\`, \`es\`)`,
        );
      }

      const lang = playerManager.setLanguage(message.guild.id, newLang);
      return message.reply(`🌐 Язык TTS изменен на: **${lang}**`);
    }

    case "help":
    case "h": {
      const helpEmbed = {
        color: 0x5865f2,
        title: "🎙️ TTS Voice Bot - Команды",
        description:
          "Бот озвучивает сообщения пользователей в голосовом канале (отлично подходит для тех, у кого выключен микрофон!).",
        fields: [
          {
            name: "`!join` (`!j`)",
            value: "Подключить бота к вашему голосовому каналу.",
          },
          {
            name: "`!leave` (`!l`)",
            value: "Отключить бота от голосового канала.",
          },
          {
            name: "`!say <текст>` (`!s`)",
            value: "Принудительно озвучить текст.",
          },
          { name: "`!skip`", value: "Пропустить текущее озвучивание." },
          {
            name: "`!lang <код>`",
            value: "Сменить язык озвучки (например: `ru`, `en`, `ja`).",
          },
          { name: "`!help`", value: "Показать эту справку." },
        ],
        footer: {
          text: "Авто-озвучка: Отправьте сообщение в чат, находясь в одном канале с ботом!",
        },
      };

      return message.reply({ embeds: [helpEmbed] });
    }

    default:
      break;
  }
}

module.exports = { handleCommand };

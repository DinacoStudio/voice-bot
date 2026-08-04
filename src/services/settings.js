const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../../config.json');

const dataDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'tts-bot.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    voice TEXT NOT NULL,
    rate REAL NOT NULL DEFAULT 1 CHECK(rate BETWEEN 0.5 AND 2),
    pitch INTEGER NOT NULL DEFAULT 0 CHECK(pitch BETWEEN -50 AND 50),
    volume INTEGER NOT NULL DEFAULT 100 CHECK(volume BETWEEN 20 AND 100),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    auto_tts INTEGER NOT NULL DEFAULT 1 CHECK(auto_tts IN (0, 1)),
    read_author_name INTEGER NOT NULL DEFAULT 1 CHECK(read_author_name IN (0, 1)),
    read_only_muted INTEGER NOT NULL DEFAULT 0 CHECK(read_only_muted IN (0, 1)),
    reaction_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reaction_enabled IN (0, 1)),
    auto_disconnect INTEGER NOT NULL DEFAULT 1 CHECK(auto_disconnect IN (0, 1)),
    merge_delay_ms INTEGER NOT NULL DEFAULT 1500 CHECK(merge_delay_ms BETWEEN 300 AND 10000),
    max_text_length INTEGER NOT NULL DEFAULT 200 CHECK(max_text_length BETWEEN 50 AND 1000),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('guild_settings', 'reaction_enabled', 'INTEGER NOT NULL DEFAULT 1 CHECK(reaction_enabled IN (0, 1))');
ensureColumn('guild_settings', 'auto_disconnect', 'INTEGER NOT NULL DEFAULT 1 CHECK(auto_disconnect IN (0, 1))');

const selectUser = db.prepare('SELECT * FROM user_settings WHERE user_id = ?');
const upsertUser = db.prepare(`
  INSERT INTO user_settings (user_id, voice, rate, pitch, volume, updated_at)
  VALUES (@userId, @voice, @rate, @pitch, @volume, CURRENT_TIMESTAMP)
  ON CONFLICT(user_id) DO UPDATE SET
    voice = excluded.voice, rate = excluded.rate, pitch = excluded.pitch,
    volume = excluded.volume, updated_at = CURRENT_TIMESTAMP
`);
const selectGuild = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?');
const upsertGuild = db.prepare(`
  INSERT INTO guild_settings
    (guild_id, auto_tts, read_author_name, read_only_muted, reaction_enabled, auto_disconnect,
     merge_delay_ms, max_text_length, updated_at)
  VALUES (@guildId, @autoTts, @readAuthorName, @readOnlyMuted, @reactionEnabled, @autoDisconnect,
          @mergeDelayMs, @maxTextLength, CURRENT_TIMESTAMP)
  ON CONFLICT(guild_id) DO UPDATE SET
    auto_tts = excluded.auto_tts, read_author_name = excluded.read_author_name,
    read_only_muted = excluded.read_only_muted, reaction_enabled = excluded.reaction_enabled,
    auto_disconnect = excluded.auto_disconnect, merge_delay_ms = excluded.merge_delay_ms,
    max_text_length = excluded.max_text_length, updated_at = CURRENT_TIMESTAMP
`);

function getUser(userId) {
  const row = selectUser.get(userId);
  return row
    ? { voice: row.voice, rate: row.rate, pitch: row.pitch, volume: row.volume }
    : { voice: config.defaultVoice, rate: 1, pitch: 0, volume: 100 };
}

function updateUser(userId, changes) {
  const next = { ...getUser(userId), ...changes };
  next.rate = Math.min(2, Math.max(0.5, Number(next.rate) || 1));
  next.pitch = Math.min(50, Math.max(-50, Math.round(Number(next.pitch) || 0)));
  next.volume = Math.min(100, Math.max(20, Math.round(Number(next.volume) || 100)));
  upsertUser.run({ userId, ...next });
  return getUser(userId);
}

function getGuild(guildId) {
  const row = selectGuild.get(guildId);
  return row
    ? {
        autoTts: Boolean(row.auto_tts),
        readAuthorName: Boolean(row.read_author_name),
        readOnlyMuted: Boolean(row.read_only_muted),
        reactionEnabled: Boolean(row.reaction_enabled),
        autoDisconnect: Boolean(row.auto_disconnect),
        mergeDelayMs: row.merge_delay_ms,
        maxTextLength: row.max_text_length,
      }
    : {
        autoTts: true,
        readAuthorName: config.readAuthorName,
        readOnlyMuted: config.readOnlyMuted,
        reactionEnabled: true,
        autoDisconnect: true,
        mergeDelayMs: config.messageMergeDelayMs || 1500,
        maxTextLength: config.maxTextLength || 200,
      };
}

function updateGuild(guildId, changes) {
  const next = { ...getGuild(guildId), ...changes };
  next.mergeDelayMs = Math.min(10000, Math.max(300, Math.round(Number(next.mergeDelayMs) || 1500)));
  next.maxTextLength = Math.min(1000, Math.max(50, Math.round(Number(next.maxTextLength) || 200)));
  upsertGuild.run({
    guildId,
    autoTts: Number(Boolean(next.autoTts)),
    readAuthorName: Number(Boolean(next.readAuthorName)),
    readOnlyMuted: Number(Boolean(next.readOnlyMuted)),
    reactionEnabled: Number(Boolean(next.reactionEnabled)),
    autoDisconnect: Number(Boolean(next.autoDisconnect)),
    mergeDelayMs: next.mergeDelayMs,
    maxTextLength: next.maxTextLength,
  });
  return getGuild(guildId);
}

// One-time migration from the previous JSON storage.
const migrationDone = db.prepare("SELECT value FROM app_meta WHERE key = 'json_migrated'").get();
if (!migrationDone) {
  const jsonFile = path.join(dataDir, 'settings.json');
  if (fs.existsSync(jsonFile)) {
    try {
      const old = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      db.transaction(() => {
        for (const [userId, value] of Object.entries(old.users || {})) updateUser(userId, value);
        for (const [guildId, value] of Object.entries(old.guilds || {})) updateGuild(guildId, value);
      })();
    } catch (error) {
      console.error('[Settings Migration Error]:', error);
    }
  }
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('json_migrated', CURRENT_TIMESTAMP)").run();
}

function close() {
  db.close();
}

module.exports = { getUser, updateUser, getGuild, updateGuild, close };

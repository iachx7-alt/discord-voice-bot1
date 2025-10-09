// index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

/**
 * ENV esperadas:
 * - TOKEN=seu_token_do_bot
 * - WEBHOOK_URL=https://seu_n8n/webhook/discord/voice
 * - TZ=America/Sao_Paulo (opcional; default abaixo)
 */
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const TIMEZONE = process.env.TZ || 'America/Sao_Paulo';

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const tz = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(tz);

// --- Client Discord ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// --- Sessões por usuário (chave: guildId:userId) ---
/**
 * sessionStore: Map<key, { channelId, channelName, startedAt: number }>
 * - startedAt em ms epoch
 */
const sessionStore = new Map();
const keyFor = (guildId, userId) => `${guildId}:${userId}`;

// Helpers de data
function nowIso() {
  return dayjs().toISOString();
}
function toLocal(whenMs) {
  return dayjs(whenMs).tz(TIMEZONE).format('DD/MM/YYYY, HH:mm:ss');
}
function nowLocal() {
  return dayjs().tz(TIMEZONE).format('DD/MM/YYYY, HH:mm:ss');
}
function humanDuration(ms) {
  let secs = Math.floor(ms / 1000);
  const h = Math.floor(secs / 3600);
  secs -= h * 3600;
  const m = Math.floor(secs / 60);
  secs -= m * 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (secs || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(' ');
}

// pega nome do canal com fallback
function labelChannel(ch) {
  return ch?.name ?? '';
}

// envia pro n8n
async function sendToWebhook(payload) {
  if (!WEBHOOK_URL) {
    console.error('❌ WEBHOOK_URL não configurada no .env');
    return;
  }
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Erro ao enviar para n8n:', err?.message || err);
  }
}

// abre nova sessão
function openSession(guildId, userId, channelId, channelName, startedAtMs = Date.now()) {
  sessionStore.set(keyFor(guildId, userId), {
    channelId,
    channelName,
    startedAt: startedAtMs,
  });
}

// fecha sessão existente e retorna dados de duração
function closeSession(guildId, userId) {
  const k = keyFor(guildId, userId);
  const s = sessionStore.get(k);
  if (!s) return null;
  const endedAt = Date.now();
  const durationMs = endedAt - s.startedAt;
  const data = {
    fromChannelId: s.channelId,
    fromChannelName: s.channelName,
    sessionStartIso: dayjs(s.startedAt).toISOString(),
    sessionStartLocal: toLocal(s.startedAt),
    sessionEndIso: dayjs(endedAt).toISOString(),
    sessionEndLocal: toLocal(endedAt),
    durationSec: Math.floor(durationMs / 1000),
    durationHuman: humanDuration(durationMs),
  };
  sessionStore.delete(k);
  return data;
}

client.on(Events.ClientReady, () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  // ignore bots (inclusive o próprio)
  if (newState.member?.user?.bot) return;

  const userId = newState.id;
  const username = newState.member?.user?.username || oldState.member?.user?.username || '';
  const guildId = newState.guild.id;

  const oldCh = oldState.channel; // null se não tinha
  const newCh = newState.channel; // null se saiu

  const timestampIso = nowIso();
  const timestampLocal = nowLocal();

  // JOIN
  if (!oldCh && newCh) {
    openSession(guildId, userId, newCh.id, labelChannel(newCh));

    const payload = {
      timestampIso,
      timestampLocal,
      timezone: TIMEZONE,
      userId,
      username,
      action: 'JOIN',
      channelId: newCh.id,
      channelName: labelChannel(newCh),

      // sem duração em JOIN
      sessionStartIso: '',
      sessionStartLocal: '',
      sessionEndIso: '',
      sessionEndLocal: '',
      durationSec: 0,
      durationHuman: '',
    };

    console.log(`✅ ${username} JOIN -> ${labelChannel(newCh)}`);
    await sendToWebhook(payload);
    return;
  }

  // MOVE
  if (oldCh && newCh && oldCh.id !== newCh.id) {
    // fecha a sessão do canal antigo
    const closed = closeSession(guildId, userId);

    // abre sessão no novo canal
    openSession(guildId, userId, newCh.id, labelChannel(newCh));

    const payload = {
      timestampIso,
      timestampLocal,
      timezone: TIMEZONE,
      userId,
      username,
      action: 'MOVE',
      channelId: newCh.id, // canal atual
      channelName: labelChannel(newCh),

      fromChannelId: oldCh.id,
      fromChannelName: labelChannel(oldCh),
      toChannelId: newCh.id,
      toChannelName: labelChannel(newCh),

      // duração da permanência NO CANAL ANTIGO:
      sessionStartIso: closed?.sessionStartIso || '',
      sessionStartLocal: closed?.sessionStartLocal || '',
      sessionEndIso: closed?.sessionEndIso || '',
      sessionEndLocal: closed?.sessionEndLocal || '',
      durationSec: closed?.durationSec || 0,
      durationHuman: closed?.durationHuman || '',
    };

    console.log(`🔀 ${username} MOVE: ${labelChannel(oldCh)} -> ${labelChannel(newCh)} (${payload.durationHuman || '—'})`);
    await sendToWebhook(payload);
    return;
  }

  // LEAVE
  if (oldCh && !newCh) {
    // fecha sessão do canal que estava
    const closed = closeSession(guildId, userId);

    const payload = {
      timestampIso,
      timestampLocal,
      timezone: TIMEZONE,
      userId,
      username,
      action: 'LEAVE',
      channelId: oldCh.id, // canal que saiu
      channelName: labelChannel(oldCh),

      fromChannelId: oldCh.id,
      fromChannelName: labelChannel(oldCh),
      toChannelId: '',
      toChannelName: '',

      // duração da permanência NO CANAL ANTIGO:
      sessionStartIso: closed?.sessionStartIso || '',
      sessionStartLocal: closed?.sessionStartLocal || '',
      sessionEndIso: closed?.sessionEndIso || '',
      sessionEndLocal: closed?.sessionEndLocal || '',
      durationSec: closed?.durationSec || 0,
      durationHuman: closed?.durationHuman || '',
    };

    console.log(`👋 ${username} LEAVE: ${labelChannel(oldCh)} (${payload.durationHuman || '—'})`);
    await sendToWebhook(payload);
    return;
  }

  // outros casos: mudo de mute/deaf, etc. (não interessa)
});

client.login(process.env.TOKEN);

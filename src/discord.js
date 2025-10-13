// src/discord.js
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { postWebhook } from './services/webhook.js';
import {
  WEBHOOK_URL,
  CH_SALES_ON,
  CH_ALINHAMENTOS,
  CH_REUNIAO,
  CH_INATIVIDADE,
  CH_COFFEE,
} from './config.js';

// ------- util -------
const SESSIONS = new Map(); // userId -> ISO de início da sessão

const WATCHED_CHANNELS = new Set(
  [CH_SALES_ON, CH_ALINHAMENTOS, CH_REUNIAO, CH_INATIVIDADE, CH_COFFEE].filter(Boolean)
);

function nowISO() {
  return new Date().toISOString();
}

function tsLocal(iso) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (r || parts.length === 0) parts.push(`${r}s`);
  return parts.join(' ');
}

async function sendRow(row) {
  const payload = {
    timestampLocal: tsLocal(row.ts),
    username: row.username,
    action: row.action,
    channelName: row.channelName ?? '',
    durationHuman: row.durationHuman ?? '',
    sessionStartLocal: row.sessionStart ? tsLocal(row.sessionStart) : '',
    sessionEndLocal: row.sessionEnd ? tsLocal(row.sessionEnd) : '',
  };

  console.log('[event]', payload);
  await postWebhook(WEBHOOK_URL, payload);
  console.log('[webhook] evento enviado:', payload);
}

// ------- discord client -------
export function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    console.log('[bot] Logado como', `${c.user.username}#${c.user.discriminator}`);
    console.log('[config] WATCHED_CHANNELS:', [...WATCHED_CHANNELS]);
    if (!WEBHOOK_URL) console.warn('[config] WEBHOOK_URL vazio! Não enviará ao n8n.');
  });

  client.on(Events.VoiceStateUpdate, async (oldS, newS) => {
    // ignorar se nada mudou
    if (oldS.channelId === newS.channelId) return;

    const user = newS.member?.user ?? oldS.member?.user;
    if (!user || user.bot) return;

    const ts = nowISO();

    const oldId = oldS.channelId;
    const newId = newS.channelId;
    const oldName = oldS.channel?.name ?? '';
    const newName = newS.channel?.name ?? '';

    const isOldWatched = oldId ? WATCHED_CHANNELS.has(oldId) : false;
    const isNewWatched = newId ? WATCHED_CHANNELS.has(newId) : false;

    console.log('[debug] voice move:', {
      user: user.username, oldId, oldName, newId, newName, isOldWatched, isNewWatched,
    });

    try {
      // Entrou em canal monitorado (não monitorado -> monitorado)
      if (!isOldWatched && isNewWatched) {
        SESSIONS.set(user.id, ts);
        await sendRow({
          ts,
          username: user.globalName || user.username,
          action: 'JOIN',
          channelName: newName,
          sessionStart: ts,
          sessionEnd: null,
          durationHuman: '',
        });
      }

      // Saiu de canal monitorado (monitorado -> não monitorado)
      if (isOldWatched && !isNewWatched) {
        const start = SESSIONS.get(user.id) || null;
        const end = ts;
        let durationHuman = '';

        if (start) {
          const seconds = (new Date(end) - new Date(start)) / 1000;
          durationHuman = formatDuration(seconds);
        }
        SESSIONS.delete(user.id);

        await sendRow({
          ts: end,
          username: user.globalName || user.username,
          action: 'LEAVE',
          channelName: oldName,
          sessionStart: start,
          sessionEnd: end,
          durationHuman,
        });
      }

      // Move interno (monitorado->monitorado ou não->não): apenas registra
      if ((isOldWatched && isNewWatched) || (!isOldWatched && !isNewWatched)) {
        await sendRow({
          ts,
          username: user.globalName || user.username,
          action: 'MOVE',
          channelName: newName || oldName,
          sessionStart: null,
          sessionEnd: null,
          durationHuman: '',
        });
      }
    } catch (err) {
      console.error('[voice] erro no handler:', err);
    }
  });

  return client;
}

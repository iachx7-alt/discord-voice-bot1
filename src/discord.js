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
  SOURCE,
} from './config.js';

// --------- estado de sessão por usuário ---------
/**
 * SESSIONS[userId] = {
 *   channelId: string,
 *   channelName: string,
 *   startISO: string
 * }
 */
const SESSIONS = new Map();

const WATCHED_CHANNELS = new Set(
  [CH_SALES_ON, CH_ALINHAMENTOS, CH_REUNIAO, CH_INATIVIDADE, CH_COFFEE].filter(Boolean)
);

// --------- helpers básicos ---------
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
    source: SOURCE || 'VPS',
    timestampLocal: tsLocal(row.ts),
    username: row.username,
    userId: row.userId,
    action: row.action,
    channelName: row.channelName ?? '',
    durationHuman: row.durationHuman ?? '',
    sessionStartLocal: row.sessionStart ? tsLocal(row.sessionStart) : '',
    sessionEndLocal: row.sessionEnd ? tsLocal(row.sessionEnd) : '',
  };

  console.log('[event]', payload);
  await postWebhook(WEBHOOK_URL, payload);
  console.log('[webhook] enviado');
}

/**
 * Fecha a sessão atual do usuário (se existir) e envia um LEAVE com duração.
 */
async function closeSessionAndSend(userId, username, endISO, reason = '') {
  const sess = SESSIONS.get(userId);
  if (!sess) return;

  const { channelId, channelName, startISO } = sess;
  let durationHuman = '';

  if (startISO) {
    const seconds = (new Date(endISO) - new Date(startISO)) / 1000;
    durationHuman = formatDuration(seconds);
  }

  console.log('[session] CLOSE', {
    userId,
    username,
    channelId,
    channelName,
    startISO,
    endISO,
    durationHuman,
    reason,
  });

  await sendRow({
    ts: endISO,
    username,
    userId,
    action: 'LEAVE',
    channelName,
    sessionStart: startISO,
    sessionEnd: endISO,
    durationHuman,
  });

  SESSIONS.delete(userId);
}

/**
 * Abre uma nova sessão para o usuário na sala informada.
 */
function openSession(userId, channelId, channelName, startISO) {
  SESSIONS.set(userId, { channelId, channelName, startISO });
  console.log('[session] OPEN', { userId, channelId, channelName, startISO });
}

// --------- cliente discord ---------
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
    console.log('[config] SOURCE:', SOURCE || 'VPS');
    console.log('[config] WATCHED_CHANNELS:', [...WATCHED_CHANNELS]);
    if (!WEBHOOK_URL) console.warn('[config] WEBHOOK_URL vazio! Não enviará ao n8n.');
  });

  client.on(Events.VoiceStateUpdate, async (oldS, newS) => {
    // se não mudou de canal, ignora
    if (oldS.channelId === newS.channelId) return;

    const user = newS.member?.user ?? oldS.member?.user;
    if (!user || user.bot) return; // só humanos

    const ts = nowISO();

    const oldId = oldS.channelId;
    const newId = newS.channelId;
    const oldName = oldS.channel?.name ?? '';
    const newName = newS.channel?.name ?? '';

    const isOldWatched = oldId ? WATCHED_CHANNELS.has(oldId) : false;
    const isNewWatched = newId ? WATCHED_CHANNELS.has(newId) : false;

    const username = user.globalName || user.username;

    console.log('[debug] move', {
      user: username,
      oldId,
      oldName,
      newId,
      newName,
      isOldWatched,
      isNewWatched,
    });

    try {
      // CASO 1: fora -> canal monitorado (abre sessão + JOIN)
      if (!isOldWatched && isNewWatched) {
        // se por algum motivo já tinha sessão aberta, fecha antes
        if (SESSIONS.has(user.id)) {
          await closeSessionAndSend(user.id, username, ts, 'stale-before-join');
        }

        openSession(user.id, newId, newName, ts);

        await sendRow({
          ts,
          username,
          userId: user.id,
          action: 'JOIN',
          channelName: newName,
          sessionStart: ts,
          sessionEnd: null,
          durationHuman: '',
        });

        return;
      }

      // CASO 2: canal monitorado -> fora (fecha sessão + LEAVE)
      if (isOldWatched && !isNewWatched) {
        await closeSessionAndSend(user.id, username, ts, 'left-watched');
        return;
      }

      // CASO 3: canal monitorado -> outro canal monitorado
      // LEAVE da sala antiga + JOIN da nova
      if (isOldWatched && isNewWatched) {
        // fecha sessão antiga calculando duração daquela sala
        await closeSessionAndSend(user.id, username, ts, 'switch-watched');

        // abre sessão nova na sala de destino
        openSession(user.id, newId, newName, ts);

        // registra JOIN na nova sala
        await sendRow({
          ts,
          username,
          userId: user.id,
          action: 'JOIN',
          channelName: newName,
          sessionStart: ts,
          sessionEnd: null,
          durationHuman: '',
        });

        return;
      }

      // CASO 4: fora -> fora (não monitorado): não faz nada
      // mas, se existir sessão aberta, fecha pra não ficar “fantasma”
      if (!isOldWatched && !isNewWatched && SESSIONS.has(user.id)) {
        await closeSessionAndSend(user.id, username, ts, 'fallback-out-of-watched');
      }
    } catch (err) {
      console.error('[voice] erro no handler:', err);
    }
  });

  return client;
}

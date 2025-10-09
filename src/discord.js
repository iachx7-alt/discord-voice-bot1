// src/discord.js
import {
  Client,
  GatewayIntentBits,
  Events,
} from 'discord.js';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import { sendVoiceEvent } from './services/webhook.js';

dayjs.extend(duration);

// Guarda quando cada usuário entrou (pra calcular duração ao sair)
const joins = new Map(); // key: userId -> { startedAt, channelId }

export function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers, // ajuda a pegar displayName/username
    ],
  });

  client.on(Events.ClientReady, () => {
    console.log('[bot] Logado como', client.user?.tag);
  });

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    // ignora o próprio bot
    const userIsBot = (newState.member ?? oldState.member)?.user?.bot;
    if (userIsBot) return;

    const oldId = oldState.channelId;
    const newId = newState.channelId;

    // não houve mudança real
    if (oldId === newId) return;

    const member = newState.member ?? oldState.member;
    const userId = member?.id ?? newState.id;
    const username =
      member?.displayName ??
      member?.user?.globalName ??
      member?.user?.username ??
      userId;

    const guild = newState.guild ?? oldState.guild;
    const oldName = oldId ? guild.channels.cache.get(oldId)?.name ?? oldId : null;
    const newName = newId ? guild.channels.cache.get(newId)?.name ?? newId : null;

    let action; // JOIN | LEAVE | MOVE
    let startedAt = null;
    let endedAt = null;
    let durationSec = null;
    let durationHuman = null;

    // Entrou num canal
    if (!oldId && newId) {
      action = 'JOIN';
      joins.set(userId, { startedAt: Date.now(), channelId: newId });
    }
    // Saiu do canal
    else if (oldId && !newId) {
      action = 'LEAVE';
      const info = joins.get(userId);
      startedAt = info?.startedAt ?? null;
      endedAt = Date.now();

      if (startedAt) {
        durationSec = Math.max(1, Math.round((endedAt - startedAt) / 1000));
        durationHuman = dayjs.duration(durationSec, 'seconds').humanize();
      }
      joins.delete(userId);
    }
    // Moveu de canal
    else if (oldId && newId) {
      action = 'MOVE';

      // Atualiza canal corrente e mantém início (pra consolidar quando sair)
      const prev = joins.get(userId);
      if (prev?.startedAt) {
        joins.set(userId, { startedAt: prev.startedAt, channelId: newId });
      } else {
        joins.set(userId, { startedAt: Date.now(), channelId: newId });
      }
    }

    const payload = {
      ts: new Date().toISOString(),
      guildId: guild?.id ?? null,
      guildName: guild?.name ?? null,

      userId,
      username,

      action, // JOIN | LEAVE | MOVE

      oldChannelId: oldId ?? null,
      oldChannelName: oldName ?? null,
      newChannelId: newId ?? null,
      newChannelName: newName ?? null,

      sessionStart: startedAt ? new Date(startedAt).toISOString() : null,
      sessionEnd: endedAt ? new Date(endedAt).toISOString() : null,
      durationSec,
      durationHuman,
    };

    try {
      await sendVoiceEvent(payload);
      console.log('[webhook] evento enviado:', payload);
    } catch (err) {
      console.error('[webhook] erro ao enviar:', err);
    }
  });

  return client;
}

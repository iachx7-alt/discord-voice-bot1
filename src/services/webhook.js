import fetch from 'node-fetch';
import { WEBHOOK_URL } from '../config.js';

export async function sendVoiceEvent(payload) {
  if (!WEBHOOK_URL) {
    console.error('[webhook] WEBHOOK_URL não configurada');
    return;
  }

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    console.log('[webhook] evento enviado:', payload);
  } catch (err) {
    console.error('[webhook] erro ao enviar:', err.message);
  }
}

// src/services/webhook.js
import fetch from 'node-fetch';

/**
 * Aceita:
 *  - string única: "https://.../hook"
 *  - CSV string: "https://a,https://b"
 *  - array de strings: ["https://a", "https://b"]
 *  - objeto { url: "https://..." }
 *  - array de objetos [{ url: "https://..." }, ...]
 */
function normalizeTargets(raw) {
  if (!raw) return [];
  if (typeof raw === 'string') {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw.flatMap(t =>
      (typeof t === 'string')
        ? [t]
        : (t && t.url ? [t.url] : [])
    );
  }
  if (typeof raw === 'object' && raw.url) return [raw.url];
  return [];
}

function isValidUrl(u) {
  try { new URL(u); return true; } catch { return false; }
}

/**
 * postWebhook(urlOrUrls, payload)
 * - urlOrUrls: ver normalizeTargets (pode ser string, CSV, array, {url}, etc.)
 * - payload: objeto que será enviado como JSON
 */
export async function postWebhook(urlOrUrls, payload) {
  // log defensivo (ajuda se alguém passar objeto no lugar da URL)
  console.log('[webhook] targetsRaw type:', typeof urlOrUrls);

  const targets = normalizeTargets(urlOrUrls || process.env.WEBHOOK_URLS);
  if (!targets.length) {
    console.error('[webhook] nenhum destino válido (WEBHOOK_URL(S) ausente ou inválido).');
    return;
  }

  for (const url of targets) {
    if (typeof url !== 'string' || !isValidUrl(url)) {
      console.error('[webhook] URL inválida (ignorada):', url);
      continue;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {})
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.error('[webhook] falha HTTP', res.status, txt);
      } else {
        console.log('[webhook] enviado com sucesso para', url);
      }
    } catch (err) {
      console.error('[webhook] erro ao enviar:', err.message);
    }
  }
}

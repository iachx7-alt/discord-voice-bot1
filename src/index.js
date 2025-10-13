import { createClient } from './discord.js';
import { DISCORD_TOKEN } from './config.js';

async function main() {
  if (!DISCORD_TOKEN) {
    console.error('[erro] DISCORD_TOKEN não configurado no .env');
    process.exit(1);
  }
  const client = createClient();
  await client.login(DISCORD_TOKEN);
}

main().catch((err) => console.error('[erro geral]', err));

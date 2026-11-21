import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, seedGuildDefaults } from '../server/db.ts';
import { guilds } from '../server/schema.ts';

async function main() {
  const db = await getDb();
  const discordGuildId = process.env.DISCORD_GUILD_ID?.trim();

  const existingGuilds = await db.select().from(guilds);
  if (existingGuilds.length === 0) {
    if (!discordGuildId || !/^\d+$/.test(discordGuildId)) {
      console.log(
        '[Seed] Belum ada Guild dan DISCORD_GUILD_ID belum diisi. Silakan buat akun Owner via `npm run create-owner` atau Setup Wizard untuk menginisialisasi Guild beserta tarif default.'
      );
      await closeDb();
      return;
    }

    const [created] = await db
      .insert(guilds)
      .values({
        discordGuildId,
        name: process.env.GUILD_NAME?.trim() || 'ComicPay Discord Server',
        timezone: 'Asia/Jakarta',
        isActive: true,
      })
      .returning();

    await seedGuildDefaults(db, created.id);
    console.log('[Seed] Guild & tarif default (Translator Rp3.000, Editor Rp3.000, Solo Rp6.000) berhasil dibuat.');
  } else {
    for (const g of existingGuilds) {
      await seedGuildDefaults(db, g.id);
    }
    console.log(`[Seed] Tarif & alias role default dipastikan tersedia untuk ${existingGuilds.length} guild.`);
  }

  await closeDb();
}

main().catch((err) => {
  console.error('[Seed] Gagal:', err);
  process.exit(1);
});

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { count } from 'drizzle-orm';
import { stdin as input, stdout as output } from 'node:process';
import readline from 'node:readline/promises';
import { closeDb, getDb, seedGuildDefaults } from '../server/db.ts';
import { adminUsers, auditLogs, guilds } from '../server/schema.ts';

function validateStrongPassword(password: string): string | null {
  if (password.length < 12) return 'Password minimal 12 karakter.';
  if (!/[A-Z]/.test(password)) return 'Password wajib memiliki minimal 1 huruf besar.';
  if (!/[a-z]/.test(password)) return 'Password wajib memiliki minimal 1 huruf kecil.';
  if (!/[0-9]/.test(password)) return 'Password wajib memiliki minimal 1 angka.';
  return null;
}

async function main() {
  const db = await getDb();
  const [{ total }] = await db.select({ total: count() }).from(adminUsers);
  if (Number(total) > 0) {
    console.error('[Create Owner] Ditolak: Akun admin/Owner sudah ada di database.');
    await closeDb();
    process.exit(1);
  }

  let email = process.env.OWNER_EMAIL?.trim() || '';
  let fullName = process.env.OWNER_NAME?.trim() || '';
  let password = process.env.OWNER_PASSWORD || '';
  let guildName = process.env.GUILD_NAME?.trim() || '';
  let discordGuildId = process.env.DISCORD_GUILD_ID?.trim() || '';

  if (!email || !password || !fullName) {
    const rl = readline.createInterface({ input, output });
    try {
      if (!fullName) fullName = (await rl.question('Nama Lengkap Owner: ')).trim();
      if (!email) email = (await rl.question('Email Owner: ')).trim().toLowerCase();
      if (!password) password = await rl.question('Password Owner (min 12 karakter, huruf besar/kecil/angka): ');
      if (!guildName) guildName = (await rl.question('Nama Studio / Server Discord: ')).trim() || 'ComicPay Studio';
      if (!discordGuildId) discordGuildId = (await rl.question('Discord Guild ID (angka, kosongkan jika belum ada): ')).trim();
    } finally {
      rl.close();
    }
  }

  email = email.toLowerCase();
  if (!email.includes('@')) {
    throw new Error('Format email tidak valid.');
  }
  const pwdError = validateStrongPassword(password);
  if (pwdError) {
    throw new Error(pwdError);
  }

  const resolvedGuildId = /^\d+$/.test(discordGuildId) ? discordGuildId : '0';

  await db.transaction(async (tx) => {
    const existingGuilds = await tx.select().from(guilds).limit(1);
    let guildId = existingGuilds[0]?.id;
    if (!guildId) {
      const [createdGuild] = await tx
        .insert(guilds)
        .values({
          discordGuildId: resolvedGuildId,
          name: guildName || 'ComicPay Studio',
          timezone: 'Asia/Jakarta',
          isActive: true,
        })
        .returning();
      guildId = createdGuild.id;
    }

    const [owner] = await tx
      .insert(adminUsers)
      .values({
        email,
        fullName,
        role: 'Owner',
        passwordHash: bcrypt.hashSync(password, 12),
        isActive: true,
      })
      .returning();

    await tx.insert(auditLogs).values({
      guildId,
      actorId: owner.id,
      actorEmail: owner.email,
      actorRole: 'Owner',
      action: 'INITIAL_OWNER_BOOTSTRAP_CLI',
      entityType: 'admin_user',
      entityId: owner.id,
      afterJson: { email: owner.email, role: 'Owner' },
      reason: 'Inisialisasi akun Owner pertama via CLI',
    });
  });

  const allGuilds = await db.select().from(guilds);
  for (const g of allGuilds) {
    await seedGuildDefaults(db, g.id);
  }

  console.log(`[Create Owner] Akun Owner (${email}) dan tarif default berhasil dibuat.`);
  await closeDb();
}

main().catch((err) => {
  console.error('[Create Owner] Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

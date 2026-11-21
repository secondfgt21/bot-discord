import { PGlite } from '@electric-sql/pglite';
import { and, count, eq, inArray } from 'drizzle-orm';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { NON_COMIC_CHANNEL_IDS } from './parser.ts';
import * as schema from './schema.ts';
import { getJakartaDateParts } from './time.ts';

export type AppDb = NodePgDatabase<typeof schema>;

let dbInstance: AppDb | null = null;
let pgPoolInstance: pg.Pool | null = null;
let pgliteClientInstance: PGlite | null = null;
let dbMode: 'supabase-postgres' | 'dev-pglite' = 'supabase-postgres';

export function getDbMode(): 'supabase-postgres' | 'dev-pglite' {
  return dbMode;
}

export function isValidProductionDatabaseUrl(url?: string): url is string {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('postgres://') && !trimmed.startsWith('postgresql://')) return false;
  if (trimmed.includes('YOUR_PROJECT_REF') || trimmed.includes('YOUR_DB_PASSWORD')) return false;
  return true;
}

export async function getDb(): Promise<AppDb> {
  if (dbInstance) return dbInstance;

  const isProd = process.env.NODE_ENV === 'production';
  const dbUrl = process.env.DATABASE_URL;
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');

  if (isProd && !isValidProductionDatabaseUrl(dbUrl)) {
    throw new Error(
      '[ComicPay] FATAL: DATABASE_URL (Supabase PostgreSQL) wajib diisi dan valid pada mode production.'
    );
  }

  if (isValidProductionDatabaseUrl(dbUrl)) {
    const useSsl = process.env.DATABASE_SSL !== 'false';
    const pool = new pg.Pool({
      connectionString: dbUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder });
    pgPoolInstance = pool;
    dbMode = 'supabase-postgres';
    dbInstance = db;
    return db;
  }

  // Non-production local sandbox fallback using real PostgreSQL (PGlite)
  const pgDataDir = path.resolve(process.cwd(), '.pglite');
  if (!fs.existsSync(pgDataDir)) {
    fs.mkdirSync(pgDataDir, { recursive: true });
  }
  const client = new PGlite(pgDataDir);
  const pgliteDb = drizzlePglite(client, { schema });
  await migratePglite(pgliteDb, { migrationsFolder });
  pgliteClientInstance = client;
  dbMode = 'dev-pglite';
  dbInstance = pgliteDb as unknown as AppDb;
  return dbInstance;
}

export async function createTestPgDb(): Promise<{ db: AppDb; cleanup: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  await migratePglite(db, { migrationsFolder });
  return {
    db: db as unknown as AppDb,
    cleanup: async () => {
      await client.close();
    },
  };
}

export async function closeDb(): Promise<void> {
  if (pgPoolInstance) {
    await pgPoolInstance.end();
    pgPoolInstance = null;
  }
  if (pgliteClientInstance) {
    await pgliteClientInstance.close();
    pgliteClientInstance = null;
  }
  dbInstance = null;
}

export async function seedGuildDefaults(db: AppDb, guildId: string): Promise<void> {
  const existingRates = await db
    .select({ total: count() })
    .from(schema.payrollRates)
    .where(eq(schema.payrollRates.guildId, guildId));

  if ((existingRates[0]?.total ?? 0) === 0) {
    await db.insert(schema.payrollRates).values([
      { guildId, role: 'Translator', rateIdr: 3000, isActive: true, createdBy: 'system:seed' },
      { guildId, role: 'Editor', rateIdr: 3000, isActive: true, createdBy: 'system:seed' },
      { guildId, role: 'Solo', rateIdr: 6000, isActive: true, createdBy: 'system:seed' },
    ]);
  }

  const existingAliases = await db
    .select({ total: count() })
    .from(schema.roleAliases)
    .where(eq(schema.roleAliases.guildId, guildId));

  if ((existingAliases[0]?.total ?? 0) === 0) {
    await db
      .insert(schema.roleAliases)
      .values([
        { guildId, alias: 'ETL', role: 'Translator' },
        { guildId, alias: 'Translator', role: 'Translator' },
        { guildId, alias: 'TL', role: 'Translator' },
        { guildId, alias: 'TS', role: 'Editor' },
        { guildId, alias: 'Editor', role: 'Editor' },
        { guildId, alias: 'Solo', role: 'Solo' },
      ])
      .onConflictDoNothing();
  }

  const defaultSettings: Array<{ key: string; valueJson: unknown }> = [
    { key: 'notification_channel_id', valueJson: process.env.DISCORD_NOTIFICATION_CHANNEL_ID || '' },
    { key: 'notify_on_new_report', valueJson: true },
    { key: 'notify_on_pending', valueJson: true },
    { key: 'notify_on_payment', valueJson: true },
    { key: 'period_reminder_days_before_end', valueJson: 3 },
    {
      key: 'admin_discord_role_ids',
      valueJson: (process.env.DISCORD_ADMIN_ROLE_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s)),
    },
    {
      key: 'admin_discord_user_ids',
      valueJson: (process.env.DISCORD_ADMIN_USER_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s)),
    },
  ];

  for (const s of defaultSettings) {
    await db
      .insert(schema.botSettings)
      .values({ guildId, key: s.key, valueJson: s.valueJson })
      .onConflictDoNothing();
  }

  // Ensure multi-comic intake channels (such as #file-tl / 1352988212079104031)
  // are never bound to a single comic project in channel_mappings.
  const nonComicIds = Array.from(NON_COMIC_CHANNEL_IDS);
  if (nonComicIds.length > 0) {
    const staleRows = await db
      .select({
        id: schema.channelMappings.id,
        discordChannelId: schema.channelMappings.discordChannelId,
        projectId: schema.channelMappings.projectId,
      })
      .from(schema.channelMappings)
      .where(
        and(
          eq(schema.channelMappings.guildId, guildId),
          inArray(schema.channelMappings.discordChannelId, nonComicIds)
        )
      );

    const byChannel = new Map<string, typeof staleRows>();
    for (const row of staleRows) {
      const list = byChannel.get(row.discordChannelId) ?? [];
      list.push(row);
      byChannel.set(row.discordChannelId, list);
    }

    for (const rows of byChannel.values()) {
      const unmappedRow = rows.find((r) => r.projectId === null);
      const mappedRows = rows.filter((r) => r.projectId !== null);
      if (mappedRows.length === 0) continue;

      if (unmappedRow) {
        await db
          .delete(schema.channelMappings)
          .where(inArray(schema.channelMappings.id, mappedRows.map((r) => r.id)));
      } else {
        const [first, ...rest] = mappedRows;
        await db
          .update(schema.channelMappings)
          .set({ projectId: null, isDefault: false, isReportChannel: true })
          .where(eq(schema.channelMappings.id, first.id));
        if (rest.length > 0) {
          await db
            .delete(schema.channelMappings)
            .where(inArray(schema.channelMappings.id, rest.map((r) => r.id)));
        }
      }
    }
  }

  const jakarta = getJakartaDateParts();
  await ensurePeriodExists(db, guildId, jakarta.year, jakarta.month);
}

export async function ensurePeriodExists(
  db: AppDb,
  guildId: string,
  year: number,
  month: number
): Promise<{ id: string; periodKey: string; status: string }> {
  const periodKey = `${year}-${String(month).padStart(2, '0')}`;
  const existing = await db
    .select({
      id: schema.payrollPeriods.id,
      periodKey: schema.payrollPeriods.periodKey,
      status: schema.payrollPeriods.status,
    })
    .from(schema.payrollPeriods)
    .where(eq(schema.payrollPeriods.periodKey, periodKey))
    .limit(1);

  const match = existing.find((p) => p.periodKey === periodKey);
  if (match) {
    return match;
  }

  const [created] = await db
    .insert(schema.payrollPeriods)
    .values({
      guildId,
      periodKey,
      year,
      month,
      timezone: 'Asia/Jakarta',
      status: 'OPEN',
    })
    .onConflictDoNothing()
    .returning({
      id: schema.payrollPeriods.id,
      periodKey: schema.payrollPeriods.periodKey,
      status: schema.payrollPeriods.status,
    });

  if (created) return created;

  const [fetched] = await db
    .select({
      id: schema.payrollPeriods.id,
      periodKey: schema.payrollPeriods.periodKey,
      status: schema.payrollPeriods.status,
    })
    .from(schema.payrollPeriods)
    .where(eq(schema.payrollPeriods.periodKey, periodKey))
    .limit(1);

  return fetched;
}

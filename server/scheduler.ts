import { eq, and, sql } from 'drizzle-orm';
import { ensurePeriodExists, type AppDb } from './db.ts';
import { createNotification } from './payrollService.ts';
import { botSettings, guilds } from './schema.ts';
import { getJakartaDateParts, getMonthDaysInJakarta } from './time.ts';

let schedulerStarted = false;
let schedulerInterval: NodeJS.Timeout | null = null;
const SCHEDULER_ADVISORY_LOCK_ID = 77420911;

export async function runSchedulerTick(db: AppDb): Promise<void> {
  // Acquire PostgreSQL advisory lock so concurrent replicas cannot run duplicate monthly jobs
  const lockRes = await db.execute(
    sql`SELECT pg_try_advisory_lock(${SCHEDULER_ADVISORY_LOCK_ID}) AS acquired`
  );
  const acquired = Boolean((lockRes.rows?.[0] as { acquired?: boolean } | undefined)?.acquired);
  if (!acquired) {
    return;
  }

  try {
    const jakarta = getJakartaDateParts();
    const activeGuilds = await db
      .select({ id: guilds.id, name: guilds.name })
      .from(guilds)
      .where(eq(guilds.isActive, true));

    const daysInMonth = getMonthDaysInJakarta(jakarta.year, jakarta.month);
    const daysRemaining = daysInMonth - jakarta.day;

    for (const guild of activeGuilds) {
      // 1. Ensure current Asia/Jakarta monthly period exists (never deleting past months)
      const period = await ensurePeriodExists(db, guild.id, jakarta.year, jakarta.month);

      // 2. Check reminder days threshold
      const settingRows = await db
        .select({ valueJson: botSettings.valueJson })
        .from(botSettings)
        .where(
          and(
            eq(botSettings.guildId, guild.id),
            eq(botSettings.key, 'period_reminder_days_before_end')
          )
        )
        .limit(1);

      const reminderThreshold = settingRows.length > 0 ? Number(settingRows[0].valueJson) : 3;

      if (period.status === 'OPEN' && daysRemaining <= reminderThreshold && daysRemaining >= 0) {
        await createNotification(db, {
          guildId: guild.id,
          type: 'PERIOD_CLOSING_SOON',
          title: `Periode ${period.periodKey} Akan Berakhir`,
          message: `Tersisa ${daysRemaining} hari sebelum akhir bulan (${jakarta.periodKey}). Pastikan seluruh laporan pending direview.`,
          payload: { periodId: period.id, periodKey: period.periodKey, daysRemaining },
          dedupKey: `period_closing_soon:${guild.id}:${period.periodKey}`,
        });
      }
    }
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${SCHEDULER_ADVISORY_LOCK_ID})`);
  }
}

export function startSingleInstanceScheduler(db: AppDb): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  void runSchedulerTick(db).catch((err) => {
    console.error('[Scheduler] Initial tick error:', err);
  });

  schedulerInterval = setInterval(() => {
    void runSchedulerTick(db).catch((err) => {
      console.error('[Scheduler] Tick error:', err);
    });
  }, 5 * 60 * 1000);
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  schedulerStarted = false;
}

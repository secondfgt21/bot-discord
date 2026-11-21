import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { Router, type NextFunction, type Request, type Response } from 'express';
import * as XLSX from 'xlsx';
import { createAuthMiddleware, requireRoles, signAuthToken } from './auth.ts';
import { getDbMode, seedGuildDefaults, type AppDb } from './db.ts';
import { getBotRuntimeState, triggerManualSync } from './discordBot.ts';
import {
  closePayrollPeriod,
  correctReportChapter,
  createPayrollAdjustment,
  getActiveRatesMap,
  handleDiscordMessageDelete,
  handleDiscordMessageEdit,
  processDiscordReport,
  recordPayment,
  reopenPayrollPeriod,
  reversePayment,
  updateChapterApproval,
  writeAuditLog,
} from './payrollService.ts';
import {
  adminUsers,
  auditLogs,
  botSettings,
  channelMappings,
  employeeRoles,
  guilds,
  members,
  notifications,
  payments,
  payrollAdjustments,
  payrollItems,
  payrollPeriods,
  payrollRates,
  payrollRecords,
  processingCheckpoints,
  projectAliases,
  projects,
  reportChapters,
  reportEvents,
  reports,
  roleAliases,
} from './schema.ts';
import { formatIdr, getJakartaDateParts, utcNowIso } from './time.ts';
import type { AdminRole, RoleName } from './types.ts';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncRoute(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function validateStrongPassword(password: string): string | null {
  if (password.length < 12) return 'Password minimal 12 karakter.';
  if (!/[A-Z]/.test(password)) return 'Password wajib memiliki minimal 1 huruf besar.';
  if (!/[a-z]/.test(password)) return 'Password wajib memiliki minimal 1 huruf kecil.';
  if (!/[0-9]/.test(password)) return 'Password wajib memiliki minimal 1 angka.';
  return null;
}

function getConfiguredSetupToken(): string | null {
  const tok = process.env.SETUP_TOKEN?.trim();
  if (!tok || tok.includes('REPLACE_WITH') || tok.includes('YOUR_')) return null;
  return tok;
}

function constantTimeMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function getPrimaryGuild(db: AppDb): Promise<{
  id: string;
  discord_guild_id: string;
  name: string;
  timezone: string;
} | null> {
  const rows = await db
    .select({
      id: guilds.id,
      discord_guild_id: guilds.discordGuildId,
      name: guilds.name,
      timezone: guilds.timezone,
    })
    .from(guilds)
    .orderBy(asc(guilds.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

function normalizeBigInts<T>(value: T): T {
  if (typeof value === 'bigint') return String(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => normalizeBigInts(item)) as unknown as T;
  if (value instanceof Date || value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = normalizeBigInts(v);
  }
  return out as T;
}

export function createApiRouter(db: AppDb): Router {
  const router = Router();
  router.use((_req: Request, res: Response, next: NextFunction) => {
    const origJson = res.json.bind(res);
    res.json = (body?: unknown) => origJson(normalizeBigInts(body));
    next();
  });

  const requireAuth = createAuthMiddleware(db);
  const requireAdminOrOwner = requireRoles(['Owner', 'Admin']);
  const requireOwner = requireRoles(['Owner']);

  // Health Check (No secrets exposed)
  router.get(
    '/health',
    asyncRoute(async (_req: Request, res: Response) => {
      try {
        await db.execute(sql`SELECT 1`);
        res.json({
          status: 'ok',
          database: 'connected',
          databaseMode: getDbMode(),
          timezone: 'Asia/Jakarta',
          bot: getBotRuntimeState(),
          timestamp: utcNowIso(),
        });
      } catch (err) {
        res.status(503).json({
          status: 'error',
          database: 'disconnected',
          error: err instanceof Error ? err.message : 'Database check failed',
        });
      }
    })
  );

  // ============================================================================
  // INITIAL OWNER SETUP & AUTHENTICATION (No public signup!)
  // ============================================================================
  router.get(
    '/auth/setup-status',
    asyncRoute(async (_req: Request, res: Response) => {
      const [{ total }] = await db.select({ total: count() }).from(adminUsers);
      const needsSetup = Number(total) === 0;
      const requiresSetupToken = needsSetup && getConfiguredSetupToken() !== null;
      res.json({ needsSetup, requiresSetupToken });
    })
  );

  router.post(
    '/auth/setup-owner',
    asyncRoute(async (req: Request, res: Response) => {
      const { email, fullName, password, guildName, discordGuildId, setupToken } = req.body as {
        email?: string;
        fullName?: string;
        password?: string;
        guildName?: string;
        discordGuildId?: string;
        setupToken?: string;
      };

      const [{ total }] = await db.select({ total: count() }).from(adminUsers);
      if (Number(total) > 0) {
        res.status(403).json({
          error: 'Setup awal telah terkunci karena akun Owner sudah ada. Silakan login.',
        });
        return;
      }

      const expectedToken = getConfiguredSetupToken();
      if (expectedToken) {
        if (!setupToken || !constantTimeMatch(expectedToken, setupToken.trim())) {
          res.status(403).json({ error: 'Setup Token tidak valid atau tidak sesuai konfigurasi server.' });
          return;
        }
      }

      if (!email?.trim() || !email.includes('@') || !fullName?.trim() || !password) {
        res.status(400).json({ error: 'Nama lengkap, email valid, dan password wajib diisi.' });
        return;
      }

      const pwdErr = validateStrongPassword(password);
      if (pwdErr) {
        res.status(400).json({ error: pwdErr });
        return;
      }

      const cleanEmail = email.trim().toLowerCase();
      const cleanGuildId = discordGuildId?.trim() && /^\d+$/.test(discordGuildId.trim())
        ? discordGuildId.trim()
        : process.env.DISCORD_GUILD_ID?.trim() && /^\d+$/.test(process.env.DISCORD_GUILD_ID.trim())
          ? process.env.DISCORD_GUILD_ID.trim()
          : '0';

      const created = await db.transaction(async (tx) => {
        const txDb = tx as unknown as AppDb;

        // Re-check inside transaction to avoid race condition
        const [{ innerTotal }] = await txDb
          .select({ innerTotal: count() })
          .from(adminUsers);
        if (Number(innerTotal) > 0) {
          throw new Error('ALREADY_INITIALIZED');
        }

        const existingGuild = await txDb.select().from(guilds).limit(1);
        let guildId = existingGuild[0]?.id;
        if (!guildId) {
          const [newGuild] = await txDb
            .insert(guilds)
            .values({
              discordGuildId: cleanGuildId,
              name: guildName?.trim() || 'ComicPay Studio',
              timezone: 'Asia/Jakarta',
              isActive: true,
            })
            .returning();
          guildId = newGuild.id;
        } else if (guildName?.trim()) {
          await txDb
            .update(guilds)
            .set({
              name: guildName.trim(),
              discordGuildId: cleanGuildId !== '0' ? cleanGuildId : existingGuild[0].discordGuildId,
              updatedAt: new Date(),
            })
            .where(eq(guilds.id, guildId));
        }

        await seedGuildDefaults(txDb, guildId);

        const [owner] = await txDb
          .insert(adminUsers)
          .values({
            email: cleanEmail,
            fullName: fullName.trim(),
            role: 'Owner',
            passwordHash: bcrypt.hashSync(password, 12),
            isActive: true,
            lastLoginAt: new Date(),
          })
          .returning();

        await writeAuditLog(txDb, {
          guildId,
          actorId: owner.id,
          actorEmail: owner.email,
          actorRole: 'Owner',
          action: 'INITIAL_OWNER_BOOTSTRAP_WEB',
          entityType: 'admin_user',
          entityId: owner.id,
          after: { email: owner.email, role: 'Owner', guildId },
          reason: 'Pembuatan akun Owner pertama via Setup Wizard aman',
          ipAddress: req.ip || null,
        });

        return owner;
      }).catch((err) => {
        if (err instanceof Error && err.message === 'ALREADY_INITIALIZED') {
          return null;
        }
        throw err;
      });

      if (!created) {
        res.status(403).json({ error: 'Setup awal telah terkunci karena akun Owner sudah ada.' });
        return;
      }

      const authUser = {
        id: created.id,
        email: created.email,
        fullName: created.fullName,
        role: 'Owner' as AdminRole,
        discordUserId: created.discordUserId,
      };
      const token = signAuthToken(authUser);
      res.status(201).json({ token, user: authUser });
    })
  );

  router.post(
    '/auth/login',
    asyncRoute(async (req: Request, res: Response) => {
      const { email, password } = req.body as { email?: string; password?: string };
      if (!email || !password) {
        res.status(400).json({ error: 'Email dan password wajib diisi.' });
        return;
      }

      const userRows = await db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.email, email.trim().toLowerCase()))
        .limit(1);

      const user = userRows[0];
      if (!user || !user.isActive || !bcrypt.compareSync(password, user.passwordHash)) {
        res.status(401).json({ error: 'Kredensial tidak valid atau akun dinonaktifkan.' });
        return;
      }

      const now = new Date();
      await db
        .update(adminUsers)
        .set({ lastLoginAt: now, updatedAt: now })
        .where(eq(adminUsers.id, user.id));

      const authUser = {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role as AdminRole,
        discordUserId: user.discordUserId,
      };

      const token = signAuthToken(authUser);
      await writeAuditLog(db, {
        actorId: authUser.id,
        actorEmail: authUser.email,
        actorRole: authUser.role,
        action: 'LOGIN',
        entityType: 'admin_user',
        entityId: authUser.id,
        ipAddress: req.ip || null,
      });

      res.json({ token, user: authUser });
    })
  );

  router.get('/auth/me', requireAuth, (req: Request, res: Response) => {
    res.json({ user: req.user });
  });

  // All subsequent routes require authentication
  router.use(requireAuth);

  // ============================================================================
  // OVERVIEW & ANALYTICS
  // ============================================================================
  router.get(
    '/overview',
    asyncRoute(async (req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      const jakarta = getJakartaDateParts();
      const year = Number(req.query.year) || jakarta.year;
      const month = Number(req.query.month) || jakarta.month;
      const periodKey = `${year}-${String(month).padStart(2, '0')}`;

      if (!guild) {
        res.json({
          period: { id: null, period_key: periodKey, year, month, status: 'OPEN' },
          stats: {
            activeEmployees: 0,
            totalProjects: 0,
            monthlyChapters: 0,
            totalPayrollIdr: 0,
            totalPaidIdr: 0,
            totalUnpaidIdr: 0,
            partialCount: 0,
            pendingReportsCount: 0,
          },
          charts: {
            dailyProductivity: [],
            workerProductivity: [],
            monthlyExpenses: [],
            chaptersByComic: [],
            roleDistribution: [],
          },
          recentActivity: [],
          botState: getBotRuntimeState(),
          checkpoints: [],
        });
        return;
      }

      const periodRows = await db
        .select({
          id: payrollPeriods.id,
          guild_id: payrollPeriods.guildId,
          period_key: payrollPeriods.periodKey,
          year: payrollPeriods.year,
          month: payrollPeriods.month,
          status: payrollPeriods.status,
          opened_at: payrollPeriods.openedAt,
        })
        .from(payrollPeriods)
        .where(and(eq(payrollPeriods.guildId, guild.id), eq(payrollPeriods.periodKey, periodKey)))
        .limit(1);

      const period = periodRows[0];

      const [empCountRow] = await db
        .select({ cnt: sql<number>`COUNT(*)::int` })
        .from(members)
        .where(and(eq(members.guildId, guild.id), eq(members.isActive, true)));

      const [projCountRow] = await db
        .select({ cnt: sql<number>`COUNT(*)::int` })
        .from(projects)
        .where(and(eq(projects.guildId, guild.id), eq(projects.isActive, true)));

      const [pendingRow] = await db
        .select({ cnt: sql<number>`COUNT(*)::int` })
        .from(reportChapters)
        .where(and(eq(reportChapters.guildId, guild.id), eq(reportChapters.approvalStatus, 'pending')));

      let monthlyChapters = 0;
      let totalPayrollIdr = 0;
      let totalPaidIdr = 0;
      let totalUnpaidIdr = 0;
      let partialCount = 0;

      if (period) {
        const prAggRes = await db.execute(sql`
          SELECT
            COALESCE(SUM(total_chapters), 0)::int AS total_ch,
            COALESCE(SUM(net_amount_idr), 0)::int AS total_net,
            COALESCE(SUM(paid_amount_idr), 0)::int AS total_paid,
            COALESCE(SUM(remaining_amount_idr), 0)::int AS total_rem,
            COALESCE(SUM(CASE WHEN payment_status = 'PARTIALLY_PAID' THEN 1 ELSE 0 END), 0)::int AS partial_cnt
          FROM payroll_records
          WHERE period_id = ${period.id}
        `);
        const prAgg = prAggRes.rows[0] as Record<string, number> | undefined;
        monthlyChapters = Number(prAgg?.total_ch ?? 0);
        totalPayrollIdr = Number(prAgg?.total_net ?? 0);
        totalPaidIdr = Number(prAgg?.total_paid ?? 0);
        totalUnpaidIdr = Number(prAgg?.total_rem ?? 0);
        partialCount = Number(prAgg?.partial_cnt ?? 0);
      }

      const dailyProductivity = period
        ? (
            await db.execute(sql`
              SELECT TO_CHAR(r.message_timestamp AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS date,
                     COUNT(rc.id)::int AS chapters,
                     COALESCE(SUM(rc.amount_idr), 0)::int AS amount_idr
              FROM report_chapters rc
              JOIN reports r ON r.id = rc.report_id
              WHERE rc.period_id = ${period.id} AND rc.approval_status IN ('auto_approved', 'approved')
              GROUP BY 1
              ORDER BY 1 ASC
            `)
          ).rows
        : [];

      const workerProductivity = period
        ? (
            await db.execute(sql`
              SELECT m.display_name AS name,
                     pr.translator_chapters::int AS translator,
                     pr.editor_chapters::int AS editor,
                     pr.solo_chapters::int AS solo,
                     pr.total_chapters::int AS total,
                     pr.net_amount_idr::int AS amount_idr
              FROM payroll_records pr
              JOIN members m ON m.id = pr.member_id
              WHERE pr.period_id = ${period.id}
              ORDER BY pr.total_chapters DESC
            `)
          ).rows
        : [];

      const monthlyExpenses = (
        await db.execute(sql`
          SELECT pp.period_key AS period,
                 COALESCE(SUM(pr.net_amount_idr), 0)::int AS total_payroll_idr,
                 COALESCE(SUM(pr.paid_amount_idr), 0)::int AS paid_idr,
                 COALESCE(SUM(pr.total_chapters), 0)::int AS chapters
          FROM payroll_periods pp
          LEFT JOIN payroll_records pr ON pr.period_id = pp.id
          WHERE pp.guild_id = ${guild.id}
          GROUP BY pp.id, pp.period_key, pp.year, pp.month
          ORDER BY pp.year ASC, pp.month ASC
          LIMIT 12
        `)
      ).rows;

      const chaptersByComic = period
        ? (
            await db.execute(sql`
              SELECT COALESCE(p.title, 'Belum Ditentukan') AS title,
                     COUNT(rc.id)::int AS chapters,
                     COALESCE(SUM(rc.amount_idr), 0)::int AS amount_idr
              FROM report_chapters rc
              LEFT JOIN projects p ON p.id = rc.project_id
              WHERE rc.period_id = ${period.id} AND rc.approval_status IN ('auto_approved', 'approved')
              GROUP BY p.id, p.title
              ORDER BY chapters DESC
            `)
          ).rows
        : [];

      const roleDistribution = period
        ? (
            await db.execute(sql`
              SELECT rc.role AS role,
                     COUNT(rc.id)::int AS chapters,
                     COALESCE(SUM(rc.amount_idr), 0)::int AS amount_idr
              FROM report_chapters rc
              WHERE rc.period_id = ${period.id}
                AND rc.approval_status IN ('auto_approved', 'approved')
                AND rc.role IS NOT NULL
              GROUP BY rc.role
            `)
          ).rows
        : [];

      const recentActivity = (
        await db.execute(sql`
          SELECT r.id, r.raw_content, r.parse_status, r.message_timestamp, r.discord_channel_id,
                 m.display_name AS employee_name, p.title AS project_title,
                 COUNT(rc.id)::int AS chapter_count,
                 COALESCE(SUM(CASE WHEN rc.approval_status = 'pending' THEN 1 ELSE 0 END), 0)::int AS pending_count,
                 COALESCE(SUM(CASE WHEN rc.approval_status IN ('auto_approved', 'approved') THEN rc.amount_idr ELSE 0 END), 0)::int AS approved_amount_idr
          FROM reports r
          JOIN members m ON m.id = r.member_id
          LEFT JOIN projects p ON p.id = r.project_id
          LEFT JOIN report_chapters rc ON rc.report_id = r.id
          WHERE r.guild_id = ${guild.id} AND r.is_deleted = FALSE
          GROUP BY r.id, m.display_name, p.title
          ORDER BY r.message_timestamp DESC
          LIMIT 10
        `)
      ).rows;

      const checkpoints = (
        await db.execute(sql`
          SELECT id, discord_channel_id, channel_name, last_message_id, last_synced_at, sync_status
          FROM processing_checkpoints
          WHERE guild_id = ${guild.id}
          ORDER BY channel_name ASC
        `)
      ).rows;

      res.json({
        period: period ?? { id: null, period_key: periodKey, year, month, status: 'OPEN' },
        stats: {
          activeEmployees: Number(empCountRow?.cnt ?? 0),
          totalProjects: Number(projCountRow?.cnt ?? 0),
          monthlyChapters,
          totalPayrollIdr,
          totalPaidIdr,
          totalUnpaidIdr,
          partialCount,
          pendingReportsCount: Number(pendingRow?.cnt ?? 0),
        },
        charts: {
          dailyProductivity,
          workerProductivity,
          monthlyExpenses,
          chaptersByComic,
          roleDistribution,
        },
        recentActivity,
        botState: getBotRuntimeState(),
        checkpoints,
      });
    })
  );

  // ============================================================================
  // EMPLOYEES
  // ============================================================================
  router.get(
    '/employees',
    asyncRoute(async (req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.json({ employees: [] });
        return;
      }
      const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

      const result = await db.execute(sql`
        SELECT m.id, m.guild_id, m.discord_user_id, m.discord_username, m.display_name,
               m.is_active, m.notes, m.created_at, m.updated_at,
          (SELECT STRING_AGG(er.role, ',') FROM employee_roles er WHERE er.member_id = m.id) AS roles_csv,
          COALESCE((SELECT SUM(pr.total_chapters) FROM payroll_records pr WHERE pr.member_id = m.id), 0)::int AS total_chapters,
          COALESCE((SELECT SUM(pr.net_amount_idr) FROM payroll_records pr WHERE pr.member_id = m.id), 0)::int AS total_earned_idr,
          COALESCE((SELECT SUM(pr.paid_amount_idr) FROM payroll_records pr WHERE pr.member_id = m.id), 0)::int AS total_paid_idr,
          COALESCE((SELECT SUM(pr.remaining_amount_idr) FROM payroll_records pr WHERE pr.member_id = m.id), 0)::int AS unpaid_balance_idr
        FROM members m
        WHERE m.guild_id = ${guild.id}
        ORDER BY m.is_active DESC, m.display_name ASC
      `);

      const rows = result.rows as Array<{
        id: string;
        discord_user_id: string;
        discord_username: string;
        display_name: string;
        is_active: boolean;
        notes: string;
        roles_csv: string | null;
        total_chapters: number;
        total_earned_idr: number;
        total_paid_idr: number;
        unpaid_balance_idr: number;
      }>;

      const filtered = rows
        .map((r) => ({
          ...r,
          roles: r.roles_csv ? r.roles_csv.split(',') : [],
        }))
        .filter((r) => {
          if (!search) return true;
          return (
            r.display_name.toLowerCase().includes(search) ||
            r.discord_username.toLowerCase().includes(search) ||
            r.discord_user_id.includes(search)
          );
        });

      res.json({ employees: filtered });
    })
  );

  router.get(
    '/employees/:id',
    asyncRoute(async (req: Request, res: Response) => {
      const empId = String(req.params.id);
      const memberRes = await db.execute(sql`SELECT * FROM members WHERE id = ${empId} LIMIT 1`);
      const member = memberRes.rows[0] as Record<string, unknown> | undefined;
      if (!member) {
        res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
        return;
      }

      const roleRows = await db
        .select({ role: employeeRoles.role })
        .from(employeeRoles)
        .where(eq(employeeRoles.memberId, empId));
      const roles = roleRows.map((r) => r.role);

      const totalsRes = await db.execute(sql`
        SELECT
          COALESCE(SUM(translator_chapters), 0)::int AS translator_chapters,
          COALESCE(SUM(editor_chapters), 0)::int AS editor_chapters,
          COALESCE(SUM(solo_chapters), 0)::int AS solo_chapters,
          COALESCE(SUM(total_chapters), 0)::int AS total_chapters,
          COALESCE(SUM(net_amount_idr), 0)::int AS total_earned_idr,
          COALESCE(SUM(paid_amount_idr), 0)::int AS total_paid_idr,
          COALESCE(SUM(remaining_amount_idr), 0)::int AS unpaid_balance_idr
        FROM payroll_records
        WHERE member_id = ${empId}
      `);

      const payrollHistory = (
        await db.execute(sql`
          SELECT pr.*, pp.period_key, pp.status AS period_status
          FROM payroll_records pr
          JOIN payroll_periods pp ON pp.id = pr.period_id
          WHERE pr.member_id = ${empId}
          ORDER BY pp.year DESC, pp.month DESC
        `)
      ).rows;

      const paymentHistory = (
        await db.execute(sql`
          SELECT py.*, pp.period_key
          FROM payments py
          JOIN payroll_periods pp ON pp.id = py.period_id
          WHERE py.member_id = ${empId}
          ORDER BY py.paid_at DESC
        `)
      ).rows;

      const projectsWorked = (
        await db.execute(sql`
          SELECT p.id, p.title, COUNT(rc.id)::int AS chapters, COALESCE(SUM(rc.amount_idr), 0)::int AS amount_idr
          FROM report_chapters rc
          JOIN projects p ON p.id = rc.project_id
          WHERE rc.member_id = ${empId} AND rc.approval_status IN ('auto_approved', 'approved')
          GROUP BY p.id, p.title
          ORDER BY chapters DESC
        `)
      ).rows;

      const monthlyChart = (
        await db.execute(sql`
          SELECT pp.period_key AS period,
                 pr.translator_chapters::int,
                 pr.editor_chapters::int,
                 pr.solo_chapters::int,
                 pr.net_amount_idr::int
          FROM payroll_records pr
          JOIN payroll_periods pp ON pp.id = pr.period_id
          WHERE pr.member_id = ${empId}
          ORDER BY pp.year ASC, pp.month ASC
        `)
      ).rows;

      res.json({
        employee: { ...member, roles },
        totals: totalsRes.rows[0],
        payrollHistory,
        paymentHistory,
        projectsWorked,
        monthlyChart,
      });
    })
  );

  router.post(
    '/employees',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.status(400).json({ error: 'Guild belum diinisialisasi. Lengkapi pengaturan Guild terlebih dahulu.' });
        return;
      }

      const { discordUserId, discordUsername, displayName, roles, notes } = req.body as {
        discordUserId?: string;
        discordUsername?: string;
        displayName?: string;
        roles?: RoleName[];
        notes?: string;
      };

      if (!discordUserId?.trim() || !/^\d+$/.test(discordUserId.trim()) || !displayName?.trim()) {
        res.status(400).json({ error: 'Discord User ID (angka Snowflake) dan nama tampilan wajib diisi.' });
        return;
      }

      const existing = await db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.guildId, guild.id), eq(members.discordUserId, discordUserId.trim())))
        .limit(1);

      if (existing.length > 0) {
        res.status(409).json({ error: 'Discord User ID sudah terdaftar.' });
        return;
      }

      const createdId = await db.transaction(async (tx) => {
        const txDb = tx as unknown as AppDb;
        const [created] = await txDb
          .insert(members)
          .values({
            guildId: guild.id,
            discordUserId: discordUserId.trim(),
            discordUsername: (discordUsername || displayName).trim(),
            displayName: displayName.trim(),
            isActive: true,
            notes: notes || '',
          })
          .returning({ id: members.id });

        const roleList = roles && roles.length > 0 ? roles : (['Translator'] as RoleName[]);
        for (const [idx, r] of roleList.entries()) {
          await txDb
            .insert(employeeRoles)
            .values({
              memberId: created.id,
              role: r,
              isPrimary: idx === 0,
            })
            .onConflictDoNothing();
        }

        await writeAuditLog(txDb, {
          guildId: guild.id,
          actorId: req.user!.id,
          actorEmail: req.user!.email,
          actorRole: req.user!.role,
          action: 'CREATE_EMPLOYEE',
          entityType: 'member',
          entityId: created.id,
          after: { discordUserId: discordUserId.trim(), displayName: displayName.trim(), roles: roleList },
        });

        return created.id;
      });

      res.status(201).json({ id: createdId });
    })
  );

  router.patch(
    '/employees/:id',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const empId = String(req.params.id);
      const memberRows = await db.select().from(members).where(eq(members.id, empId)).limit(1);
      if (memberRows.length === 0) {
        res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
        return;
      }
      const member = memberRows[0];

      const { displayName, discordUsername, discordUserId, isActive, roles, notes } = req.body as {
        displayName?: string;
        discordUsername?: string;
        discordUserId?: string;
        isActive?: boolean;
        roles?: RoleName[];
        notes?: string;
      };

      if (discordUserId !== undefined && discordUserId.trim() && !/^\d+$/.test(discordUserId.trim())) {
        res.status(400).json({ error: 'Discord User ID harus berupa angka Snowflake.' });
        return;
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        const txDb = tx as unknown as AppDb;
        await txDb
          .update(members)
          .set({
            displayName: displayName?.trim() || member.displayName,
            discordUsername: discordUsername?.trim() || member.discordUsername,
            discordUserId: discordUserId?.trim() || member.discordUserId,
            isActive: typeof isActive === 'boolean' ? isActive : member.isActive,
            notes: notes !== undefined ? notes : member.notes,
            updatedAt: now,
          })
          .where(eq(members.id, member.id));

        if (Array.isArray(roles)) {
          await txDb.delete(employeeRoles).where(eq(employeeRoles.memberId, member.id));
          for (const [idx, r] of roles.entries()) {
            await txDb
              .insert(employeeRoles)
              .values({
                memberId: member.id,
                role: r,
                isPrimary: idx === 0,
              })
              .onConflictDoNothing();
          }
        }

        await writeAuditLog(txDb, {
          guildId: member.guildId,
          actorId: req.user!.id,
          actorEmail: req.user!.email,
          actorRole: req.user!.role,
          action: 'UPDATE_EMPLOYEE',
          entityType: 'member',
          entityId: member.id,
          before: { displayName: member.displayName, isActive: member.isActive },
          after: { displayName, isActive, roles },
        });
      });

      res.json({ ok: true });
    })
  );

  // ============================================================================
  // PROJECTS / COMICS & CHANNEL MAPPINGS
  // ============================================================================
  router.get(
    '/projects',
    asyncRoute(async (_req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.json({ projects: [], allChannelMappings: [] });
        return;
      }

      const projectRows = (
        await db.execute(sql`
          SELECT p.id, p.guild_id, p.title, p.slug, p.is_active, p.created_at, p.updated_at,
            COALESCE((SELECT COUNT(*) FROM report_chapters rc WHERE rc.project_id = p.id AND rc.approval_status IN ('auto_approved', 'approved')), 0)::int AS total_chapters,
            COALESCE((SELECT SUM(rc.amount_idr) FROM report_chapters rc WHERE rc.project_id = p.id AND rc.approval_status IN ('auto_approved', 'approved')), 0)::int AS total_expense_idr
          FROM projects p
          WHERE p.guild_id = ${guild.id}
          ORDER BY p.is_active DESC, p.title ASC
        `)
      ).rows as Array<{ id: string; title: string }>;

      const aliasRows = await db
        .select({
          id: projectAliases.id,
          project_id: projectAliases.projectId,
          alias: projectAliases.alias,
        })
        .from(projectAliases)
        .where(eq(projectAliases.guildId, guild.id));

      const channelRows = await db
        .select({
          id: channelMappings.id,
          project_id: channelMappings.projectId,
          discord_channel_id: channelMappings.discordChannelId,
          channel_name: channelMappings.channelName,
          is_report_channel: channelMappings.isReportChannel,
          is_default: channelMappings.isDefault,
        })
        .from(channelMappings)
        .where(eq(channelMappings.guildId, guild.id));

      const enriched = projectRows.map((p) => ({
        ...p,
        aliases: aliasRows.filter((a) => a.project_id === p.id),
        channels: channelRows.filter((c) => c.project_id === p.id),
      }));

      res.json({ projects: enriched, allChannelMappings: channelRows });
    })
  );

  router.get(
    '/projects/:id',
    asyncRoute(async (req: Request, res: Response) => {
      const projId = String(req.params.id);
      const projectRes = await db.execute(sql`SELECT * FROM projects WHERE id = ${projId} LIMIT 1`);
      const project = projectRes.rows[0];
      if (!project) {
        res.status(404).json({ error: 'Komik tidak ditemukan.' });
        return;
      }

      const contributors = (
        await db.execute(sql`
          SELECT m.id, m.display_name, rc.role,
                 COUNT(rc.id)::int AS chapters,
                 COALESCE(SUM(rc.amount_idr), 0)::int AS amount_idr
          FROM report_chapters rc
          JOIN members m ON m.id = rc.member_id
          WHERE rc.project_id = ${projId} AND rc.approval_status IN ('auto_approved', 'approved')
          GROUP BY m.id, m.display_name, rc.role
          ORDER BY chapters DESC
        `)
      ).rows;

      const history = (
        await db.execute(sql`
          SELECT rc.id, rc.chapter_number, rc.role, rc.amount_idr, rc.approval_status, rc.created_at,
                 m.display_name AS employee_name
          FROM report_chapters rc
          JOIN members m ON m.id = rc.member_id
          WHERE rc.project_id = ${projId}
          ORDER BY rc.created_at DESC
          LIMIT 50
        `)
      ).rows;

      res.json({ project, contributors, history });
    })
  );

  router.post(
    '/projects',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.status(400).json({ error: 'Guild belum tersedia.' });
        return;
      }

      const { title, aliases, discordChannelId, channelName } = req.body as {
        title?: string;
        aliases?: string[];
        discordChannelId?: string;
        channelName?: string;
      };

      if (!title?.trim()) {
        res.status(400).json({ error: 'Judul komik wajib diisi.' });
        return;
      }

      if (discordChannelId?.trim() && !/^\d+$/.test(discordChannelId.trim())) {
        res.status(400).json({ error: 'Discord Channel ID harus berupa angka Snowflake.' });
        return;
      }

      const slug = title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const createdId = await db.transaction(async (tx) => {
        const txDb = tx as unknown as AppDb;
        const [created] = await txDb
          .insert(projects)
          .values({
            guildId: guild.id,
            title: title.trim(),
            slug,
            isActive: true,
          })
          .returning({ id: projects.id });

        const aliasList = Array.from(
          new Set([title.trim(), ...(aliases || []).map((a) => a.trim()).filter(Boolean)])
        );
        for (const a of aliasList) {
          await txDb
            .insert(projectAliases)
            .values({ guildId: guild.id, projectId: created.id, alias: a })
            .onConflictDoNothing();
        }

        if (discordChannelId?.trim()) {
          await txDb
            .insert(channelMappings)
            .values({
              guildId: guild.id,
              discordChannelId: discordChannelId.trim(),
              channelName: channelName?.trim() || `#${slug}`,
              projectId: created.id,
              isReportChannel: true,
              isDefault: true,
            })
            .onConflictDoNothing();

          await txDb
            .insert(processingCheckpoints)
            .values({
              guildId: guild.id,
              discordChannelId: discordChannelId.trim(),
              channelName: channelName?.trim() || `#${slug}`,
              syncStatus: 'SYNCED',
            })
            .onConflictDoNothing();
        }

        await writeAuditLog(txDb, {
          guildId: guild.id,
          actorId: req.user!.id,
          actorEmail: req.user!.email,
          actorRole: req.user!.role,
          action: 'CREATE_PROJECT',
          entityType: 'project',
          entityId: created.id,
          after: { title: title.trim(), slug, aliases: aliasList, discordChannelId },
        });

        return created.id;
      });

      res.status(201).json({ id: createdId });
    })
  );

  router.patch(
    '/projects/:id',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const projId = String(req.params.id);
      const projRows = await db.select().from(projects).where(eq(projects.id, projId)).limit(1);
      if (projRows.length === 0) {
        res.status(404).json({ error: 'Komik tidak ditemukan.' });
        return;
      }
      const project = projRows[0];
      const { title, isActive } = req.body as { title?: string; isActive?: boolean };

      await db
        .update(projects)
        .set({
          title: title?.trim() || project.title,
          isActive: typeof isActive === 'boolean' ? isActive : project.isActive,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, project.id));

      await writeAuditLog(db, {
        guildId: project.guildId,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'UPDATE_PROJECT',
        entityType: 'project',
        entityId: project.id,
        before: { title: project.title, isActive: project.isActive },
        after: { title, isActive },
      });

      res.json({ ok: true });
    })
  );

  router.post(
    '/projects/:id/aliases',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const projId = String(req.params.id);
      const projRows = await db.select().from(projects).where(eq(projects.id, projId)).limit(1);
      if (projRows.length === 0) {
        res.status(404).json({ error: 'Komik tidak ditemukan.' });
        return;
      }
      const project = projRows[0];
      const { alias } = req.body as { alias?: string };
      if (!alias?.trim()) {
        res.status(400).json({ error: 'Alias wajib diisi.' });
        return;
      }

      const [created] = await db
        .insert(projectAliases)
        .values({ guildId: project.guildId, projectId: project.id, alias: alias.trim() })
        .returning({ id: projectAliases.id });

      await writeAuditLog(db, {
        guildId: project.guildId,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'ADD_PROJECT_ALIAS',
        entityType: 'project_alias',
        entityId: created.id,
        after: { projectId: project.id, alias: alias.trim() },
      });

      res.status(201).json({ id: created.id });
    })
  );

  router.delete(
    '/projects/aliases/:aliasId',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      await db.delete(projectAliases).where(eq(projectAliases.id, String(req.params.aliasId)));
      res.json({ ok: true });
    })
  );

  router.post(
    '/projects/:id/channels',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const projId = String(req.params.id);
      const projRows = await db.select().from(projects).where(eq(projects.id, projId)).limit(1);
      if (projRows.length === 0) {
        res.status(404).json({ error: 'Komik tidak ditemukan.' });
        return;
      }
      const project = projRows[0];
      const { discordChannelId, channelName, isDefault } = req.body as {
        discordChannelId?: string;
        channelName?: string;
        isDefault?: boolean;
      };

      if (!discordChannelId?.trim() || !/^\d+$/.test(discordChannelId.trim())) {
        res.status(400).json({ error: 'Discord Channel ID valid (angka Snowflake) wajib diisi.' });
        return;
      }

      const [created] = await db
        .insert(channelMappings)
        .values({
          guildId: project.guildId,
          discordChannelId: discordChannelId.trim(),
          channelName: channelName?.trim() || '',
          projectId: project.id,
          isReportChannel: true,
          isDefault: Boolean(isDefault),
        })
        .returning({ id: channelMappings.id });

      await db
        .insert(processingCheckpoints)
        .values({
          guildId: project.guildId,
          discordChannelId: discordChannelId.trim(),
          channelName: channelName?.trim() || '',
          syncStatus: 'SYNCED',
        })
        .onConflictDoNothing();

      await writeAuditLog(db, {
        guildId: project.guildId,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'ADD_CHANNEL_MAPPING',
        entityType: 'channel_mapping',
        entityId: created.id,
        after: { projectId: project.id, discordChannelId: discordChannelId.trim(), channelName, isDefault },
      });

      res.status(201).json({ id: created.id });
    })
  );

  router.delete(
    '/projects/channels/:mappingId',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      await db.delete(channelMappings).where(eq(channelMappings.id, String(req.params.mappingId)));
      res.json({ ok: true });
    })
  );

  // ============================================================================
  // REPORTS & SMART PARSER INGESTION
  // ============================================================================
  router.get(
    '/reports',
    asyncRoute(async (req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 25));
      const offset = (page - 1) * pageSize;

      if (!guild) {
        res.json({
          reports: [],
          pagination: { page, pageSize, total: 0, totalPages: 1 },
        });
        return;
      }

      const clauses = [sql`r.guild_id = ${guild.id}`];

      if (typeof req.query.periodId === 'string' && req.query.periodId) {
        clauses.push(sql`r.period_id = ${req.query.periodId}`);
      }
      if (typeof req.query.memberId === 'string' && req.query.memberId) {
        clauses.push(sql`r.member_id = ${req.query.memberId}`);
      }
      if (typeof req.query.projectId === 'string' && req.query.projectId) {
        clauses.push(sql`rc.project_id = ${req.query.projectId}`);
      }
      if (typeof req.query.role === 'string' && req.query.role) {
        clauses.push(sql`rc.role = ${req.query.role}`);
      }
      if (typeof req.query.status === 'string' && req.query.status) {
        clauses.push(sql`rc.approval_status = ${req.query.status}`);
      }
      if (typeof req.query.channelId === 'string' && req.query.channelId) {
        clauses.push(sql`r.discord_channel_id = ${req.query.channelId}`);
      }
      if (typeof req.query.chapter === 'string' && req.query.chapter) {
        clauses.push(sql`rc.chapter_number = ${Number(req.query.chapter)}`);
      }
      if (typeof req.query.date === 'string' && req.query.date) {
        clauses.push(sql`TO_CHAR(r.message_timestamp AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') = ${req.query.date}`);
      }
      if (typeof req.query.search === 'string' && req.query.search.trim()) {
        const term = `%${req.query.search.trim()}%`;
        clauses.push(sql`(r.raw_content ILIKE ${term} OR m.display_name ILIKE ${term})`);
      }

      const whereClause = sql.join(clauses, sql` AND `);

      const countRes = await db.execute(sql`
        SELECT COUNT(DISTINCT r.id)::int AS total
        FROM reports r
        JOIN members m ON m.id = r.member_id
        LEFT JOIN report_chapters rc ON rc.report_id = r.id
        WHERE ${whereClause}
      `);
      const total = Number((countRes.rows[0] as { total?: number } | undefined)?.total ?? 0);

      const reportRowsRes = await db.execute(sql`
        SELECT DISTINCT r.id, r.guild_id, r.period_id, r.member_id, r.project_id,
               r.discord_guild_id, r.discord_channel_id, r.discord_message_id, r.discord_author_id,
               r.author_username, r.author_display_name, r.raw_content, r.mentions_json,
               r.message_url, r.message_timestamp, r.parse_status, r.parse_notes_json,
               r.is_deleted, r.deleted_at, r.created_at, r.updated_at,
               m.display_name AS employee_name, p.title AS project_title, pp.period_key
        FROM reports r
        JOIN members m ON m.id = r.member_id
        JOIN payroll_periods pp ON pp.id = r.period_id
        LEFT JOIN projects p ON p.id = r.project_id
        LEFT JOIN report_chapters rc ON rc.report_id = r.id
        WHERE ${whereClause}
        ORDER BY r.message_timestamp DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      const reportRows = reportRowsRes.rows as Array<{ id: string } & Record<string, unknown>>;
      const reportIds = reportRows.map((r) => r.id);
      const chaptersByReport = new Map<string, unknown[]>();

      if (reportIds.length > 0) {
        const chapterRowsRes = await db.execute(sql`
          SELECT rc.id, rc.report_id, rc.guild_id, rc.period_id, rc.member_id, rc.project_id,
                 rc.chapter_number, rc.role, rc.unit_rate_idr, rc.amount_idr,
                 rc.approval_status, rc.duplicate_flag, rc.duplicate_of_chapter_id,
                 rc.approved_by, rc.approved_at, rc.rejection_reason, rc.created_at,
                 p.title AS project_title
          FROM report_chapters rc
          LEFT JOIN projects p ON p.id = rc.project_id
          WHERE rc.report_id IN (${sql.join(reportIds.map((id) => sql`${id}`), sql`, `)})
          ORDER BY rc.chapter_number ASC
        `);

        for (const ch of chapterRowsRes.rows as Array<{ report_id: string }>) {
          const list = chaptersByReport.get(ch.report_id) ?? [];
          list.push(ch);
          chaptersByReport.set(ch.report_id, list);
        }
      }

      const reportsOut = reportRows.map((r) => ({
        ...r,
        chapters: chaptersByReport.get(r.id) ?? [],
      }));

      res.json({
        reports: reportsOut,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      });
    })
  );

  router.get(
    '/reports/:id',
    asyncRoute(async (req: Request, res: Response) => {
      const reportId = String(req.params.id);
      const reportRes = await db.execute(sql`
        SELECT r.*, m.display_name AS employee_name, p.title AS project_title, pp.period_key
        FROM reports r
        JOIN members m ON m.id = r.member_id
        JOIN payroll_periods pp ON pp.id = r.period_id
        LEFT JOIN projects p ON p.id = r.project_id
        WHERE r.id = ${reportId}
        LIMIT 1
      `);
      const report = reportRes.rows[0];
      if (!report) {
        res.status(404).json({ error: 'Laporan tidak ditemukan.' });
        return;
      }

      const chapters = (
        await db.execute(sql`
          SELECT rc.*, p.title AS project_title
          FROM report_chapters rc
          LEFT JOIN projects p ON p.id = rc.project_id
          WHERE rc.report_id = ${reportId}
          ORDER BY rc.chapter_number ASC
        `)
      ).rows;

      const events = (
        await db.execute(sql`
          SELECT * FROM report_events WHERE report_id = ${reportId} ORDER BY created_at DESC
        `)
      ).rows;

      res.json({ report, chapters, events });
    })
  );

  router.post(
    '/reports/ingest',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.status(400).json({ error: 'Guild belum diinisialisasi.' });
        return;
      }

      const {
        discordMessageId,
        discordChannelId,
        discordAuthorId,
        authorUsername,
        authorDisplayName,
        content,
        bypassChannelCheck,
      } = req.body as {
        discordMessageId?: string;
        discordChannelId?: string;
        discordAuthorId?: string;
        authorUsername?: string;
        authorDisplayName?: string;
        content?: string;
        bypassChannelCheck?: boolean;
      };

      if (!content?.trim() || !discordChannelId?.trim() || !discordAuthorId?.trim()) {
        res.status(400).json({ error: 'Channel ID, Discord Author ID, dan isi pesan wajib diisi.' });
        return;
      }

      const msgId =
        discordMessageId?.trim() && /^\d+$/.test(discordMessageId.trim())
          ? discordMessageId.trim()
          : `${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`;

      try {
        const result = await processDiscordReport(
          db,
          {
            discordMessageId: msgId,
            discordGuildId: guild.discord_guild_id,
            discordChannelId: discordChannelId.trim(),
            discordAuthorId: discordAuthorId.trim(),
            authorUsername: authorUsername?.trim() || 'discord_member',
            authorDisplayName: authorDisplayName?.trim() || 'Discord Worker',
            content: content.trim(),
          },
          { bypassChannelCheck: Boolean(bypassChannelCheck) }
        );
        res.json(result);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal memproses pesan.' });
      }
    })
  );

  router.post(
    '/reports/edit-sync',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.status(400).json({ error: 'Guild belum diinisialisasi.' });
        return;
      }

      const { discordMessageId, discordChannelId, discordAuthorId, authorUsername, authorDisplayName, content } =
        req.body as {
          discordMessageId: string;
          discordChannelId: string;
          discordAuthorId: string;
          authorUsername?: string;
          authorDisplayName?: string;
          content: string;
        };

      const result = await handleDiscordMessageEdit(db, {
        discordMessageId,
        discordGuildId: guild.discord_guild_id,
        discordChannelId,
        discordAuthorId,
        authorUsername: authorUsername || 'discord_member',
        authorDisplayName: authorDisplayName || 'Discord Worker',
        content,
      });
      res.json(result);
    })
  );

  router.post(
    '/reports/delete-sync',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const { discordMessageId, reason } = req.body as { discordMessageId?: string; reason?: string };
      if (!discordMessageId) {
        res.status(400).json({ error: 'discordMessageId wajib diisi.' });
        return;
      }
      const result = await handleDiscordMessageDelete(
        db,
        discordMessageId,
        req.user!,
        reason || 'Void oleh Admin'
      );
      res.json(result);
    })
  );

  router.post(
    '/reports/chapters/bulk-approval',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const { chapterIds, action, reason } = req.body as {
        chapterIds?: string[];
        action?: 'approve' | 'reject' | 'void';
        reason?: string;
      };
      if (!Array.isArray(chapterIds) || chapterIds.length === 0 || !action) {
        res.status(400).json({ error: 'chapterIds dan action wajib diisi.' });
        return;
      }
      try {
        const result = await updateChapterApproval(db, chapterIds, action, req.user!, reason || '');
        res.json(result);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal memperbarui status.' });
      }
    })
  );

  router.patch(
    '/reports/chapters/:chapterId',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const { projectId, role, chapterNumber, approvalStatus, reason } = req.body as {
        projectId?: string;
        role?: RoleName;
        chapterNumber?: number;
        approvalStatus?: 'approved' | 'rejected' | 'void' | 'pending';
        reason?: string;
      };
      if (!reason?.trim()) {
        res.status(400).json({ error: 'Alasan koreksi wajib diisi untuk audit trail.' });
        return;
      }
      try {
        await correctReportChapter(
          db,
          String(req.params.chapterId),
          { projectId, role, chapterNumber, approvalStatus },
          req.user!,
          reason.trim()
        );
        res.json({ ok: true });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal mengoreksi chapter.' });
      }
    })
  );

  // ============================================================================
  // PAYROLL & PAYMENTS
  // ============================================================================
  router.get(
    '/payroll',
    asyncRoute(async (req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.json({ records: [], periodId: '' });
        return;
      }

      const jakarta = getJakartaDateParts();
      let periodId = typeof req.query.periodId === 'string' ? req.query.periodId : '';
      if (!periodId) {
        const pRows = await db
          .select({ id: payrollPeriods.id })
          .from(payrollPeriods)
          .where(and(eq(payrollPeriods.guildId, guild.id), eq(payrollPeriods.periodKey, jakarta.periodKey)))
          .limit(1);
        periodId = pRows[0]?.id || '';
      }

      const clauses = [sql`pr.guild_id = ${guild.id}`];
      if (periodId) clauses.push(sql`pr.period_id = ${periodId}`);
      if (typeof req.query.status === 'string' && req.query.status) {
        clauses.push(sql`pr.payment_status = ${req.query.status}`);
      }
      if (typeof req.query.memberId === 'string' && req.query.memberId) {
        clauses.push(sql`pr.member_id = ${req.query.memberId}`);
      }

      const whereClause = sql.join(clauses, sql` AND `);
      const records = (
        await db.execute(sql`
          SELECT pr.*, m.display_name AS employee_name, m.discord_user_id, m.discord_username,
                 pp.period_key, pp.status AS period_status
          FROM payroll_records pr
          JOIN members m ON m.id = pr.member_id
          JOIN payroll_periods pp ON pp.id = pr.period_id
          WHERE ${whereClause}
          ORDER BY pr.remaining_amount_idr DESC, m.display_name ASC
        `)
      ).rows;

      res.json({ records, periodId });
    })
  );

  router.get(
    '/payroll/:recordId/items',
    asyncRoute(async (req: Request, res: Response) => {
      const recordId = String(req.params.recordId);
      const recordRes = await db.execute(sql`
        SELECT pr.*, m.display_name AS employee_name, pp.period_key, pp.status AS period_status
        FROM payroll_records pr
        JOIN members m ON m.id = pr.member_id
        JOIN payroll_periods pp ON pp.id = pr.period_id
        WHERE pr.id = ${recordId}
        LIMIT 1
      `);
      const record = recordRes.rows[0];
      if (!record) {
        res.status(404).json({ error: 'Payroll record tidak ditemukan.' });
        return;
      }

      const items = (
        await db.execute(sql`
          SELECT pi.*, p.title AS project_title
          FROM payroll_items pi
          LEFT JOIN projects p ON p.id = pi.project_id
          WHERE pi.payroll_record_id = ${recordId}
          ORDER BY p.title ASC, pi.chapter_number ASC
        `)
      ).rows;

      const adjustments = (
        await db.execute(sql`
          SELECT * FROM payroll_adjustments WHERE payroll_record_id = ${recordId} ORDER BY created_at DESC
        `)
      ).rows;

      const paymentRows = (
        await db.execute(sql`
          SELECT * FROM payments WHERE payroll_record_id = ${recordId} ORDER BY paid_at DESC
        `)
      ).rows;

      res.json({ record, items, adjustments, payments: paymentRows });
    })
  );

  router.post(
    '/payroll/pay',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const { payrollRecordId, amountIdr, method, transactionRef, notes } = req.body as {
        payrollRecordId?: string;
        amountIdr?: number;
        method?: string;
        transactionRef?: string;
        notes?: string;
      };

      if (!payrollRecordId || !amountIdr) {
        res.status(400).json({ error: 'payrollRecordId dan amountIdr wajib diisi.' });
        return;
      }

      try {
        const result = await recordPayment(
          db,
          {
            payrollRecordId,
            amountIdr: Math.trunc(Number(amountIdr)),
            method: method || 'Bank Transfer',
            transactionRef,
            notes,
          },
          req.user!
        );
        res.status(201).json(result);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal mencatat pembayaran.' });
      }
    })
  );

  router.post(
    '/payroll/bulk-pay',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const { payrollRecordIds, method, transactionRefPrefix, notes } = req.body as {
        payrollRecordIds?: string[];
        method?: string;
        transactionRefPrefix?: string;
        notes?: string;
      };
      if (!Array.isArray(payrollRecordIds) || payrollRecordIds.length === 0) {
        res.status(400).json({ error: 'Pilih minimal 1 payroll record.' });
        return;
      }

      try {
        const results: Array<{ payrollRecordId: string; paid: number }> = [];
        for (const [idx, recId] of payrollRecordIds.entries()) {
          const recRows = await db
            .select({ remainingAmountIdr: payrollRecords.remainingAmountIdr })
            .from(payrollRecords)
            .where(eq(payrollRecords.id, recId))
            .limit(1);

          const rec = recRows[0];
          if (!rec || rec.remainingAmountIdr <= 0) continue;

          await recordPayment(
            db,
            {
              payrollRecordId: recId,
              amountIdr: rec.remainingAmountIdr,
              method: method || 'Bank Transfer',
              transactionRef: transactionRefPrefix
                ? `${transactionRefPrefix}-${idx + 1}`
                : `BULK-${Date.now()}-${idx + 1}`,
              notes: notes || 'Pembayaran massal (Bulk Payment)',
            },
            req.user!
          );
          results.push({ payrollRecordId: recId, paid: rec.remainingAmountIdr });
        }
        res.json({ processedCount: results.length, results });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal memproses bulk payment.' });
      }
    })
  );

  router.post(
    '/payroll/adjustments',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const { payrollRecordId, amountIdr, reason } = req.body as {
        payrollRecordId?: string;
        amountIdr?: number;
        reason?: string;
      };
      if (!payrollRecordId || amountIdr === undefined || !reason) {
        res.status(400).json({ error: 'payrollRecordId, amountIdr, dan reason wajib diisi.' });
        return;
      }
      try {
        const result = await createPayrollAdjustment(
          db,
          { payrollRecordId, amountIdr: Math.trunc(Number(amountIdr)), reason },
          req.user!
        );
        res.status(201).json(result);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal membuat adjustment.' });
      }
    })
  );

  router.get(
    '/payments',
    asyncRoute(async (req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 25));
      const offset = (page - 1) * pageSize;

      if (!guild) {
        res.json({
          payments: [],
          pagination: { page, pageSize, total: 0, totalPages: 1 },
        });
        return;
      }

      const clauses = [sql`py.guild_id = ${guild.id}`];
      if (typeof req.query.periodId === 'string' && req.query.periodId) {
        clauses.push(sql`py.period_id = ${req.query.periodId}`);
      }
      if (typeof req.query.method === 'string' && req.query.method) {
        clauses.push(sql`py.method = ${req.query.method}`);
      }
      if (search) {
        const term = `%${search}%`;
        clauses.push(
          sql`(m.display_name ILIKE ${term} OR py.transaction_ref ILIKE ${term} OR py.admin_name ILIKE ${term})`
        );
      }

      const whereClause = sql.join(clauses, sql` AND `);

      const totalRes = await db.execute(sql`
        SELECT COUNT(*)::int AS total
        FROM payments py
        JOIN members m ON m.id = py.member_id
        WHERE ${whereClause}
      `);
      const total = Number((totalRes.rows[0] as { total?: number } | undefined)?.total ?? 0);

      const paymentRows = (
        await db.execute(sql`
          SELECT py.*, m.display_name AS recipient_name, m.discord_user_id,
                 pp.period_key, pr.payment_status AS payroll_status
          FROM payments py
          JOIN members m ON m.id = py.member_id
          JOIN payroll_periods pp ON pp.id = py.period_id
          JOIN payroll_records pr ON pr.id = py.payroll_record_id
          WHERE ${whereClause}
          ORDER BY py.paid_at DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `)
      ).rows;

      res.json({
        payments: paymentRows,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      });
    })
  );

  router.post(
    '/payments/:id/reverse',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const { reason } = req.body as { reason?: string };
      try {
        const result = await reversePayment(db, String(req.params.id), reason || '', req.user!);
        res.status(201).json(result);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal melakukan reversal pembayaran.' });
      }
    })
  );

  // ============================================================================
  // PERIODS & MONTHLY ARCHIVE
  // ============================================================================
  router.get(
    '/periods',
    asyncRoute(async (_req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.json({ periods: [] });
        return;
      }
      const rows = (
        await db.execute(sql`
          SELECT * FROM payroll_periods WHERE guild_id = ${guild.id} ORDER BY year DESC, month DESC
        `)
      ).rows;
      res.json({ periods: rows });
    })
  );

  router.get(
    '/periods/archive',
    asyncRoute(async (_req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.json({ archives: [] });
        return;
      }

      const periodRows = (
        await db.execute(sql`
          SELECT * FROM payroll_periods WHERE guild_id = ${guild.id} ORDER BY year DESC, month DESC
        `)
      ).rows as Array<{ id: string; period_key: string; year: number; month: number; status: string }>;

      const archives = [];
      for (const p of periodRows) {
        const summaryRes = await db.execute(sql`
          SELECT
            COUNT(DISTINCT CASE WHEN pr.total_chapters > 0 THEN pr.member_id END)::int AS active_workers,
            COALESCE(SUM(pr.translator_chapters), 0)::int AS translator_chapters,
            COALESCE(SUM(pr.editor_chapters), 0)::int AS editor_chapters,
            COALESCE(SUM(pr.solo_chapters), 0)::int AS solo_chapters,
            COALESCE(SUM(pr.total_chapters), 0)::int AS total_chapters,
            COALESCE(SUM(pr.net_amount_idr), 0)::int AS total_payroll_idr,
            COALESCE(SUM(pr.paid_amount_idr), 0)::int AS total_paid_idr,
            COALESCE(SUM(pr.remaining_amount_idr), 0)::int AS total_unpaid_idr
          FROM payroll_records pr
          WHERE pr.period_id = ${p.id}
        `);
        const summary = (summaryRes.rows[0] ?? {}) as Record<string, number>;

        const comicsCntRes = await db.execute(sql`
          SELECT COUNT(DISTINCT project_id)::int AS cnt
          FROM report_chapters
          WHERE period_id = ${p.id}
            AND approval_status IN ('auto_approved', 'approved')
            AND project_id IS NOT NULL
        `);
        const totalComics = Number((comicsCntRes.rows[0] as { cnt?: number } | undefined)?.cnt ?? 0);

        const byComic = (
          await db.execute(sql`
            SELECT COALESCE(proj.title, 'Unknown') AS title,
                   COUNT(rc.id)::int AS chapters,
                   COALESCE(SUM(rc.amount_idr), 0)::int AS amount_idr
            FROM report_chapters rc
            LEFT JOIN projects proj ON proj.id = rc.project_id
            WHERE rc.period_id = ${p.id} AND rc.approval_status IN ('auto_approved', 'approved')
            GROUP BY proj.id, proj.title
            ORDER BY amount_idr DESC
          `)
        ).rows;

        archives.push({
          ...p,
          ...summary,
          total_comics: totalComics,
          byComic,
        });
      }

      res.json({ archives });
    })
  );

  router.post(
    '/periods/:id/close',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      try {
        await closePayrollPeriod(db, String(req.params.id), req.user!);
        res.json({ ok: true });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal menutup periode.' });
      }
    })
  );

  router.post(
    '/periods/:id/reopen',
    requireOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const { reason } = req.body as { reason?: string };
      try {
        await reopenPayrollPeriod(db, String(req.params.id), reason || '', req.user!);
        res.json({ ok: true });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal membuka kembali periode.' });
      }
    })
  );

  // ============================================================================
  // SETTINGS & ADMIN USERS
  // ============================================================================
  router.get(
    '/settings',
    asyncRoute(async (_req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.json({
          guild: { id: '', discord_guild_id: '0', name: 'Belum Diatur', timezone: 'Asia/Jakarta' },
          rates: { Translator: 3000, Editor: 3000, Solo: 6000 },
          rateHistory: [],
          roleAliases: [],
          botSettings: {},
          botState: getBotRuntimeState(),
          checkpoints: [],
        });
        return;
      }

      const rates = await getActiveRatesMap(db, guild.id);
      const rateHistory = (
        await db.execute(sql`
          SELECT * FROM payroll_rates WHERE guild_id = ${guild.id} ORDER BY created_at DESC LIMIT 20
        `)
      ).rows;

      const roleAliasRows = (
        await db.execute(sql`
          SELECT * FROM role_aliases WHERE guild_id = ${guild.id} ORDER BY role ASC, alias ASC
        `)
      ).rows;

      const botSettingRows = await db
        .select({ key: botSettings.key, valueJson: botSettings.valueJson })
        .from(botSettings)
        .where(eq(botSettings.guildId, guild.id));

      const botSettingsMap: Record<string, unknown> = {};
      for (const r of botSettingRows) {
        botSettingsMap[r.key] = r.valueJson;
      }

      const checkpoints = (
        await db.execute(sql`
          SELECT * FROM processing_checkpoints WHERE guild_id = ${guild.id} ORDER BY channel_name ASC
        `)
      ).rows;

      res.json({
        guild,
        rates,
        rateHistory,
        roleAliases: roleAliasRows,
        botSettings: botSettingsMap,
        botState: getBotRuntimeState(),
        checkpoints,
      });
    })
  );

  router.put(
    '/settings/guild',
    requireOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const { name, discordGuildId } = req.body as { name?: string; discordGuildId?: string };
      if (discordGuildId !== undefined && discordGuildId.trim() && !/^\d+$/.test(discordGuildId.trim())) {
        res.status(400).json({ error: 'Discord Guild ID harus berupa angka Snowflake.' });
        return;
      }

      let resolvedGuild = await getPrimaryGuild(db);
      const beforeSnapshot = resolvedGuild
        ? { name: resolvedGuild.name, discord_guild_id: resolvedGuild.discord_guild_id }
        : null;

      if (!resolvedGuild) {
        const [created] = await db
          .insert(guilds)
          .values({
            name: name?.trim() || 'ComicPay Studio',
            discordGuildId: discordGuildId?.trim() || '0',
            timezone: 'Asia/Jakarta',
            isActive: true,
          })
          .returning();
        await seedGuildDefaults(db, created.id);
        resolvedGuild = {
          id: created.id,
          discord_guild_id: created.discordGuildId,
          name: created.name,
          timezone: created.timezone,
        };
      } else {
        await db
          .update(guilds)
          .set({
            name: name?.trim() || resolvedGuild.name,
            discordGuildId: discordGuildId?.trim() || resolvedGuild.discord_guild_id,
            updatedAt: new Date(),
          })
          .where(eq(guilds.id, resolvedGuild.id));
      }

      await writeAuditLog(db, {
        guildId: resolvedGuild.id,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'UPDATE_GUILD',
        entityType: 'guild',
        entityId: resolvedGuild.id,
        before: beforeSnapshot,
        after: { name, discordGuildId },
      });

      res.json({ ok: true });
    })
  );

  router.put(
    '/settings/rates',
    requireOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.status(400).json({ error: 'Guild belum diinisialisasi.' });
        return;
      }

      const { role, rateIdr } = req.body as { role?: RoleName; rateIdr?: number };
      if (!role || !['Translator', 'Editor', 'Solo'].includes(role) || !Number.isInteger(rateIdr) || (rateIdr ?? -1) < 0) {
        res.status(400).json({ error: 'Role dan tarif integer Rupiah yang valid wajib diisi.' });
        return;
      }

      const prevRates = await getActiveRatesMap(db, guild.id);
      const now = new Date();

      await db.transaction(async (tx) => {
        const txDb = tx as unknown as AppDb;
        await txDb
          .update(payrollRates)
          .set({ isActive: false })
          .where(and(eq(payrollRates.guildId, guild.id), eq(payrollRates.role, role)));

        await txDb.insert(payrollRates).values({
          guildId: guild.id,
          role,
          rateIdr: rateIdr!,
          effectiveFrom: now,
          isActive: true,
          createdBy: req.user!.email,
        });

        await writeAuditLog(txDb, {
          guildId: guild.id,
          actorId: req.user!.id,
          actorEmail: req.user!.email,
          actorRole: req.user!.role,
          action: 'UPDATE_PAYROLL_RATE',
          entityType: 'payroll_rate',
          entityId: role,
          before: { rate_idr: prevRates[role] },
          after: { rate_idr: rateIdr },
          reason: 'Perubahan tarif berlaku hanya untuk laporan baru (snapshot lama dipertahankan).',
        });
      });

      res.json({ ok: true, rates: await getActiveRatesMap(db, guild.id) });
    })
  );

  router.post(
    '/settings/role-aliases',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.status(400).json({ error: 'Guild belum tersedia.' });
        return;
      }

      const { alias, role } = req.body as { alias?: string; role?: RoleName };
      if (!alias?.trim() || !role || !['Translator', 'Editor', 'Solo'].includes(role)) {
        res.status(400).json({ error: 'Alias dan role valid wajib diisi.' });
        return;
      }

      const [created] = await db
        .insert(roleAliases)
        .values({ guildId: guild.id, alias: alias.trim(), role })
        .returning({ id: roleAliases.id });

      await writeAuditLog(db, {
        guildId: guild.id,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'ADD_ROLE_ALIAS',
        entityType: 'role_alias',
        entityId: created.id,
        after: { alias: alias.trim(), role },
      });

      res.status(201).json({ id: created.id });
    })
  );

  router.delete(
    '/settings/role-aliases/:id',
    requireAdminOrOwner,
    asyncRoute(async (req: Request, res: Response) => {
      await db.delete(roleAliases).where(eq(roleAliases.id, String(req.params.id)));
      res.json({ ok: true });
    })
  );

  router.put(
    '/settings/bot',
    requireOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.status(400).json({ error: 'Guild belum tersedia.' });
        return;
      }

      const settings = req.body as Record<string, unknown>;
      const now = new Date();

      await db.transaction(async (tx) => {
        const txDb = tx as unknown as AppDb;
        for (const [key, val] of Object.entries(settings)) {
          await txDb
            .insert(botSettings)
            .values({ guildId: guild.id, key, valueJson: val, updatedAt: now })
            .onConflictDoUpdate({
              target: [botSettings.guildId, botSettings.key],
              set: { valueJson: val, updatedAt: now },
            });
        }

        await writeAuditLog(txDb, {
          guildId: guild.id,
          actorId: req.user!.id,
          actorEmail: req.user!.email,
          actorRole: req.user!.role,
          action: 'UPDATE_BOT_SETTINGS',
          entityType: 'bot_settings',
          entityId: guild.id,
          after: settings,
        });
      });

      res.json({ ok: true });
    })
  );

  router.get(
    '/settings/admin-users',
    requireOwner,
    asyncRoute(async (_req: Request, res: Response) => {
      const users = (
        await db.execute(sql`
          SELECT id, email, full_name, role, discord_user_id, is_active, last_login_at, created_at
          FROM admin_users
          ORDER BY created_at ASC
        `)
      ).rows;
      res.json({ users });
    })
  );

  router.post(
    '/settings/admin-users',
    requireOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const { email, fullName, role, password, discordUserId } = req.body as {
        email?: string;
        fullName?: string;
        role?: AdminRole;
        password?: string;
        discordUserId?: string;
      };

      if (!email?.trim() || !fullName?.trim() || !password || password.length < 8 || !role) {
        res.status(400).json({ error: 'Email, nama lengkap, role, dan password (min 8 karakter) wajib diisi.' });
        return;
      }
      if (!['Owner', 'Admin', 'Viewer'].includes(role)) {
        res.status(400).json({ error: 'Role tidak valid. Pilih Owner, Admin, atau Viewer.' });
        return;
      }
      if (discordUserId?.trim() && !/^\d+$/.test(discordUserId.trim())) {
        res.status(400).json({ error: 'Discord User ID harus berupa angka Snowflake.' });
        return;
      }

      const cleanEmail = email.trim().toLowerCase();
      const exists = await db
        .select({ id: adminUsers.id })
        .from(adminUsers)
        .where(eq(adminUsers.email, cleanEmail))
        .limit(1);

      if (exists.length > 0) {
        res.status(409).json({ error: 'Email admin sudah terdaftar.' });
        return;
      }

      const [created] = await db
        .insert(adminUsers)
        .values({
          email: cleanEmail,
          fullName: fullName.trim(),
          role,
          passwordHash: bcrypt.hashSync(password, 12),
          discordUserId: discordUserId?.trim() || null,
          isActive: true,
        })
        .returning({ id: adminUsers.id });

      await writeAuditLog(db, {
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'CREATE_ADMIN_USER',
        entityType: 'admin_user',
        entityId: created.id,
        after: { email: cleanEmail, fullName: fullName.trim(), role },
      });

      res.status(201).json({ id: created.id });
    })
  );

  router.patch(
    '/settings/admin-users/:id',
    requireOwner,
    asyncRoute(async (req: Request, res: Response) => {
      const targetId = String(req.params.id);
      const { role, isActive, fullName } = req.body as {
        role?: AdminRole;
        isActive?: boolean;
        fullName?: string;
      };

      const existingRows = await db.select().from(adminUsers).where(eq(adminUsers.id, targetId)).limit(1);
      if (existingRows.length === 0) {
        res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
        return;
      }
      const existing = existingRows[0];

      await db
        .update(adminUsers)
        .set({
          role: role || existing.role,
          isActive: typeof isActive === 'boolean' ? isActive : existing.isActive,
          fullName: fullName?.trim() || existing.fullName,
          updatedAt: new Date(),
        })
        .where(eq(adminUsers.id, targetId));

      await writeAuditLog(db, {
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'UPDATE_ADMIN_USER',
        entityType: 'admin_user',
        entityId: targetId,
        after: { role, isActive, fullName },
      });

      res.json({ ok: true });
    })
  );

  // ============================================================================
  // AUDIT LOGS, NOTIFICATIONS & BOT SYNC
  // ============================================================================
  router.get(
    '/audit-logs',
    asyncRoute(async (req: Request, res: Response) => {
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 30));
      const offset = (page - 1) * pageSize;

      const [{ total }] = await db.select({ total: count() }).from(auditLogs);
      const logs = (
        await db.execute(sql`
          SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}
        `)
      ).rows;

      res.json({
        logs,
        pagination: {
          page,
          pageSize,
          total: Number(total),
          totalPages: Math.max(1, Math.ceil(Number(total) / pageSize)),
        },
      });
    })
  );

  router.get(
    '/notifications',
    asyncRoute(async (_req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.json({ notifications: [], unreadCount: 0 });
        return;
      }
      const notifRows = (
        await db.execute(sql`
          SELECT * FROM notifications WHERE guild_id = ${guild.id} ORDER BY created_at DESC LIMIT 30
        `)
      ).rows;

      const [{ cnt }] = await db
        .select({ cnt: count() })
        .from(notifications)
        .where(and(eq(notifications.guildId, guild.id), eq(notifications.isRead, false)));

      res.json({ notifications: notifRows, unreadCount: Number(cnt) });
    })
  );

  router.post(
    '/notifications/read-all',
    requireAdminOrOwner,
    asyncRoute(async (_req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (guild) {
        await db.update(notifications).set({ isRead: true }).where(eq(notifications.guildId, guild.id));
      }
      res.json({ ok: true });
    })
  );

  router.post(
    '/bot/sync',
    requireAdminOrOwner,
    asyncRoute(async (_req: Request, res: Response) => {
      const result = await triggerManualSync(db);
      res.json({ ...result, botState: getBotRuntimeState() });
    })
  );

  // ============================================================================
  // EXPORT (EXCEL & CSV)
  // ============================================================================
  router.get(
    '/export',
    asyncRoute(async (req: Request, res: Response) => {
      const guild = await getPrimaryGuild(db);
      if (!guild) {
        res.status(400).json({ error: 'Belum ada data guild untuk diexport.' });
        return;
      }

      const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
      const dataset = String(req.query.dataset || 'payroll');
      const periodId = typeof req.query.periodId === 'string' ? req.query.periodId : '';

      const periodRes = periodId
        ? await db.execute(sql`SELECT id, period_key FROM payroll_periods WHERE id = ${periodId} LIMIT 1`)
        : await db.execute(
            sql`SELECT id, period_key FROM payroll_periods WHERE guild_id = ${guild.id} ORDER BY year DESC, month DESC LIMIT 1`
          );

      const period = periodRes.rows[0] as { id: string; period_key: string } | undefined;
      const periodLabel = period?.period_key || 'All';
      const exportDate = getJakartaDateParts().dateStr;

      const wb = XLSX.utils.book_new();
      let csvRows: string[][] = [];

      if (dataset === 'payroll' && period) {
        const rows = (
          await db.execute(sql`
            SELECT m.display_name, m.discord_user_id, pr.translator_chapters::int, pr.editor_chapters::int,
                   pr.solo_chapters::int, pr.total_chapters::int, pr.gross_amount_idr::int, pr.adjustment_amount_idr::int,
                   pr.net_amount_idr::int, pr.paid_amount_idr::int, pr.remaining_amount_idr::int, pr.payment_status
            FROM payroll_records pr
            JOIN members m ON m.id = pr.member_id
            WHERE pr.period_id = ${period.id}
            ORDER BY m.display_name ASC
          `)
        ).rows as Array<{
          display_name: string;
          discord_user_id: string;
          translator_chapters: number;
          editor_chapters: number;
          solo_chapters: number;
          total_chapters: number;
          gross_amount_idr: number;
          adjustment_amount_idr: number;
          net_amount_idr: number;
          paid_amount_idr: number;
          remaining_amount_idr: number;
          payment_status: string;
        }>;

        const sheetAoA: Array<Array<string | number>> = [
          [`Laporan Payroll Karyawan — ${guild.name}`],
          [`Periode: ${periodLabel}`, `Tanggal Export (WIB): ${exportDate}`],
          [],
          [
            'Nama Karyawan',
            'Discord User ID',
            'Translator (Ch)',
            'Editor (Ch)',
            'Solo (Ch)',
            'Total Chapter',
            'Bruto (IDR)',
            'Adjustment (IDR)',
            'Total Gaji (IDR)',
            'Sudah Dibayar (IDR)',
            'Sisa (IDR)',
            'Status',
          ],
        ];

        let sumCh = 0;
        let sumNet = 0;
        let sumPaid = 0;
        let sumRem = 0;

        for (const r of rows) {
          sumCh += r.total_chapters;
          sumNet += r.net_amount_idr;
          sumPaid += r.paid_amount_idr;
          sumRem += r.remaining_amount_idr;
          sheetAoA.push([
            r.display_name,
            String(r.discord_user_id ?? ''),
            r.translator_chapters,
            r.editor_chapters,
            r.solo_chapters,
            r.total_chapters,
            r.gross_amount_idr,
            r.adjustment_amount_idr,
            r.net_amount_idr,
            r.paid_amount_idr,
            r.remaining_amount_idr,
            r.payment_status,
          ]);
        }

        sheetAoA.push([
          'TOTAL',
          '',
          rows.reduce((s, r) => s + r.translator_chapters, 0),
          rows.reduce((s, r) => s + r.editor_chapters, 0),
          rows.reduce((s, r) => s + r.solo_chapters, 0),
          sumCh,
          rows.reduce((s, r) => s + r.gross_amount_idr, 0),
          rows.reduce((s, r) => s + r.adjustment_amount_idr, 0),
          sumNet,
          sumPaid,
          sumRem,
          formatIdr(sumNet),
        ]);

        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetAoA), 'Payroll Karyawan');

        const comicRows = (
          await db.execute(sql`
            SELECT COALESCE(p.title, 'Unknown') AS title,
                   COALESCE(SUM(CASE WHEN rc.role = 'Translator' THEN 1 ELSE 0 END), 0)::int AS tl_ch,
                   COALESCE(SUM(CASE WHEN rc.role = 'Editor' THEN 1 ELSE 0 END), 0)::int AS ed_ch,
                   COALESCE(SUM(CASE WHEN rc.role = 'Solo' THEN 1 ELSE 0 END), 0)::int AS solo_ch,
                   COUNT(rc.id)::int AS total_ch,
                   COALESCE(SUM(rc.amount_idr), 0)::int AS total_idr
            FROM report_chapters rc
            LEFT JOIN projects p ON p.id = rc.project_id
            WHERE rc.period_id = ${period.id} AND rc.approval_status IN ('auto_approved', 'approved')
            GROUP BY p.id, p.title
            ORDER BY total_idr DESC
          `)
        ).rows as Array<{
          title: string;
          tl_ch: number;
          ed_ch: number;
          solo_ch: number;
          total_ch: number;
          total_idr: number;
        }>;

        const comicAoA: Array<Array<string | number>> = [
          [`Rekap Pengeluaran per Komik — ${guild.name}`],
          [`Periode: ${periodLabel}`, `Tanggal Export: ${exportDate}`],
          [],
          ['Komik', 'Translator (Ch)', 'Editor (Ch)', 'Solo (Ch)', 'Total Chapter', 'Total Pengeluaran (IDR)'],
          ...comicRows.map((c) => [c.title, c.tl_ch, c.ed_ch, c.solo_ch, c.total_ch, c.total_idr]),
          [
            'TOTAL',
            comicRows.reduce((s, c) => s + c.tl_ch, 0),
            comicRows.reduce((s, c) => s + c.ed_ch, 0),
            comicRows.reduce((s, c) => s + c.solo_ch, 0),
            comicRows.reduce((s, c) => s + c.total_ch, 0),
            comicRows.reduce((s, c) => s + c.total_idr, 0),
          ],
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(comicAoA), 'Payroll per Komik');
        csvRows = sheetAoA.map((row) => row.map((v) => String(v)));
      } else if (dataset === 'payments') {
        const rows = (
          await db.execute(sql`
            SELECT py.paid_at, m.display_name, pp.period_key, py.amount_idr::int,
                   py.method, py.transaction_ref, py.admin_name, py.notes
            FROM payments py
            JOIN members m ON m.id = py.member_id
            JOIN payroll_periods pp ON pp.id = py.period_id
            WHERE py.guild_id = ${guild.id}
            ORDER BY py.paid_at DESC
          `)
        ).rows as Array<Record<string, unknown>>;

        const sheetAoA: Array<Array<string | number>> = [
          [`Riwayat Pembayaran — ${guild.name}`],
          [`Tanggal Export: ${exportDate}`],
          [],
          ['Tanggal (UTC)', 'Penerima', 'Periode', 'Nominal (IDR)', 'Metode', 'Referensi', 'Admin', 'Catatan'],
          ...rows.map((r) => [
            r.paid_at instanceof Date ? r.paid_at.toISOString() : String(r.paid_at),
            String(r.display_name),
            String(r.period_key),
            Number(r.amount_idr),
            String(r.method),
            String(r.transaction_ref || ''),
            String(r.admin_name),
            String(r.notes || ''),
          ]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetAoA), 'Riwayat Pembayaran');
        csvRows = sheetAoA.map((row) => row.map((v) => String(v)));
      } else {
        const periodFilter = period ? sql`AND rc.period_id = ${period.id}` : sql``;
        const rows = (
          await db.execute(sql`
            SELECT r.message_timestamp, m.display_name, COALESCE(p.title, 'Ambigu') AS title,
                   rc.chapter_number::int, rc.role, rc.unit_rate_idr::int, rc.amount_idr::int,
                   rc.approval_status, r.raw_content
            FROM report_chapters rc
            JOIN reports r ON r.id = rc.report_id
            JOIN members m ON m.id = rc.member_id
            LEFT JOIN projects p ON p.id = rc.project_id
            WHERE rc.guild_id = ${guild.id} ${periodFilter}
            ORDER BY r.message_timestamp DESC
          `)
        ).rows as Array<Record<string, unknown>>;

        const sheetAoA: Array<Array<string | number>> = [
          [`Daftar Laporan Chapter — ${guild.name}`],
          [`Periode: ${periodLabel}`, `Tanggal Export: ${exportDate}`],
          [],
          ['Waktu', 'Karyawan', 'Komik', 'Chapter', 'Role', 'Tarif Snapshot', 'Nominal (IDR)', 'Status', 'Pesan Asli'],
          ...rows.map((r) => [
            r.message_timestamp instanceof Date ? r.message_timestamp.toISOString() : String(r.message_timestamp),
            String(r.display_name),
            String(r.title),
            Number(r.chapter_number),
            String(r.role || '-'),
            Number(r.unit_rate_idr),
            Number(r.amount_idr),
            String(r.approval_status),
            String(r.raw_content),
          ]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetAoA), 'Daftar Laporan');
        csvRows = sheetAoA.map((row) => row.map((v) => String(v)));
      }

      if (format === 'csv') {
        const csvContent = csvRows
          .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
          .join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="comicpay-${dataset}-${periodLabel}.csv"`);
        res.send('\uFEFF' + csvContent);
        return;
      }

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="comicpay-${dataset}-${periodLabel}.xlsx"`);
      res.send(buffer);
    })
  );

  // Express error fallback for API routes
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[ComicPay API Error]', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Terjadi kesalahan internal server.',
    });
  });

  return router;
}

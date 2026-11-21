import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { ensurePeriodExists, seedGuildDefaults, type AppDb } from './db.ts';
import {
  parseDiscordReport,
  type ChannelMappingEntry,
  type ProjectCatalogEntry,
  type RoleAliasEntry,
} from './parser.ts';
import {
  auditLogs,
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
import { formatIdr, getJakartaDateParts } from './time.ts';
import type { AuthUser, IncomingDiscordMessage, RoleName } from './types.ts';

export async function writeAuditLog(
  db: AppDb,
  params: {
    guildId?: string | null;
    actorId: string;
    actorEmail: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
    ipAddress?: string | null;
  }
): Promise<void> {
  await db.insert(auditLogs).values({
    guildId: params.guildId ?? null,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    actorRole: params.actorRole,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    beforeJson: params.before !== undefined ? params.before : null,
    afterJson: params.after !== undefined ? params.after : null,
    reason: params.reason ?? null,
    ipAddress: params.ipAddress ?? null,
  });
}

export async function createNotification(
  db: AppDb,
  params: {
    guildId: string;
    type: string;
    title: string;
    message: string;
    payload?: unknown;
    dedupKey?: string | null;
  }
): Promise<void> {
  if (params.dedupKey) {
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.dedupKey, params.dedupKey))
      .limit(1);
    if (existing.length > 0) return;
  }

  await db
    .insert(notifications)
    .values({
      guildId: params.guildId,
      type: params.type,
      title: params.title,
      message: params.message,
      payloadJson: params.payload ?? {},
      dedupKey: params.dedupKey ?? null,
      sentToDiscord: false,
      isRead: false,
    })
    .onConflictDoNothing();
}

export async function getActiveRatesMap(
  db: AppDb,
  guildId: string
): Promise<Record<RoleName, number>> {
  const rows = await db
    .select({ role: payrollRates.role, rateIdr: payrollRates.rateIdr })
    .from(payrollRates)
    .where(and(eq(payrollRates.guildId, guildId), eq(payrollRates.isActive, true)));

  const map: Record<RoleName, number> = {
    Translator: 3000,
    Editor: 3000,
    Solo: 6000,
  };
  for (const r of rows) {
    if (r.role === 'Translator' || r.role === 'Editor' || r.role === 'Solo') {
      map[r.role] = r.rateIdr;
    }
  }
  return map;
}

async function loadParserCatalog(
  db: AppDb,
  guildId: string,
  discordChannelId: string
): Promise<{
  isReportChannel: boolean;
  projects: ProjectCatalogEntry[];
  channelMappings: ChannelMappingEntry[];
  roleAliases: RoleAliasEntry[];
}> {
  const channelRows = await db
    .select({
      projectId: channelMappings.projectId,
      isReportChannel: channelMappings.isReportChannel,
      isDefault: channelMappings.isDefault,
    })
    .from(channelMappings)
    .where(
      and(
        eq(channelMappings.guildId, guildId),
        eq(channelMappings.discordChannelId, discordChannelId)
      )
    );

  const isReportChannel = channelRows.some((r) => r.isReportChannel);
  const mappedChannels: ChannelMappingEntry[] = channelRows
    .filter((r) => r.projectId !== null)
    .map((r) => ({
      projectId: r.projectId as string,
      isDefault: r.isDefault,
    }));

  const projectRows = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(and(eq(projects.guildId, guildId), eq(projects.isActive, true)));

  const aliasRows = await db
    .select({ projectId: projectAliases.projectId, alias: projectAliases.alias })
    .from(projectAliases)
    .where(eq(projectAliases.guildId, guildId));

  const aliasesByProject = new Map<string, string[]>();
  for (const a of aliasRows) {
    const arr = aliasesByProject.get(a.projectId) ?? [];
    arr.push(a.alias);
    aliasesByProject.set(a.projectId, arr);
  }

  const projectCatalog: ProjectCatalogEntry[] = projectRows.map((p) => ({
    id: p.id,
    title: p.title,
    aliases: aliasesByProject.get(p.id) ?? [],
  }));

  const roleAliasRows = await db
    .select({ alias: roleAliases.alias, role: roleAliases.role })
    .from(roleAliases)
    .where(eq(roleAliases.guildId, guildId));

  return {
    isReportChannel,
    projects: projectCatalog,
    channelMappings: mappedChannels,
    roleAliases: roleAliasRows.map((r) => ({ alias: r.alias, role: r.role as RoleName })),
  };
}

export async function recalculatePayrollForMemberPeriod(
  db: AppDb,
  guildId: string,
  periodId: string,
  memberId: string
): Promise<void> {
  const now = new Date();

  const approvedChapters = await db
    .select({
      id: reportChapters.id,
      projectId: reportChapters.projectId,
      chapterNumber: reportChapters.chapterNumber,
      role: reportChapters.role,
      unitRateIdr: reportChapters.unitRateIdr,
      amountIdr: reportChapters.amountIdr,
    })
    .from(reportChapters)
    .where(
      and(
        eq(reportChapters.guildId, guildId),
        eq(reportChapters.periodId, periodId),
        eq(reportChapters.memberId, memberId),
        inArray(reportChapters.approvalStatus, ['auto_approved', 'approved'])
      )
    );

  let translatorChapters = 0;
  let editorChapters = 0;
  let soloChapters = 0;
  let grossAmount = 0;

  const validItems = approvedChapters.filter(
    (c) => c.role === 'Translator' || c.role === 'Editor' || c.role === 'Solo'
  );

  for (const ch of validItems) {
    if (ch.role === 'Translator') translatorChapters += 1;
    else if (ch.role === 'Editor') editorChapters += 1;
    else if (ch.role === 'Solo') soloChapters += 1;
    grossAmount += ch.amountIdr;
  }

  const totalChapters = translatorChapters + editorChapters + soloChapters;

  const [adjRow] = await db
    .select({
      totalAdj: sql<number>`COALESCE(SUM(${payrollAdjustments.amountIdr}), 0)::int`,
    })
    .from(payrollAdjustments)
    .where(
      and(eq(payrollAdjustments.periodId, periodId), eq(payrollAdjustments.memberId, memberId))
    );

  const [payRow] = await db
    .select({
      totalPaid: sql<number>`COALESCE(SUM(${payments.amountIdr}), 0)::int`,
    })
    .from(payments)
    .where(and(eq(payments.periodId, periodId), eq(payments.memberId, memberId)));

  const adjustmentAmount = Number(adjRow?.totalAdj ?? 0);
  const netAmount = Math.max(0, grossAmount + adjustmentAmount);
  const paidAmount = Number(payRow?.totalPaid ?? 0);
  const remainingAmount = Math.max(0, netAmount - paidAmount);

  let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
  if (netAmount === 0 && paidAmount === 0) {
    paymentStatus = totalChapters === 0 ? 'UNPAID' : 'PAID';
  } else if (paidAmount >= netAmount && netAmount > 0) {
    paymentStatus = 'PAID';
  } else if (paidAmount > 0 && paidAmount < netAmount) {
    paymentStatus = 'PARTIALLY_PAID';
  }

  const existingRecord = await db
    .select({ id: payrollRecords.id })
    .from(payrollRecords)
    .where(and(eq(payrollRecords.periodId, periodId), eq(payrollRecords.memberId, memberId)))
    .limit(1);

  let recordId: string;
  if (existingRecord.length > 0) {
    recordId = existingRecord[0].id;
    await db
      .update(payrollRecords)
      .set({
        translatorChapters,
        editorChapters,
        soloChapters,
        totalChapters,
        grossAmountIdr: grossAmount,
        adjustmentAmountIdr: adjustmentAmount,
        netAmountIdr: netAmount,
        paidAmountIdr: paidAmount,
        remainingAmountIdr: remainingAmount,
        paymentStatus,
        updatedAt: now,
      })
      .where(eq(payrollRecords.id, recordId));
  } else {
    const [inserted] = await db
      .insert(payrollRecords)
      .values({
        guildId,
        periodId,
        memberId,
        translatorChapters,
        editorChapters,
        soloChapters,
        totalChapters,
        grossAmountIdr: grossAmount,
        adjustmentAmountIdr: adjustmentAmount,
        netAmountIdr: netAmount,
        paidAmountIdr: paidAmount,
        remainingAmountIdr: remainingAmount,
        paymentStatus,
        updatedAt: now,
      })
      .returning({ id: payrollRecords.id });
    recordId = inserted.id;
  }

  // Rebuild payroll_items atomically
  await db.delete(payrollItems).where(eq(payrollItems.payrollRecordId, recordId));

  if (validItems.length > 0) {
    await db.insert(payrollItems).values(
      validItems.map((ch) => ({
        payrollRecordId: recordId,
        reportChapterId: ch.id,
        projectId: ch.projectId,
        chapterNumber: ch.chapterNumber,
        role: ch.role as RoleName,
        unitRateIdr: ch.unitRateIdr,
        amountIdr: ch.amountIdr,
      }))
    );
  }
}

export async function resolveGuildOrCreateDefault(
  db: AppDb,
  discordGuildId: string
): Promise<{ id: string; discordGuildId: string; name: string }> {
  const cleanGuildId = /^\d+$/.test(discordGuildId) ? discordGuildId : '0';

  const byDiscord = await db
    .select({ id: guilds.id, discordGuildId: guilds.discordGuildId, name: guilds.name })
    .from(guilds)
    .where(eq(guilds.discordGuildId, cleanGuildId))
    .limit(1);

  if (byDiscord.length > 0) return byDiscord[0];

  const anyGuild = await db
    .select({ id: guilds.id, discordGuildId: guilds.discordGuildId, name: guilds.name })
    .from(guilds)
    .limit(1);

  if (anyGuild.length > 0) return anyGuild[0];

  const [created] = await db
    .insert(guilds)
    .values({
      discordGuildId: cleanGuildId,
      name: 'Discord Payroll Server',
      timezone: 'Asia/Jakarta',
      isActive: true,
    })
    .returning({ id: guilds.id, discordGuildId: guilds.discordGuildId, name: guilds.name });

  await seedGuildDefaults(db, created.id);
  return created;
}

export async function upsertMemberByDiscordId(
  db: AppDb,
  guildId: string,
  discordUserId: string,
  username: string,
  displayName: string,
  roleHint?: RoleName | null
): Promise<{ id: string; displayName: string }> {
  const now = new Date();
  const existing = await db
    .select({ id: members.id, displayName: members.displayName })
    .from(members)
    .where(and(eq(members.guildId, guildId), eq(members.discordUserId, discordUserId)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(members)
      .set({ discordUsername: username, updatedAt: now })
      .where(eq(members.id, existing[0].id));
    return existing[0];
  }

  const [created] = await db
    .insert(members)
    .values({
      guildId,
      discordUserId,
      discordUsername: username,
      displayName: displayName || username,
      isActive: true,
    })
    .returning({ id: members.id, displayName: members.displayName });

  if (roleHint) {
    await db
      .insert(employeeRoles)
      .values({
        memberId: created.id,
        role: roleHint,
        isPrimary: true,
      })
      .onConflictDoNothing();
  }

  return created;
}

export async function processDiscordReport(
  db: AppDb,
  msg: IncomingDiscordMessage,
  options: { bypassChannelCheck?: boolean } = {}
): Promise<{
  outcome:
    | 'IGNORED_NOT_REPORT_CHANNEL'
    | 'IGNORED_NOT_A_REPORT'
    | 'DUPLICATE_MESSAGE_IDEMPOTENT'
    | 'PROCESSED';
  reportId?: string;
  parseStatus?: string;
  chaptersCreated?: number;
  totalAmountIdr?: number;
  approvalSummary?: string;
}> {
  if (!/^\d+$/.test(msg.discordMessageId) || !/^\d+$/.test(msg.discordAuthorId) || !/^\d+$/.test(msg.discordChannelId)) {
    throw new Error('Discord Message ID, Channel ID, dan Author ID harus berupa angka Snowflake valid.');
  }

  // 1. Primary Idempotency Check on Discord Message ID
  const existingReport = await db
    .select({ id: reports.id, parseStatus: reports.parseStatus })
    .from(reports)
    .where(eq(reports.discordMessageId, msg.discordMessageId))
    .limit(1);

  if (existingReport.length > 0) {
    return {
      outcome: 'DUPLICATE_MESSAGE_IDEMPOTENT',
      reportId: existingReport[0].id,
      parseStatus: existingReport[0].parseStatus,
    };
  }

  const guild = await resolveGuildOrCreateDefault(db, msg.discordGuildId);
  await seedGuildDefaults(db, guild.id);
  const catalog = await loadParserCatalog(db, guild.id, msg.discordChannelId);

  if (!options.bypassChannelCheck && !catalog.isReportChannel) {
    return { outcome: 'IGNORED_NOT_REPORT_CHANNEL' };
  }

  const parsed = parseDiscordReport(msg.content, {
    projects: catalog.projects,
    channelMappings: catalog.channelMappings,
    roleAliases: catalog.roleAliases,
    explicitMentions: msg.mentions,
  });

  if (parsed.isReport && !parsed.projectId && parsed.chapters.length > 0 && parsed.role) {
  const rawTitleCandidate = (parsed.projectTitleMatched || parsed.cleanedContent.split(/\b(?:chapter|chap|ch)\b/i)[0] || '')
    .replace(/^#/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const derivedTitle = rawTitleCandidate || `Channel ${msg.discordChannelId}`;
  const derivedSlug =
    derivedTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `project-${Date.now()}`;

  const existingProj = await db
    .select()
    .from(projects)
    .where(and(eq(projects.guildId, guild.id), eq(projects.slug, derivedSlug)))
    .limit(1);

  let targetProject = existingProj[0];
  if (!targetProject) {
    const inserted = await db
      .insert(projects)
      .values({
        guildId: guild.id,
        title: derivedTitle,
        slug: derivedSlug,
        isActive: true,
      })
      .returning();
    targetProject = inserted[0];
  }

  if (targetProject) {
    parsed.projectId = targetProject.id;
    parsed.projectTitleMatched = targetProject.title;
    parsed.parseStatus = 'VALID';
    parsed.parseNotes = parsed.parseNotes.filter(
      (n) => !n.includes('tidak ditemukan') && !n.includes('belum di-mapping') && !n.includes('perlu pemeriksaan')
    );

    await db
      .update(channelMappings)
      .set({ projectId: targetProject.id, updatedAt: new Date() })
      .where(
        and(
          eq(channelMappings.guildId, guild.id),
          eq(channelMappings.discordChannelId, msg.discordChannelId),
          sql`${channelMappings.projectId} IS NULL`
        )
      );
  }
}

  if (!parsed.isReport) {
    return { outcome: 'IGNORED_NOT_A_REPORT' };
  }

  const msgDate = msg.messageTimestamp ? new Date(msg.messageTimestamp) : new Date();
  const jakarta = getJakartaDateParts(msgDate);
  const now = new Date();

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as AppDb;
    const period = await ensurePeriodExists(txDb, guild.id, jakarta.year, jakarta.month);
    const member = await upsertMemberByDiscordId(
      txDb,
      guild.id,
      msg.discordAuthorId,
      msg.authorUsername,
      msg.authorDisplayName,
      parsed.role
    );

    const periodIsClosed = period.status === 'CLOSED';
    if (periodIsClosed) {
      parsed.parseNotes.push(
        `Periode ${period.periodKey} sudah CLOSED. Laporan masuk antrian pending untuk review/koreksi.`
      );
    }

    const messageUrl =
      msg.messageUrl ||
      `https://discord.com/channels/${msg.discordGuildId}/${msg.discordChannelId}/${msg.discordMessageId}`;

    const [createdReport] = await txDb
      .insert(reports)
      .values({
        guildId: guild.id,
        periodId: period.id,
        memberId: member.id,
        projectId: parsed.projectId,
        discordGuildId: /^\d+$/.test(msg.discordGuildId) ? msg.discordGuildId : guild.discordGuildId,
        discordChannelId: msg.discordChannelId,
        discordMessageId: msg.discordMessageId,
        discordAuthorId: msg.discordAuthorId,
        authorUsername: msg.authorUsername,
        authorDisplayName: msg.authorDisplayName,
        rawContent: msg.content,
        mentionsJson: parsed.mentions,
        messageUrl,
        messageTimestamp: msgDate,
        parseStatus: parsed.parseStatus,
        parseNotesJson: parsed.parseNotes,
        isDeleted: false,
      })
      .returning({ id: reports.id });

    const rates = await getActiveRatesMap(txDb, guild.id);
    const unitRate = parsed.role ? rates[parsed.role] : 0;

    const chaptersToInsert = parsed.chapters.length > 0 ? parsed.chapters : [0];
    let autoApprovedCount = 0;
    let pendingCount = 0;
    let totalAmountIdr = 0;

    for (const chNum of chaptersToInsert) {
      let duplicateOfId: string | null = null;
      let duplicateFlag = false;

      if (chNum > 0 && parsed.projectId && parsed.role) {
        const dupRows = await txDb
          .select({ id: reportChapters.id })
          .from(reportChapters)
          .where(
            and(
              eq(reportChapters.guildId, guild.id),
              eq(reportChapters.projectId, parsed.projectId),
              eq(reportChapters.chapterNumber, chNum),
              eq(reportChapters.memberId, member.id),
              eq(reportChapters.role, parsed.role),
              notInArray(reportChapters.approvalStatus, ['rejected', 'void'])
            )
          )
          .limit(1);

        if (dupRows.length > 0) {
          duplicateFlag = true;
          duplicateOfId = dupRows[0].id;
        }
      }

      const isCleanAutoApprove =
      !periodIsClosed &&
      !duplicateFlag &&
      chNum > 0 &&
      parsed.role !== null &&
      parsed.projectId !== null;

      const approvalStatus = isCleanAutoApprove ? 'auto_approved' : 'pending';
      const amount = parsed.role && chNum > 0 ? unitRate : 0;

      if (approvalStatus === 'auto_approved') {
        autoApprovedCount += 1;
        totalAmountIdr += amount;
      } else {
        pendingCount += 1;
      }

      await txDb.insert(reportChapters).values({
        reportId: createdReport.id,
        guildId: guild.id,
        periodId: period.id,
        memberId: member.id,
        projectId: parsed.projectId,
        chapterNumber: chNum,
        role: parsed.role,
        unitRateIdr: unitRate,
        amountIdr: amount,
        approvalStatus,
        duplicateFlag,
        duplicateOfChapterId: duplicateOfId,
        approvedBy: isCleanAutoApprove ? 'system:auto_approval' : null,
        approvedAt: isCleanAutoApprove ? now : null,
      });
    }

    await txDb.insert(reportEvents).values({
      reportId: createdReport.id,
      eventType: 'CREATED',
      beforeJson: null,
      afterJson: {
        parseStatus: parsed.parseStatus,
        chapters: parsed.chapters,
        role: parsed.role,
        projectId: parsed.projectId,
      },
      actorType: 'discord_bot',
      actorId: msg.discordAuthorId,
      reason: parsed.parseNotes.join('; ') || 'Parsed from Discord message',
    });

    if (!periodIsClosed) {
      await recalculatePayrollForMemberPeriod(txDb, guild.id, period.id, member.id);
    }

    if (pendingCount > 0) {
      await createNotification(txDb, {
        guildId: guild.id,
        type: 'REPORT_PENDING',
        title: `Laporan Pending Review (${member.displayName})`,
        message: `${msg.content.slice(0, 120)} — ${parsed.parseNotes.join(' ') || 'Kemungkinan duplikat terdeteksi.'}`,
        payload: { reportId: createdReport.id, parseStatus: parsed.parseStatus },
        dedupKey: `report_pending:${msg.discordMessageId}`,
      });
    } else {
      await createNotification(txDb, {
        guildId: guild.id,
        type: 'REPORT_AUTO_APPROVED',
        title: `Laporan Disetujui Otomatis (${member.displayName})`,
        message: `${autoApprovedCount} chapter (${parsed.role}) · ${formatIdr(totalAmountIdr)}`,
        payload: { reportId: createdReport.id },
        dedupKey: `report_approved:${msg.discordMessageId}`,
      });
    }

    await txDb
      .insert(processingCheckpoints)
      .values({
        guildId: guild.id,
        discordChannelId: msg.discordChannelId,
        lastMessageId: msg.discordMessageId,
        lastSyncedAt: now,
        syncStatus: 'SYNCED',
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [processingCheckpoints.guildId, processingCheckpoints.discordChannelId],
        set: {
          lastMessageId: msg.discordMessageId,
          lastSyncedAt: now,
          syncStatus: 'SYNCED',
          lastError: null,
          updatedAt: now,
        },
      });

    return {
      outcome: 'PROCESSED' as const,
      reportId: createdReport.id,
      parseStatus: parsed.parseStatus,
      chaptersCreated: chaptersToInsert.length,
      totalAmountIdr,
      approvalSummary:
        pendingCount > 0
          ? `${pendingCount} chapter pending review`
          : `${autoApprovedCount} chapter auto-approved`,
    };
  });
}

export async function handleDiscordMessageEdit(
  db: AppDb,
  msg: IncomingDiscordMessage
): Promise<{ status: string; message: string }> {
  const existingRows = await db
    .select()
    .from(reports)
    .where(eq(reports.discordMessageId, msg.discordMessageId))
    .limit(1);

  if (existingRows.length === 0) {
    const res = await processDiscordReport(db, msg);
    return { status: res.outcome, message: 'Pesan yang diedit diproses sebagai laporan baru.' };
  }

  const existing = existingRows[0];
  const [period] = await db
    .select({ id: payrollPeriods.id, periodKey: payrollPeriods.periodKey, status: payrollPeriods.status })
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, existing.periodId))
    .limit(1);

  const now = new Date();
  const catalog = await loadParserCatalog(db, existing.guildId, msg.discordChannelId);
  const parsed = parseDiscordReport(msg.content, {
    projects: catalog.projects,
    channelMappings: catalog.channelMappings,
    roleAliases: catalog.roleAliases,
    explicitMentions: msg.mentions,
  });

  const oldChapters = await db
    .select({
      chapterNumber: reportChapters.chapterNumber,
      role: reportChapters.role,
      approvalStatus: reportChapters.approvalStatus,
      amountIdr: reportChapters.amountIdr,
    })
    .from(reportChapters)
    .where(eq(reportChapters.reportId, existing.id));

  if (period.status === 'CLOSED') {
    await db.insert(reportEvents).values({
      reportId: existing.id,
      eventType: 'EDIT_BLOCKED_CLOSED_PERIOD',
      beforeJson: { rawContent: existing.rawContent, chapters: oldChapters },
      afterJson: { newRawContent: msg.content, parsed },
      actorType: 'discord_bot',
      actorId: msg.discordAuthorId,
      reason: `Pesan diedit saat periode ${period.periodKey} sudah CLOSED. Diperlukan koreksi admin.`,
    });

    await createNotification(db, {
      guildId: existing.guildId,
      type: 'SYNC_CORRECTION_REQUIRED',
      title: `Edit Laporan pada Periode CLOSED (${period.periodKey})`,
      message: `Pesan ${msg.discordMessageId} diedit oleh ${msg.authorDisplayName}. Diperlukan adjustment admin.`,
      payload: { reportId: existing.id, newContent: msg.content },
      dedupKey: `edit_closed:${msg.discordMessageId}:${now.toISOString().slice(0, 16)}`,
    });

    return {
      status: 'CORRECTION_REQUIRED',
      message: `Periode ${period.periodKey} sudah CLOSED. Perubahan dicatat di histori dan memerlukan koreksi admin.`,
    };
  }

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as AppDb;
    await txDb
      .update(reports)
      .set({
        rawContent: msg.content,
        projectId: parsed.projectId,
        parseStatus: parsed.parseStatus,
        parseNotesJson: parsed.parseNotes,
        updatedAt: now,
      })
      .where(eq(reports.id, existing.id));

    await txDb
      .update(reportChapters)
      .set({ approvalStatus: 'void', updatedAt: now })
      .where(and(eq(reportChapters.reportId, existing.id), notInArray(reportChapters.approvalStatus, ['void'])));

    const rates = await getActiveRatesMap(txDb, existing.guildId);
    const unitRate = parsed.role ? rates[parsed.role] : 0;
    const chaptersToInsert = parsed.chapters.length > 0 ? parsed.chapters : [0];

    for (const chNum of chaptersToInsert) {
      const isClean =
        parsed.isReport &&
        parsed.parseStatus === 'VALID' &&
        chNum > 0 &&
        parsed.role !== null &&
        parsed.projectId !== null;

      await txDb.insert(reportChapters).values({
        reportId: existing.id,
        guildId: existing.guildId,
        periodId: existing.periodId,
        memberId: existing.memberId,
        projectId: parsed.projectId,
        chapterNumber: chNum,
        role: parsed.role,
        unitRateIdr: unitRate,
        amountIdr: parsed.role && chNum > 0 ? unitRate : 0,
        approvalStatus: isClean ? 'auto_approved' : 'pending',
        duplicateFlag: false,
        approvedBy: isClean ? 'system:edit_sync' : null,
        approvedAt: isClean ? now : null,
      });
    }

    await txDb.insert(reportEvents).values({
      reportId: existing.id,
      eventType: 'EDITED',
      beforeJson: { rawContent: existing.rawContent, chapters: oldChapters },
      afterJson: { rawContent: msg.content, chapters: parsed.chapters, role: parsed.role },
      actorType: 'discord_bot',
      actorId: msg.discordAuthorId,
      reason: 'Discord message edited & resynced',
    });

    await recalculatePayrollForMemberPeriod(txDb, existing.guildId, existing.periodId, existing.memberId);
  });

  return { status: 'EDITED_SYNCED', message: 'Perubahan pesan disinkronkan dan payroll diperbarui.' };
}

export async function handleDiscordMessageDelete(
  db: AppDb,
  discordMessageId: string,
  actor?: AuthUser | null,
  reason = 'Pesan Discord dihapus'
): Promise<{ status: string; message: string }> {
  if (!/^\d+$/.test(discordMessageId)) {
    return { status: 'NOT_FOUND', message: 'Format Message ID tidak valid.' };
  }

  const existingRows = await db
    .select()
    .from(reports)
    .where(eq(reports.discordMessageId, discordMessageId))
    .limit(1);

  if (existingRows.length === 0) {
    return { status: 'NOT_FOUND', message: 'Pesan tidak ditemukan pada catatan laporan.' };
  }

  const existing = existingRows[0];
  if (existing.isDeleted) {
    return { status: 'ALREADY_VOID', message: 'Laporan sudah berstatus deleted/void.' };
  }

  const [period] = await db
    .select({ id: payrollPeriods.id, periodKey: payrollPeriods.periodKey, status: payrollPeriods.status })
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, existing.periodId))
    .limit(1);

  const payrollRows = await db
    .select({ id: payrollRecords.id, paidAmountIdr: payrollRecords.paidAmountIdr })
    .from(payrollRecords)
    .where(and(eq(payrollRecords.periodId, existing.periodId), eq(payrollRecords.memberId, existing.memberId)))
    .limit(1);

  const now = new Date();
  const isLockedOrPaid =
    period.status === 'CLOSED' || (payrollRows.length > 0 && payrollRows[0].paidAmountIdr > 0);

  if (isLockedOrPaid && !actor) {
    await db.insert(reportEvents).values({
      reportId: existing.id,
      eventType: 'DELETE_FLAGGED_FOR_ADMIN',
      beforeJson: { rawContent: existing.rawContent, periodStatus: period.status },
      afterJson: null,
      actorType: 'discord_bot',
      actorId: 'discord_gateway',
      reason: 'Pesan dihapus di Discord saat payroll sudah dibayar atau periode CLOSED. Memerlukan otorisasi admin.',
    });

    await createNotification(db, {
      guildId: existing.guildId,
      type: 'DELETE_CORRECTION_REQUIRED',
      title: 'Pesan Dihapus pada Payroll Terbayar/Tertutup',
      message: `Laporan ${existing.rawContent.slice(0, 80)} dihapus di Discord. Diperlukan koreksi admin.`,
      payload: { reportId: existing.id, discordMessageId },
      dedupKey: `del_corr:${discordMessageId}`,
    });

    return {
      status: 'CORRECTION_REQUIRED',
      message: 'Laporan terkait periode CLOSED atau payroll terbayar; ditandai untuk otorisasi koreksi admin.',
    };
  }

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as AppDb;
    await txDb
      .update(reports)
      .set({ isDeleted: true, deletedAt: now, updatedAt: now })
      .where(eq(reports.id, existing.id));

    await txDb
      .update(reportChapters)
      .set({ approvalStatus: 'void', updatedAt: now })
      .where(eq(reportChapters.reportId, existing.id));

    await txDb.insert(reportEvents).values({
      reportId: existing.id,
      eventType: 'VOIDED',
      beforeJson: { rawContent: existing.rawContent },
      afterJson: { isDeleted: true, approvalStatus: 'void' },
      actorType: actor ? 'admin' : 'discord_bot',
      actorId: actor ? actor.id : 'discord_gateway',
      reason,
    });

    if (actor) {
      await writeAuditLog(txDb, {
        guildId: existing.guildId,
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'VOID_REPORT',
        entityType: 'report',
        entityId: existing.id,
        before: { isDeleted: false },
        after: { isDeleted: true },
        reason,
      });
    }

    await recalculatePayrollForMemberPeriod(txDb, existing.guildId, existing.periodId, existing.memberId);
  });

  return { status: 'VOIDED', message: 'Laporan ditandai void/deleted dan histori tetap tersimpan.' };
}

export async function updateChapterApproval(
  db: AppDb,
  chapterIds: string[],
  action: 'approve' | 'reject' | 'void',
  actor: AuthUser,
  reason = ''
): Promise<{ updatedCount: number }> {
  const now = new Date();
  const targetStatus =
    action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'void';

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as AppDb;
    const affectedPairs = new Set<string>();
    let updatedCount = 0;

    for (const chId of chapterIds) {
      const rows = await txDb
        .select({
          chapter: reportChapters,
          periodStatus: payrollPeriods.status,
        })
        .from(reportChapters)
        .innerJoin(payrollPeriods, eq(payrollPeriods.id, reportChapters.periodId))
        .where(eq(reportChapters.id, chId))
        .limit(1);

      if (rows.length === 0) continue;
      const ch = rows[0].chapter;
      const periodStatus = rows[0].periodStatus;

      if (periodStatus === 'CLOSED') {
        throw new Error('Periode sudah CLOSED. Buka kembali periode (Owner) atau gunakan Payroll Adjustment.');
      }
      if (action === 'approve' && (!ch.projectId || !ch.role || ch.chapterNumber <= 0)) {
        throw new Error(`Chapter #${ch.chapterNumber} belum lengkap (proyek/role/nomor chapter wajib diisi sebelum approve).`);
      }

      const rates = await getActiveRatesMap(txDb, ch.guildId);
      const roleKey = ch.role as RoleName | null;
      const unitRate = ch.unitRateIdr > 0 ? ch.unitRateIdr : roleKey ? rates[roleKey] : 0;
      const amount = roleKey && ch.chapterNumber > 0 ? unitRate : 0;

      await txDb
        .update(reportChapters)
        .set({
          approvalStatus: targetStatus,
          unitRateIdr: unitRate,
          amountIdr: amount,
          approvedBy: actor.email,
          approvedAt: now,
          rejectionReason: action === 'reject' || action === 'void' ? reason || null : null,
          updatedAt: now,
        })
        .where(eq(reportChapters.id, ch.id));

      await txDb.insert(reportEvents).values({
        reportId: ch.reportId,
        eventType: `CHAPTER_${action.toUpperCase()}`,
        beforeJson: { chapterId: ch.id, approvalStatus: ch.approvalStatus },
        afterJson: { chapterId: ch.id, approvalStatus: targetStatus },
        actorType: 'admin',
        actorId: actor.id,
        reason: reason || `Admin ${action}`,
      });

      await writeAuditLog(txDb, {
        guildId: ch.guildId,
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: `${action.toUpperCase()}_CHAPTER`,
        entityType: 'report_chapter',
        entityId: ch.id,
        before: { approvalStatus: ch.approvalStatus },
        after: { approvalStatus: targetStatus, amountIdr: amount },
        reason: reason || null,
      });

      affectedPairs.add(`${ch.guildId}::${ch.periodId}::${ch.memberId}`);
      updatedCount += 1;
    }

    for (const pair of affectedPairs) {
      const [gId, pId, mId] = pair.split('::');
      await recalculatePayrollForMemberPeriod(txDb, gId, pId, mId);
    }

    return { updatedCount };
  });
}

export async function correctReportChapter(
  db: AppDb,
  chapterId: string,
  updates: {
    projectId?: string;
    role?: RoleName;
    chapterNumber?: number;
    approvalStatus?: 'approved' | 'rejected' | 'void' | 'pending';
  },
  actor: AuthUser,
  reason: string
): Promise<void> {
  const rows = await db
    .select({ chapter: reportChapters, periodStatus: payrollPeriods.status })
    .from(reportChapters)
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, reportChapters.periodId))
    .where(eq(reportChapters.id, chapterId))
    .limit(1);

  if (rows.length === 0) throw new Error('Chapter laporan tidak ditemukan.');
  const ch = rows[0].chapter;
  if (rows[0].periodStatus === 'CLOSED') {
    throw new Error('Tidak dapat mengedit laporan pada periode CLOSED secara langsung.');
  }

  const now = new Date();
  const nextProjectId = updates.projectId ?? ch.projectId;
  const nextRole = (updates.role ?? ch.role) as RoleName | null;
  const nextChapterNumber = updates.chapterNumber ?? ch.chapterNumber;
  const nextStatus = updates.approvalStatus ?? ch.approvalStatus;

  const rates = await getActiveRatesMap(db, ch.guildId);
  const nextRate = nextRole ? rates[nextRole] : 0;
  const nextAmount = nextRole && nextChapterNumber > 0 ? nextRate : 0;

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as AppDb;
    await txDb
      .update(reportChapters)
      .set({
        projectId: nextProjectId,
        role: nextRole,
        chapterNumber: nextChapterNumber,
        unitRateIdr: nextRate,
        amountIdr: nextAmount,
        approvalStatus: nextStatus,
        approvedBy: actor.email,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(reportChapters.id, ch.id));

    await txDb.insert(reportEvents).values({
      reportId: ch.reportId,
      eventType: 'CHAPTER_CORRECTED',
      beforeJson: {
        projectId: ch.projectId,
        role: ch.role,
        chapterNumber: ch.chapterNumber,
        approvalStatus: ch.approvalStatus,
        amountIdr: ch.amountIdr,
      },
      afterJson: {
        projectId: nextProjectId,
        role: nextRole,
        chapterNumber: nextChapterNumber,
        approvalStatus: nextStatus,
        amountIdr: nextAmount,
      },
      actorType: 'admin',
      actorId: actor.id,
      reason,
    });

    await writeAuditLog(txDb, {
      guildId: ch.guildId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'CORRECT_CHAPTER',
      entityType: 'report_chapter',
      entityId: ch.id,
      before: {
        projectId: ch.projectId,
        role: ch.role,
        chapterNumber: ch.chapterNumber,
        approvalStatus: ch.approvalStatus,
      },
      after: {
        projectId: nextProjectId,
        role: nextRole,
        chapterNumber: nextChapterNumber,
        approvalStatus: nextStatus,
      },
      reason,
    });

    await recalculatePayrollForMemberPeriod(txDb, ch.guildId, ch.periodId, ch.memberId);
  });
}

export async function recordPayment(
  db: AppDb,
  params: {
    payrollRecordId: string;
    amountIdr: number;
    method: string;
    transactionRef?: string;
    notes?: string;
  },
  actor: AuthUser
): Promise<{ paymentId: string; remainingAmountIdr: number; paymentStatus: string }> {
  if (!Number.isInteger(params.amountIdr) || params.amountIdr <= 0) {
    throw new Error('Nominal pembayaran harus bilangan bulat Rupiah lebih dari 0.');
  }

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as AppDb;
    const rows = await txDb
      .select({
        record: payrollRecords,
        periodStatus: payrollPeriods.status,
        periodKey: payrollPeriods.periodKey,
        displayName: members.displayName,
      })
      .from(payrollRecords)
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRecords.periodId))
      .innerJoin(members, eq(members.id, payrollRecords.memberId))
      .where(eq(payrollRecords.id, params.payrollRecordId))
      .limit(1);

    if (rows.length === 0) throw new Error('Payroll record tidak ditemukan.');
    const { record, periodStatus, periodKey, displayName } = rows[0];

    if (periodStatus === 'CLOSED') {
      throw new Error(`Periode ${periodKey} sudah CLOSED. Gunakan adjustment atau buka kembali periode.`);
    }
    if (params.amountIdr > record.remainingAmountIdr) {
      throw new Error(
        `Nominal pembayaran (${formatIdr(params.amountIdr)}) melebihi sisa tagihan (${formatIdr(record.remainingAmountIdr)}).`
      );
    }

    const [createdPayment] = await txDb
      .insert(payments)
      .values({
        guildId: record.guildId,
        payrollRecordId: record.id,
        periodId: record.periodId,
        memberId: record.memberId,
        amountIdr: params.amountIdr,
        adminUserId: actor.id,
        adminName: actor.fullName,
        method: params.method || 'Bank Transfer',
        transactionRef: params.transactionRef || '',
        notes: params.notes || '',
        isReversal: false,
      })
      .returning({ id: payments.id });

    await recalculatePayrollForMemberPeriod(txDb, record.guildId, record.periodId, record.memberId);

    const [updated] = await txDb
      .select({
        remainingAmountIdr: payrollRecords.remainingAmountIdr,
        paymentStatus: payrollRecords.paymentStatus,
      })
      .from(payrollRecords)
      .where(eq(payrollRecords.id, record.id))
      .limit(1);

    await writeAuditLog(txDb, {
      guildId: record.guildId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'RECORD_PAYMENT',
      entityType: 'payment',
      entityId: createdPayment.id,
      before: {
        paidAmountIdr: record.paidAmountIdr,
        remainingAmountIdr: record.remainingAmountIdr,
      },
      after: {
        amountIdr: params.amountIdr,
        remainingAmountIdr: updated.remainingAmountIdr,
        paymentStatus: updated.paymentStatus,
      },
      reason: params.notes || 'Payment recorded',
    });

    await createNotification(txDb, {
      guildId: record.guildId,
      type: 'PAYMENT_RECORDED',
      title: `Pembayaran Dicatat (${displayName})`,
      message: `${formatIdr(params.amountIdr)} via ${params.method || 'Bank Transfer'} · Status: ${updated.paymentStatus}`,
      payload: { paymentId: createdPayment.id, payrollRecordId: record.id },
      dedupKey: `payment:${createdPayment.id}`,
    });

    return {
      paymentId: createdPayment.id,
      remainingAmountIdr: updated.remainingAmountIdr,
      paymentStatus: updated.paymentStatus,
    };
  });
}

export async function createPayrollAdjustment(
  db: AppDb,
  params: {
    payrollRecordId: string;
    amountIdr: number;
    reason: string;
  },
  actor: AuthUser
): Promise<{ adjustmentId: string }> {
  if (!Number.isInteger(params.amountIdr) || params.amountIdr === 0) {
    throw new Error('Nominal koreksi harus bilangan bulat bukan nol.');
  }
  if (!params.reason.trim()) {
    throw new Error('Alasan koreksi wajib diisi.');
  }

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as AppDb;
    const rows = await txDb
      .select()
      .from(payrollRecords)
      .where(eq(payrollRecords.id, params.payrollRecordId))
      .limit(1);
    if (rows.length === 0) throw new Error('Payroll record tidak ditemukan.');
    const record = rows[0];

    const [createdAdj] = await txDb
      .insert(payrollAdjustments)
      .values({
        guildId: record.guildId,
        payrollRecordId: record.id,
        periodId: record.periodId,
        memberId: record.memberId,
        amountIdr: params.amountIdr,
        reason: params.reason.trim(),
        authorizedBy: actor.email,
      })
      .returning({ id: payrollAdjustments.id });

    await recalculatePayrollForMemberPeriod(txDb, record.guildId, record.periodId, record.memberId);

    await writeAuditLog(txDb, {
      guildId: record.guildId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'CREATE_PAYROLL_ADJUSTMENT',
      entityType: 'payroll_adjustment',
      entityId: createdAdj.id,
      before: { netAmountIdr: record.netAmountIdr },
      after: { adjustmentAmountIdr: params.amountIdr },
      reason: params.reason.trim(),
    });

    return { adjustmentId: createdAdj.id };
  });
}

export async function reversePayment(
  db: AppDb,
  paymentId: string,
  reason: string,
  actor: AuthUser
): Promise<{ reversalId: string }> {
  if (!reason.trim()) throw new Error('Alasan pembatalan/reversal pembayaran wajib diisi.');

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as AppDb;
    const origRows = await txDb
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);

    if (origRows.length === 0) throw new Error('Transaksi pembayaran tidak ditemukan.');
    const orig = origRows[0];

    if (orig.isReversal || orig.amountIdr <= 0) {
      throw new Error('Transaksi reversal tidak dapat dibalik ulang.');
    }

    const alreadyReversed = await txDb
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.reversesPaymentId, orig.id))
      .limit(1);

    if (alreadyReversed.length > 0) {
      throw new Error('Pembayaran ini sudah pernah di-reversal.');
    }

    const [rev] = await txDb
      .insert(payments)
      .values({
        guildId: orig.guildId,
        payrollRecordId: orig.payrollRecordId,
        periodId: orig.periodId,
        memberId: orig.memberId,
        amountIdr: -orig.amountIdr,
        adminUserId: actor.id,
        adminName: actor.fullName,
        method: 'Reversal',
        transactionRef: `REV-${orig.id.slice(0, 8)}`,
        notes: reason.trim(),
        isReversal: true,
        reversesPaymentId: orig.id,
      })
      .returning({ id: payments.id });

    await recalculatePayrollForMemberPeriod(txDb, orig.guildId, orig.periodId, orig.memberId);

    await writeAuditLog(txDb, {
      guildId: orig.guildId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'REVERSE_PAYMENT',
      entityType: 'payment',
      entityId: rev.id,
      before: { originalPaymentId: orig.id, amountIdr: orig.amountIdr },
      after: { reversalAmountIdr: -orig.amountIdr },
      reason: reason.trim(),
    });

    return { reversalId: rev.id };
  });
}

export async function closePayrollPeriod(
  db: AppDb,
  periodId: string,
  actor: AuthUser
): Promise<void> {
  const rows = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);
  if (rows.length === 0) throw new Error('Periode payroll tidak ditemukan.');
  const period = rows[0];
  if (period.status === 'CLOSED') throw new Error('Periode sudah CLOSED.');

  const [pendingRow] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(reportChapters)
    .where(and(eq(reportChapters.periodId, periodId), eq(reportChapters.approvalStatus, 'pending')));

  const pendingCount = Number(pendingRow?.cnt ?? 0);
  if (pendingCount > 0) {
    throw new Error(
      `Masih ada ${pendingCount} chapter berstatus pending pada periode ${period.periodKey}. Selesaikan review terlebih dahulu.`
    );
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    const txDb = tx as unknown as AppDb;
    await txDb
      .update(payrollPeriods)
      .set({ status: 'CLOSED', closedAt: now, closedBy: actor.email })
      .where(eq(payrollPeriods.id, periodId));

    await writeAuditLog(txDb, {
      guildId: period.guildId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'CLOSE_PERIOD',
      entityType: 'payroll_period',
      entityId: periodId,
      before: { status: period.status },
      after: { status: 'CLOSED', closedAt: now.toISOString() },
      reason: `Periode ${period.periodKey} ditutup`,
    });

    await createNotification(txDb, {
      guildId: period.guildId,
      type: 'PERIOD_CLOSED',
      title: `Periode ${period.periodKey} Ditutup`,
      message: `Periode payroll ${period.periodKey} telah resmi ditutup oleh ${actor.fullName}.`,
      payload: { periodId, periodKey: period.periodKey },
      dedupKey: `period_closed:${periodId}:${now.toISOString().slice(0, 16)}`,
    });
  });
}

export async function reopenPayrollPeriod(
  db: AppDb,
  periodId: string,
  reason: string,
  actor: AuthUser
): Promise<void> {
  if (actor.role !== 'Owner') {
    throw new Error('Hanya Owner yang berwenang membuka kembali periode yang sudah CLOSED.');
  }
  if (!reason.trim()) {
    throw new Error('Alasan pembukaan kembali periode wajib diisi.');
  }

  const rows = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, periodId))
    .limit(1);
  if (rows.length === 0) throw new Error('Periode payroll tidak ditemukan.');
  const period = rows[0];
  if (period.status !== 'CLOSED') throw new Error('Periode tidak berstatus CLOSED.');

  const now = new Date();
  await db.transaction(async (tx) => {
    const txDb = tx as unknown as AppDb;
    await txDb
      .update(payrollPeriods)
      .set({
        status: 'REOPENED',
        reopenedAt: now,
        reopenedBy: actor.email,
        reopenReason: reason.trim(),
      })
      .where(eq(payrollPeriods.id, periodId));

    await writeAuditLog(txDb, {
      guildId: period.guildId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'REOPEN_PERIOD',
      entityType: 'payroll_period',
      entityId: periodId,
      before: { status: 'CLOSED' },
      after: { status: 'REOPENED', reopenedAt: now.toISOString() },
      reason: reason.trim(),
    });
  });
}

export async function getRecentAuditLogs(db: AppDb, limit = 5) {
  return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
}

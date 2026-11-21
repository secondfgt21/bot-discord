import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
  type TextChannel,
} from 'discord.js';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ensurePeriodExists, type AppDb } from './db.ts';
import { isNonComicChannel } from './parser.ts';
import {
  closePayrollPeriod,
  correctReportChapter,
  createNotification,
  getActiveRatesMap,
  handleDiscordMessageDelete,
  handleDiscordMessageEdit,
  processDiscordReport,
  recordPayment,
  reopenPayrollPeriod,
  writeAuditLog,
  updateChapterApproval,
} from './payrollService.ts';
import {
  adminUsers,
  auditLogs,
  botSettings,
  channelMappings,
  guilds,
  members,
  payrollPeriods,
  payrollRates,
  payrollRecords,
  processingCheckpoints,
  projectAliases,
  projects,
  reportChapters,
} from './schema.ts';
import { formatIdr, getJakartaDateParts } from './time.ts';
import type { AdminRole, AuthUser, RoleName } from './types.ts';

export interface BotRuntimeState {
  status: 'CONNECTED' | 'CONNECTING' | 'STANDBY_NO_TOKEN' | 'ERROR';
  botTag: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
  guildCount: number;
}

const runtimeState: BotRuntimeState = {
  status: 'STANDBY_NO_TOKEN',
  botTag: null,
  lastError: null,
  lastSyncAt: null,
  guildCount: 0,
};

let clientInstance: Client | null = null;

export function getBotRuntimeState(): BotRuntimeState {
  return { ...runtimeState };
}

function getMessageChannelName(message: Message): string | undefined {
  if ('name' in message.channel && typeof message.channel.name === 'string') {
    const trimmed = message.channel.name.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function extractMentionedChannelsFromMessage(
  message: Message
): Array<{ id: string; name: string }> {
  const resolved = new Map<string, string>();
  for (const [id, ch] of message.mentions.channels) {
    if ('name' in ch && typeof ch.name === 'string' && ch.name.trim()) {
      resolved.set(id, ch.name.trim());
    }
  }
  const channelMentionRegex = /<#(\d+)>/g;
  let match: RegExpExecArray | null;
  while ((match = channelMentionRegex.exec(message.content)) !== null) {
    const id = match[1];
    if (!resolved.has(id)) {
      const cached = message.guild?.channels.cache.get(id);
      if (cached && 'name' in cached && typeof cached.name === 'string' && cached.name.trim()) {
        resolved.set(id, cached.name.trim());
      }
    }
  }
  return Array.from(resolved.entries()).map(([id, name]) => ({ id, name }));
}

export function formatReportAcceptedMessage(params: {
  discordAuthorId: string;
  projectTitle?: string | null;
  chapterDisplay?: string | null;
  totalChapters?: number;
  isPending?: boolean;
  pendingReason?: string | null;
}): string {
  const title = params.projectTitle?.trim() || '-';
  const chapter = params.chapterDisplay?.trim() || '-';
  const totalChapter =
    typeof params.totalChapters === 'number' && Number.isFinite(params.totalChapters)
      ? Math.max(0, Math.trunc(params.totalChapters))
      : 0;

  const lines = [
    `<@${params.discordAuthorId}> Laporan Diterima`,
    `judul : ${title}`,
    `chapter : ${chapter}`,
    `total chapter : ${totalChapter}`,
    '',
  ];

  if (params.isPending) {
    const reason = params.pendingReason?.trim() || 'Laporan memerlukan pemeriksaan admin.';
    lines.push('Laporan Kamu : Pending');
    lines.push(`pesan : ${reason}`);
  } else {
    lines.push('Laporan kamu : sukses tercatat');
  }

  return lines.join('\n');
}

async function isDiscordAdmin(
  db: AppDb,
  guildId: string,
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  const envUsers = (process.env.DISCORD_ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const envRoles = (process.env.DISCORD_ADMIN_ROLE_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const userRows = await db
    .select({ valueJson: botSettings.valueJson })
    .from(botSettings)
    .where(and(eq(botSettings.guildId, guildId), eq(botSettings.key, 'admin_discord_user_ids')))
    .limit(1);

  const roleRows = await db
    .select({ valueJson: botSettings.valueJson })
    .from(botSettings)
    .where(and(eq(botSettings.guildId, guildId), eq(botSettings.key, 'admin_discord_role_ids')))
    .limit(1);

  const dbUsers = Array.isArray(userRows[0]?.valueJson) ? (userRows[0].valueJson as string[]) : [];
  const dbRoles = Array.isArray(roleRows[0]?.valueJson) ? (roleRows[0].valueJson as string[]) : [];

  const allowedUsers = new Set([...envUsers, ...dbUsers]);
  const allowedRoles = new Set([...envRoles, ...dbRoles]);

  if (allowedUsers.has(interaction.user.id)) return true;

  const member = interaction.member;
  if (member && 'roles' in member && member.roles && 'cache' in member.roles) {
    for (const roleId of member.roles.cache.keys()) {
      if (allowedRoles.has(roleId)) return true;
    }
  }

  const linkedAdmin = await db
    .select({ role: adminUsers.role })
    .from(adminUsers)
    .where(
      and(
        eq(adminUsers.discordUserId, interaction.user.id),
        eq(adminUsers.isActive, true),
        inArray(adminUsers.role, ['Owner', 'Admin'])
      )
    )
    .limit(1);

  return linkedAdmin.length > 0;
}

async function getDiscordActor(
  db: AppDb,
  interaction: ChatInputCommandInteraction
): Promise<AuthUser> {
  const linked = await db
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      fullName: adminUsers.fullName,
      role: adminUsers.role,
      discordUserId: adminUsers.discordUserId,
    })
    .from(adminUsers)
    .where(and(eq(adminUsers.discordUserId, interaction.user.id), eq(adminUsers.isActive, true)))
    .limit(1);

  if (linked.length > 0) {
    return {
      id: linked[0].id,
      email: linked[0].email,
      fullName: linked[0].fullName,
      role: linked[0].role as AdminRole,
      discordUserId: linked[0].discordUserId,
    };
  }

  return {
    id: `discord:${interaction.user.id}`,
    email: `${interaction.user.username}@discord`,
    fullName: interaction.user.displayName || interaction.user.username,
    role: 'Admin',
    discordUserId: interaction.user.id,
  };
}

function buildSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName('cek')
      .setDescription('Tampilkan statistik dan total gaji')
      .addUserOption((o) => o.setName('user').setDescription('Anggota lain (khusus admin)')),
    new SlashCommandBuilder().setName('riwayat').setDescription('Lihat riwayat pekerjaan terbaru Anda'),
    new SlashCommandBuilder().setName('gaji').setDescription('Lihat rincian payroll bulan berjalan'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Peringkat produktivitas bulan berjalan'),
    new SlashCommandBuilder().setName('rekap-komik').setDescription('Rekap kontribusi berdasarkan komik'),
    new SlashCommandBuilder().setName('rekap').setDescription('[Admin] Rekap keseluruhan bulan berjalan'),
    new SlashCommandBuilder()
      .setName('rekap-user')
      .setDescription('[Admin] Rekap satu anggota')
      .addUserOption((o) => o.setName('user').setDescription('Anggota').setRequired(true)),
    new SlashCommandBuilder()
      .setName('rekap-bulan')
      .setDescription('[Admin] Rekap periode bulan tertentu')
      .addStringOption((o) => o.setName('periode').setDescription('Format YYYY-MM').setRequired(true)),
    new SlashCommandBuilder().setName('laporan-pending').setDescription('[Admin] Daftar laporan menunggu approval'),
    new SlashCommandBuilder()
      .setName('approve')
      .setDescription('[Admin] Setujui chapter laporan')
      .addStringOption((o) => o.setName('chapter_id').setDescription('ID Chapter (UUID atau prefix)').setRequired(true)),
    new SlashCommandBuilder()
      .setName('reject')
      .setDescription('[Admin] Tolak chapter laporan')
      .addStringOption((o) => o.setName('chapter_id').setDescription('ID Chapter (UUID atau prefix)').setRequired(true))
      .addStringOption((o) => o.setName('alasan').setDescription('Alasan penolakan').setRequired(true)),
    new SlashCommandBuilder()
      .setName('koreksi')
      .setDescription('[Admin] Koreksi nomor chapter')
      .addStringOption((o) => o.setName('chapter_id').setDescription('ID Chapter (UUID atau prefix)').setRequired(true))
      .addIntegerOption((o) => o.setName('chapter').setDescription('Nomor chapter baru').setRequired(true))
      .addStringOption((o) => o.setName('alasan').setDescription('Alasan koreksi').setRequired(true)),
    new SlashCommandBuilder()
      .setName('hapus-laporan')
      .setDescription('[Admin] Void laporan (audit trail)')
      .addStringOption((o) => o.setName('message_id').setDescription('Discord Message ID').setRequired(true))
      .addStringOption((o) => o.setName('alasan').setDescription('Alasan void').setRequired(true)),
    new SlashCommandBuilder()
      .setName('set-channel')
      .setDescription('[Admin] Daftarkan channel laporan')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel Discord').setRequired(true))
      .addStringOption((o) => o.setName('komik').setDescription('Nama proyek komik')),
    new SlashCommandBuilder()
      .setName('set-alias')
      .setDescription('[Admin] Tambah alias komik')
      .addStringOption((o) => o.setName('komik').setDescription('Nama komik').setRequired(true))
      .addStringOption((o) => o.setName('alias').setDescription('Alias baru').setRequired(true)),
    new SlashCommandBuilder()
      .setName('set-tarif')
      .setDescription('[Owner] Ubah tarif role (hanya untuk laporan baru)')
      .addStringOption((o) =>
        o
          .setName('role')
          .setDescription('Role')
          .setRequired(true)
          .addChoices(
            { name: 'Translator', value: 'Translator' },
            { name: 'Editor', value: 'Editor' },
            { name: 'Solo', value: 'Solo' }
          )
      )
      .addIntegerOption((o) => o.setName('tarif').setDescription('Tarif Rupiah integer').setRequired(true)),
    new SlashCommandBuilder()
      .setName('tutup-bulan')
      .setDescription('[Admin] Tutup periode payroll')
      .addStringOption((o) => o.setName('periode').setDescription('Format YYYY-MM').setRequired(true)),
    new SlashCommandBuilder()
      .setName('buka-bulan')
      .setDescription('[Owner] Buka kembali periode CLOSED')
      .addStringOption((o) => o.setName('periode').setDescription('Format YYYY-MM').setRequired(true))
      .addStringOption((o) => o.setName('alasan').setDescription('Alasan pembukaan kembali').setRequired(true)),
    new SlashCommandBuilder()
      .setName('bayar')
      .setDescription('[Admin] Catat pembayaran anggota')
      .addUserOption((o) => o.setName('user').setDescription('Penerima').setRequired(true))
      .addIntegerOption((o) => o.setName('nominal').setDescription('Nominal Rupiah').setRequired(true))
      .addStringOption((o) => o.setName('metode').setDescription('Metode pembayaran').setRequired(true)),
    new SlashCommandBuilder().setName('status-pembayaran').setDescription('[Admin] Lihat status pembayaran bulan berjalan'),
    new SlashCommandBuilder().setName('export').setDescription('[Admin] Ringkasan export periode berjalan'),
    new SlashCommandBuilder().setName('audit-log').setDescription('[Admin] Lihat 5 aktivitas audit log terakhir'),
  ].map((c) => c.toJSON());
}

export async function syncMissedMessages(db: AppDb, client: Client): Promise<void> {
  const channels = await db
    .selectDistinct({
      guildId: channelMappings.guildId,
      discordChannelId: channelMappings.discordChannelId,
    })
    .from(channelMappings)
    .where(eq(channelMappings.isReportChannel, true));

  const now = new Date();
  for (const ch of channels) {
    try {
      const cpRows = await db
        .select({ lastMessageId: processingCheckpoints.lastMessageId })
        .from(processingCheckpoints)
        .where(
          and(
            eq(processingCheckpoints.guildId, ch.guildId),
            eq(processingCheckpoints.discordChannelId, ch.discordChannelId)
          )
        )
        .limit(1);

      const lastMsgId = cpRows[0]?.lastMessageId ?? null;
      const fetchedChannel = await client.channels.fetch(ch.discordChannelId).catch(() => null);
      if (!fetchedChannel || !fetchedChannel.isTextBased()) continue;

      const textCh = fetchedChannel as TextChannel;
      const fetchOptions: { limit: number; after?: string } = { limit: 100 };
      if (lastMsgId) fetchOptions.after = lastMsgId;

      const messages = await textCh.messages.fetch(fetchOptions);
      const sorted = Array.from(messages.values()).sort(
        (a, b) => a.createdTimestamp - b.createdTimestamp
      );

      for (const m of sorted) {
        if (m.author.bot) continue;
        await processDiscordReport(db, {
          discordMessageId: m.id,
          discordGuildId: m.guildId || '',
          discordChannelId: m.channelId,
          discordChannelName: textCh.name,
          discordAuthorId: m.author.id,
          authorUsername: m.author.username,
          authorDisplayName: m.member?.displayName || m.author.displayName || m.author.username,
          content: m.content,
          mentions: m.mentions.users.map((u) => `<@${u.id}>`),
          mentionedChannels: extractMentionedChannelsFromMessage(m),
          messageTimestamp: new Date(m.createdTimestamp).toISOString(),
          messageUrl: m.url,
        });
      }

      const newestId = sorted.length > 0 ? sorted[sorted.length - 1].id : lastMsgId;
      await db
        .insert(processingCheckpoints)
        .values({
          guildId: ch.guildId,
          discordChannelId: ch.discordChannelId,
          channelName: `#${textCh.name}`,
          lastMessageId: newestId,
          lastSyncedAt: now,
          syncStatus: 'SYNCED',
          lastError: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [processingCheckpoints.guildId, processingCheckpoints.discordChannelId],
          set: {
            channelName: `#${textCh.name}`,
            lastMessageId: newestId,
            lastSyncedAt: now,
            syncStatus: 'SYNCED',
            lastError: null,
            updatedAt: now,
          },
        });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync error';
      await db
        .update(processingCheckpoints)
        .set({ syncStatus: 'ERROR', lastError: msg, updatedAt: now })
        .where(
          and(
            eq(processingCheckpoints.guildId, ch.guildId),
            eq(processingCheckpoints.discordChannelId, ch.discordChannelId)
          )
        );

      await createNotification(db, {
        guildId: ch.guildId,
        type: 'SYNC_ERROR',
        title: `Gagal Sinkronisasi Channel ${ch.discordChannelId}`,
        message: msg,
        dedupKey: `sync_err:${ch.discordChannelId}:${now.toISOString().slice(0, 13)}`,
      });
    }
  }
  runtimeState.lastSyncAt = now.toISOString();
}

async function handleSlashCommand(
  db: AppDb,
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const guildRows = await db
    .select({ id: guilds.id, discordGuildId: guilds.discordGuildId })
    .from(guilds)
    .where(eq(guilds.discordGuildId, interaction.guildId || '0'))
    .limit(1);

  if (guildRows.length === 0) {
    await interaction.reply({ content: 'Server belum terdaftar di database ComicPay.', ephemeral: true });
    return;
  }

  const guildRow = guildRows[0];
  const jakarta = getJakartaDateParts();
  const currentPeriod = await ensurePeriodExists(db, guildRow.id, jakarta.year, jakarta.month);
  const cmd = interaction.commandName;

  if (cmd === 'cek' || cmd === 'gaji') {
    const targetUser = interaction.options.getUser('user');
    if (targetUser && targetUser.id !== interaction.user.id && !(await isDiscordAdmin(db, guildRow.id, interaction))) {
      await interaction.reply({ content: 'Anda hanya dapat melihat statistik milik sendiri.', ephemeral: true });
      return;
    }
    const discordUid = targetUser ? targetUser.id : interaction.user.id;
    const memberRows = await db
      .select({ id: members.id, displayName: members.displayName })
      .from(members)
      .where(and(eq(members.guildId, guildRow.id), eq(members.discordUserId, discordUid)))
      .limit(1);

    if (memberRows.length === 0) {
      await interaction.reply({ content: 'Belum ada data laporan untuk pengguna tersebut.', ephemeral: true });
      return;
    }

    const prRows = await db
      .select()
      .from(payrollRecords)
      .where(and(eq(payrollRecords.periodId, currentPeriod.id), eq(payrollRecords.memberId, memberRows[0].id)))
      .limit(1);
    const pr = prRows[0];

    const embed = new EmbedBuilder()
      .setTitle(`Rekap Payroll ${currentPeriod.periodKey} — ${memberRows[0].displayName}`)
      .setColor(0x0f172a)
      .addFields(
        { name: 'Translator', value: `${pr?.translatorChapters ?? 0} ch`, inline: true },
        { name: 'Editor', value: `${pr?.editorChapters ?? 0} ch`, inline: true },
        { name: 'Solo', value: `${pr?.soloChapters ?? 0} ch`, inline: true },
        { name: 'Total Gaji', value: formatIdr(pr?.netAmountIdr ?? 0), inline: true },
        { name: 'Sudah Dibayar', value: formatIdr(pr?.paidAmountIdr ?? 0), inline: true },
        { name: 'Sisa', value: `${formatIdr(pr?.remainingAmountIdr ?? 0)} (${pr?.paymentStatus ?? 'UNPAID'})`, inline: true }
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (cmd === 'riwayat') {
    const rows = await db
      .select({
        title: projects.title,
        chapterNumber: reportChapters.chapterNumber,
        role: reportChapters.role,
        amountIdr: reportChapters.amountIdr,
        approvalStatus: reportChapters.approvalStatus,
      })
      .from(reportChapters)
      .innerJoin(members, eq(members.id, reportChapters.memberId))
      .leftJoin(projects, eq(projects.id, reportChapters.projectId))
      .where(and(eq(reportChapters.guildId, guildRow.id), eq(members.discordUserId, interaction.user.id)))
      .orderBy(desc(reportChapters.createdAt))
      .limit(10);

    const lines = rows.map(
      (r) => `• **${r.title ?? 'Unknown'}** Ch.${r.chapterNumber} (${r.role ?? '-'}) — ${formatIdr(r.amountIdr)} [${r.approvalStatus}]`
    );
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Riwayat 10 Chapter Terbaru')
          .setDescription(lines.join('\n') || 'Belum ada riwayat.'),
      ],
      ephemeral: true,
    });
    return;
  }

  if (cmd === 'leaderboard') {
    const rows = await db
      .select({
        displayName: members.displayName,
        totalChapters: payrollRecords.totalChapters,
        netAmountIdr: payrollRecords.netAmountIdr,
      })
      .from(payrollRecords)
      .innerJoin(members, eq(members.id, payrollRecords.memberId))
      .where(eq(payrollRecords.periodId, currentPeriod.id))
      .orderBy(desc(payrollRecords.totalChapters))
      .limit(10);

    const descText = rows
      .map((r, i) => `${i + 1}. **${r.displayName}** — ${r.totalChapters} chapter (${formatIdr(r.netAmountIdr)})`)
      .join('\n');
    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle(`Leaderboard ${currentPeriod.periodKey}`).setDescription(descText || 'Belum ada data.')],
    });
    return;
  }

  if (cmd === 'rekap-komik') {
    const rows = await db
      .select({
        title: projects.title,
        chCount: sql<number>`COUNT(*)::int`,
        totalIdr: sql<number>`COALESCE(SUM(${reportChapters.amountIdr}), 0)::int`,
      })
      .from(reportChapters)
      .innerJoin(projects, eq(projects.id, reportChapters.projectId))
      .where(
        and(
          eq(reportChapters.periodId, currentPeriod.id),
          inArray(reportChapters.approvalStatus, ['auto_approved', 'approved'])
        )
      )
      .groupBy(projects.id, projects.title)
      .orderBy(desc(sql`COUNT(*)`));

    const descText = rows
      .map((r) => `• **${r.title}**: ${r.chCount} chapter (${formatIdr(r.totalIdr)})`)
      .join('\n');
    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle(`Rekap Komik ${currentPeriod.periodKey}`).setDescription(descText || 'Belum ada data.')],
    });
    return;
  }

  if (!(await isDiscordAdmin(db, guildRow.id, interaction))) {
    await interaction.reply({
      content: 'Perintah ini khusus Admin/Controller yang terdaftar berdasarkan Discord User ID atau Role ID.',
      ephemeral: true,
    });
    return;
  }

  const actor = await getDiscordActor(db, interaction);

  if (cmd === 'rekap' || cmd === 'rekap-bulan') {
    const periodKey = cmd === 'rekap-bulan' ? interaction.options.getString('periode', true) : currentPeriod.periodKey;
    const pRows = await db
      .select()
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.guildId, guildRow.id), eq(payrollPeriods.periodKey, periodKey)))
      .limit(1);

    if (pRows.length === 0) {
      await interaction.reply({ content: `Periode ${periodKey} tidak ditemukan.`, ephemeral: true });
      return;
    }
    const p = pRows[0];
    const [agg] = await db
      .select({
        ch: sql<number>`COALESCE(SUM(${payrollRecords.totalChapters}), 0)::int`,
        net: sql<number>`COALESCE(SUM(${payrollRecords.netAmountIdr}), 0)::int`,
        paid: sql<number>`COALESCE(SUM(${payrollRecords.paidAmountIdr}), 0)::int`,
        rem: sql<number>`COALESCE(SUM(${payrollRecords.remainingAmountIdr}), 0)::int`,
      })
      .from(payrollRecords)
      .where(eq(payrollRecords.periodId, p.id));

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Rekap Payroll ${p.periodKey} (${p.status})`)
          .addFields(
            { name: 'Total Chapter', value: `${agg.ch}`, inline: true },
            { name: 'Total Payroll', value: formatIdr(agg.net), inline: true },
            { name: 'Dibayar', value: formatIdr(agg.paid), inline: true },
            { name: 'Sisa', value: formatIdr(agg.rem), inline: true }
          ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (cmd === 'rekap-user') {
    const targetUser = interaction.options.getUser('user', true);
    const mRows = await db
      .select({ id: members.id, displayName: members.displayName })
      .from(members)
      .where(and(eq(members.guildId, guildRow.id), eq(members.discordUserId, targetUser.id)))
      .limit(1);
    if (mRows.length === 0) {
      await interaction.reply({ content: 'Anggota tidak ditemukan.', ephemeral: true });
      return;
    }
    const prRows = await db
      .select()
      .from(payrollRecords)
      .where(and(eq(payrollRecords.periodId, currentPeriod.id), eq(payrollRecords.memberId, mRows[0].id)))
      .limit(1);
    const pr = prRows[0];
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Rekap ${mRows[0].displayName} (${currentPeriod.periodKey})`)
          .addFields(
            { name: 'Total Chapter', value: `${pr?.totalChapters ?? 0}`, inline: true },
            { name: 'Total Gaji', value: formatIdr(pr?.netAmountIdr ?? 0), inline: true },
            { name: 'Sisa', value: formatIdr(pr?.remainingAmountIdr ?? 0), inline: true }
          ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (cmd === 'laporan-pending') {
    const pending = await db
      .select({
        id: reportChapters.id,
        displayName: members.displayName,
        title: projects.title,
        chapterNumber: reportChapters.chapterNumber,
        role: reportChapters.role,
      })
      .from(reportChapters)
      .innerJoin(members, eq(members.id, reportChapters.memberId))
      .leftJoin(projects, eq(projects.id, reportChapters.projectId))
      .where(and(eq(reportChapters.guildId, guildRow.id), eq(reportChapters.approvalStatus, 'pending')))
      .orderBy(desc(reportChapters.createdAt))
      .limit(10);

    const descText = pending
      .map((r) => `\`${r.id.slice(0, 8)}\` • ${r.displayName} — ${r.title ?? 'Ambigu'} Ch.${r.chapterNumber} (${r.role ?? '?'})`)
      .join('\n');
    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle('Laporan Pending Review').setDescription(descText || 'Tidak ada laporan pending.')],
      ephemeral: true,
    });
    return;
  }

  if (cmd === 'approve' || cmd === 'reject') {
    const chPrefix = interaction.options.getString('chapter_id', true);
    const matches = await db
      .select({ id: reportChapters.id })
      .from(reportChapters)
      .where(
        and(
          eq(reportChapters.guildId, guildRow.id),
          sql`${reportChapters.id}::text LIKE ${chPrefix + '%'}`
        )
      )
      .limit(1);
    if (matches.length === 0) {
      await interaction.reply({ content: 'Chapter ID tidak ditemukan.', ephemeral: true });
      return;
    }
    const reason = cmd === 'reject' ? interaction.options.getString('alasan', true) : 'Approved via Discord slash command';
    await updateChapterApproval(db, [matches[0].id], cmd, actor, reason);
    await interaction.reply({ content: `Chapter \`${matches[0].id.slice(0, 8)}\` berhasil di-${cmd}.`, ephemeral: true });
    return;
  }

  if (cmd === 'koreksi') {
    const chPrefix = interaction.options.getString('chapter_id', true);
    const newChNum = interaction.options.getInteger('chapter', true);
    const reason = interaction.options.getString('alasan', true);
    const matches = await db
      .select({ id: reportChapters.id })
      .from(reportChapters)
      .where(
        and(
          eq(reportChapters.guildId, guildRow.id),
          sql`${reportChapters.id}::text LIKE ${chPrefix + '%'}`
        )
      )
      .limit(1);
    if (matches.length === 0) {
      await interaction.reply({ content: 'Chapter ID tidak ditemukan.', ephemeral: true });
      return;
    }
    await correctReportChapter(db, matches[0].id, { chapterNumber: newChNum }, actor, reason);
    await interaction.reply({ content: `Chapter berhasil dikoreksi menjadi Ch.${newChNum}.`, ephemeral: true });
    return;
  }

  if (cmd === 'hapus-laporan') {
    const msgId = interaction.options.getString('message_id', true);
    const reason = interaction.options.getString('alasan', true);
    const res = await handleDiscordMessageDelete(db, msgId, actor, reason);
    await interaction.reply({ content: `${res.status}: ${res.message}`, ephemeral: true });
    return;
  }

  if (cmd === 'set-channel') {
    const channel = interaction.options.getChannel('channel', true);
    const komik = interaction.options.getString('komik');
    const channelLabel = 'name' in channel && typeof channel.name === 'string' ? channel.name : channel.id;
    const isNonComic = isNonComicChannel(channel.id, channelLabel);
    let projectId: string | null = null;
    if (komik && !isNonComic) {
      const p = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.guildId, guildRow.id), sql`LOWER(${projects.title}) = LOWER(${komik})`))
        .limit(1);
      projectId = p[0]?.id ?? null;
    }
    await db
      .insert(channelMappings)
      .values({
        guildId: guildRow.id,
        discordChannelId: channel.id,
        channelName: `#${channelLabel}`,
        projectId: isNonComic ? null : projectId,
        isReportChannel: true,
        isDefault: isNonComic ? false : Boolean(projectId),
      })
      .onConflictDoNothing();
    await interaction.reply({
      content: isNonComic
        ? `Channel <#${channel.id}> terdaftar sebagai channel penampungan laporan multi-komik (tidak diikat ke satu proyek komik).`
        : `Channel <#${channel.id}> terdaftar sebagai channel laporan.`,
      ephemeral: true,
    });
    return;
  }

  if (cmd === 'set-alias') {
    const komik = interaction.options.getString('komik', true);
    const alias = interaction.options.getString('alias', true);
    const p = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.guildId, guildRow.id), sql`LOWER(${projects.title}) = LOWER(${komik})`))
      .limit(1);
    if (p.length === 0) {
      await interaction.reply({ content: `Komik "${komik}" tidak ditemukan.`, ephemeral: true });
      return;
    }
    await db
      .insert(projectAliases)
      .values({ guildId: guildRow.id, projectId: p[0].id, alias })
      .onConflictDoNothing();
    await interaction.reply({ content: `Alias "${alias}" ditambahkan untuk **${komik}**.`, ephemeral: true });
    return;
  }

  if (cmd === 'set-tarif') {
    if (actor.role !== 'Owner') {
      await interaction.reply({ content: 'Hanya Owner yang dapat mengubah tarif.', ephemeral: true });
      return;
    }
    const role = interaction.options.getString('role', true) as RoleName;
    const rate = interaction.options.getInteger('tarif', true);
    const prevRates = await getActiveRatesMap(db, guildRow.id);
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as AppDb;
      await txDb
        .update(payrollRates)
        .set({ isActive: false })
        .where(and(eq(payrollRates.guildId, guildRow.id), eq(payrollRates.role, role)));
      await txDb.insert(payrollRates).values({
        guildId: guildRow.id,
        role,
        rateIdr: rate,
        isActive: true,
        createdBy: actor.email,
      });
      await writeAuditLog(txDb, {
        guildId: guildRow.id,
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'UPDATE_PAYROLL_RATE',
        entityType: 'payroll_rate',
        entityId: role,
        before: { rateIdr: prevRates[role] },
        after: { rateIdr: rate },
      });
    });
    await interaction.reply({
      content: `Tarif **${role}** diperbarui ke ${formatIdr(rate)} (berlaku untuk laporan baru).`,
      ephemeral: true,
    });
    return;
  }

  if (cmd === 'tutup-bulan') {
    const periodKey = interaction.options.getString('periode', true);
    const p = await db
      .select({ id: payrollPeriods.id })
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.guildId, guildRow.id), eq(payrollPeriods.periodKey, periodKey)))
      .limit(1);
    if (p.length === 0) {
      await interaction.reply({ content: 'Periode tidak ditemukan.', ephemeral: true });
      return;
    }
    await closePayrollPeriod(db, p[0].id, actor);
    await interaction.reply({ content: `Periode ${periodKey} berhasil ditutup (CLOSED).`, ephemeral: true });
    return;
  }

  if (cmd === 'buka-bulan') {
    const periodKey = interaction.options.getString('periode', true);
    const reason = interaction.options.getString('alasan', true);
    const p = await db
      .select({ id: payrollPeriods.id })
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.guildId, guildRow.id), eq(payrollPeriods.periodKey, periodKey)))
      .limit(1);
    if (p.length === 0) {
      await interaction.reply({ content: 'Periode tidak ditemukan.', ephemeral: true });
      return;
    }
    await reopenPayrollPeriod(db, p[0].id, reason, actor);
    await interaction.reply({ content: `Periode ${periodKey} berhasil dibuka kembali (REOPENED).`, ephemeral: true });
    return;
  }

  if (cmd === 'bayar') {
    const targetUser = interaction.options.getUser('user', true);
    const nominal = interaction.options.getInteger('nominal', true);
    const metode = interaction.options.getString('metode', true);
    const pr = await db
      .select({ id: payrollRecords.id })
      .from(payrollRecords)
      .innerJoin(members, eq(members.id, payrollRecords.memberId))
      .where(and(eq(payrollRecords.periodId, currentPeriod.id), eq(members.discordUserId, targetUser.id)))
      .limit(1);
    if (pr.length === 0) {
      await interaction.reply({ content: 'Data payroll anggota tidak ditemukan untuk bulan ini.', ephemeral: true });
      return;
    }
    const result = await recordPayment(
      db,
      { payrollRecordId: pr[0].id, amountIdr: nominal, method: metode },
      actor
    );
    await interaction.reply({
      content: `Pembayaran ${formatIdr(nominal)} dicatat. Sisa: ${formatIdr(result.remainingAmountIdr)} (${result.paymentStatus}).`,
      ephemeral: true,
    });
    return;
  }

  if (cmd === 'status-pembayaran') {
    const rows = await db
      .select({
        displayName: members.displayName,
        remainingAmountIdr: payrollRecords.remainingAmountIdr,
        paymentStatus: payrollRecords.paymentStatus,
      })
      .from(payrollRecords)
      .innerJoin(members, eq(members.id, payrollRecords.memberId))
      .where(eq(payrollRecords.periodId, currentPeriod.id))
      .limit(20);
    const descText = rows
      .map((r) => `• **${r.displayName}**: ${r.paymentStatus} (Sisa ${formatIdr(r.remainingAmountIdr)})`)
      .join('\n');
    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle(`Status Pembayaran ${currentPeriod.periodKey}`).setDescription(descText || 'Belum ada data.')],
      ephemeral: true,
    });
    return;
  }

  if (cmd === 'audit-log') {
    const logs = await db
      .select({
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        actorEmail: auditLogs.actorEmail,
      })
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(5);
    const descText = logs.map((l) => `• **${l.action}** (${l.entityType}) oleh ${l.actorEmail}`).join('\n');
    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle('Audit Log Terbaru').setDescription(descText || 'Belum ada log.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `Rekap siap diexport melalui Admin Dashboard menu Payroll / Export (${currentPeriod.periodKey}).`,
    ephemeral: true,
  });
}

export async function startDiscordBotIfConfigured(db: AppDb): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || token.includes('YOUR_') || token.length < 20) {
    runtimeState.status = 'STANDBY_NO_TOKEN';
    runtimeState.lastError = null;
    return;
  }

  try {
    runtimeState.status = 'CONNECTING';
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
      partials: [Partials.Message, Partials.Channel],
    });

    client.once(Events.ClientReady, async (readyClient) => {
      runtimeState.status = 'CONNECTED';
      runtimeState.botTag = readyClient.user.tag;
      runtimeState.guildCount = readyClient.guilds.cache.size;
      runtimeState.lastError = null;

      try {
        const rest = new REST({ version: '10' }).setToken(token);
        const commands = buildSlashCommands();
        for (const [guildId] of readyClient.guilds.cache) {
          await rest.put(Routes.applicationGuildCommands(readyClient.user.id, guildId), {
            body: commands,
          });
        }
      } catch (err) {
        console.error('[DiscordBot] Slash command registration warning:', err);
      }

      await syncMissedMessages(db, readyClient);
    });

    client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot || !message.guildId) return;
      try {
        const res = await processDiscordReport(db, {
          discordMessageId: message.id,
          discordGuildId: message.guildId,
          discordChannelId: message.channelId,
          discordChannelName: getMessageChannelName(message),
          discordAuthorId: message.author.id,
          authorUsername: message.author.username,
          authorDisplayName: message.member?.displayName || message.author.displayName || message.author.username,
          content: message.content,
          mentions: message.mentions.users.map((u) => `<@${u.id}>`),
          mentionedChannels: extractMentionedChannelsFromMessage(message),
          messageTimestamp: new Date(message.createdTimestamp).toISOString(),
          messageUrl: message.url,
        });
        if (res.outcome === 'PROCESSED') {
          const replyText = formatReportAcceptedMessage({
            discordAuthorId: message.author.id,
            projectTitle: res.projectTitle,
            chapterDisplay: res.chapterDisplay,
            totalChapters: res.totalChapters,
            isPending: res.isPending,
            pendingReason: res.pendingReason,
          });
          await message.reply(replyText).catch((err) =>
            console.error('[DiscordBot] Reply error:', err)
          );
        }
      } catch (err) {
        console.error('[DiscordBot] MessageCreate error:', err);
      }
    });

    client.on(Events.MessageUpdate, async (_oldMsg, newMsg) => {
      const full = newMsg.partial ? await newMsg.fetch().catch(() => null) : newMsg;
      if (!full || !full.author || full.author.bot || !full.guildId) return;
      await handleDiscordMessageEdit(db, {
        discordMessageId: full.id,
        discordGuildId: full.guildId,
        discordChannelId: full.channelId,
        discordChannelName: getMessageChannelName(full),
        discordAuthorId: full.author.id,
        authorUsername: full.author.username,
        authorDisplayName: full.member?.displayName || full.author.displayName || full.author.username,
        content: full.content,
        mentions: full.mentions.users.map((u) => `<@${u.id}>`),
        mentionedChannels: extractMentionedChannelsFromMessage(full),
        messageTimestamp: new Date(full.createdTimestamp).toISOString(),
        messageUrl: full.url,
      });
    });

    client.on(Events.MessageDelete, (deletedMsg) => {
      void handleDiscordMessageDelete(db, deletedMsg.id, null, 'Pesan dihapus di Discord').catch((err) =>
        console.error('[DiscordBot] MessageDelete error:', err)
      );
    });

    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      try {
        await handleSlashCommand(db, interaction);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Terjadi kesalahan saat memproses perintah.';
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: `Error: ${msg}`, ephemeral: true });
        } else {
          await interaction.reply({ content: `Error: ${msg}`, ephemeral: true });
        }
      }
    });

    clientInstance = client;
    await client.login(token);
  } catch (err) {
    runtimeState.status = 'ERROR';
    runtimeState.lastError = err instanceof Error ? err.message : 'Discord login error';
    console.error('[DiscordBot] Connection failed:', runtimeState.lastError);
  }
}

export async function triggerManualSync(db: AppDb): Promise<{ synced: boolean; reason?: string }> {
  if (!clientInstance || runtimeState.status !== 'CONNECTED') {
    return {
      synced: false,
      reason: 'Bot sedang dalam mode standby (token Discord belum terhubung). Checkpoint lokal tetap tersimpan.',
    };
  }
  await syncMissedMessages(db, clientInstance);
  return { synced: true };
}

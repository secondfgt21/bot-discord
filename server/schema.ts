import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const snowflakeBigint = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'bigint';
  },
  fromDriver(value: unknown): string {
    return String(value);
  },
  toDriver(value: string): string {
    return String(value);
  },
});

// 1. guilds
export const guilds = pgTable('guilds', {
  id: uuid('id').defaultRandom().primaryKey(),
  discordGuildId: snowflakeBigint('discord_guild_id').notNull().unique(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Jakarta'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 2. members
export const members = pgTable(
  'members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    discordUserId: snowflakeBigint('discord_user_id').notNull(),
    discordUsername: text('discord_username').notNull(),
    displayName: text('display_name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_members_guild_discord').on(t.guildId, t.discordUserId),
    index('idx_members_guild_discord').on(t.guildId, t.discordUserId),
  ]
);

// 3. employee_roles
export const employeeRoles = pgTable(
  'employee_roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_employee_roles_member_role').on(t.memberId, t.role),
    index('idx_employee_roles_member').on(t.memberId),
  ]
);

// 4. projects
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_projects_guild_slug').on(t.guildId, t.slug),
    index('idx_projects_guild').on(t.guildId),
  ]
);

// 5. project_aliases
export const projectAliases = pgTable(
  'project_aliases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_project_aliases_guild_alias').on(t.guildId, t.alias),
    index('idx_project_aliases_project').on(t.projectId),
  ]
);

// 6. channel_mappings
export const channelMappings = pgTable(
  'channel_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    discordChannelId: snowflakeBigint('discord_channel_id').notNull(),
    channelName: text('channel_name').notNull().default(''),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    isReportChannel: boolean('is_report_channel').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_channel_mappings_unique').on(t.guildId, t.discordChannelId, t.projectId),
    index('idx_channel_mappings_channel').on(t.discordChannelId),
    index('idx_channel_mappings_project').on(t.projectId),
  ]
);

// 7. role_aliases
export const roleAliases = pgTable(
  'role_aliases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_role_aliases_guild_alias').on(t.guildId, t.alias)]
);

// 8. payroll_rates
export const payrollRates = pgTable(
  'payroll_rates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    rateIdr: integer('rate_idr').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_payroll_rates_active').on(t.guildId, t.role, t.isActive)]
);

// 9. payroll_periods
export const payrollPeriods = pgTable(
  'payroll_periods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    periodKey: text('period_key').notNull(),
    year: integer('year').notNull(),
    month: integer('month').notNull(),
    timezone: text('timezone').notNull().default('Asia/Jakarta'),
    status: text('status').notNull().default('OPEN'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: text('closed_by'),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    reopenedBy: text('reopened_by'),
    reopenReason: text('reopen_reason'),
  },
  (t) => [
    uniqueIndex('uq_payroll_periods_guild_key').on(t.guildId, t.periodKey),
    index('idx_payroll_periods_key').on(t.guildId, t.year, t.month),
  ]
);

// 10. reports
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => payrollPeriods.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    projectId: uuid('project_id').references(() => projects.id),
    discordGuildId: snowflakeBigint('discord_guild_id').notNull(),
    discordChannelId: snowflakeBigint('discord_channel_id').notNull(),
    discordMessageId: snowflakeBigint('discord_message_id').notNull().unique(),
    discordAuthorId: snowflakeBigint('discord_author_id').notNull(),
    authorUsername: text('author_username').notNull(),
    authorDisplayName: text('author_display_name').notNull(),
    rawContent: text('raw_content').notNull(),
    mentionsJson: jsonb('mentions_json').$type<string[]>().notNull().default([]),
    messageUrl: text('message_url').notNull().default(''),
    messageTimestamp: timestamp('message_timestamp', { withTimezone: true }).notNull(),
    parseStatus: text('parse_status').notNull(),
    parseNotesJson: jsonb('parse_notes_json').$type<string[]>().notNull().default([]),
    isDeleted: boolean('is_deleted').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_reports_period').on(t.periodId),
    index('idx_reports_member').on(t.memberId),
    index('idx_reports_project').on(t.projectId),
    index('idx_reports_channel').on(t.discordChannelId),
    index('idx_reports_msg').on(t.discordMessageId),
  ]
);

// 11. report_chapters
export const reportChapters = pgTable(
  'report_chapters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => payrollPeriods.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    projectId: uuid('project_id').references(() => projects.id),
    chapterNumber: integer('chapter_number').notNull(),
    role: text('role'),
    unitRateIdr: integer('unit_rate_idr').notNull().default(0),
    amountIdr: integer('amount_idr').notNull().default(0),
    approvalStatus: text('approval_status').notNull(),
    duplicateFlag: boolean('duplicate_flag').notNull().default(false),
    duplicateOfChapterId: uuid('duplicate_of_chapter_id'),
    approvedBy: text('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_rc_period').on(t.periodId),
    index('idx_rc_member').on(t.memberId),
    index('idx_rc_project').on(t.projectId),
    index('idx_rc_role').on(t.role),
    index('idx_rc_status').on(t.approvalStatus),
    index('idx_rc_chapter_num').on(t.chapterNumber),
    index('idx_rc_dup_lookup').on(t.guildId, t.projectId, t.chapterNumber, t.memberId, t.role),
  ]
);

// 12. report_events
export const reportEvents = pgTable(
  'report_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    beforeJson: jsonb('before_json'),
    afterJson: jsonb('after_json'),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_report_events_report').on(t.reportId)]
);

// 13. payroll_records
export const payrollRecords = pgTable(
  'payroll_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => payrollPeriods.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    translatorChapters: integer('translator_chapters').notNull().default(0),
    editorChapters: integer('editor_chapters').notNull().default(0),
    soloChapters: integer('solo_chapters').notNull().default(0),
    totalChapters: integer('total_chapters').notNull().default(0),
    grossAmountIdr: integer('gross_amount_idr').notNull().default(0),
    adjustmentAmountIdr: integer('adjustment_amount_idr').notNull().default(0),
    netAmountIdr: integer('net_amount_idr').notNull().default(0),
    paidAmountIdr: integer('paid_amount_idr').notNull().default(0),
    remainingAmountIdr: integer('remaining_amount_idr').notNull().default(0),
    paymentStatus: text('payment_status').notNull().default('UNPAID'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_pr_period_member').on(t.periodId, t.memberId),
    index('idx_pr_period').on(t.periodId),
    index('idx_pr_member').on(t.memberId),
    index('idx_pr_status').on(t.paymentStatus),
  ]
);

// 14. payroll_items
export const payrollItems = pgTable(
  'payroll_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    payrollRecordId: uuid('payroll_record_id')
      .notNull()
      .references(() => payrollRecords.id, { onDelete: 'cascade' }),
    reportChapterId: uuid('report_chapter_id')
      .notNull()
      .references(() => reportChapters.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id),
    chapterNumber: integer('chapter_number').notNull(),
    role: text('role').notNull(),
    unitRateIdr: integer('unit_rate_idr').notNull(),
    amountIdr: integer('amount_idr').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_pi_chapter').on(t.reportChapterId),
    index('idx_pi_record').on(t.payrollRecordId),
  ]
);

// 15. payments
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    payrollRecordId: uuid('payroll_record_id')
      .notNull()
      .references(() => payrollRecords.id),
    periodId: uuid('period_id')
      .notNull()
      .references(() => payrollPeriods.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    amountIdr: integer('amount_idr').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    adminUserId: text('admin_user_id').notNull(),
    adminName: text('admin_name').notNull(),
    method: text('method').notNull(),
    transactionRef: text('transaction_ref').notNull().default(''),
    notes: text('notes').notNull().default(''),
    isReversal: boolean('is_reversal').notNull().default(false),
    reversesPaymentId: uuid('reverses_payment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_payments_period').on(t.periodId),
    index('idx_payments_member').on(t.memberId),
    index('idx_payments_record').on(t.payrollRecordId),
  ]
);

// 16. payroll_adjustments
export const payrollAdjustments = pgTable(
  'payroll_adjustments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    payrollRecordId: uuid('payroll_record_id')
      .notNull()
      .references(() => payrollRecords.id),
    periodId: uuid('period_id')
      .notNull()
      .references(() => payrollPeriods.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    amountIdr: integer('amount_idr').notNull(),
    reason: text('reason').notNull(),
    authorizedBy: text('authorized_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_pa_record').on(t.payrollRecordId)]
);

// 17. admin_users
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  fullName: text('full_name').notNull(),
  role: text('role').notNull(), // Owner | Admin | Viewer
  passwordHash: text('password_hash').notNull(),
  supabaseUid: text('supabase_uid'),
  discordUserId: snowflakeBigint('discord_user_id'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 18. audit_logs
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id'),
    actorId: text('actor_id').notNull(),
    actorEmail: text('actor_email').notNull(),
    actorRole: text('actor_role').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    beforeJson: jsonb('before_json'),
    afterJson: jsonb('after_json'),
    reason: text('reason'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_audit_logs_created').on(t.createdAt),
    index('idx_audit_logs_entity').on(t.entityType, t.entityId),
  ]
);

// 19. bot_settings
export const botSettings = pgTable(
  'bot_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    valueJson: jsonb('value_json').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_bot_settings_guild_key').on(t.guildId, t.key)]
);

// 20. processing_checkpoints
export const processingCheckpoints = pgTable(
  'processing_checkpoints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    discordChannelId: snowflakeBigint('discord_channel_id').notNull(),
    channelName: text('channel_name').notNull().default(''),
    lastMessageId: snowflakeBigint('last_message_id'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    syncStatus: text('sync_status').notNull().default('IDLE'),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_checkpoints_guild_channel').on(t.guildId, t.discordChannelId)]
);

// 21. notifications
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    payloadJson: jsonb('payload_json').notNull().default({}),
    dedupKey: text('dedup_key').unique(),
    sentToDiscord: boolean('sent_to_discord').notNull().default(false),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_notifications_created').on(t.createdAt)]
);

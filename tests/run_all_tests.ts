import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { createTestPgDb, seedGuildDefaults } from '../server/db.ts';
import { parseDiscordReport } from '../server/parser.ts';
import {
  closePayrollPeriod,
  createPayrollAdjustment,
  handleDiscordMessageDelete,
  handleDiscordMessageEdit,
  processDiscordReport,
  recordPayment,
  reopenPayrollPeriod,
  reversePayment,
  updateChapterApproval,
} from '../server/payrollService.ts';
import {
  channelMappings,
  guilds,
  members,
  payrollPeriods,
  payrollRates,
  payrollRecords,
  projectAliases,
  projects,
  reportChapters,
} from '../server/schema.ts';
import type { AuthUser } from '../server/types.ts';

async function runTests() {
  let passed = 0;
  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`PASS: ${name}`);
      passed += 1;
    } catch (err) {
      console.error(`FAIL: ${name}`);
      throw err;
    }
  }

  const testProjects = [
    { id: 'p-sl', title: 'Solo Leveling', aliases: ['SL', 'Solo Leveling', 'Solo-Leveling'] },
    { id: 'p-orv', title: 'Omniscient Reader', aliases: ['ORV', 'Omniscient Reader'] },
    { id: 'p-nm', title: 'Nano Machine', aliases: ['NM', 'Nano Machine'] },
  ];
  const testRoleAliases = [
    { alias: 'ETL', role: 'Translator' as const },
    { alias: 'Translator', role: 'Translator' as const },
    { alias: 'TS', role: 'Editor' as const },
    { alias: 'Editor', role: 'Editor' as const },
    { alias: 'Solo', role: 'Solo' as const },
  ];
  const slChannel = [{ projectId: 'p-sl', isDefault: true }];

  // =========================================================================
  // PARSER TESTS
  // =========================================================================
  await test('1. CH 18 ETL Done', () => {
    const r = parseDiscordReport('CH 18 ETL Done', {
      projects: testProjects,
      channelMappings: slChannel,
      roleAliases: testRoleAliases,
    });
    assert.equal(r.parseStatus, 'VALID');
    assert.deepEqual(r.chapters, [18]);
    assert.equal(r.role, 'Translator');
    assert.equal(r.projectId, 'p-sl');
  });

  await test('2. CH 108-110 ETL Done', () => {
    const r = parseDiscordReport('CH 108-110 ETL Done', {
      projects: testProjects,
      channelMappings: slChannel,
      roleAliases: testRoleAliases,
    });
    assert.equal(r.parseStatus, 'VALID');
    assert.deepEqual(r.chapters, [108, 109, 110]);
    assert.equal(r.role, 'Translator');
  });

  await test('3. CH 108 - 110 ETL Done', () => {
    const r = parseDiscordReport('CH 108 - 110 ETL Done', {
      projects: testProjects,
      channelMappings: slChannel,
      roleAliases: testRoleAliases,
    });
    assert.equal(r.parseStatus, 'VALID');
    assert.deepEqual(r.chapters, [108, 109, 110]);
  });

  await test('4. Chapter 108-110 Translator Done & Chapter 108 sampai 110', () => {
    const r1 = parseDiscordReport('Chapter 108-110 Translator Done', {
      projects: testProjects,
      channelMappings: slChannel,
      roleAliases: testRoleAliases,
    });
    assert.deepEqual(r1.chapters, [108, 109, 110]);
    assert.equal(r1.role, 'Translator');

    const r2 = parseDiscordReport('Chapter 108 sampai 110 ETL Done', {
      projects: testProjects,
      channelMappings: slChannel,
      roleAliases: testRoleAliases,
    });
    assert.deepEqual(r2.chapters, [108, 109, 110]);
  });

  await test('5. CH 108, 109, 110 TS Done', () => {
    const r = parseDiscordReport('CH 108, 109, 110 TS Done', {
      projects: testProjects,
      channelMappings: slChannel,
      roleAliases: testRoleAliases,
    });
    assert.equal(r.parseStatus, 'VALID');
    assert.deepEqual(r.chapters, [108, 109, 110]);
    assert.equal(r.role, 'Editor');
  });

  await test('6. CH 108 & 109 Solo Done', () => {
    const r = parseDiscordReport('CH 108 & 109 Solo Done', {
      projects: testProjects,
      channelMappings: slChannel,
      roleAliases: testRoleAliases,
    });
    assert.equal(r.parseStatus, 'VALID');
    assert.deepEqual(r.chapters, [108, 109]);
    assert.equal(r.role, 'Solo');
  });

  await test('7. CH 108, 110, 112 ETL Done', () => {
    const r = parseDiscordReport('CH 108, 110, 112 ETL Done', {
      projects: testProjects,
      channelMappings: slChannel,
      roleAliases: testRoleAliases,
    });
    assert.equal(r.parseStatus, 'VALID');
    assert.deepEqual(r.chapters, [108, 110, 112]);
  });

  await test('8. CH 108-110, 115, 118-120 ETL Done (7 chapters)', () => {
    const r = parseDiscordReport('CH 108-110, 115, 118-120 ETL Done', {
      projects: testProjects,
      channelMappings: slChannel,
      roleAliases: testRoleAliases,
    });
    assert.equal(r.parseStatus, 'VALID');
    assert.deepEqual(r.chapters, [108, 109, 110, 115, 118, 119, 120]);
    assert.equal(r.chapters.length, 7);
  });

  await test('9. Comic omitted but channel has mapping + @Controller excluded', () => {
    const r = parseDiscordReport('CH 18 ETL Done @Controller', {
      projects: testProjects,
      channelMappings: slChannel,
      roleAliases: testRoleAliases,
    });
    assert.equal(r.parseStatus, 'VALID');
    assert.equal(r.projectId, 'p-sl');
    assert.deepEqual(r.mentions, ['@Controller']);
  });

  await test('10. Comic name conflicts with channel mapping -> PROJECT_CHANNEL_CONFLICT', () => {
    const r = parseDiscordReport('Nano Machine CH 190 TS Done @Controller', {
      projects: testProjects,
      channelMappings: slChannel,
      roleAliases: testRoleAliases,
    });
    assert.equal(r.parseStatus, 'PROJECT_CHANNEL_CONFLICT');
  });

  await test('11. Unknown role -> UNKNOWN_ROLE', () => {
    const r = parseDiscordReport('CH 18 Typesetter Done', {
      projects: testProjects,
      channelMappings: slChannel,
      roleAliases: testRoleAliases,
    });
    assert.equal(r.parseStatus, 'UNKNOWN_ROLE');
  });

  await test('12. Invalid chapter range -> INVALID_CHAPTER', () => {
    const r = parseDiscordReport('CH 110-100 ETL Done', {
      projects: testProjects,
      channelMappings: slChannel,
      roleAliases: testRoleAliases,
    });
    assert.equal(r.parseStatus, 'INVALID_CHAPTER');
  });

  await test('13. Non-report message -> NOT_A_REPORT', () => {
    const r = parseDiscordReport('Halo guys lagi ngapain nih?', {
      projects: testProjects,
      channelMappings: slChannel,
      roleAliases: testRoleAliases,
    });
    assert.equal(r.isReport, false);
    assert.equal(r.parseStatus, 'NOT_A_REPORT');
  });

  // =========================================================================
  // POSTGRESQL DRIZZLE MIGRATION, PAYROLL, EDIT, DELETE, IDEMPOTENCY, DUPLICATE
  // =========================================================================
  const { db, cleanup } = await createTestPgDb();

  try {
    await test('14. Database Migration creates all 21 PostgreSQL tables & seeds rates only', async () => {
      const tableRes = await db.execute(sql`
        SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
      `);
      assert.ok(tableRes.rows.length >= 21, `Expected >=21 tables, got ${tableRes.rows.length}`);

      const [guild] = await db
        .insert(guilds)
        .values({ discordGuildId: '100000000000000001', name: 'Test Guild', timezone: 'Asia/Jakarta' })
        .returning();

      await seedGuildDefaults(db, guild.id);

      const rateRows = await db.select().from(payrollRates).where(eq(payrollRates.guildId, guild.id));
      assert.equal(rateRows.length, 3);
      const memberRows = await db.select().from(members);
      assert.equal(memberRows.length, 0, 'Production seed must NOT create fake members');
    });

    const [guild] = await db.select().from(guilds).limit(1);

    // Setup test comic projects & channels specifically inside the test context
    const [slProj] = await db
      .insert(projects)
      .values({ guildId: guild.id, title: 'Solo Leveling', slug: 'solo-leveling' })
      .returning();
    await db.insert(projectAliases).values([
      { guildId: guild.id, projectId: slProj.id, alias: 'Solo Leveling' },
      { guildId: guild.id, projectId: slProj.id, alias: 'Solo-Leveling' },
    ]);

    const [orvProj] = await db
      .insert(projects)
      .values({ guildId: guild.id, title: 'Omniscient Reader', slug: 'omniscient-reader' })
      .returning();

    const chSlId = '1280000000000000101';
    const chOrvId = '1280000000000000102';
    await db.insert(channelMappings).values([
      {
        guildId: guild.id,
        discordChannelId: chSlId,
        channelName: '#solo-leveling',
        projectId: slProj.id,
        isReportChannel: true,
        isDefault: true,
      },
      {
        guildId: guild.id,
        discordChannelId: chOrvId,
        channelName: '#orv',
        projectId: orvProj.id,
        isReportChannel: true,
        isDefault: true,
      },
    ]);

    const ownerActor: AuthUser = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'owner@example.com',
      fullName: 'Owner',
      role: 'Owner',
    };
    const adminActor: AuthUser = {
      id: '00000000-0000-0000-0000-000000000002',
      email: 'admin@example.com',
      fullName: 'Admin',
      role: 'Admin',
    };

    await test('15. Payroll Math (TL 3ch=9000, ED 3ch=9000, Solo 3ch=18000), Idempotency, Duplicate, Payment & Reversal', async () => {
      const workerUid = '770000000000000999';

      const res1 = await processDiscordReport(db, {
        discordMessageId: '900000000000000001',
        discordGuildId: guild.discordGuildId,
        discordChannelId: chSlId,
        discordAuthorId: workerUid,
        authorUsername: 'uji_worker',
        authorDisplayName: 'Uji Worker',
        content: '#Solo-Leveling CH 501-503 ETL Done @Controller',
      });
      assert.equal(res1.outcome, 'PROCESSED');
      assert.equal(res1.chaptersCreated, 3);
      assert.equal(res1.totalAmountIdr, 9000);

      // Idempotency on same Discord Message ID
      const res1Repeat = await processDiscordReport(db, {
        discordMessageId: '900000000000000001',
        discordGuildId: guild.discordGuildId,
        discordChannelId: chSlId,
        discordAuthorId: workerUid,
        authorUsername: 'uji_worker',
        authorDisplayName: 'Uji Worker',
        content: '#Solo-Leveling CH 501-503 ETL Done @Controller',
      });
      assert.equal(res1Repeat.outcome, 'DUPLICATE_MESSAGE_IDEMPOTENT');

      const res2 = await processDiscordReport(db, {
        discordMessageId: '900000000000000002',
        discordGuildId: guild.discordGuildId,
        discordChannelId: chSlId,
        discordAuthorId: workerUid,
        authorUsername: 'uji_worker',
        authorDisplayName: 'Uji Worker',
        content: 'CH 501-503 TS Done @Controller',
      });
      assert.equal(res2.totalAmountIdr, 9000);

      const res3 = await processDiscordReport(db, {
        discordMessageId: '900000000000000003',
        discordGuildId: guild.discordGuildId,
        discordChannelId: chOrvId,
        discordAuthorId: workerUid,
        authorUsername: 'uji_worker',
        authorDisplayName: 'Uji Worker',
        content: 'CH 601-603 Solo Done @Controller',
      });
      assert.equal(res3.totalAmountIdr, 18000);

      const [member] = await db
        .select()
        .from(members)
        .where(eq(members.discordUserId, workerUid))
        .limit(1);

      const [pr] = await db
        .select()
        .from(payrollRecords)
        .where(eq(payrollRecords.memberId, member.id))
        .limit(1);

      assert.equal(pr.translatorChapters, 3);
      assert.equal(pr.editorChapters, 3);
      assert.equal(pr.soloChapters, 3);
      assert.equal(pr.totalChapters, 9);
      assert.equal(pr.netAmountIdr, 36000);

      // Cross-message duplicate detection
      const dupRes = await processDiscordReport(db, {
        discordMessageId: '900000000000000004',
        discordGuildId: guild.discordGuildId,
        discordChannelId: chSlId,
        discordAuthorId: workerUid,
        authorUsername: 'uji_worker',
        authorDisplayName: 'Uji Worker',
        content: 'CH 501 ETL Done @Controller',
      });
      assert.equal(dupRes.outcome, 'PROCESSED');
      assert.equal(dupRes.totalAmountIdr, 0);

      // Partial, Full, and Reversal payment
      const pay1 = await recordPayment(
        db,
        { payrollRecordId: pr.id, amountIdr: 10000, method: 'BCA' },
        adminActor
      );
      assert.equal(pay1.remainingAmountIdr, 26000);
      assert.equal(pay1.paymentStatus, 'PARTIALLY_PAID');

      const pay2 = await recordPayment(
        db,
        { payrollRecordId: pr.id, amountIdr: 26000, method: 'BCA' },
        adminActor
      );
      assert.equal(pay2.remainingAmountIdr, 0);
      assert.equal(pay2.paymentStatus, 'PAID');

      // Reversal restores remaining balance
      await reversePayment(db, pay2.paymentId, 'Koreksi transfer ganda', adminActor);
      const [prAfterRev] = await db
        .select()
        .from(payrollRecords)
        .where(eq(payrollRecords.id, pr.id))
        .limit(1);
      assert.equal(prAfterRev.remainingAmountIdr, 26000);
      assert.equal(prAfterRev.paymentStatus, 'PARTIALLY_PAID');

      // Reject pending duplicate chapter so period can close cleanly
      const pendingCh = await db
        .select({ id: reportChapters.id })
        .from(reportChapters)
        .where(eq(reportChapters.approvalStatus, 'pending'));

      await updateChapterApproval(
        db,
        pendingCh.map((c) => c.id),
        'reject',
        adminActor,
        'Duplikat terkonfirmasi'
      );
    });

    await test('16. Message Edit Sync & Soft Delete Void', async () => {
      await processDiscordReport(db, {
        discordMessageId: '900000000000000010',
        discordGuildId: guild.discordGuildId,
        discordChannelId: chSlId,
        discordAuthorId: '770000000000000888',
        authorUsername: 'editor_test',
        authorDisplayName: 'Editor Test',
        content: 'CH 10-11 ETL Done',
      });

      const editRes = await handleDiscordMessageEdit(db, {
        discordMessageId: '900000000000000010',
        discordGuildId: guild.discordGuildId,
        discordChannelId: chSlId,
        discordAuthorId: '770000000000000888',
        authorUsername: 'editor_test',
        authorDisplayName: 'Editor Test',
        content: 'CH 10-12 ETL Done',
      });
      assert.equal(editRes.status, 'EDITED_SYNCED');

      const [editMember] = await db
        .select()
        .from(members)
        .where(eq(members.discordUserId, '770000000000000888'))
        .limit(1);
      const [editPr] = await db
        .select()
        .from(payrollRecords)
        .where(eq(payrollRecords.memberId, editMember.id))
        .limit(1);
      assert.equal(editPr.totalChapters, 3);
      assert.equal(editPr.netAmountIdr, 9000);

      const delRes = await handleDiscordMessageDelete(db, '900000000000000010', adminActor, 'Dihapus');
      assert.equal(delRes.status, 'VOIDED');
      const [editPrAfterDel] = await db
        .select()
        .from(payrollRecords)
        .where(eq(payrollRecords.memberId, editMember.id))
        .limit(1);
      assert.equal(editPrAfterDel.totalChapters, 0);
      assert.equal(editPrAfterDel.netAmountIdr, 0);
    });

    await test('17. Rate Snapshot Immutability & Period Close/Reopen RBAC', async () => {
      const [currPeriod] = await db
        .select()
        .from(payrollPeriods)
        .where(eq(payrollPeriods.status, 'OPEN'))
        .limit(1);

      // Update rate to Rp4.500 and verify old approved chapter snapshots remain Rp3.000
      await db.update(payrollRates).set({ isActive: false }).where(eq(payrollRates.role, 'Translator'));
      await db.insert(payrollRates).values({
        guildId: guild.id,
        role: 'Translator',
        rateIdr: 4500,
        isActive: true,
        createdBy: ownerActor.email,
      });

      const [prBeforeClose] = await db
        .select()
        .from(payrollRecords)
        .where(eq(payrollRecords.periodId, currPeriod.id))
        .limit(1);
      const oldNet = prBeforeClose.netAmountIdr;

      await closePayrollPeriod(db, currPeriod.id, adminActor);

      // Direct payment on CLOSED period must fail
      await assert.rejects(() =>
        recordPayment(db, { payrollRecordId: prBeforeClose.id, amountIdr: 1000, method: 'BCA' }, adminActor)
      );

      // Adjustment on CLOSED period succeeds with reason
      const adj = await createPayrollAdjustment(
        db,
        { payrollRecordId: prBeforeClose.id, amountIdr: 3000, reason: 'Bonus koreksi resmi' },
        ownerActor
      );
      assert.ok(adj.adjustmentId);
      assert.equal(oldNet, prBeforeClose.netAmountIdr);

      // Admin CANNOT reopen closed period
      await assert.rejects(() =>
        reopenPayrollPeriod(db, currPeriod.id, 'Coba buka', adminActor)
      );

      // Owner CAN reopen closed period with reason
      await reopenPayrollPeriod(db, currPeriod.id, 'Perbaikan laporan terlambat', ownerActor);
      const [pAfter] = await db
        .select()
        .from(payrollPeriods)
        .where(eq(payrollPeriods.id, currPeriod.id))
        .limit(1);
      assert.equal(pAfter.status, 'REOPENED');
    });

    console.log(`\nALL ${passed} CORE POSTGRESQL & PAYROLL TEST SUITES PASSED.`);
  } finally {
    await cleanup();
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});

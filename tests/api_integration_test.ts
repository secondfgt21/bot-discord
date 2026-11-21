import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createTestPgDb } from '../server/db.ts';
import { createApiRouter } from '../server/routes.ts';

async function runApiIntegration() {
  const { db, cleanup } = await createTestPgDb();
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(db));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}/api`;

  try {
    // 1. Health Check
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const health = (await healthRes.json()) as { status: string; database: string };
    assert.equal(health.status, 'ok');
    assert.equal(health.database, 'connected');

    // 2. Unauthenticated request must return 401
    const unauthRes = await fetch(`${baseUrl}/overview`);
    assert.equal(unauthRes.status, 401);

    // 3. Initial Owner Setup Status (needsSetup: true before any Owner exists)
    const statusBeforeRes = await fetch(`${baseUrl}/auth/setup-status`);
    assert.equal(statusBeforeRes.status, 200);
    const statusBefore = (await statusBeforeRes.json()) as { needsSetup: boolean };
    assert.equal(statusBefore.needsSetup, true);

    // 4. Reject weak password on setup-owner
    const weakSetupRes = await fetch(`${baseUrl}/auth/setup-owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@teststudio.id',
        fullName: 'Studio Owner',
        password: 'weak',
        guildName: 'Studio Test',
      }),
    });
    assert.equal(weakSetupRes.status, 400);

    // 5. Create first Owner securely via /auth/setup-owner
    const setupRes = await fetch(`${baseUrl}/auth/setup-owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@teststudio.id',
        fullName: 'Studio Owner',
        password: 'StrongTestPassword123!',
        guildName: 'Studio Test',
        discordGuildId: '998877665544332211',
      }),
    });
    assert.equal(setupRes.status, 201);
    const setupData = (await setupRes.json()) as { token: string; user: { role: string } };
    assert.equal(setupData.user.role, 'Owner');
    const ownerToken = setupData.token;

    // 6. Setup endpoint must permanently lock out after Owner exists
    const statusAfterRes = await fetch(`${baseUrl}/auth/setup-status`);
    const statusAfter = (await statusAfterRes.json()) as { needsSetup: boolean };
    assert.equal(statusAfter.needsSetup, false);

    const secondSetupRes = await fetch(`${baseUrl}/auth/setup-owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'attacker@teststudio.id',
        fullName: 'Attacker',
        password: 'StrongTestPassword123!',
      }),
    });
    assert.equal(secondSetupRes.status, 403);

    // 7. Default Rates Seeded (Translator 3000, Editor 3000, Solo 6000) & Zero Fake Employees
    const settingsRes = await fetch(`${baseUrl}/settings`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(settingsRes.status, 200);
    const settings = (await settingsRes.json()) as { rates: Record<string, number> };
    assert.equal(settings.rates.Translator, 3000);
    assert.equal(settings.rates.Editor, 3000);
    assert.equal(settings.rates.Solo, 6000);

    const empListRes = await fetch(`${baseUrl}/employees`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const empList = (await empListRes.json()) as { employees: unknown[] };
    assert.equal(empList.employees.length, 0, 'Must have 0 fake seeded employees');

    // 8. Owner creates Admin & Viewer accounts, then verifies Login & RBAC
    const createAdminRes = await fetch(`${baseUrl}/settings/admin-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        email: 'admin@teststudio.id',
        fullName: 'Studio Admin',
        role: 'Admin',
        password: 'AdminStrongPassword123!',
      }),
    });
    assert.equal(createAdminRes.status, 201);

    const createViewerRes = await fetch(`${baseUrl}/settings/admin-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        email: 'viewer@teststudio.id',
        fullName: 'Studio Viewer',
        role: 'Viewer',
        password: 'ViewerStrongPassword123!',
      }),
    });
    assert.equal(createViewerRes.status, 201);

    async function login(email: string, password: string): Promise<string> {
      const r = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(r.status, 200, `Login failed for ${email}`);
      const d = (await r.json()) as { token: string };
      return d.token;
    }

    const adminToken = await login('admin@teststudio.id', 'AdminStrongPassword123!');
    const viewerToken = await login('viewer@teststudio.id', 'ViewerStrongPassword123!');

    // Viewer CAN read overview, CANNOT mutate
    const viewerOv = await fetch(`${baseUrl}/overview`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    assert.equal(viewerOv.status, 200);

    const viewerCreateEmp = await fetch(`${baseUrl}/employees`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${viewerToken}`,
      },
      body: JSON.stringify({ discordUserId: '123456789012345678', displayName: 'Blocked' }),
    });
    assert.equal(viewerCreateEmp.status, 403);

    // Admin CANNOT change rates or view admin-users (Owner only)
    const adminRateRes = await fetch(`${baseUrl}/settings/rates`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: 'Translator', rateIdr: 5000 }),
    });
    assert.equal(adminRateRes.status, 403);

    const adminUsersRes = await fetch(`${baseUrl}/settings/admin-users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminUsersRes.status, 403);

    // 9. Admin creates project + channel mapping, then ingests Discord report
    const createProjRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        title: 'Solo Leveling',
        aliases: ['SL', 'Solo-Leveling'],
        discordChannelId: '1280000000000000101',
        channelName: '#solo-leveling',
      }),
    });
    assert.equal(createProjRes.status, 201);

    const ingestRes = await fetch(`${baseUrl}/reports/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        discordChannelId: '1280000000000000101',
        discordAuthorId: '880000000000000101',
        authorUsername: 'raka_tl',
        authorDisplayName: 'Raka Pratama',
        content: 'CH 120-122 ETL Done @Controller',
      }),
    });
    assert.equal(ingestRes.status, 200);
    const ingestData = (await ingestRes.json()) as { outcome: string; totalAmountIdr: number };
    assert.equal(ingestData.outcome, 'PROCESSED');
    assert.equal(ingestData.totalAmountIdr, 9000);

    // 10. Payment & Payroll API flow
    const payrollRes = await fetch(`${baseUrl}/payroll`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(payrollRes.status, 200);
    const payrollData = (await payrollRes.json()) as { records: Array<{ id: string; net_amount_idr: number }> };
    assert.equal(payrollData.records.length, 1);
    assert.equal(payrollData.records[0].net_amount_idr, 9000);

    const payRes = await fetch(`${baseUrl}/payroll/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        payrollRecordId: payrollData.records[0].id,
        amountIdr: 9000,
        method: 'BCA Transfer',
        transactionRef: 'TRF-TEST-001',
      }),
    });
    assert.equal(payRes.status, 201);

    // 11. Dashboard API endpoints + Excel & CSV Exports
    const paymentsRes = await fetch(`${baseUrl}/payments`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(paymentsRes.status, 200);

    const archiveRes = await fetch(`${baseUrl}/periods/archive`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(archiveRes.status, 200);

    const xlsxRes = await fetch(`${baseUrl}/export?dataset=payroll&format=xlsx`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(xlsxRes.status, 200);
    const xlsxBuf = await xlsxRes.arrayBuffer();
    assert.ok(xlsxBuf.byteLength > 500, 'Expected non-empty Excel workbook');

    const csvRes = await fetch(`${baseUrl}/export?dataset=payroll&format=csv`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.ok(csvText.includes('Raka Pratama'));

    console.log('ALL HTTP API, SETUP WIZARD, RBAC, PAYMENT & EXPORT INTEGRATION TESTS PASSED.');
  } finally {
    server.close();
    await cleanup();
  }
}

runApiIntegration().catch((err) => {
  console.error(err);
  process.exit(1);
});

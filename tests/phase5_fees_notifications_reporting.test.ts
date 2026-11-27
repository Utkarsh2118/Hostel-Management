import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiApp } from '../server.ts';
import { InMemoryHostelRepository } from '../lib/repo/memoryRepo.ts';
import { HostelAuthService } from '../lib/auth/authService.ts';
import { MaintenanceTaskService } from '../lib/maintenance/store.ts';
import { HostelOperationsService } from '../lib/operations/service.ts';
import { NotificationAndNoticeService } from '../lib/notifications/service.ts';
import { HostelFinanceService } from '../lib/finance/service.ts';
import { InstitutionalReportingService, sanitizeCsvCell } from '../lib/reports/service.ts';

async function startPhase5TestServer() {
  const repo = new InMemoryHostelRepository();
  const authService = new HostelAuthService({
    demoAdminPassword: 'AdminStrongPassword123',
    demoWardenPassword: 'WardenStrongPassword123',
    demoMaintenancePassword: 'MaintStrongPassword123',
    demoStudentPassword: 'StudentStrongPassword123',
  });
  const maintenanceService = new MaintenanceTaskService();
  const operationsService = new HostelOperationsService(repo, maintenanceService);
  const notificationService = new NotificationAndNoticeService(repo);
  const financeService = new HostelFinanceService(repo, notificationService);
  const reportingService = new InstitutionalReportingService(
    repo,
    maintenanceService,
    operationsService,
    financeService
  );

  const app = createApiApp({
    repo,
    authService,
    maintenanceService,
    operationsService,
    notificationService,
    financeService,
    reportingService,
  });

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, baseUrl, repo, notificationService, financeService };
}

async function loginAs(
  baseUrl: string,
  identifier: string,
  password: string,
  portalRole: 'STUDENT' | 'WARDEN' | 'MAINTENANCE_STAFF' | 'ADMIN'
) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'HostelHub',
    },
    body: JSON.stringify({
      identifier,
      password,
      login_portal_role: portalRole,
    }),
  });
  const setCookie = res.headers.get('set-cookie');
  const cookieHeader = setCookie ? setCookie.split(';')[0] : '';
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body, cookieHeader };
}

describe('Phase 5 — Fees & Billing Ledger, Notifications, Institutional Notices & Audited Reporting', () => {
  let activeServer: Server | null = null;

  beforeEach(() => {
    activeServer = null;
  });

  afterEach(async () => {
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
      activeServer = null;
    }
  });

  it('enforces anti-self-payment, anti-IDOR, idempotent verification, overpayment blocking, SHA-256 receipts, and MAINTENANCE_STAFF denial', async () => {
    const { server, baseUrl } = await startPhase5TestServer();
    activeServer = server;

    const studentA = await loginAs(
      baseUrl,
      'student.demo@hostelhub.local',
      'StudentStrongPassword123',
      'STUDENT'
    );
    const studentB = await loginAs(
      baseUrl,
      'ananya.iyer@univ.edu.in',
      'StudentStrongPassword123',
      'STUDENT'
    );
    const admin = await loginAs(
      baseUrl,
      'admin.demo@hostelhub.local',
      'AdminStrongPassword123',
      'ADMIN'
    );
    const maint = await loginAs(
      baseUrl,
      'maintenance.demo@hostelhub.local',
      'MaintStrongPassword123',
      'MAINTENANCE_STAFF'
    );

    // MAINTENANCE_STAFF denied on all finance & reporting endpoints
    for (const ep of [
      '/api/finance/invoices',
      '/api/reports/summary',
      '/api/reports/export?dataset=occupancy',
    ]) {
      const denied = await fetch(`${baseUrl}${ep}`, { headers: { Cookie: maint.cookieHeader } });
      expect(denied.status).toBe(403);
    }

    // Student A fetches own ledger and verifies transparent non-fabricated gateway status
    const listRes = await fetch(`${baseUrl}/api/finance/invoices`, {
      headers: { Cookie: studentA.cookieHeader },
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      invoices: Array<{ id: string; balance_due_inr: number; paid_inr: number; status: string }>;
      gateway_readiness: { configured: boolean; mode: string };
    };
    expect(listBody.gateway_readiness.configured).toBe(false);
    expect(listBody.gateway_readiness.mode).toBe('UNCONFIGURED_UNIVERSITY_GATEWAY');
    expect(listBody.invoices.length).toBeGreaterThanOrEqual(1);

    const inv = listBody.invoices[0];
    const originalBalance = inv.balance_due_inr;

    // Student B cannot submit a payment on Student A's invoice (403)
    const idorPay = await fetch(`${baseUrl}/api/finance/invoices/${inv.id}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentB.cookieHeader,
      },
      body: JSON.stringify({
        mode: 'BANK_NEFT_IMPS',
        reference_number: 'UTR-IDOR-99999',
        amount_inr: 5000,
        paid_on_date: '2026-08-10',
      }),
    });
    expect(idorPay.status).toBe(403);

    // Overpayment beyond balance_due_inr is rejected (400)
    const overPay = await fetch(`${baseUrl}/api/finance/invoices/${inv.id}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        mode: 'BANK_NEFT_IMPS',
        reference_number: 'UTR-OVER-0001',
        amount_inr: originalBalance + 1000,
        paid_on_date: '2026-08-10',
      }),
    });
    expect(overPay.status).toBe(400);

    // Student A submits valid partial NEFT reference (balance remains unchanged until Admin verifies)
    const submitPay = await fetch(`${baseUrl}/api/finance/invoices/${inv.id}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        mode: 'BANK_NEFT_IMPS',
        reference_number: 'UTR202608120001',
        amount_inr: 15000,
        paid_on_date: '2026-08-12',
      }),
    });
    expect(submitPay.status).toBe(201);
    const submitBody = (await submitPay.json()) as {
      invoice: { paid_inr: number; status: string };
      payment: { id: string; status: string };
    };
    expect(submitBody.payment.status).toBe('SUBMITTED_FOR_VERIFICATION');
    expect(submitBody.invoice.paid_inr).toBe(0);
    expect(submitBody.invoice.status).toBe('UNPAID');

    // Duplicate reference submission blocked (409)
    const dupPay = await fetch(`${baseUrl}/api/finance/invoices/${inv.id}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        mode: 'BANK_NEFT_IMPS',
        reference_number: 'UTR202608120001',
        amount_inr: 15000,
        paid_on_date: '2026-08-12',
      }),
    });
    expect(dupPay.status).toBe(409);

    // Student A CANNOT self-verify their payment (403)
    const selfVerify = await fetch(
      `${baseUrl}/api/finance/invoices/${inv.id}/payments/${submitBody.payment.id}/verify`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: studentA.cookieHeader,
        },
        body: JSON.stringify({
          decision: 'VERIFIED_PAID',
          verification_note: 'Self approval attempt',
        }),
      }
    );
    expect(selfVerify.status).toBe(403);

    // Admin Finance Office verifies payment -> issues receipt + checksum
    const verifyRes = await fetch(
      `${baseUrl}/api/finance/invoices/${inv.id}/payments/${submitBody.payment.id}/verify`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: admin.cookieHeader,
        },
        body: JSON.stringify({
          decision: 'VERIFIED_PAID',
          verification_note: 'Reconciled with SBI institutional account statement.',
        }),
      }
    );
    expect(verifyRes.status).toBe(200);
    const verifiedBody = (await verifyRes.json()) as {
      invoice: { paid_inr: number; balance_due_inr: number; status: string };
      payment: { receipt_number: string; receipt_checksum: string; status: string };
    };
    expect(verifiedBody.payment.status).toBe('VERIFIED_PAID');
    expect(verifiedBody.payment.receipt_number).toMatch(/^RCPT-2026-\d+$/);
    expect(verifiedBody.payment.receipt_checksum.length).toBe(16);
    expect(verifiedBody.invoice.paid_inr).toBe(15000);
    expect(verifiedBody.invoice.balance_due_inr).toBe(originalBalance - 15000);
    expect(verifiedBody.invoice.status).toBe('PARTIALLY_PAID');

    // Duplicate verification blocked (409 idempotency)
    const dupVerify = await fetch(
      `${baseUrl}/api/finance/invoices/${inv.id}/payments/${submitBody.payment.id}/verify`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: admin.cookieHeader,
        },
        body: JSON.stringify({
          decision: 'VERIFIED_PAID',
          verification_note: 'Duplicate click',
        }),
      }
    );
    expect(dupVerify.status).toBe(409);

    // Student A can read official receipt; Student B is blocked (403)
    const rcptA = await fetch(
      `${baseUrl}/api/finance/invoices/${inv.id}/payments/${submitBody.payment.id}/receipt`,
      { headers: { Cookie: studentA.cookieHeader } }
    );
    expect(rcptA.status).toBe(200);
    const rcptB = await fetch(
      `${baseUrl}/api/finance/invoices/${inv.id}/payments/${submitBody.payment.id}/receipt`,
      { headers: { Cookie: studentB.cookieHeader } }
    );
    expect(rcptB.status).toBe(403);

    // Admin applies audited waiver for remaining balance -> invoice settled (PAID)
    const waiverRes = await fetch(`${baseUrl}/api/finance/invoices/${inv.id}/waivers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: admin.cookieHeader,
      },
      body: JSON.stringify({
        amount_inr: verifiedBody.invoice.balance_due_inr,
        reason: 'University Merit-cum-Means Scholarship Order #MCM-2026-18',
      }),
    });
    expect(waiverRes.status).toBe(200);
    const waivedBody = (await waiverRes.json()) as {
      invoice: { balance_due_inr: number; status: string };
    };
    expect(waivedBody.invoice.balance_due_inr).toBe(0);
    expect(waivedBody.invoice.status).toBe('PAID');
  });

  it('isolates user notifications and restricts Warden notice publishing strictly to assigned blocks', async () => {
    const { server, baseUrl, notificationService } = await startPhase5TestServer();
    activeServer = server;

    const studentA = await loginAs(
      baseUrl,
      'student.demo@hostelhub.local',
      'StudentStrongPassword123',
      'STUDENT'
    );
    const studentB = await loginAs(
      baseUrl,
      'ananya.iyer@univ.edu.in',
      'StudentStrongPassword123',
      'STUDENT'
    );
    const warden1 = await loginAs(
      baseUrl,
      'warden.demo@hostelhub.local',
      'WardenStrongPassword123',
      'WARDEN'
    ); // assigned blk-nilgiri, blk-kaveri

    // Dispatch personal notification to stu-001
    const createdNotif = notificationService.notifyStudent('stu-001', {
      category: 'BILLING',
      title: 'Test Semester Dues Reminder',
      body: 'Please submit your challan reference before deadline.',
    });

    // Student B cannot mark Student A's notification read (403)
    const crossRead = await fetch(
      `${baseUrl}/api/notifications/${encodeURIComponent(createdNotif.id)}/read`,
      {
        method: 'PATCH',
        headers: {
          'X-Requested-With': 'HostelHub',
          Cookie: studentB.cookieHeader,
        },
      }
    );
    expect(crossRead.status).toBe(403);

    // Student A marks own notification read (200)
    const ownRead = await fetch(
      `${baseUrl}/api/notifications/${encodeURIComponent(createdNotif.id)}/read`,
      {
        method: 'PATCH',
        headers: {
          'X-Requested-With': 'HostelHub',
          Cookie: studentA.cookieHeader,
        },
      }
    );
    expect(ownRead.status).toBe(200);
    expect(((await ownRead.json()) as { notification: { read: boolean } }).notification.read).toBe(
      true
    );

    // Warden 1 cannot publish campus-wide notice (block_id: null) -> 403
    const campusWideAttempt = await fetch(`${baseUrl}/api/institutional-notices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: warden1.cookieHeader,
      },
      body: JSON.stringify({
        title: 'Unauthorized Campus Broadcast',
        body: 'Wardens cannot broadcast campus-wide without Admin authority.',
        audience: 'ALL_HOSTELS',
        block_id: null,
        pinned: false,
      }),
    });
    expect(campusWideAttempt.status).toBe(403);

    // Warden 1 cannot publish for unassigned blk-vindhya -> 403
    const outScopeNotice = await fetch(`${baseUrl}/api/institutional-notices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: warden1.cookieHeader,
      },
      body: JSON.stringify({
        title: 'Vindhya Floor Meeting',
        body: 'Attempted post into unassigned block.',
        audience: 'BLOCK_RESIDENTS',
        block_id: 'blk-vindhya',
        pinned: false,
      }),
    });
    expect(outScopeNotice.status).toBe(403);

    // Warden 1 succeeds publishing for assigned blk-nilgiri -> 201
    const okNotice = await fetch(`${baseUrl}/api/institutional-notices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: warden1.cookieHeader,
      },
      body: JSON.stringify({
        title: 'Nilgiri Hall Fire Drill Schedule',
        body: 'All Nilgiri Hall residents please assemble in the courtyard at 5:30 PM Friday.',
        audience: 'BLOCK_RESIDENTS',
        block_id: 'blk-nilgiri',
        pinned: true,
      }),
    });
    expect(okNotice.status).toBe(201);
  });

  it('scopes Warden institutional reports to assigned blocks, sanitizes CSV formula injection, and audits every export', async () => {
    const { server, baseUrl, repo } = await startPhase5TestServer();
    activeServer = server;

    const studentA = await loginAs(
      baseUrl,
      'student.demo@hostelhub.local',
      'StudentStrongPassword123',
      'STUDENT'
    );
    const warden1 = await loginAs(
      baseUrl,
      'warden.demo@hostelhub.local',
      'WardenStrongPassword123',
      'WARDEN'
    ); // blk-nilgiri, blk-kaveri
    const admin = await loginAs(
      baseUrl,
      'admin.demo@hostelhub.local',
      'AdminStrongPassword123',
      'ADMIN'
    );

    // Direct CSV sanitizer verification
    expect(sanitizeCsvCell('=SUM(A1:A5)')).toBe("'=SUM(A1:A5)");
    expect(sanitizeCsvCell('+cmd|/C calc')).toBe("'+cmd|/C calc");
    expect(sanitizeCsvCell('@HYPERLINK("http://evil")')).toBe(`"'@HYPERLINK(""http://evil"")"`);

    // Student denied reporting summary & exports
    const stuRep = await fetch(`${baseUrl}/api/reports/summary`, {
      headers: { Cookie: studentA.cookieHeader },
    });
    expect(stuRep.status).toBe(403);

    // Warden summary strictly contains assigned blocks only
    const wardenSummaryRes = await fetch(`${baseUrl}/api/reports/summary`, {
      headers: { Cookie: warden1.cookieHeader },
    });
    expect(wardenSummaryRes.status).toBe(200);
    const wardenSummary = (await wardenSummaryRes.json()) as {
      summary: { scope: string; blocks: Array<{ block_id: string }> };
    };
    expect(wardenSummary.summary.scope).toBe('ASSIGNED_BLOCKS');
    const blockIds = wardenSummary.summary.blocks.map((b) => b.block_id);
    expect(blockIds).toContain('blk-nilgiri');
    expect(blockIds).toContain('blk-kaveri');
    expect(blockIds).not.toContain('blk-vindhya');
    expect(blockIds).not.toContain('blk-narmada');

    // File a complaint with a spreadsheet formula payload in subject, then export complaints CSV as Admin
    const formulaCmp = await fetch(`${baseUrl}/api/operations/complaints`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        category: 'other',
        priority: 'low',
        subject: '=CMD|"/C calc"!A0',
        description: 'Testing CSV formula neutralization in institutional exports.',
      }),
    });
    expect(formulaCmp.status).toBe(201);

    const exportRes = await fetch(`${baseUrl}/api/reports/export?dataset=complaints`, {
      headers: { Cookie: admin.cookieHeader },
    });
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get('content-type')).toContain('text/csv');
    expect(exportRes.headers.get('content-disposition')).toContain('attachment; filename="hostelhub-complaints-');
    const csvText = await exportRes.text();
    // Formula cell must be prefixed with single quote so Excel/Sheets cannot execute it
    expect(csvText).toContain(`"'=CMD|""/C calc""!A0"`);

    // Verify export was logged in immutable audit trail
    const logs = await repo.getAuditLogs(25);
    expect(logs.some((l) => l.action === 'INSTITUTIONAL_REPORT_EXPORTED')).toBe(true);
  });
});

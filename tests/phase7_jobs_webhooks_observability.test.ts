import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiApp } from '../server.ts';
import { InMemoryHostelRepository } from '../lib/repo/memoryRepo.ts';
import { HostelAuthService } from '../lib/auth/authService.ts';
import { computePaymentWebhookSignature } from '../lib/finance/webhook.ts';

async function startPhase7TestServer(opts?: {
  backgroundJobSecret?: string;
  paymentWebhookSecret?: string;
}) {
  const repo = new InMemoryHostelRepository();
  const authService = new HostelAuthService({
    demoAdminPassword: 'AdminStrongPassword123',
    demoWardenPassword: 'WardenStrongPassword123',
    demoMaintenancePassword: 'MaintStrongPassword123',
    demoStudentPassword: 'StudentStrongPassword123',
  });
  const app = createApiApp({
    repo,
    authService,
    backgroundJobSecret: opts?.backgroundJobSecret,
    paymentWebhookSecret: opts?.paymentWebhookSecret,
  });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, baseUrl };
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
  return { status: res.status, cookieHeader };
}

describe('Phase 7 — Background Jobs, Signed Payment Webhooks, Outbox & Incident Controls', () => {
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

  it('enforces Admin RBAC on ops endpoints, timing-safe cron secret auth, deduplicated overdue sweeps, and non-fabricated outbox statuses', async () => {
    // 1. Verify cron endpoint fails closed (503) when BACKGROUND_JOB_SECRET is unset
    const unconfigured = await startPhase7TestServer();
    activeServer = unconfigured.server;

    const cronDisabled = await fetch(`${unconfigured.baseUrl}/api/jobs/cron/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_name: 'SESSION_AND_AUDIT_HEALTH_CHECK' }),
    });
    expect(cronDisabled.status).toBe(503);

    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = null;

    // 2. Boot with configured cron secret
    const cronSecret = 'hostelhub-cron-secret-key-2026-prod-test';
    const { server, baseUrl } = await startPhase7TestServer({
      backgroundJobSecret: cronSecret,
    });
    activeServer = server;

    const student = await loginAs(
      baseUrl,
      'student.demo@hostelhub.local',
      'StudentStrongPassword123',
      'STUDENT'
    );
    const warden = await loginAs(
      baseUrl,
      'warden.demo@hostelhub.local',
      'WardenStrongPassword123',
      'WARDEN'
    );
    const maint = await loginAs(
      baseUrl,
      'maintenance.demo@hostelhub.local',
      'MaintStrongPassword123',
      'MAINTENANCE_STAFF'
    );
    const admin = await loginAs(
      baseUrl,
      'admin.demo@hostelhub.local',
      'AdminStrongPassword123',
      'ADMIN'
    );

    // Non-admin roles strictly denied on /api/admin/ops/overview and /api/admin/jobs/run
    for (const cookie of [student.cookieHeader, warden.cookieHeader, maint.cookieHeader]) {
      const overviewDenied = await fetch(`${baseUrl}/api/admin/ops/overview`, {
        headers: { Cookie: cookie },
      });
      expect(overviewDenied.status).toBe(403);

      const runDenied = await fetch(`${baseUrl}/api/admin/jobs/run`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
        },
        body: JSON.stringify({ job_name: 'ALL' }),
      });
      expect(runDenied.status).toBe(403);
    }

    // Wrong cron secret -> 401
    const badCron = await fetch(`${baseUrl}/api/jobs/cron/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Job-Secret': 'wrong-secret-attempt-00000',
      },
      body: JSON.stringify({ job_name: 'OVERDUE_FEE_REMINDERS', reference_date_iso: '2026-09-15' }),
    });
    expect(badCron.status).toBe(401);

    // Create a past-due checked-out gate pass and an expired scheduled visitor
    const gpCreate = await fetch(`${baseUrl}/api/operations/gate-passes`, {
      method: 'POST',
      headers: {
        Cookie: student.cookieHeader,
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
      },
      body: JSON.stringify({
        pass_type: 'DAY_OUT',
        destination: 'City Railway Station',
        reason: 'Collecting academic books from parcel desk',
        departure_at: '2026-09-10T09:00:00.000Z',
        expected_return_at: '2026-09-10T18:00:00.000Z',
        emergency_contact_phone: '+91-9820012345',
      }),
    });
    expect(gpCreate.status).toBe(201);
    const { gate_pass } = (await gpCreate.json()) as { gate_pass: { id: string } };

    // Warden approves & marks exited
    await fetch(`${baseUrl}/api/operations/gate-passes/${gate_pass.id}/review`, {
      method: 'PATCH',
      headers: {
        Cookie: warden.cookieHeader,
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
      },
      body: JSON.stringify({ action: 'APPROVE' }),
    });
    await fetch(`${baseUrl}/api/operations/gate-passes/${gate_pass.id}/review`, {
      method: 'PATCH',
      headers: {
        Cookie: warden.cookieHeader,
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
      },
      body: JSON.stringify({ action: 'MARK_EXITED' }),
    });

    // Student schedules a visitor on a past date
    const visCreate = await fetch(`${baseUrl}/api/operations/visitors`, {
      method: 'POST',
      headers: {
        Cookie: student.cookieHeader,
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
      },
      body: JSON.stringify({
        visitor_name: 'Suresh Kulkarni',
        relation: 'Father',
        id_type: 'GOVT_ID',
        id_last_four: '4821',
        purpose: 'Delivering winter bedding and textbooks',
        scheduled_date: '2026-09-01',
      }),
    });
    expect(visCreate.status).toBe(201);

    // Trigger ALL 4 jobs via valid cron secret (no cookies or CSRF header required)
    const cronRun1 = await fetch(`${baseUrl}/api/jobs/cron/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Job-Secret': cronSecret,
      },
      body: JSON.stringify({
        job_name: 'ALL',
        reference_date_iso: '2026-09-15',
      }),
    });
    expect(cronRun1.status).toBe(200);
    const run1Body = (await cronRun1.json()) as {
      ok: boolean;
      runs: Array<{ job_name: string; items_scanned: number; items_acted: number }>;
    };
    expect(run1Body.ok).toBe(true);
    expect(run1Body.runs.length).toBe(4);

    const feeRun1 = run1Body.runs.find((r) => r.job_name === 'OVERDUE_FEE_REMINDERS')!;
    const gpRun1 = run1Body.runs.find((r) => r.job_name === 'OVERDUE_GATE_PASS_ALERTS')!;
    const visRun1 = run1Body.runs.find((r) => r.job_name === 'EXPIRED_VISITOR_SWEEP')!;

    expect(feeRun1.items_scanned).toBeGreaterThanOrEqual(4);
    expect(feeRun1.items_acted).toBe(feeRun1.items_scanned);
    expect(gpRun1.items_acted).toBe(1);
    expect(visRun1.items_acted).toBe(1);

    // Second run on same date must deduplicate reminders & alerts (0 duplicate actions!)
    const cronRun2 = await fetch(`${baseUrl}/api/jobs/cron/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Job-Secret': cronSecret,
      },
      body: JSON.stringify({
        job_name: 'OVERDUE_FEE_REMINDERS',
        reference_date_iso: '2026-09-15',
      }),
    });
    expect(cronRun2.status).toBe(200);
    const run2Body = (await cronRun2.json()) as {
      runs: Array<{ items_acted: number }>;
    };
    expect(run2Body.runs[0].items_acted).toBe(0);

    // Inspect Admin Ops overview: outbound messages are masked & explicitly QUEUED_PROVIDER_UNCONFIGURED
    const overviewRes = await fetch(`${baseUrl}/api/admin/ops/overview`, {
      headers: { Cookie: admin.cookieHeader },
    });
    expect(overviewRes.status).toBe(200);
    const overview = (await overviewRes.json()) as {
      observability: { total_api_requests: number };
      communications: {
        queue: Array<{ status: string; recipient_masked: string; channel: string }>;
      };
      jobs: { history: Array<{ job_name: string }> };
    };

    expect(overview.observability.total_api_requests).toBeGreaterThan(5);
    expect(overview.jobs.history.length).toBeGreaterThanOrEqual(5);
    expect(overview.communications.queue.length).toBeGreaterThanOrEqual(5);
    // Never falsely DISPATCHED when RESEND_API_KEY / SMS_PROVIDER_API_KEY are unset
    expect(
      overview.communications.queue.every((q) => q.status === 'QUEUED_PROVIDER_UNCONFIGURED')
    ).toBe(true);
    // Recipients are masked (no raw phone '+91-9820012345')
    expect(JSON.stringify(overview.communications.queue)).not.toContain('9820012345');
    expect(JSON.stringify(overview)).not.toContain(cronSecret);
  });

  it('enforces fail-closed HMAC-SHA256 payment webhook verification, 5-minute replay guard, and strict event_id idempotency', async () => {
    // 1. Fails closed with 503 when PAYMENT_WEBHOOK_SECRET is unset
    const unconfigured = await startPhase7TestServer();
    activeServer = unconfigured.server;

    const payload = {
      event_id: 'evt_billdesk_2026_99001',
      event_type: 'PAYMENT_CAPTURED' as const,
      provider_name: 'billdesk_univ',
      invoice_id_or_code: 'inv-seed-stu-001',
      gateway_reference: 'BDTXN202609150001',
      amount_inr: 10000,
      paid_on_date: '2026-09-15',
    };
    const disabledRes = await fetch(`${unconfigured.baseUrl}/api/webhooks/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(disabledRes.status).toBe(503);

    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = null;

    // 2. Start server with configured PAYMENT_WEBHOOK_SECRET
    const webhookSecret = 'univ-payment-webhook-hmac-secret-2026';
    const { server, baseUrl } = await startPhase7TestServer({
      paymentWebhookSecret: webhookSecret,
    });
    activeServer = server;

    const rawBody = JSON.stringify(payload);
    const nowSec = Math.floor(Date.now() / 1000);

    // Invalid signature -> 401
    const badSig = await fetch(`${baseUrl}/api/webhooks/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HostelHub-Timestamp': String(nowSec),
        'X-HostelHub-Signature': `v1=${'a'.repeat(64)}`,
      },
      body: rawBody,
    });
    expect(badSig.status).toBe(401);

    // Stale timestamp (10 minutes old) -> 401 replay rejected
    const staleTs = nowSec - 600;
    const staleSig = computePaymentWebhookSignature(rawBody, staleTs, webhookSecret);
    const staleRes = await fetch(`${baseUrl}/api/webhooks/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HostelHub-Timestamp': String(staleTs),
        'X-HostelHub-Signature': staleSig,
      },
      body: rawBody,
    });
    expect(staleRes.status).toBe(401);

    // Valid signed webhook -> 200 & credits invoice exactly once
    const validSig = computePaymentWebhookSignature(rawBody, nowSec, webhookSecret);
    const okRes = await fetch(`${baseUrl}/api/webhooks/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HostelHub-Timestamp': String(nowSec),
        'X-HostelHub-Signature': validSig,
      },
      body: rawBody,
    });
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as {
      received: boolean;
      duplicate: boolean;
      receipt_number: string;
      invoice_balance_due_inr: number;
    };
    expect(okBody.received).toBe(true);
    expect(okBody.duplicate).toBe(false);
    expect(okBody.receipt_number).toMatch(/^RCPT-2026-\d+$/);
    const balanceAfterFirst = okBody.invoice_balance_due_inr;

    // Duplicate replay of same event_id -> 200 duplicate: true, ZERO double-crediting!
    const replayRes = await fetch(`${baseUrl}/api/webhooks/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HostelHub-Timestamp': String(nowSec),
        'X-HostelHub-Signature': validSig,
      },
      body: rawBody,
    });
    expect(replayRes.status).toBe(200);
    const replayBody = (await replayRes.json()) as { duplicate: boolean };
    expect(replayBody.duplicate).toBe(true);

    // Confirm student's actual invoice balance was only credited once
    const student = await loginAs(
      baseUrl,
      'student.demo@hostelhub.local',
      'StudentStrongPassword123',
      'STUDENT'
    );
    const invRes = await fetch(`${baseUrl}/api/finance/invoices`, {
      headers: { Cookie: student.cookieHeader },
    });
    const invBody = (await invRes.json()) as {
      invoices: Array<{ id: string; balance_due_inr: number; paid_inr: number }>;
    };
    const stuInv = invBody.invoices.find((i) => i.id === 'inv-seed-stu-001')!;
    expect(stuInv.paid_inr).toBe(10000);
    expect(stuInv.balance_due_inr).toBe(balanceAfterFirst);
  });

  it('supports Admin Break-Glass Emergency Global Session Revocation while preserving Admin containment session', async () => {
    const { server, baseUrl } = await startPhase7TestServer();
    activeServer = server;

    const student = await loginAs(
      baseUrl,
      'student.demo@hostelhub.local',
      'StudentStrongPassword123',
      'STUDENT'
    );
    const warden = await loginAs(
      baseUrl,
      'warden.demo@hostelhub.local',
      'WardenStrongPassword123',
      'WARDEN'
    );
    const admin = await loginAs(
      baseUrl,
      'admin.demo@hostelhub.local',
      'AdminStrongPassword123',
      'ADMIN'
    );

    // Non-admin denied (403)
    const denied = await fetch(`${baseUrl}/api/admin/incident/revoke-sessions`, {
      method: 'POST',
      headers: {
        Cookie: warden.cookieHeader,
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
      },
      body: JSON.stringify({ reason: 'Unauthorized attempt by warden to revoke sessions' }),
    });
    expect(denied.status).toBe(403);

    // Admin executes break-glass revocation
    const revokeRes = await fetch(`${baseUrl}/api/admin/incident/revoke-sessions`, {
      method: 'POST',
      headers: {
        Cookie: admin.cookieHeader,
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
      },
      body: JSON.stringify({
        reason: 'Campus IT incident containment drill — rotating all non-admin sessions.',
      }),
    });
    expect(revokeRes.status).toBe(200);
    const revokeBody = (await revokeRes.json()) as {
      revoked_count: number;
      remaining_active_sessions: number;
    };
    expect(revokeBody.revoked_count).toBe(2);
    expect(revokeBody.remaining_active_sessions).toBe(1);

    // Student & Warden sessions are immediately revoked (401 on protected routes, authenticated=false on /api/auth/me)
    const studentProtected = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Cookie: student.cookieHeader },
    });
    expect(studentProtected.status).toBe(401);

    const wardenProtected = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Cookie: warden.cookieHeader },
    });
    expect(wardenProtected.status).toBe(401);

    const studentMe = (await (
      await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: student.cookieHeader } })
    ).json()) as { authenticated: boolean };
    expect(studentMe.authenticated).toBe(false);

    // Admin session stays active (200)
    const adminProtected = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Cookie: admin.cookieHeader },
    });
    expect(adminProtected.status).toBe(200);
  });
});

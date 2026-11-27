import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiApp } from '../server.ts';
import { InMemoryHostelRepository } from '../lib/repo/memoryRepo.ts';
import { HostelAuthService } from '../lib/auth/authService.ts';
import { MaintenanceTaskService } from '../lib/maintenance/store.ts';
import { validateServerEnv } from '../lib/config/env.ts';

async function startTestServer() {
  const repo = new InMemoryHostelRepository();
  const authService = new HostelAuthService({
    demoAdminPassword: 'AdminStrongPassword123',
    demoWardenPassword: 'WardenStrongPassword123',
    demoMaintenancePassword: 'MaintStrongPassword123',
    demoStudentPassword: 'StudentStrongPassword123',
  });
  const maintenanceService = new MaintenanceTaskService();
  const app = createApiApp({ repo, authService, maintenanceService });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, baseUrl, repo, authService, maintenanceService };
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

describe('Phase 1 — Foundation, 4-Role RBAC, Scoped Isolation & Environment Validation', () => {
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

  it('authenticates MAINTENANCE_STAFF via Maintenance portal, denies wrong portals, and redirects to /maintenance', async () => {
    const { server, baseUrl } = await startTestServer();
    activeServer = server;

    // Student cannot sign in through Maintenance portal
    const wrongPortal = await loginAs(
      baseUrl,
      'student.demo@hostelhub.local',
      'StudentStrongPassword123',
      'MAINTENANCE_STAFF'
    );
    expect(wrongPortal.status).toBe(401);

    // Maintenance staff cannot sign in through Admin or Warden portal
    const maintAsAdmin = await loginAs(
      baseUrl,
      'maintenance.demo@hostelhub.local',
      'MaintStrongPassword123',
      'ADMIN'
    );
    expect(maintAsAdmin.status).toBe(401);

    // Maintenance staff signs in cleanly through MAINTENANCE_STAFF portal
    const ok = await loginAs(
      baseUrl,
      'maintenance.demo@hostelhub.local',
      'MaintStrongPassword123',
      'MAINTENANCE_STAFF'
    );
    expect(ok.status).toBe(200);
    expect(ok.body.redirectTo).toBe('/maintenance');
    expect(ok.cookieHeader).toContain('hostelhub_sid=');
  });

  it('enforces strict data isolation for MAINTENANCE_STAFF (no student PII, allotment, warden, or admin endpoints; only assigned tasks)', async () => {
    const { server, baseUrl } = await startTestServer();
    activeServer = server;

    const maint = await loginAs(
      baseUrl,
      'maintenance.demo@hostelhub.local',
      'MaintStrongPassword123',
      'MAINTENANCE_STAFF'
    );
    expect(maint.status).toBe(200);

    // Must be denied student profile/directory, allotment runs, swaps, disputes, warden overview, and admin endpoints
    const forbiddenPaths = [
      '/api/students',
      '/api/students/me',
      '/api/allotment/runs',
      '/api/swaps',
      '/api/disputes',
      '/api/warden/dashboard',
      '/api/admin/accounts',
      '/api/admin/environment',
      '/api/audit-logs',
    ];
    for (const p of forbiddenPaths) {
      const res = await fetch(`${baseUrl}${p}`, {
        headers: { Cookie: maint.cookieHeader },
      });
      expect(res.status, `Expected 403 for MAINTENANCE_STAFF on ${p}`).toBe(403);
    }

    // Can list ONLY assigned tasks (mt-001, mt-002, mt-004); must NOT see mt-003 (assigned to usr-maint-002 in blk-vindhya)
    const tasksRes = await fetch(`${baseUrl}/api/maintenance/tasks`, {
      headers: { Cookie: maint.cookieHeader },
    });
    expect(tasksRes.status).toBe(200);
    const tasksBody = (await tasksRes.json()) as { tasks: Array<Record<string, unknown>> };
    const taskIds = tasksBody.tasks.map((t) => t.id);
    expect(taskIds).toContain('mt-001');
    expect(taskIds).not.toContain('mt-003');

    // Data minimization check: task DTOs must never leak student academic or PII fields
    for (const task of tasksBody.tasks) {
      expect(task).not.toHaveProperty('cgpa_band');
      expect(task).not.toHaveProperty('student_email');
      expect(task).not.toHaveProperty('student_code');
    }

    // Direct IDOR attempt on another staff member's ticket must be denied (404/403)
    const idorRead = await fetch(`${baseUrl}/api/maintenance/tasks/mt-003`, {
      headers: { Cookie: maint.cookieHeader },
    });
    expect(idorRead.status).toBe(404);

    const idorPatch = await fetch(`${baseUrl}/api/maintenance/tasks/mt-003`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: maint.cookieHeader,
      },
      body: JSON.stringify({ status: 'resolved', work_note: 'Unauthorized tamper' }),
    });
    expect(idorPatch.status).toBe(403);

    // Updating own assigned ticket succeeds and is audited
    const ownPatch = await fetch(`${baseUrl}/api/maintenance/tasks/mt-001`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: maint.cookieHeader,
      },
      body: JSON.stringify({
        status: 'in_progress',
        work_note: 'Replaced regulator capacitor and testing load.',
        parts_needed: '2.5uF ceiling fan capacitor',
      }),
    });
    expect(ownPatch.status).toBe(200);
    const updated = (await ownPatch.json()) as { task: { status: string; parts_needed: string } };
    expect(updated.task.status).toBe('in_progress');
    expect(updated.task.parts_needed).toBe('2.5uF ceiling fan capacitor');

    // Maintenance staff cannot formally close a ticket (Warden/Admin only)
    const closeAttempt = await fetch(`${baseUrl}/api/maintenance/tasks/mt-001`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: maint.cookieHeader,
      },
      body: JSON.stringify({ status: 'closed' }),
    });
    expect(closeAttempt.status).toBe(403);
  });

  it('allows Admin to provision MAINTENANCE_STAFF with explicit blocks, exposes safe environment readiness, and records audit logs without secrets', async () => {
    const { server, baseUrl } = await startTestServer();
    activeServer = server;

    const admin = await loginAs(
      baseUrl,
      'admin.demo@hostelhub.local',
      'AdminStrongPassword123',
      'ADMIN'
    );
    expect(admin.status).toBe(200);

    // Provision a new MAINTENANCE_STAFF account
    const provisionRes = await fetch(`${baseUrl}/api/admin/accounts/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: admin.cookieHeader,
      },
      body: JSON.stringify({
        full_name: 'Suresh Menon (Plumbing)',
        email: 'suresh.maint@univ.edu.in',
        role: 'MAINTENANCE_STAFF',
        assigned_block_ids: ['blk-nilgiri'],
        initial_password: 'SureshMaintPassword123',
      }),
    });
    expect(provisionRes.status).toBe(201);
    const provisioned = (await provisionRes.json()) as {
      account: { id: string; role: string; assigned_block_ids: string[] };
    };
    expect(provisioned.account.role).toBe('MAINTENANCE_STAFF');
    expect(provisioned.account.assigned_block_ids).toEqual(['blk-nilgiri']);

    // Newly provisioned technician can sign in
    const sureshLogin = await loginAs(
      baseUrl,
      'suresh.maint@univ.edu.in',
      'SureshMaintPassword123',
      'MAINTENANCE_STAFF'
    );
    expect(sureshLogin.status).toBe(200);

    // Admin environment endpoint reports readiness without leaking any secret strings
    const envRes = await fetch(`${baseUrl}/api/admin/environment`, {
      headers: { Cookie: admin.cookieHeader },
    });
    expect(envRes.status).toBe(200);
    const envJson = (await envRes.json()) as {
      environment: string;
      integrations: Array<{ id: string; state: string }>;
    };
    expect(['development', 'staging', 'production']).toContain(envJson.environment);
    const univ = envJson.integrations.find((i) => i.id === 'university_verification');
    expect(univ).toBeDefined();
    expect(JSON.stringify(envJson)).not.toContain('AdminStrongPassword123');

    // Audit log captured provisioning event and contains no passwords
    const auditRes = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      headers: { Cookie: admin.cookieHeader },
    });
    expect(auditRes.status).toBe(200);
    const auditJson = (await auditRes.json()) as { logs: Array<{ action: string }> };
    expect(auditJson.logs.some((l) => l.action === 'PROVISIONED_MAINTENANCE_STAFF_ACCOUNT')).toBe(
      true
    );
    expect(JSON.stringify(auditJson)).not.toContain('SureshMaintPassword123');
  });

  it('validates production environment requirements strictly and distinguishes mock/sandbox modes', () => {
    const devResult = validateServerEnv({ HOSTELHUB_ENV: 'development' });
    expect(devResult.environment).toBe('development');
    expect(devResult.valid).toBe(true);
    expect(devResult.warnings.length).toBeGreaterThan(0);

    const prodMissing = validateServerEnv({ HOSTELHUB_ENV: 'production' });
    expect(prodMissing.environment).toBe('production');
    expect(prodMissing.valid).toBe(false);
    expect(prodMissing.errors.some((e) => e.includes('SESSION_SECRET'))).toBe(true);
    expect(prodMissing.errors.some((e) => e.includes('university'))).toBe(true);
  });
});

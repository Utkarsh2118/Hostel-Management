import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiApp } from '../server.ts';
import { InMemoryHostelRepository } from '../lib/repo/memoryRepo.ts';
import { HostelAuthService } from '../lib/auth/authService.ts';
import { buildProductionReadinessReport } from '../lib/security/readiness.ts';

async function startPhase6TestServer() {
  const repo = new InMemoryHostelRepository();
  const authService = new HostelAuthService({
    demoAdminPassword: 'AdminStrongPassword123',
    demoWardenPassword: 'WardenStrongPassword123',
    demoMaintenancePassword: 'MaintStrongPassword123',
    demoStudentPassword: 'StudentStrongPassword123',
  });
  const app = createApiApp({ repo, authService });
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

describe('Phase 6 — Production Hardening, Security Headers, Redacted Errors & Readiness Audit', () => {
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

  it('enforces hardened HTTP security headers, disables X-Powered-By, blocks missing CSRF header, redacts malformed JSON errors, and returns JSON 404 for unknown API routes', async () => {
    const { server, baseUrl } = await startPhase6TestServer();
    activeServer = server;

    // 1. Security headers + valid X-Request-Id propagation
    const health = await fetch(`${baseUrl}/api/health`, {
      headers: { 'X-Request-Id': 'audit-trace-123456' },
    });
    expect(health.status).toBe(200);
    expect(health.headers.get('x-powered-by')).toBeNull();
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(health.headers.get('permissions-policy')).toContain('camera=()');
    expect(health.headers.get('cache-control')).toContain('no-store');
    expect(health.headers.get('x-request-id')).toBe('audit-trace-123456');

    // Invalid X-Request-Id must be replaced with a clean generated ID
    const badIdRes = await fetch(`${baseUrl}/api/health`, {
      headers: { 'X-Request-Id': '../../evil<script>alert(1)</script>' },
    });
    const safeId = badIdRes.headers.get('x-request-id');
    expect(safeId).toMatch(/^req-[a-z0-9-]+$/);

    // 2. Malformed JSON returns redacted 400 JSON without stack traces or internal paths
    const badJson = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
      },
      body: '{"identifier": "broken-json"',
    });
    expect(badJson.status).toBe(400);
    const badJsonText = await badJson.text();
    expect(badJsonText).toContain('Malformed JSON request body.');
    expect(badJsonText).not.toContain('SyntaxError');
    expect(badJsonText).not.toContain('/node_modules/');

    // 3. Unknown API route returns clean JSON 404
    const notFound = await fetch(`${baseUrl}/api/nonexistent-security-probe`);
    expect(notFound.status).toBe(404);
    const notFoundBody = (await notFound.json()) as { error: string; request_id: string };
    expect(notFoundBody.error).toContain('not found');
    expect(notFoundBody.request_id).toBeTruthy();

    // 4. CSRF protection blocks state-changing POST without X-Requested-With header
    const noCsrf = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(noCsrf.status).toBe(403);
  });

  it('restricts /api/admin/readiness strictly to ADMIN, verifies all 5 SQL migrations on disk, and never exposes raw secrets', async () => {
    const { server, baseUrl } = await startPhase6TestServer();
    activeServer = server;

    // Unauthenticated -> 401
    const unauth = await fetch(`${baseUrl}/api/admin/readiness`);
    expect(unauth.status).toBe(401);

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

    // Non-admin roles strictly denied (403)
    for (const cookie of [student.cookieHeader, warden.cookieHeader, maint.cookieHeader]) {
      const denied = await fetch(`${baseUrl}/api/admin/readiness`, {
        headers: { Cookie: cookie },
      });
      expect(denied.status).toBe(403);
    }

    // Admin receives full honest readiness dossier
    const res = await fetch(`${baseUrl}/api/admin/readiness`, {
      headers: { Cookie: admin.cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      report: {
        production_ready: boolean;
        migrations: Array<{ filename: string; present_on_disk: boolean }>;
        security_controls: Array<{ id: string; verified: boolean }>;
        institutional_blockers: Array<{ id: string; status: string }>;
      };
    };

    expect(body.report.migrations.length).toBe(6);
    expect(body.report.migrations.every((m) => m.present_on_disk)).toBe(true);
    expect(body.report.security_controls.length).toBeGreaterThanOrEqual(12);
    expect(body.report.security_controls.every((c) => c.verified)).toBe(true);
    expect(body.report.production_ready).toBe(false);
    expect(body.report.institutional_blockers.some((b) => b.status === 'BLOCKED')).toBe(true);

    // Ensure no secret value can leak into serialized report
    const syntheticSecret = 'SUPER_SECRET_SENTINEL_998877665544332211';
    const prodReport = buildProductionReadinessReport({
      HOSTELHUB_ENV: 'production',
      SESSION_SECRET: syntheticSecret,
      SUPABASE_SERVICE_ROLE_KEY: syntheticSecret,
    });
    expect(JSON.stringify(prodReport)).not.toContain(syntheticSecret);
    expect(prodReport.env_validation.valid).toBe(false);
    expect(prodReport.production_ready).toBe(false);
  });
});

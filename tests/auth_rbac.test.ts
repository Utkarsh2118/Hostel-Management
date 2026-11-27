import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApiApp } from '../server.ts';
import { InMemoryHostelRepository } from '../lib/repo/memoryRepo.ts';
import {
  computeTotpCode,
  HostelAuthService,
} from '../lib/auth/authService.ts';

// Test-only ephemeral credentials (never production secrets)
const TEST_ADMIN_PWD = 'AdminTestPass2026!';
const TEST_WARDEN_PWD = 'WardenTestPass2026!';
const TEST_STUDENT_PWD = 'StudentTestPass2026!';

function extractCookieHeader(res: Response): string {
  const raw = res.headers.get('set-cookie');
  if (!raw) return '';
  return raw.split(';')[0] ?? '';
}

describe('Authentication, 3-Role RBAC & Security Controls', () => {
  let server: Server;
  let baseUrl: string;
  let repo: InMemoryHostelRepository;
  let authService: HostelAuthService;

  beforeAll(async () => {
    repo = new InMemoryHostelRepository();
    authService = new HostelAuthService({
      demoAdminPassword: TEST_ADMIN_PWD,
      demoWardenPassword: TEST_WARDEN_PWD,
      demoStudentPassword: TEST_STUDENT_PWD,
      allowedEmailDomain: 'univ.edu.in',
    });
    const app = createApiApp({ repo, authService });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function apiCall(
    path: string,
    options: RequestInit & { cookie?: string; skipCsrf?: boolean } = {}
  ) {
    const headers = new Headers(options.headers ?? {});
    if (!options.skipCsrf) {
      headers.set('X-Requested-With', 'HostelHub');
    }
    if (options.cookie) {
      headers.set('Cookie', options.cookie);
    }
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, res, json };
  }

  async function loginAs(
    identifier: string,
    password: string,
    portalRole: 'STUDENT' | 'WARDEN' | 'ADMIN',
    mfaCode?: string
  ) {
    const resp = await apiCall('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identifier,
        password,
        login_portal_role: portalRole,
        ...(mfaCode ? { mfa_code: mfaCode } : {}),
      }),
    });
    return {
      ...resp,
      cookie: extractCookieHeader(resp.res),
    };
  }

  it('rejects unauthenticated requests to all protected student, warden, and admin endpoints (401)', async () => {
    const endpoints = [
      '/api/students/me',
      '/api/warden/dashboard',
      '/api/admin/accounts',
      '/api/audit-logs',
      '/api/rooms',
      '/api/swaps',
    ];
    for (const ep of endpoints) {
      const { status } = await apiCall(ep);
      expect(status).toBe(401);
    }
  });

  it('rejects state-changing requests missing CSRF protection (Origin or X-Requested-With)', async () => {
    const { status } = await apiCall('/api/auth/login', {
      method: 'POST',
      skipCsrf: true,
      body: JSON.stringify({
        identifier: 'student.demo@hostelhub.local',
        password: TEST_STUDENT_PWD,
        login_portal_role: 'STUDENT',
      }),
    });
    expect(status).toBe(403);
  });

  it('allows Student login via both university email and student ID, and sets HttpOnly session cookie', async () => {
    const byEmail = await loginAs('student.demo@hostelhub.local', TEST_STUDENT_PWD, 'STUDENT');
    expect(byEmail.status).toBe(200);
    expect(byEmail.json.user.role).toBe('STUDENT');
    expect(byEmail.json.redirectTo).toBe('/student');
    expect(byEmail.res.headers.get('set-cookie')).toContain('HttpOnly');

    const byStudentCode = await loginAs('VV2024CO101', TEST_STUDENT_PWD, 'STUDENT');
    expect(byStudentCode.status).toBe(200);
    expect(byStudentCode.json.user.student_code).toBe('VV2024CO101');
  });

  it('denies role-portal mismatch with generic error (Student cannot log in via Admin or Warden portal)', async () => {
    const studentOnAdmin = await loginAs('student.demo@hostelhub.local', TEST_STUDENT_PWD, 'ADMIN');
    expect(studentOnAdmin.status).toBe(401);
    expect(studentOnAdmin.json.error).toBe('Invalid credentials or unauthorized portal access.');

    const studentOnWarden = await loginAs('student.demo@hostelhub.local', TEST_STUDENT_PWD, 'WARDEN');
    expect(studentOnWarden.status).toBe(401);
    expect(studentOnWarden.json.error).toBe('Invalid credentials or unauthorized portal access.');

    const wardenOnAdmin = await loginAs('warden.demo@hostelhub.local', TEST_WARDEN_PWD, 'ADMIN');
    expect(wardenOnAdmin.status).toBe(401);
    expect(wardenOnAdmin.json.error).toBe('Invalid credentials or unauthorized portal access.');
  });

  it('blocks Student from Warden & Admin routes (403) and ignores any spoofed role fields on profile update', async () => {
    const studentLogin = await loginAs('student.demo@hostelhub.local', TEST_STUDENT_PWD, 'STUDENT');
    expect(studentLogin.status).toBe(200);

    // Student blocked from Warden and Admin endpoints
    expect((await apiCall('/api/warden/dashboard', { cookie: studentLogin.cookie })).status).toBe(403);
    expect((await apiCall('/api/admin/accounts', { cookie: studentLogin.cookie })).status).toBe(403);
    expect((await apiCall('/api/audit-logs', { cookie: studentLogin.cookie })).status).toBe(403);
    expect(
      (
        await apiCall('/api/allotment/runs', {
          method: 'POST',
          cookie: studentLogin.cookie,
          body: JSON.stringify({
            label: 'Hack Run',
            seed: 'HACK',
            rules: {
              year_weight: 25,
              merit_weight: 6,
              enable_merit_band: true,
              preserve_mutual_roommates: true,
              enable_pareto_pass: true,
            },
            apply_immediately: true,
          }),
        })
      ).status
    ).toBe(403);

    // Attempting to inject `role: 'ADMIN'` in PUT /api/students/me must never escalate role
    const updateAttempt = await apiCall('/api/students/me', {
      method: 'PUT',
      cookie: studentLogin.cookie,
      body: JSON.stringify({
        name: 'Rohan Kulkarni',
        year: 3,
        branch: 'Computer Science',
        gender: 'male',
        cgpa_band: 'A',
        sleep_schedule: 'late',
        study_style: 'quiet',
        cleanliness: 4,
        about_me: 'Trying role injection.',
        preferences: [],
        role: 'ADMIN',
      }),
    });
    expect(updateAttempt.status).toBe(200);

    const meAfter = await apiCall('/api/auth/me', { cookie: studentLogin.cookie });
    expect(meAfter.json.user.role).toBe('STUDENT');
  });

  it('enforces strict Warden block scoping (allowed on assigned blocks, 403 on unassigned blocks & Admin ops)', async () => {
    // warden.demo@hostelhub.local is assigned ONLY to blk-nilgiri and blk-kaveri
    const wardenLogin = await loginAs('warden.demo@hostelhub.local', TEST_WARDEN_PWD, 'WARDEN');
    expect(wardenLogin.status).toBe(200);
    expect(wardenLogin.json.redirectTo).toBe('/warden');

    // Warden dashboard returns ONLY assigned blocks
    const dash = await apiCall('/api/warden/dashboard', { cookie: wardenLogin.cookie });
    expect(dash.status).toBe(200);
    const returnedBlockIds = dash.json.blocks.map((b: { id: string }) => b.id);
    expect(returnedBlockIds.sort()).toEqual(['blk-kaveri', 'blk-nilgiri']);

    // Allowed: create room in assigned block blk-nilgiri
    const createAllowed = await apiCall('/api/rooms', {
      method: 'POST',
      cookie: wardenLogin.cookie,
      body: JSON.stringify({
        block_id: 'blk-nilgiri',
        floor: 1,
        number: '199',
        capacity: 2,
        ac: true,
        tags: ['quiet'],
      }),
    });
    expect(createAllowed.status).toBe(201);

    // Denied: create room in unassigned block blk-vindhya -> 403 BLOCK_SCOPE_DENIED
    const createDenied = await apiCall('/api/rooms', {
      method: 'POST',
      cookie: wardenLogin.cookie,
      body: JSON.stringify({
        block_id: 'blk-vindhya',
        floor: 1,
        number: '199',
        capacity: 2,
        ac: true,
        tags: ['quiet'],
      }),
    });
    expect(createDenied.status).toBe(403);
    expect(createDenied.json.code).toBe('BLOCK_SCOPE_DENIED');

    // Denied: post notice for unassigned block or campus-wide
    const noticeDenied = await apiCall('/api/notices', {
      method: 'POST',
      cookie: wardenLogin.cookie,
      body: JSON.stringify({
        block_id: 'blk-narmada',
        title: 'Unauthorized Notice',
        body: 'Wardens cannot post outside their assigned blocks.',
        priority: 'notice',
      }),
    });
    expect(noticeDenied.status).toBe(403);

    // Allowed: post notice for assigned block blk-nilgiri
    const noticeAllowed = await apiCall('/api/notices', {
      method: 'POST',
      cookie: wardenLogin.cookie,
      body: JSON.stringify({
        block_id: 'blk-nilgiri',
        title: 'Nilgiri Floor Inspection',
        body: 'Routine electrical inspection on Floor 2 at 5:00 PM.',
        priority: 'notice',
      }),
    });
    expect(noticeAllowed.status).toBe(201);

    // Denied: Warden cannot manage accounts, run allotment, or change global security settings
    expect((await apiCall('/api/admin/accounts', { cookie: wardenLogin.cookie })).status).toBe(403);
    expect(
      (
        await apiCall('/api/admin/security-settings', {
          method: 'PUT',
          cookie: wardenLogin.cookie,
          body: JSON.stringify({ session_ttl_minutes: 30 }),
        })
      ).status
    ).toBe(403);
  });

  it('allows Admin account provisioning, blocks self-role modification, supports Admin TOTP MFA, and logs security events', async () => {
    const adminLogin = await loginAs('admin.demo@hostelhub.local', TEST_ADMIN_PWD, 'ADMIN');
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.json.redirectTo).toBe('/admin');

    // Provision a new WARDEN assigned to blk-vindhya
    const prov = await apiCall('/api/admin/accounts/provision', {
      method: 'POST',
      cookie: adminLogin.cookie,
      body: JSON.stringify({
        full_name: 'Prof. Vikram Rao',
        email: 'vikram.warden@univ.edu.in',
        role: 'WARDEN',
        assigned_block_ids: ['blk-vindhya'],
        initial_password: 'NewWardenPass2026!',
      }),
    });
    expect(prov.status).toBe(201);
    expect(prov.json.account.role).toBe('WARDEN');

    // Verify newly provisioned warden can log in through WARDEN portal
    const newWardenLogin = await loginAs('vikram.warden@univ.edu.in', 'NewWardenPass2026!', 'WARDEN');
    expect(newWardenLogin.status).toBe(200);

    // Admin cannot modify their own role or deactivate themselves
    const selfDemote = await apiCall(`/api/admin/accounts/${adminLogin.json.user.id}`, {
      method: 'PATCH',
      cookie: adminLogin.cookie,
      body: JSON.stringify({ role: 'STUDENT' }),
    });
    expect(selfDemote.status).toBe(400);

    // Admin TOTP MFA setup + login enforcement
    const mfaStart = await apiCall('/api/admin/mfa/setup', {
      method: 'POST',
      cookie: adminLogin.cookie,
    });
    expect(mfaStart.status).toBe(200);
    const secret: string = mfaStart.json.secret;
    const validTotp = computeTotpCode(secret);

    const mfaConfirm = await apiCall('/api/admin/mfa/confirm', {
      method: 'POST',
      cookie: adminLogin.cookie,
      body: JSON.stringify({ code: validTotp }),
    });
    expect(mfaConfirm.status).toBe(200);
    expect(mfaConfirm.json.user.mfa_enabled).toBe(true);

    // Login without MFA code now requires MFA
    const mfaChallenge = await loginAs('admin.demo@hostelhub.local', TEST_ADMIN_PWD, 'ADMIN');
    expect(mfaChallenge.json.mfaRequired).toBe(true);
    expect(mfaChallenge.cookie).toBe('');

    // Login with valid TOTP code succeeds
    const mfaVerified = await loginAs(
      'admin.demo@hostelhub.local',
      TEST_ADMIN_PWD,
      'ADMIN',
      computeTotpCode(secret)
    );
    expect(mfaVerified.status).toBe(200);
    expect(mfaVerified.cookie).toContain('hostelhub_sid=');

    // Disable MFA cleanly after test and verify admin audit logs recorded provisioning & MFA
    await apiCall('/api/admin/mfa/disable', { method: 'POST', cookie: mfaVerified.cookie });
    const logs = await apiCall('/api/admin/audit-logs', { cookie: mfaVerified.cookie });
    expect(logs.status).toBe(200);
    const actions = logs.json.logs.map((l: { action: string }) => l.action);
    expect(actions).toContain('PROVISIONED_WARDEN_ACCOUNT');
    expect(actions).toContain('ADMIN_MFA_ENABLED');
  });

  it('enforces student-only registration, email verification, password reset session revocation, and logout invalidation', async () => {
    // Register a new student (even if payload attempts to sneak `role: 'ADMIN'`)
    const reg = await apiCall('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        full_name: 'Meera Deshmukh',
        email: 'meera.deshmukh@univ.edu.in',
        student_code: 'VV2026CS901',
        password: 'MeeraStrongPass2026!',
        year: 2,
        branch: 'Computer Science',
        gender: 'female',
        role: 'ADMIN',
      }),
    });
    expect(reg.status).toBe(201);
    expect(reg.json.role).toBe('STUDENT');
    const verifyToken: string = reg.json.devVerificationToken;
    expect(verifyToken).toBeTruthy();

    // Cannot log in before verifying email
    const preVerifyLogin = await loginAs('meera.deshmukh@univ.edu.in', 'MeeraStrongPass2026!', 'STUDENT');
    expect(preVerifyLogin.status).toBe(401);

    // Verify email token
    const verified = await apiCall('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token: verifyToken }),
    });
    expect(verified.status).toBe(200);

    // Now login succeeds as STUDENT
    const firstSession = await loginAs('meera.deshmukh@univ.edu.in', 'MeeraStrongPass2026!', 'STUDENT');
    expect(firstSession.status).toBe(200);
    expect(firstSession.json.user.role).toBe('STUDENT');

    // Password reset revokes all prior active sessions
    const forgot = await apiCall('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'meera.deshmukh@univ.edu.in' }),
    });
    expect(forgot.status).toBe(200);
    const resetToken: string = forgot.json.devResetToken;

    const reset = await apiCall('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: resetToken, new_password: 'MeeraNewPass2027!' }),
    });
    expect(reset.status).toBe(200);

    // Old session cookie is immediately invalidated
    const staleCheck = await apiCall('/api/students/me', { cookie: firstSession.cookie });
    expect(staleCheck.status).toBe(401);

    // New password logs in cleanly, then logout revokes session
    const secondSession = await loginAs('meera.deshmukh@univ.edu.in', 'MeeraNewPass2027!', 'STUDENT');
    expect(secondSession.status).toBe(200);

    const logoutRes = await apiCall('/api/auth/logout', {
      method: 'POST',
      cookie: secondSession.cookie,
    });
    expect(logoutRes.status).toBe(200);

    const postLogout = await apiCall('/api/students/me', { cookie: secondSession.cookie });
    expect(postLogout.status).toBe(401);
  });

  it('locks account after repeated failed login attempts', async () => {
    const isolatedAuth = new HostelAuthService({
      demoStudentPassword: TEST_STUDENT_PWD,
    });
    for (let i = 0; i < 5; i += 1) {
      const attempt = await isolatedAuth.login({
        identifier: 'student.demo@hostelhub.local',
        password: 'WrongPassword123',
        loginPortalRole: 'STUDENT',
        ip: '10.0.0.9',
      });
      expect(attempt.ok).toBe(false);
    }
    const lockedAttempt = await isolatedAuth.login({
      identifier: 'student.demo@hostelhub.local',
      password: TEST_STUDENT_PWD,
      loginPortalRole: 'STUDENT',
      ip: '10.0.0.9',
    });
    expect(lockedAttempt.ok).toBe(false);
    if (!lockedAttempt.ok) {
      expect(lockedAttempt.locked).toBe(true);
      expect(lockedAttempt.statusCode).toBe(429);
    }
  });
});

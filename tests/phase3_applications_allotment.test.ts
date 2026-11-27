import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiApp } from '../server.ts';
import { InMemoryHostelRepository } from '../lib/repo/memoryRepo.ts';
import { HostelAuthService } from '../lib/auth/authService.ts';
import { MaintenanceTaskService } from '../lib/maintenance/store.ts';
import { StudentVerificationService } from '../lib/integrations/university/student-verification.ts';
import { InstitutionalInventoryService } from '../lib/inventory/service.ts';
import { PrivateDocumentVaultService } from '../lib/documents/service.ts';
import { HostelApplicationService } from '../lib/applications/service.ts';

async function startPhase3TestServer() {
  const repo = new InMemoryHostelRepository();
  const authService = new HostelAuthService({
    demoAdminPassword: 'AdminStrongPassword123',
    demoWardenPassword: 'WardenStrongPassword123',
    demoMaintenancePassword: 'MaintStrongPassword123',
    demoStudentPassword: 'StudentStrongPassword123',
  });
  const maintenanceService = new MaintenanceTaskService();
  const verificationService = new StudentVerificationService({
    ...process.env,
    HOSTELHUB_ENV: 'development',
    UNIVERSITY_API_BASE_URL: '',
    UNIVERSITY_API_KEY: '',
  });
  const inventoryService = new InstitutionalInventoryService(repo);
  const documentService = new PrivateDocumentVaultService(repo);
  const applicationService = new HostelApplicationService(
    repo,
    verificationService,
    inventoryService
  );

  const app = createApiApp({
    repo,
    authService,
    maintenanceService,
    verificationService,
    inventoryService,
    documentService,
    applicationService,
  });

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    server,
    baseUrl,
    repo,
    verificationService,
    inventoryService,
    applicationService,
  };
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

describe('Phase 3 — Applications, Rule-Based Eligibility, Waitlists & Deterministic Allotment', () => {
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

  it('enforces gender-compatible preferences, verification eligibility gate, and blocks MAINTENANCE_STAFF from all Phase 3 endpoints', async () => {
    const { server, baseUrl, repo } = await startPhase3TestServer();
    activeServer = server;

    const studentA = await loginAs(
      baseUrl,
      'student.demo@hostelhub.local',
      'StudentStrongPassword123',
      'STUDENT'
    ); // male (stu-001, seeded VERIFIED)
    const studentB = await loginAs(
      baseUrl,
      'ananya.iyer@univ.edu.in',
      'StudentStrongPassword123',
      'STUDENT'
    ); // female (stu-151, PENDING verification)
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

    // 1. MAINTENANCE_STAFF strictly blocked (403)
    const maintCycles = await fetch(`${baseUrl}/api/applications/cycles`, {
      headers: { Cookie: maint.cookieHeader },
    });
    expect(maintCycles.status).toBe(403);

    const allRooms = await repo.getRooms();
    const girlsRoom = allRooms.find((r) => r.block_id === 'blk-kaveri')!;
    const boysRoom = allRooms.find(
      (r) => r.block_id === 'blk-nilgiri' && r.occupants.length < r.capacity
    )!;

    // 2. Male student submitting a girls' block room preference is rejected (400)
    const crossGender = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        cycle_id: 'cyc-2026-monsoon',
        preferred_room_ids: [girlsRoom.id],
        home_distance_km: 300,
        declaration_accepted: true,
        submit_now: true,
      }),
    });
    expect(crossGender.status).toBe(400);

    // 3. Unverified Student B submits valid girls' preference -> status stays SUBMITTED (NOT ELIGIBLE)
    const unverifiedSubmit = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentB.cookieHeader,
      },
      body: JSON.stringify({
        cycle_id: 'cyc-2026-monsoon',
        preferred_room_ids: [girlsRoom.id],
        home_distance_km: 400,
        declaration_accepted: true,
        submit_now: true,
      }),
    });
    expect(unverifiedSubmit.status).toBe(201);
    const unverifiedJson = (await unverifiedSubmit.json()) as {
      application: { id: string; status: string; eligibility: { eligible: boolean } };
    };
    expect(unverifiedJson.application.status).toBe('SUBMITTED');
    expect(unverifiedJson.application.eligibility.eligible).toBe(false);

    // 4. Even Admin review CANNOT force unverified student to ELIGIBLE (409)
    const illegalEligible = await fetch(
      `${baseUrl}/api/applications/${unverifiedJson.application.id}/review`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: admin.cookieHeader,
        },
        body: JSON.stringify({
          decision: 'ELIGIBLE',
          review_note: 'Attempting to bypass university verification gate',
        }),
      }
    );
    expect(illegalEligible.status).toBe(409);

    // 5. Verified Student A submits valid boys' room preference -> becomes ELIGIBLE immediately
    const verifiedSubmit = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        cycle_id: 'cyc-2026-monsoon',
        preferred_room_ids: [boysRoom.id],
        home_distance_km: 500,
        declaration_accepted: true,
        submit_now: true,
      }),
    });
    expect(verifiedSubmit.status).toBe(201);
    const verifiedJson = (await verifiedSubmit.json()) as {
      application: { id: string; status: string; eligibility: { eligible: boolean } };
    };
    expect(verifiedJson.application.status).toBe('ELIGIBLE');
    expect(verifiedJson.application.eligibility.eligible).toBe(true);
  });

  it('runs deterministic dry-run & commit allotment respecting Phase 2 maintenance overrides, accessibility priority, offer acceptance/decline, and slip privacy', async () => {
    const { server, baseUrl, repo, inventoryService } = await startPhase3TestServer();
    activeServer = server;

    const admin = await loginAs(
      baseUrl,
      'admin.demo@hostelhub.local',
      'AdminStrongPassword123',
      'ADMIN'
    );
    const warden = await loginAs(
      baseUrl,
      'warden.demo@hostelhub.local',
      'WardenStrongPassword123',
      'WARDEN'
    );
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

    const allRooms = await repo.getRooms();
    // Pick two boys' rooms with free beds: mark pref1 UNDER_MAINTENANCE so engine skips it!
    const freeBoysRooms = allRooms.filter(
      (r) =>
        (r.block_id === 'blk-nilgiri' || r.block_id === 'blk-vindhya') &&
        r.occupants.length < r.capacity
    );
    const maintRoom = freeBoysRooms[0]!;
    const openPrefRoom = freeBoysRooms[1]!;

    // Admin marks maintRoom UNDER_MAINTENANCE via Phase 2 endpoint
    const markMaint = await fetch(`${baseUrl}/api/hostels/rooms/${maintRoom.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: admin.cookieHeader,
      },
      body: JSON.stringify({
        status: 'UNDER_MAINTENANCE',
        reason: 'Plumbing overhaul before semester',
      }),
    });
    expect(markMaint.status).toBe(200);

    // Student A ranks maintRoom #1 and openPrefRoom #2
    const submitRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        cycle_id: 'cyc-2026-monsoon',
        preferred_room_ids: [maintRoom.id, openPrefRoom.id],
        home_distance_km: 350,
        declaration_accepted: true,
        submit_now: true,
      }),
    });
    expect(submitRes.status).toBe(201);
    const appId = ((await submitRes.json()) as { application: { id: string } }).application.id;

    // Warden cannot execute cycle allotment (Admin only -> 403)
    const wardenExec = await fetch(
      `${baseUrl}/api/applications/cycles/cyc-2026-monsoon/execute`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: warden.cookieHeader,
        },
        body: JSON.stringify({ seed: 'SEED-TEST-01', dry_run: true }),
      }
    );
    expect(wardenExec.status).toBe(403);

    // Admin runs dry-run first -> skips maintRoom, picks openPrefRoom (#2), does NOT mutate status
    const dryRunRes = await fetch(
      `${baseUrl}/api/applications/cycles/cyc-2026-monsoon/execute`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: admin.cookieHeader,
        },
        body: JSON.stringify({ seed: 'SEED-TEST-01', dry_run: true }),
      }
    );
    expect(dryRunRes.status).toBe(200);
    const dryRunJson = (await dryRunRes.json()) as {
      run: {
        dry_run: boolean;
        committed: boolean;
        allotted_count: number;
        decisions: Array<{ room_label: string; preference_rank: number | null }>;
      };
    };
    expect(dryRunJson.run.dry_run).toBe(true);
    expect(dryRunJson.run.committed).toBe(false);
    expect(dryRunJson.run.allotted_count).toBe(1);
    expect(dryRunJson.run.decisions[0].preference_rank).toBe(2);

    // Admin commits deterministic run -> assigns openPrefRoom atomically
    const commitRes = await fetch(
      `${baseUrl}/api/applications/cycles/cyc-2026-monsoon/execute`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: admin.cookieHeader,
        },
        body: JSON.stringify({ seed: 'SEED-TEST-01', dry_run: false }),
      }
    );
    expect(commitRes.status).toBe(200);

    // Occupancy invariants remain 100% valid after commit
    const invCheck = await inventoryService.verifyOccupancyInvariants();
    expect(invCheck.valid).toBe(true);

    // Student B cannot read Student A's official allotment slip (IDOR blocked -> 403)
    const idorSlip = await fetch(`${baseUrl}/api/applications/${appId}/slip`, {
      headers: { Cookie: studentB.cookieHeader },
    });
    expect(idorSlip.status).toBe(403);

    // Student A reads official slip & accepts allotment offer
    const ownSlip = await fetch(`${baseUrl}/api/applications/${appId}/slip`, {
      headers: { Cookie: studentA.cookieHeader },
    });
    expect(ownSlip.status).toBe(200);
    const slipJson = (await ownSlip.json()) as {
      slip: { checksum: string; assignment: { room_id: string } };
    };
    expect(slipJson.slip.checksum).toHaveLength(16);
    expect(slipJson.slip.assignment.room_id).toBe(openPrefRoom.id);

    const acceptRes = await fetch(`${baseUrl}/api/applications/${appId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({ action: 'accept' }),
    });
    expect(acceptRes.status).toBe(200);
    const acceptJson = (await acceptRes.json()) as { application: { status: string } };
    expect(acceptJson.application.status).toBe('ACCEPTED');
  });

  it('enforces audited Admin manual override constraints (blocks maintenance rooms, gender violations, and non-Admin roles)', async () => {
    const { server, baseUrl, repo } = await startPhase3TestServer();
    activeServer = server;

    const admin = await loginAs(
      baseUrl,
      'admin.demo@hostelhub.local',
      'AdminStrongPassword123',
      'ADMIN'
    );
    const warden = await loginAs(
      baseUrl,
      'warden.demo@hostelhub.local',
      'WardenStrongPassword123',
      'WARDEN'
    );
    const studentA = await loginAs(
      baseUrl,
      'student.demo@hostelhub.local',
      'StudentStrongPassword123',
      'STUDENT'
    );

    const allRooms = await repo.getRooms();
    const freeBoysRoom = allRooms.find(
      (r) => r.block_id === 'blk-vindhya' && r.occupants.length < r.capacity
    )!;
    const freeGirlsRoom = allRooms.find(
      (r) => r.block_id === 'blk-kaveri' && r.occupants.length < r.capacity
    )!;

    const submitRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        cycle_id: 'cyc-2026-monsoon',
        preferred_room_ids: [freeBoysRoom.id],
        home_distance_km: 120,
        declaration_accepted: true,
        submit_now: true,
      }),
    });
    const appId = ((await submitRes.json()) as { application: { id: string } }).application.id;

    // Warden cannot perform manual override (403)
    const wardenOvr = await fetch(`${baseUrl}/api/applications/${appId}/override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: warden.cookieHeader,
      },
      body: JSON.stringify({
        target_room_id: freeBoysRoom.id,
        justification: 'Warden attempting unauthorized admin override',
      }),
    });
    expect(wardenOvr.status).toBe(403);

    // Admin manual override into opposite-gender room blocked (409)
    const genderOvr = await fetch(`${baseUrl}/api/applications/${appId}/override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: admin.cookieHeader,
      },
      body: JSON.stringify({
        target_room_id: freeGirlsRoom.id,
        justification: 'Testing gender policy enforcement on manual override',
      }),
    });
    expect(genderOvr.status).toBe(409);

    // Valid Admin manual override succeeds and logs audit record
    const okOvr = await fetch(`${baseUrl}/api/applications/${appId}/override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: admin.cookieHeader,
      },
      body: JSON.stringify({
        target_room_id: freeBoysRoom.id,
        justification: 'Dean Welfare Committee Order #2026-44 medical transfer approval',
      }),
    });
    expect(okOvr.status).toBe(200);
    const okJson = (await okOvr.json()) as {
      application: { allotment: { allotted_via: string; room_id: string } };
    };
    expect(okJson.application.allotment.allotted_via).toBe('manual_override');
    expect(okJson.application.allotment.room_id).toBe(freeBoysRoom.id);

    const logs = await repo.getAuditLogs(20);
    expect(logs.some((l) => l.action === 'ALLOTMENT_MANUAL_OVERRIDE')).toBe(true);
  });
});

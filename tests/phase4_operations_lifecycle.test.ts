import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiApp } from '../server.ts';
import { InMemoryHostelRepository } from '../lib/repo/memoryRepo.ts';
import { HostelAuthService } from '../lib/auth/authService.ts';
import { MaintenanceTaskService } from '../lib/maintenance/store.ts';
import { HostelOperationsService } from '../lib/operations/service.ts';

async function startPhase4TestServer() {
  const repo = new InMemoryHostelRepository();
  const authService = new HostelAuthService({
    demoAdminPassword: 'AdminStrongPassword123',
    demoWardenPassword: 'WardenStrongPassword123',
    demoMaintenancePassword: 'MaintStrongPassword123',
    demoStudentPassword: 'StudentStrongPassword123',
  });
  const maintenanceService = new MaintenanceTaskService();
  const operationsService = new HostelOperationsService(repo, maintenanceService);

  const app = createApiApp({
    repo,
    authService,
    maintenanceService,
    operationsService,
  });

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, baseUrl, repo, maintenanceService, operationsService };
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

describe('Phase 4 — Check-In/Out, Complaints & PII-Stripped Maintenance Escalation, Gate Passes & Visitors', () => {
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

  it('enforces Warden block scoping on Check-In, requires mandatory key return on Check-Out, and vacates the room atomically', async () => {
    const { server, baseUrl, repo } = await startPhase4TestServer();
    activeServer = server;

    const student = await repo.getStudentById('stu-001');
    expect(student?.allotted_room_id).toBeTruthy();
    const room = await repo.getRoomById(student!.allotted_room_id!);
    expect(room).toBeTruthy();

    // warden.demo owns blk-nilgiri & blk-kaveri; arvind.warden owns blk-vindhya & blk-narmada
    const warden1Blocks = new Set(['blk-nilgiri', 'blk-kaveri']);
    const inScopeWardenEmail = warden1Blocks.has(room!.block_id)
      ? 'warden.demo@hostelhub.local'
      : 'arvind.warden@univ.edu.in';
    const outScopeWardenEmail = warden1Blocks.has(room!.block_id)
      ? 'arvind.warden@univ.edu.in'
      : 'warden.demo@hostelhub.local';

    const studentSession = await loginAs(
      baseUrl,
      'student.demo@hostelhub.local',
      'StudentStrongPassword123',
      'STUDENT'
    );
    const inScopeWarden = await loginAs(
      baseUrl,
      inScopeWardenEmail,
      'WardenStrongPassword123',
      'WARDEN'
    );
    const outScopeWarden = await loginAs(
      baseUrl,
      outScopeWardenEmail,
      'WardenStrongPassword123',
      'WARDEN'
    );

    expect(studentSession.status).toBe(200);
    expect(inScopeWarden.status).toBe(200);
    expect(outScopeWarden.status).toBe(200);

    // Out-of-scope warden must be denied (403)
    const deniedCheckIn = await fetch(`${baseUrl}/api/operations/occupancy/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: outScopeWarden.cookieHeader,
      },
      body: JSON.stringify({
        student_id: 'stu-001',
        key_serial: 'KEY-UNAUTH-01',
        room_condition_checkin: 'Attempted out-of-scope check-in',
      }),
    });
    expect(deniedCheckIn.status).toBe(403);

    // In-scope warden records Check-In (201)
    const okCheckIn = await fetch(`${baseUrl}/api/operations/occupancy/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: inScopeWarden.cookieHeader,
      },
      body: JSON.stringify({
        student_id: 'stu-001',
        key_serial: 'KEY-N101-A',
        room_condition_checkin: 'Bed, study desk, wardrobe, and fan verified intact.',
      }),
    });
    expect(okCheckIn.status).toBe(201);
    const checkInBody = (await okCheckIn.json()) as {
      record: { status: string; key_serial: string };
    };
    expect(checkInBody.record.status).toBe('CHECKED_IN');
    expect(checkInBody.record.key_serial).toBe('KEY-N101-A');

    // Student submits check-out notice (201)
    const reqCheckOut = await fetch(`${baseUrl}/api/operations/occupancy/checkout-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentSession.cookieHeader,
      },
      body: JSON.stringify({
        planned_date: '2026-05-20',
        reason: 'Completed final semester examinations and clearing hostel.',
      }),
    });
    expect(reqCheckOut.status).toBe(201);
    const reqCoBody = (await reqCheckOut.json()) as { record: { status: string } };
    expect(reqCoBody.record.status).toBe('CHECKOUT_REQUESTED');

    // Completing check-out without physical key return must fail (400)
    const badCheckOut = await fetch(`${baseUrl}/api/operations/occupancy/stu-001/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: inScopeWarden.cookieHeader,
      },
      body: JSON.stringify({
        key_returned: false,
        clearance_note: 'Attempted checkout without key return',
        vacate_room: true,
      }),
    });
    expect(badCheckOut.status).toBe(400);

    // Completing check-out with key_returned: true and vacate_room: true succeeds and clears room allotment
    const goodCheckOut = await fetch(`${baseUrl}/api/operations/occupancy/stu-001/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: inScopeWarden.cookieHeader,
      },
      body: JSON.stringify({
        key_returned: true,
        clearance_note: 'Room key KEY-N101-A returned and room fixtures cleared.',
        vacate_room: true,
      }),
    });
    expect(goodCheckOut.status).toBe(200);
    const coBody = (await goodCheckOut.json()) as {
      record: { status: string; key_returned: boolean };
    };
    expect(coBody.record.status).toBe('CHECKED_OUT');
    expect(coBody.record.key_returned).toBe(true);

    const updatedStudent = await repo.getStudentById('stu-001');
    expect(updatedStudent?.allotted_room_id).toBeNull();
  });

  it('isolates student complaints (anti-IDOR), blocks MAINTENANCE_STAFF from Phase 4 routes, and strips all student PII on Maintenance Escalation', async () => {
    const { server, baseUrl, repo } = await startPhase4TestServer();
    activeServer = server;

    const studentARecord = await repo.getStudentById('stu-001');
    expect(studentARecord).toBeTruthy();

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

    // MAINTENANCE_STAFF must be denied (403) on ALL Phase 4 student-facing operational routes
    for (const endpoint of [
      '/api/operations/occupancy',
      '/api/operations/complaints',
      '/api/operations/gate-passes',
      '/api/operations/visitors',
    ]) {
      const denied = await fetch(`${baseUrl}${endpoint}`, {
        headers: { Cookie: maint.cookieHeader },
      });
      expect(denied.status).toBe(403);
    }

    // Student A files a complaint containing personal details in description
    const createCmp = await fetch(`${baseUrl}/api/operations/complaints`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        category: 'electrical',
        priority: 'high',
        subject: 'Ceiling fan regulator sparking',
        description: `My name is ${studentARecord!.name} (${studentARecord!.student_code}, ${studentARecord!.email}) and my fan regulator sparks when turned on.`,
      }),
    });
    expect(createCmp.status).toBe(201);
    const createdCmp = (await createCmp.json()) as {
      complaint: { id: string; complaint_code: string };
    };

    // Student B must NOT see Student A's complaint
    const studentBCmps = await fetch(`${baseUrl}/api/operations/complaints`, {
      headers: { Cookie: studentB.cookieHeader },
    });
    expect(studentBCmps.status).toBe(200);
    const bList = (await studentBCmps.json()) as { complaints: Array<{ id: string }> };
    expect(bList.complaints.some((c) => c.id === createdCmp.complaint.id)).toBe(false);

    // Admin escalates Student A's complaint to Maintenance Staff with strictly sanitized summary
    const escalateRes = await fetch(
      `${baseUrl}/api/operations/complaints/${encodeURIComponent(createdCmp.complaint.id)}/escalate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: admin.cookieHeader,
        },
        body: JSON.stringify({
          sanitized_summary: 'Replace faulty ceiling fan regulator switch',
          location_detail: 'Study desk wall switchboard',
          assigned_to_id: 'usr-maint-001',
        }),
      }
    );
    expect(escalateRes.status).toBe(201);
    const escBody = (await escalateRes.json()) as {
      complaint: { escalated_ticket_code: string; status: string };
      maintenance_task: { id: string; ticket_code: string };
    };
    expect(escBody.complaint.status).toBe('IN_PROGRESS');
    expect(escBody.complaint.escalated_ticket_code).toBe(escBody.maintenance_task.ticket_code);

    // Maintenance Staff CAN read the assigned work order, and it contains ZERO Student A PII
    const maintTasksRes = await fetch(`${baseUrl}/api/maintenance/tasks`, {
      headers: { Cookie: maint.cookieHeader },
    });
    expect(maintTasksRes.status).toBe(200);
    const maintTasksBody = (await maintTasksRes.json()) as {
      tasks: Array<Record<string, unknown>>;
    };
    const escalatedTask = maintTasksBody.tasks.find(
      (t) => t.id === escBody.maintenance_task.id
    );
    expect(escalatedTask).toBeTruthy();

    const serializedTask = JSON.stringify(escalatedTask).toLowerCase();
    expect(serializedTask).not.toContain(studentARecord!.name.toLowerCase());
    expect(serializedTask).not.toContain(studentARecord!.email.toLowerCase());
    expect(serializedTask).not.toContain(studentARecord!.student_code.toLowerCase());
  });

  it('enforces gate pass lifecycle & anti-IDOR cancellation, plus strict 4-character ID minimization on the visitor register', async () => {
    const { server, baseUrl, repo } = await startPhase4TestServer();
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

    // 1. Gate pass creation by Student A
    const createGp = await fetch(`${baseUrl}/api/operations/gate-passes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        pass_type: 'OVERNIGHT',
        destination: 'Local Guardian Residence, Pune',
        reason: 'Attending family function over the weekend.',
        departure_at: '2026-04-10T17:00:00.000Z',
        expected_return_at: '2026-04-12T18:00:00.000Z',
        emergency_contact_phone: '+91 98200 11223',
      }),
    });
    expect(createGp.status).toBe(201);
    const gpCreated = (await createGp.json()) as {
      gate_pass: { id: string; status: string; pass_code: string | null };
    };
    expect(gpCreated.gate_pass.status).toBe('PENDING');
    expect(gpCreated.gate_pass.pass_code).toBeNull();

    // Student B cannot cancel Student A's gate pass (403)
    const crossCancel = await fetch(
      `${baseUrl}/api/operations/gate-passes/${encodeURIComponent(gpCreated.gate_pass.id)}/cancel`,
      {
        method: 'POST',
        headers: {
          'X-Requested-With': 'HostelHub',
          Cookie: studentB.cookieHeader,
        },
      }
    );
    expect(crossCancel.status).toBe(403);

    // Admin approves gate pass -> issues GP-2026-XXXX code, marks exit, marks return
    const approveGp = await fetch(
      `${baseUrl}/api/operations/gate-passes/${encodeURIComponent(gpCreated.gate_pass.id)}/review`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: admin.cookieHeader,
        },
        body: JSON.stringify({
          action: 'APPROVE',
          review_note: 'Parent consent verified.',
        }),
      }
    );
    expect(approveGp.status).toBe(200);
    const approvedBody = (await approveGp.json()) as {
      gate_pass: { status: string; pass_code: string };
    };
    expect(approvedBody.gate_pass.status).toBe('APPROVED');
    expect(approvedBody.gate_pass.pass_code).toMatch(/^GP-2026-\d+$/);

    const exitGp = await fetch(
      `${baseUrl}/api/operations/gate-passes/${encodeURIComponent(gpCreated.gate_pass.id)}/review`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: admin.cookieHeader,
        },
        body: JSON.stringify({ action: 'MARK_EXITED' }),
      }
    );
    expect(exitGp.status).toBe(200);
    expect(((await exitGp.json()) as { gate_pass: { status: string } }).gate_pass.status).toBe(
      'CHECKED_OUT_GATE'
    );

    const returnGp = await fetch(
      `${baseUrl}/api/operations/gate-passes/${encodeURIComponent(gpCreated.gate_pass.id)}/review`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: admin.cookieHeader,
        },
        body: JSON.stringify({ action: 'MARK_RETURNED' }),
      }
    );
    expect(returnGp.status).toBe(200);
    expect(((await returnGp.json()) as { gate_pass: { status: string } }).gate_pass.status).toBe(
      'RETURNED'
    );

    // 2. Visitor Register: full Govt ID number (>4 chars) must be rejected (400)
    const badVisitor = await fetch(`${baseUrl}/api/operations/visitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        visitor_name: 'Suresh Kulkarni',
        relation: 'Parent',
        id_type: 'GOVT_ID',
        id_last_four: '123456789012',
        purpose: 'Delivering books',
        scheduled_date: '2026-04-15',
      }),
    });
    expect(badVisitor.status).toBe(400);

    // Valid 4-char id_last_four succeeds (201) and staff can check-in and check-out visitor
    const okVisitor = await fetch(`${baseUrl}/api/operations/visitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        visitor_name: 'Suresh Kulkarni',
        relation: 'Parent',
        id_type: 'GOVT_ID',
        id_last_four: '9012',
        purpose: 'Delivering books',
        scheduled_date: '2026-04-15',
      }),
    });
    expect(okVisitor.status).toBe(201);
    const visCreated = (await okVisitor.json()) as {
      visitor: { id: string; id_last_four: string; status: string };
    };
    expect(visCreated.visitor.id_last_four).toBe('9012');
    expect(visCreated.visitor.status).toBe('SCHEDULED');

    const visIn = await fetch(
      `${baseUrl}/api/operations/visitors/${encodeURIComponent(visCreated.visitor.id)}/status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: admin.cookieHeader,
        },
        body: JSON.stringify({ status: 'CHECKED_IN' }),
      }
    );
    expect(visIn.status).toBe(200);
    expect(((await visIn.json()) as { visitor: { status: string } }).visitor.status).toBe(
      'CHECKED_IN'
    );

    const visOut = await fetch(
      `${baseUrl}/api/operations/visitors/${encodeURIComponent(visCreated.visitor.id)}/status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: admin.cookieHeader,
        },
        body: JSON.stringify({ status: 'CHECKED_OUT' }),
      }
    );
    expect(visOut.status).toBe(200);
    expect(((await visOut.json()) as { visitor: { status: string } }).visitor.status).toBe(
      'CHECKED_OUT'
    );

    // Verify audit trail captured Phase 4 actions
    const logs = await repo.getAuditLogs(50);
    const actions = new Set(logs.map((l) => l.action));
    expect(actions.has('GATE_PASS_REQUESTED')).toBe(true);
    expect(actions.has('GATE_PASS_APPROVE')).toBe(true);
    expect(actions.has('VISITOR_REGISTERED')).toBe(true);
    expect(actions.has('VISITOR_STATUS_UPDATED')).toBe(true);
  });
});

import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiApp } from '../server.ts';
import { InMemoryHostelRepository } from '../lib/repo/memoryRepo.ts';
import { HostelAuthService } from '../lib/auth/authService.ts';
import { MaintenanceTaskService } from '../lib/maintenance/store.ts';
import { StudentVerificationService } from '../lib/integrations/university/student-verification.ts';
import { OfficialUniversityApiProvider } from '../lib/integrations/university/providers/api-provider.ts';
import { DevMockUniversityProvider } from '../lib/integrations/university/providers/authorized-import-provider.ts';
import { InstitutionalInventoryService } from '../lib/inventory/service.ts';
import { PrivateDocumentVaultService } from '../lib/documents/service.ts';

async function startPhase2TestServer() {
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

  const app = createApiApp({
    repo,
    authService,
    maintenanceService,
    verificationService,
    inventoryService,
    documentService,
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
    authService,
    verificationService,
    inventoryService,
    documentService,
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

describe('Phase 2 — University Verification, Bed-Level Inventory & Private Document Vault', () => {
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

  it('strictly blocks DevMockUniversityProvider in production and never fabricates VERIFIED when Official API is unconfigured', async () => {
    const prodMock = new DevMockUniversityProvider({ HOSTELHUB_ENV: 'production' });
    await expect(
      prodMock.verifyStudent({
        studentId: 'stu-001',
        universityStudentCode: 'VV2024CO101',
        universityEmail: 'student.demo@hostelhub.local',
        fullName: 'Rohan Kulkarni',
        academicYear: 3,
        courseBranch: 'Computer Science',
      })
    ).rejects.toThrow(/strictly forbidden in production/i);

    const devMock = new DevMockUniversityProvider({ HOSTELHUB_ENV: 'development' });
    const devResult = await devMock.verifyStudent({
      studentId: 'stu-001',
      universityStudentCode: 'VV2024CO101',
      universityEmail: 'student.demo@hostelhub.local',
      fullName: 'Rohan Kulkarni',
      academicYear: 3,
      courseBranch: 'Computer Science',
    });
    expect(devResult.is_mock_development_record).toBe(true);
    expect(devResult.provider_kind).toBe('dev_mock_only');

    const unconfiguredApi = new OfficialUniversityApiProvider({
      UNIVERSITY_API_BASE_URL: '',
      UNIVERSITY_API_KEY: '',
    });
    const apiRes = await unconfiguredApi.verifyStudent({
      studentId: 'stu-001',
      universityStudentCode: 'VV2024CO101',
      universityEmail: 'student.demo@hostelhub.local',
      fullName: 'Rohan Kulkarni',
      academicYear: 3,
      courseBranch: 'Computer Science',
    });
    expect(apiRes.status).toBe('NEEDS_REVIEW');
    expect(apiRes.is_mock_development_record).toBe(false);
  });

  it('enforces Admin-only SHA-256 verified university roster import and verifies matching students cleanly', async () => {
    const { server, baseUrl, repo } = await startPhase2TestServer();
    activeServer = server;

    const stu001 = (await repo.getStudentById('stu-001'))!;
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
    const student = await loginAs(
      baseUrl,
      'student.demo@hostelhub.local',
      'StudentStrongPassword123',
      'STUDENT'
    );

    const entries = [
      {
        university_student_id: stu001.student_code,
        official_full_name: stu001.name,
        official_email: stu001.email,
        course_branch: stu001.branch,
        academic_year: stu001.year,
        enrollment_status: 'enrolled' as const,
        campus_code: 'CAMPUS-NORTH',
      },
    ];

    // Non-admin (Warden) is blocked from importing official rosters
    const wardenImport = await fetch(`${baseUrl}/api/admin/verification/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: warden.cookieHeader,
      },
      body: JSON.stringify({ source_label: 'Unauthorized Batch', entries }),
    });
    expect(wardenImport.status).toBe(403);

    // Bad SHA-256 checksum is rejected
    const badChecksumImport = await fetch(`${baseUrl}/api/admin/verification/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: admin.cookieHeader,
      },
      body: JSON.stringify({
        source_label: 'Registrar Monsoon 2026',
        expected_sha256: '0'.repeat(64),
        entries,
      }),
    });
    expect(badChecksumImport.status).toBe(400);

    // Valid SHA-256 checksum succeeds
    const validSha = crypto
      .createHash('sha256')
      .update(JSON.stringify(entries))
      .digest('hex');

    const okImport = await fetch(`${baseUrl}/api/admin/verification/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: admin.cookieHeader,
      },
      body: JSON.stringify({
        source_label: 'Registrar Monsoon 2026',
        expected_sha256: validSha,
        entries,
      }),
    });
    expect(okImport.status).toBe(201);

    // Now Student submits verification -> matched against AuthorizedImportProvider (NOT dev mock!)
    const submitRes = await fetch(`${baseUrl}/api/verification/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: student.cookieHeader,
      },
      body: JSON.stringify({ university_student_code: stu001.student_code }),
    });
    expect(submitRes.status).toBe(200);
    const submitJson = (await submitRes.json()) as {
      record: {
        status: string;
        provider_kind: string;
        is_mock_development_record: boolean;
        account_lifecycle: { identity_verified: boolean; hostel_eligible: boolean };
      };
    };
    expect(submitJson.record.status).toBe('VERIFIED');
    expect(submitJson.record.provider_kind).toBe('authorized_roster_import');
    expect(submitJson.record.is_mock_development_record).toBe(false);
    expect(submitJson.record.account_lifecycle.identity_verified).toBe(true);
    expect(submitJson.record.account_lifecycle.hostel_eligible).toBe(true);
  });

  it('derives bed-level inventory, redacts student occupant IDs, enforces occupancy invariants, and restricts Wardens to assigned blocks', async () => {
    const { server, baseUrl, repo, inventoryService } = await startPhase2TestServer();
    activeServer = server;

    // Verify institutional occupancy invariants hold across initial dataset
    const invariantCheck = await inventoryService.verifyOccupancyInvariants();
    expect(invariantCheck.valid).toBe(true);
    expect(invariantCheck.duplicate_student_ids).toHaveLength(0);
    expect(invariantCheck.over_capacity_room_ids).toHaveLength(0);

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

    // Maintenance staff denied from institutional inventory
    const maintHier = await fetch(`${baseUrl}/api/hostels/hierarchy`, {
      headers: { Cookie: maint.cookieHeader },
    });
    expect(maintHier.status).toBe(403);

    // Student receives full hierarchy
    const hierRes = await fetch(`${baseUrl}/api/hostels/hierarchy`, {
      headers: { Cookie: student.cookieHeader },
    });
    expect(hierRes.status).toBe(200);
    const hier = (await hierRes.json()) as {
      totals: { campuses: number; hostels: number; blocks: number; beds: number };
    };
    expect(hier.totals.campuses).toBe(2);
    expect(hier.totals.hostels).toBe(4);
    expect(hier.totals.blocks).toBe(4);
    expect(hier.totals.beds).toBeGreaterThan(200);

    // Pick an occupied room in Nilgiri (assigned to warden.demo) and an unassigned room in Vindhya
    const allRooms = await repo.getRooms();
    const nilgiriOccupiedRoom = allRooms.find(
      (r) => r.block_id === 'blk-nilgiri' && r.occupants.length > 0
    )!;
    const nilgiriRoomWithFreeBed = allRooms.find(
      (r) => r.block_id === 'blk-nilgiri' && r.occupants.length < r.capacity
    )!;
    const vindhyaRoom = allRooms.find((r) => r.block_id === 'blk-vindhya')!;

    // Student viewing bed register sees is_occupied=true but occupant_student_id/code redacted to null
    const studentBedsRes = await fetch(
      `${baseUrl}/api/hostels/rooms/${nilgiriOccupiedRoom.id}/beds`,
      { headers: { Cookie: student.cookieHeader } }
    );
    expect(studentBedsRes.status).toBe(200);
    const studentBedsJson = (await studentBedsRes.json()) as {
      beds: Array<{
        id: string;
        is_occupied: boolean;
        occupant_student_id: string | null;
        occupant_student_code: string | null;
      }>;
    };
    const occupiedBedForStudent = studentBedsJson.beds.find((b) => b.is_occupied)!;
    expect(occupiedBedForStudent).toBeDefined();
    expect(occupiedBedForStudent.occupant_student_id).toBeNull();
    expect(occupiedBedForStudent.occupant_student_code).toBeNull();

    // Scoped Warden viewing assigned block sees occupant_student_code
    const wardenBedsRes = await fetch(
      `${baseUrl}/api/hostels/rooms/${nilgiriOccupiedRoom.id}/beds`,
      { headers: { Cookie: warden.cookieHeader } }
    );
    expect(wardenBedsRes.status).toBe(200);
    const wardenBedsJson = (await wardenBedsRes.json()) as {
      beds: Array<{ id: string; is_occupied: boolean; occupant_student_code: string | null }>;
    };
    expect(wardenBedsJson.beds.find((b) => b.is_occupied)!.occupant_student_code).toBeTruthy();

    // Hard invariant: Cannot mark an occupied bed as MAINTENANCE (409)
    const occupiedBedId = wardenBedsJson.beds.find((b) => b.is_occupied)!.id;
    const overrideOccupied = await fetch(
      `${baseUrl}/api/hostels/beds/${occupiedBedId}/status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: warden.cookieHeader,
        },
        body: JSON.stringify({
          status: 'MAINTENANCE',
          reason: 'Attempting illegal override of occupied bed',
        }),
      }
    );
    expect(overrideOccupied.status).toBe(409);

    // Scoped Warden CAN mark a free bed in assigned Nilgiri block as RESERVED
    const freeRoomDetail = await inventoryService.getRoomBeds(
      nilgiriRoomWithFreeBed.id,
      (await Promise.resolve({
        id: 'usr-warden-001',
        role: 'WARDEN',
        status: 'active',
        assigned_block_ids: ['blk-nilgiri', 'blk-kaveri'],
      })) as never
    );
    const freeBed = freeRoomDetail.beds.find((b) => !b.is_occupied)!;
    const reserveFreeBed = await fetch(`${baseUrl}/api/hostels/beds/${freeBed.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: warden.cookieHeader,
      },
      body: JSON.stringify({
        status: 'RESERVED',
        reason: 'Reserved for incoming exchange scholar',
      }),
    });
    expect(reserveFreeBed.status).toBe(200);

    // Warden CANNOT update room status in unassigned Vindhya block (403)
    const crossBlockUpdate = await fetch(
      `${baseUrl}/api/hostels/rooms/${vindhyaRoom.id}/status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'HostelHub',
          Cookie: warden.cookieHeader,
        },
        body: JSON.stringify({
          status: 'UNDER_MAINTENANCE',
          reason: 'Cross-block unauthorized change attempt',
        }),
      }
    );
    expect(crossBlockUpdate.status).toBe(403);
  });

  it('secures private student documents with MIME/size caps, user-bound HMAC signed links, IDOR blocking, and MAINTENANCE_STAFF denial', async () => {
    const { server, baseUrl } = await startPhase2TestServer();
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

    // 1. Disallowed MIME type rejected (400)
    const badMime = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        category: 'identity_document',
        filename: 'exploit.html',
        mime_type: 'text/html',
        content_base64: Buffer.from('<script>alert(1)</script>').toString('base64'),
      }),
    });
    expect(badMime.status).toBe(400);

    // 2. Oversized > 5 MB file rejected (413)
    const oversizedBuf = Buffer.alloc(5 * 1024 * 1024 + 128, 65);
    const tooBig = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        category: 'enrollment_proof',
        filename: 'huge.pdf',
        mime_type: 'application/pdf',
        content_base64: oversizedBuf.toString('base64'),
      }),
    });
    expect(tooBig.status).toBe(413);

    // 3. Valid upload by Student A with path traversal filename sanitized
    const samplePdf = Buffer.from('%PDF-1.4\nHostelHub Private Doc Test\n', 'utf8');
    const uploadRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
      body: JSON.stringify({
        category: 'identity_document',
        filename: '../../etc/passwd_id_card.pdf',
        mime_type: 'application/pdf',
        content_base64: samplePdf.toString('base64'),
      }),
    });
    expect(uploadRes.status).toBe(201);
    const uploadJson = (await uploadRes.json()) as {
      document: { id: string; sanitized_filename: string; private_storage_path: string };
    };
    const docId = uploadJson.document.id;
    expect(uploadJson.document.sanitized_filename).not.toContain('..');
    expect(uploadJson.document.sanitized_filename).not.toContain('/');
    expect(uploadJson.document.private_storage_path).toMatch(/^private\/students\/stu-001\//);

    // 4. Student A gets signed URL and downloads successfully
    const signedRes = await fetch(`${baseUrl}/api/documents/${docId}/signed-url`, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'HostelHub',
        Cookie: studentA.cookieHeader,
      },
    });
    expect(signedRes.status).toBe(200);
    const signedJson = (await signedRes.json()) as { token: string; download_url: string };

    const downloadOk = await fetch(`${baseUrl}${signedJson.download_url}`, {
      headers: { Cookie: studentA.cookieHeader },
    });
    expect(downloadOk.status).toBe(200);
    expect(downloadOk.headers.get('cache-control')).toContain('no-store');
    expect(downloadOk.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await downloadOk.text()).toContain('HostelHub Private Doc Test');

    // 5. Cross-student IDOR blocked: Student B cannot sign OR redeem Student A's token
    const idorSign = await fetch(`${baseUrl}/api/documents/${docId}/signed-url`, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'HostelHub',
        Cookie: studentB.cookieHeader,
      },
    });
    expect(idorSign.status).toBe(403);

    const idorRedeem = await fetch(`${baseUrl}${signedJson.download_url}`, {
      headers: { Cookie: studentB.cookieHeader },
    });
    expect(idorRedeem.status).toBe(403);

    // 6. Tampered token signature rejected (401)
    const tampered = await fetch(
      `${baseUrl}/api/documents/download?token=${encodeURIComponent(signedJson.token + 'tamper')}`,
      { headers: { Cookie: studentA.cookieHeader } }
    );
    expect(tampered.status).toBe(401);

    // 7. MAINTENANCE_STAFF strictly blocked (403)
    const maintList = await fetch(`${baseUrl}/api/documents`, {
      headers: { Cookie: maint.cookieHeader },
    });
    expect(maintList.status).toBe(403);

    // 8. Admin can review and verify Student A's document
    const adminReview = await fetch(`${baseUrl}/api/documents/${docId}/review`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'HostelHub',
        Cookie: admin.cookieHeader,
      },
      body: JSON.stringify({
        status: 'VERIFIED',
        note: 'Verified against institutional ID checklist.',
      }),
    });
    expect(adminReview.status).toBe(200);
    const reviewedJson = (await adminReview.json()) as {
      document: { review_status: string; reviewed_by: string };
    };
    expect(reviewedJson.document.review_status).toBe('VERIFIED');
    expect(reviewedJson.document.reviewed_by).toBe('admin.demo@hostelhub.local');
  });
});

import crypto from 'node:crypto';
import type { AuthUserProfile } from '../../auth/roles.ts';
import { resolveDeploymentEnvironment } from '../../config/env.ts';
import {
  type StudentVerificationRequest,
  type UniversityVerificationProvider,
  type VerificationProviderKind,
  type VerificationStatus,
  type VerifiedInstitutionalAttributes,
} from './university-provider.ts';
import { OfficialUniversityApiProvider } from './providers/api-provider.ts';
import {
  AuthorizedImportProvider,
  type AuthorizedRosterEntry,
  DevMockUniversityProvider,
  type RosterImportBatch,
} from './providers/authorized-import-provider.ts';

export interface VerificationHistoryEntry {
  id: string;
  student_id: string;
  university_student_id: string;
  status: VerificationStatus;
  provider_kind: VerificationProviderKind;
  provider_name: string;
  provider_reference: string | null;
  is_mock_development_record: boolean;
  reason: string;
  reviewed_by: string | null;
  timestamp: string;
}

export interface StudentVerificationRecord {
  student_id: string;
  university_student_id: string;
  status: VerificationStatus;
  provider_kind: VerificationProviderKind;
  provider_name: string;
  provider_reference: string | null;
  is_mock_development_record: boolean;
  verified_attributes: VerifiedInstitutionalAttributes | null;
  reason: string;
  account_lifecycle: {
    authenticated: boolean;
    identity_verified: boolean;
    account_activated: boolean;
    hostel_eligible: boolean;
    application_approved: boolean;
  };
  updated_at: string;
  history: VerificationHistoryEntry[];
}

/**
 * Student Verification Orchestration Service
 * ==========================================
 * Separates authentication, university identity verification, account activation,
 * and hostel eligibility. Dispatches verification to:
 *   1. OfficialUniversityApiProvider (when configured)
 *   2. AuthorizedImportProvider (when an admin-imported roster exists)
 *   3. DevMockUniversityProvider (strictly development/staging only; NEVER production)
 */
export class StudentVerificationService {
  private readonly records = new Map<string, StudentVerificationRecord>();
  public readonly apiProvider: OfficialUniversityApiProvider;
  public readonly importProvider: AuthorizedImportProvider;
  public readonly devMockProvider: DevMockUniversityProvider;
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
    this.apiProvider = new OfficialUniversityApiProvider(env);
    this.importProvider = new AuthorizedImportProvider();
    this.devMockProvider = new DevMockUniversityProvider(env);

    // Seed synthetic initial verification state for demo student stu-001 (explicitly flagged as dev mock)
    if (resolveDeploymentEnvironment(env) !== 'production') {
      this.seedDevelopmentRecords();
    }
  }

  private seedDevelopmentRecords(): void {
    const now = '2026-07-16T09:15:00.000Z';
    const seedEntry: VerificationHistoryEntry = {
      id: 'ver-hist-seed-001',
      student_id: 'stu-001',
      university_student_id: 'VV2024CO101',
      status: 'VERIFIED',
      provider_kind: 'dev_mock_only',
      provider_name: this.devMockProvider.name,
      provider_reference: 'DEV-MOCK-VV2024CO101',
      is_mock_development_record: true,
      reason:
        '[DEV MOCK ONLY] Synthetic development verification record. Connect official University SIS before production.',
      reviewed_by: null,
      timestamp: now,
    };

    this.records.set('stu-001', {
      student_id: 'stu-001',
      university_student_id: 'VV2024CO101',
      status: 'VERIFIED',
      provider_kind: 'dev_mock_only',
      provider_name: this.devMockProvider.name,
      provider_reference: 'DEV-MOCK-VV2024CO101',
      is_mock_development_record: true,
      verified_attributes: {
        university_student_id: 'VV2024CO101',
        official_full_name: 'Rohan Kulkarni',
        official_email: 'student.demo@hostelhub.local',
        course_branch: 'Computer Science',
        academic_year: 3,
        enrollment_status: 'enrolled',
        campus_code: 'CAMPUS-NORTH',
      },
      reason: seedEntry.reason,
      account_lifecycle: {
        authenticated: true,
        identity_verified: true,
        account_activated: true,
        hostel_eligible: true,
        application_approved: true,
      },
      updated_at: now,
      history: [seedEntry],
    });
  }

  public getActiveProvider(): UniversityVerificationProvider {
    if (this.apiProvider.isConfigured()) {
      return this.apiProvider;
    }
    if (this.importProvider.isConfigured()) {
      return this.importProvider;
    }
    if (resolveDeploymentEnvironment(this.env) === 'production') {
      // Never fall back to mock in production
      return this.apiProvider;
    }
    return this.devMockProvider;
  }

  public getProviderSummary() {
    const active = this.getActiveProvider();
    return {
      environment: resolveDeploymentEnvironment(this.env),
      active_provider_kind: active.kind,
      active_provider_name: active.name,
      is_mock_development_provider: active.isMockDevelopmentProvider,
      official_api_configured: this.apiProvider.isConfigured(),
      imported_roster_count: this.importProvider.getRosterCount(),
      import_batches: this.importProvider.listImportBatches(),
    };
  }

  public getRecordForStudent(
    studentId: string,
    fallbackStudentCode = '',
    hasActiveAllotment = false
  ): StudentVerificationRecord {
    const existing = this.records.get(studentId);
    if (existing) {
      return structuredClone(existing);
    }
    return {
      student_id: studentId,
      university_student_id: fallbackStudentCode,
      status: 'PENDING',
      provider_kind: this.getActiveProvider().kind,
      provider_name: this.getActiveProvider().name,
      provider_reference: null,
      is_mock_development_record: this.getActiveProvider().isMockDevelopmentProvider,
      verified_attributes: null,
      reason: 'University enrollment verification has not been submitted yet.',
      account_lifecycle: {
        authenticated: true,
        identity_verified: false,
        account_activated: true,
        hostel_eligible: false,
        application_approved: hasActiveAllotment,
      },
      updated_at: new Date().toISOString(),
      history: [],
    };
  }

  public listAllRecords(): StudentVerificationRecord[] {
    return Array.from(this.records.values())
      .map((r) => structuredClone(r))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  public async submitVerification(
    request: StudentVerificationRequest
  ): Promise<StudentVerificationRecord> {
    const provider = this.getActiveProvider();
    const result = await provider.verifyStudent(request);
    const existing = this.records.get(request.studentId);

    const historyEntry: VerificationHistoryEntry = {
      id: `ver-${crypto.randomUUID().slice(0, 8)}`,
      student_id: request.studentId,
      university_student_id: request.universityStudentCode.trim().toUpperCase(),
      status: result.status,
      provider_kind: result.provider_kind,
      provider_name: result.provider_name,
      provider_reference: result.provider_reference,
      is_mock_development_record: result.is_mock_development_record,
      reason: result.reason,
      reviewed_by: null,
      timestamp: result.checked_at,
    };

    const isVerified = result.status === 'VERIFIED';
    const record: StudentVerificationRecord = {
      student_id: request.studentId,
      university_student_id: request.universityStudentCode.trim().toUpperCase(),
      status: result.status,
      provider_kind: result.provider_kind,
      provider_name: result.provider_name,
      provider_reference: result.provider_reference,
      is_mock_development_record: result.is_mock_development_record,
      verified_attributes: result.verified_attributes,
      reason: result.reason,
      account_lifecycle: {
        authenticated: true,
        identity_verified: isVerified,
        account_activated: true,
        hostel_eligible: isVerified,
        application_approved: existing?.account_lifecycle.application_approved ?? false,
      },
      updated_at: result.checked_at,
      history: [historyEntry, ...(existing?.history ?? [])],
    };

    this.records.set(request.studentId, record);
    return structuredClone(record);
  }

  public reviewVerificationException(
    actor: AuthUserProfile,
    params: {
      studentId: string;
      universityStudentCode: string;
      decision: VerificationStatus;
      reason: string;
    }
  ): StudentVerificationRecord {
    if (actor.role !== 'ADMIN' && actor.role !== 'WARDEN') {
      throw new Error('Only authorized Administrators or Wardens may review verification exceptions.');
    }

    const now = new Date().toISOString();
    const existing = this.records.get(params.studentId);
    const historyEntry: VerificationHistoryEntry = {
      id: `ver-rev-${crypto.randomUUID().slice(0, 8)}`,
      student_id: params.studentId,
      university_student_id: params.universityStudentCode.trim().toUpperCase(),
      status: params.decision,
      provider_kind: 'manual_exception',
      provider_name: 'Authorized Institutional Exception Review',
      provider_reference: `MANUAL-${actor.id}-${Date.now()}`,
      is_mock_development_record: false,
      reason: params.reason.trim(),
      reviewed_by: actor.email,
      timestamp: now,
    };

    const isVerified = params.decision === 'VERIFIED';
    const record: StudentVerificationRecord = {
      student_id: params.studentId,
      university_student_id: params.universityStudentCode.trim().toUpperCase(),
      status: params.decision,
      provider_kind: 'manual_exception',
      provider_name: 'Authorized Institutional Exception Review',
      provider_reference: historyEntry.provider_reference,
      is_mock_development_record: false,
      verified_attributes: existing?.verified_attributes ?? null,
      reason: params.reason.trim(),
      account_lifecycle: {
        authenticated: true,
        identity_verified: isVerified,
        account_activated: params.decision !== 'SUSPENDED',
        hostel_eligible: isVerified,
        application_approved: existing?.account_lifecycle.application_approved ?? false,
      },
      updated_at: now,
      history: [historyEntry, ...(existing?.history ?? [])],
    };

    this.records.set(params.studentId, record);
    return structuredClone(record);
  }

  public importInstitutionalRoster(
    actor: AuthUserProfile,
    params: {
      sourceLabel: string;
      entries: AuthorizedRosterEntry[];
      expectedSha256?: string;
    }
  ): RosterImportBatch {
    if (actor.role !== 'ADMIN') {
      throw new Error('Only Administrators may import official university student rosters.');
    }
    return this.importProvider.importRosterBatch({
      importedBy: actor.email,
      sourceLabel: params.sourceLabel,
      entries: params.entries,
      expectedSha256: params.expectedSha256,
    });
  }
}

let sharedVerificationService: StudentVerificationService | null = null;

export function getVerificationService(): StudentVerificationService {
  if (!sharedVerificationService) {
    sharedVerificationService = new StudentVerificationService();
  }
  return sharedVerificationService;
}

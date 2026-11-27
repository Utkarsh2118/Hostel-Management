import crypto from 'node:crypto';
import {
  type StudentVerificationRequest,
  type UniversityVerificationProvider,
  type VerificationProviderResult,
  type VerifiedInstitutionalAttributes,
} from '../university-provider.ts';
import { resolveDeploymentEnvironment } from '../../../config/env.ts';

export interface AuthorizedRosterEntry {
  university_student_id: string;
  official_full_name: string;
  official_email: string;
  course_branch: string;
  academic_year: 1 | 2 | 3 | 4;
  enrollment_status: 'enrolled' | 'leave' | 'graduated' | 'suspended';
  campus_code: string;
}

export interface RosterImportBatch {
  batch_id: string;
  imported_by: string;
  imported_at: string;
  record_count: number;
  sha256_checksum: string;
  source_label: string;
}

/**
 * Controlled Institutional Roster Import Provider
 * ===============================================
 * Supports signed/checksum-verified official student roster batches imported
 * strictly by an authenticated Administrator (for universities without a live SIS API).
 */
export class AuthorizedImportProvider implements UniversityVerificationProvider {
  public readonly kind = 'authorized_roster_import' as const;
  public readonly name = 'Authorized Institutional Roster Import';
  public readonly isMockDevelopmentProvider = false;

  private readonly roster = new Map<string, AuthorizedRosterEntry>();
  private readonly batches: RosterImportBatch[] = [];

  public isConfigured(): boolean {
    return this.roster.size > 0;
  }

  public importRosterBatch(params: {
    importedBy: string;
    sourceLabel: string;
    entries: AuthorizedRosterEntry[];
    expectedSha256?: string;
  }): RosterImportBatch {
    const canonical = JSON.stringify(params.entries);
    const computedChecksum = crypto.createHash('sha256').update(canonical).digest('hex');

    if (params.expectedSha256 && params.expectedSha256.trim().toLowerCase() !== computedChecksum) {
      throw new Error('Roster import checksum mismatch. File integrity verification failed.');
    }

    for (const entry of params.entries) {
      this.roster.set(entry.university_student_id.trim().toUpperCase(), {
        ...entry,
        university_student_id: entry.university_student_id.trim().toUpperCase(),
        official_email: entry.official_email.trim().toLowerCase(),
      });
    }

    const batch: RosterImportBatch = {
      batch_id: `IMP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      imported_by: params.importedBy,
      imported_at: new Date().toISOString(),
      record_count: params.entries.length,
      sha256_checksum: computedChecksum,
      source_label: params.sourceLabel,
    };
    this.batches.unshift(batch);
    return batch;
  }

  public listImportBatches(): RosterImportBatch[] {
    return structuredClone(this.batches);
  }

  public getRosterCount(): number {
    return this.roster.size;
  }

  public async verifyStudent(
    request: StudentVerificationRequest
  ): Promise<VerificationProviderResult> {
    const checkedAt = new Date().toISOString();
    const code = request.universityStudentCode.trim().toUpperCase();
    const entry = this.roster.get(code);

    if (!entry) {
      return {
        status: 'NEEDS_REVIEW',
        provider_kind: this.kind,
        provider_name: this.name,
        provider_reference: null,
        is_mock_development_record: false,
        reason:
          'Student ID was not found in the latest authorized institutional roster import. Escalated for review.',
        verified_attributes: null,
        checked_at: checkedAt,
      };
    }

    if (entry.official_email !== request.universityEmail.trim().toLowerCase()) {
      return {
        status: 'NEEDS_REVIEW',
        provider_kind: this.kind,
        provider_name: this.name,
        provider_reference: `ROSTER-${code}`,
        is_mock_development_record: false,
        reason:
          'Submitted email does not match the official university email in the imported roster.',
        verified_attributes: null,
        checked_at: checkedAt,
      };
    }

    if (entry.enrollment_status === 'suspended') {
      return {
        status: 'SUSPENDED',
        provider_kind: this.kind,
        provider_name: this.name,
        provider_reference: `ROSTER-${code}`,
        is_mock_development_record: false,
        reason: 'University enrollment status is SUSPENDED in the institutional roster.',
        verified_attributes: null,
        checked_at: checkedAt,
      };
    }

    if (entry.enrollment_status !== 'enrolled') {
      return {
        status: 'REJECTED',
        provider_kind: this.kind,
        provider_name: this.name,
        provider_reference: `ROSTER-${code}`,
        is_mock_development_record: false,
        reason: `Student enrollment status is '${entry.enrollment_status}', not active 'enrolled'.`,
        verified_attributes: null,
        checked_at: checkedAt,
      };
    }

    return {
      status: 'VERIFIED',
      provider_kind: this.kind,
      provider_name: this.name,
      provider_reference: `ROSTER-${code}`,
      is_mock_development_record: false,
      reason: 'Matched active enrollment record in administrator-imported university roster.',
      verified_attributes: structuredClone(entry),
      checked_at: checkedAt,
    };
  }
}

/**
 * Development-Only Mock University Verification Provider
 * ======================================================
 * Strictly disabled in production (`HOSTELHUB_ENV === 'production'`).
 * Every result carries `is_mock_development_record: true` so mock checks are
 * NEVER presented as real university verification.
 */
export class DevMockUniversityProvider implements UniversityVerificationProvider {
  public readonly kind = 'dev_mock_only' as const;
  public readonly name = 'Development Mock University Provider (Non-Production Only)';
  public readonly isMockDevelopmentProvider = true;

  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
  }

  public isConfigured(): boolean {
    return resolveDeploymentEnvironment(this.env) !== 'production';
  }

  public async verifyStudent(
    request: StudentVerificationRequest
  ): Promise<VerificationProviderResult> {
    const checkedAt = new Date().toISOString();

    if (resolveDeploymentEnvironment(this.env) === 'production') {
      throw new Error(
        'DevMockUniversityProvider is strictly forbidden in production mode. Configure OfficialUniversityApiProvider or AuthorizedImportProvider.'
      );
    }

    const code = request.universityStudentCode.trim().toUpperCase();
    // Deterministic synthetic rules for development testing:
    // - Codes matching /^VV20\d{2}[A-Z]{2}\d{3,4}$/ verify in dev mock mode
    // - Codes containing "SUSP" return SUSPENDED
    // - Codes containing "REV" return NEEDS_REVIEW
    if (code.includes('SUSP')) {
      return {
        status: 'SUSPENDED',
        provider_kind: this.kind,
        provider_name: this.name,
        provider_reference: `DEV-MOCK-${code}`,
        is_mock_development_record: true,
        reason: '[DEV MOCK ONLY] Synthetic suspended enrollment test record.',
        verified_attributes: null,
        checked_at: checkedAt,
      };
    }

    if (code.includes('REV')) {
      return {
        status: 'NEEDS_REVIEW',
        provider_kind: this.kind,
        provider_name: this.name,
        provider_reference: `DEV-MOCK-${code}`,
        is_mock_development_record: true,
        reason: '[DEV MOCK ONLY] Routed for manual institutional exception review.',
        verified_attributes: null,
        checked_at: checkedAt,
      };
    }

    if (/^VV20\d{2}[A-Z]{2}\d{3,4}$/.test(code)) {
      const attrs: VerifiedInstitutionalAttributes = {
        university_student_id: code,
        official_full_name: request.fullName,
        official_email: request.universityEmail.trim().toLowerCase(),
        course_branch: request.courseBranch,
        academic_year: request.academicYear,
        enrollment_status: 'enrolled',
        campus_code: request.academicYear <= 2 ? 'CAMPUS-NORTH' : 'CAMPUS-SOUTH',
      };
      return {
        status: 'VERIFIED',
        provider_kind: this.kind,
        provider_name: this.name,
        provider_reference: `DEV-MOCK-${code}`,
        is_mock_development_record: true,
        reason:
          '[DEV MOCK ONLY] Matched synthetic development student ID format. Not an official university SIS verification.',
        verified_attributes: attrs,
        checked_at: checkedAt,
      };
    }

    return {
      status: 'REJECTED',
      provider_kind: this.kind,
      provider_name: this.name,
      provider_reference: `DEV-MOCK-${code}`,
      is_mock_development_record: true,
      reason:
        '[DEV MOCK ONLY] Student ID did not match synthetic format (e.g., VV2024CO101). Submit a manual review request if applicable.',
      verified_attributes: null,
      checked_at: checkedAt,
    };
  }
}

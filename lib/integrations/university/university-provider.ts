/**
 * HostelHub — University Student Verification Provider Contract
 * =============================================================
 * The university is the sole authority for student identity and enrollment.
 * Ordinary email confirmation is NOT proof of enrollment.
 */

export type VerificationStatus =
  | 'PENDING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'NEEDS_REVIEW'
  | 'EXPIRED'
  | 'SUSPENDED';

export type VerificationProviderKind =
  | 'official_university_api'
  | 'authorized_roster_import'
  | 'manual_exception'
  | 'dev_mock_only';

export interface StudentVerificationRequest {
  studentId: string;
  universityStudentCode: string;
  universityEmail: string;
  fullName: string;
  academicYear: 1 | 2 | 3 | 4;
  courseBranch: string;
}

export interface VerifiedInstitutionalAttributes {
  university_student_id: string;
  official_full_name: string;
  official_email: string;
  course_branch: string;
  academic_year: 1 | 2 | 3 | 4;
  enrollment_status: 'enrolled' | 'leave' | 'graduated' | 'suspended';
  campus_code: string;
}

export interface VerificationProviderResult {
  status: VerificationStatus;
  provider_kind: VerificationProviderKind;
  provider_name: string;
  provider_reference: string | null;
  is_mock_development_record: boolean;
  reason: string;
  verified_attributes: VerifiedInstitutionalAttributes | null;
  checked_at: string;
}

export interface UniversityVerificationProvider {
  readonly kind: VerificationProviderKind;
  readonly name: string;
  readonly isMockDevelopmentProvider: boolean;
  isConfigured(): boolean;
  verifyStudent(request: StudentVerificationRequest): Promise<VerificationProviderResult>;
}

import {
  type StudentVerificationRequest,
  type UniversityVerificationProvider,
  type VerificationProviderResult,
} from '../university-provider.ts';

/**
 * Official University SIS API Provider
 * ====================================
 * Connects exclusively to a university-supplied HTTPS verification endpoint
 * configured via server-side environment variables:
 *   - UNIVERSITY_API_BASE_URL
 *   - UNIVERSITY_API_KEY (or UNIVERSITY_API_CLIENT_ID + UNIVERSITY_API_CLIENT_SECRET)
 *
 * Never invents an endpoint or fabricates a VERIFIED result when credentials are absent.
 */
export class OfficialUniversityApiProvider implements UniversityVerificationProvider {
  public readonly kind = 'official_university_api' as const;
  public readonly name = 'Official University SIS Verification API';
  public readonly isMockDevelopmentProvider = false;

  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
  }

  public isConfigured(): boolean {
    const baseUrl = this.env.UNIVERSITY_API_BASE_URL?.trim();
    const hasKey = Boolean(this.env.UNIVERSITY_API_KEY?.trim());
    const hasClient = Boolean(
      this.env.UNIVERSITY_API_CLIENT_ID?.trim() && this.env.UNIVERSITY_API_CLIENT_SECRET?.trim()
    );
    if (!baseUrl || (!hasKey && !hasClient)) return false;
    try {
      const parsed = new URL(baseUrl);
      return parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  public async verifyStudent(
    request: StudentVerificationRequest
  ): Promise<VerificationProviderResult> {
    const checkedAt = new Date().toISOString();

    if (!this.isConfigured()) {
      return {
        status: 'NEEDS_REVIEW',
        provider_kind: this.kind,
        provider_name: this.name,
        provider_reference: null,
        is_mock_development_record: false,
        reason:
          'Official university SIS API credentials are not configured. Contact university IT or use an authorized signed roster import.',
        verified_attributes: null,
        checked_at: checkedAt,
      };
    }

    const baseUrl = this.env.UNIVERSITY_API_BASE_URL!.trim().replace(/\/+$/, '');
    const parsedUrl = new URL(`${baseUrl}/students/verify`);

    // Block loopback / private metadata targets against SSRF
    const host = parsedUrl.hostname.toLowerCase();
    if (
      parsedUrl.protocol !== 'https:' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '169.254.169.254' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      throw new Error('Configured UNIVERSITY_API_BASE_URL violates HTTPS/external host security policy.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.env.UNIVERSITY_API_KEY?.trim()) {
      headers['Authorization'] = `Bearer ${this.env.UNIVERSITY_API_KEY.trim()}`;
    } else {
      headers['X-University-Client-Id'] = this.env.UNIVERSITY_API_CLIENT_ID!.trim();
      headers['X-University-Client-Secret'] = this.env.UNIVERSITY_API_CLIENT_SECRET!.trim();
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(parsedUrl.toString(), {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          student_id: request.universityStudentCode,
          university_email: request.universityEmail,
        }),
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return {
          status: 'NEEDS_REVIEW',
          provider_kind: this.kind,
          provider_name: this.name,
          provider_reference: null,
          is_mock_development_record: false,
          reason: `University SIS verification service returned HTTP ${response.status}. Routed for manual review.`,
          verified_attributes: null,
          checked_at: checkedAt,
        };
      }

      const payload = (await response.json()) as {
        verified?: boolean;
        reference_id?: string;
        enrollment_status?: 'enrolled' | 'leave' | 'graduated' | 'suspended';
        official_name?: string;
        course_branch?: string;
        academic_year?: number;
        campus_code?: string;
      };

      if (!payload.verified || payload.enrollment_status !== 'enrolled') {
        return {
          status: payload.enrollment_status === 'suspended' ? 'SUSPENDED' : 'REJECTED',
          provider_kind: this.kind,
          provider_name: this.name,
          provider_reference: payload.reference_id ?? null,
          is_mock_development_record: false,
          reason: 'University SIS did not confirm active enrollment for the submitted identifier.',
          verified_attributes: null,
          checked_at: checkedAt,
        };
      }

      const year =
        payload.academic_year === 1 ||
        payload.academic_year === 2 ||
        payload.academic_year === 3 ||
        payload.academic_year === 4
          ? payload.academic_year
          : request.academicYear;

      return {
        status: 'VERIFIED',
        provider_kind: this.kind,
        provider_name: this.name,
        provider_reference: payload.reference_id ?? `SIS-${request.universityStudentCode}`,
        is_mock_development_record: false,
        reason: 'Verified against official University Student Information System.',
        verified_attributes: {
          university_student_id: request.universityStudentCode,
          official_full_name: payload.official_name ?? request.fullName,
          official_email: request.universityEmail,
          course_branch: payload.course_branch ?? request.courseBranch,
          academic_year: year,
          enrollment_status: 'enrolled',
          campus_code: payload.campus_code ?? 'CAMPUS-MAIN',
        },
        checked_at: checkedAt,
      };
    } catch {
      return {
        status: 'NEEDS_REVIEW',
        provider_kind: this.kind,
        provider_name: this.name,
        provider_reference: null,
        is_mock_development_record: false,
        reason: 'Unable to reach official University SIS endpoint. Verification queued for review.',
        verified_attributes: null,
        checked_at: checkedAt,
      };
    }
  }
}

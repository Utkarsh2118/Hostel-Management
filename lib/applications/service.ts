import crypto from 'node:crypto';
import type { AuthUserProfile } from '../auth/roles.ts';
import { canAccessBlock } from '../auth/permissions.ts';
import type { IHostelRepository } from '../repo/interface.ts';
import type { StudentVerificationService } from '../integrations/university/student-verification.ts';
import type { InstitutionalInventoryService } from '../inventory/service.ts';
import { isGenderCompatibleWithBlock } from '../allotment/engine.ts';
import { seededTieBreaker } from '../utils/prng.ts';
import type { Block, CgpaBand, Room, Student } from '../types.ts';

export type ApplicationCycleStatus = 'UPCOMING' | 'OPEN' | 'CLOSED' | 'ALLOTTED' | 'ARCHIVED';

export type ApplicationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'ELIGIBLE'
  | 'WAITLISTED'
  | 'ALLOTTED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'REJECTED'
  | 'WITHDRAWN';

export interface CyclePolicyRules {
  policy_version: string;
  require_university_verification: boolean;
  enforce_gender_separation: boolean;
  eligible_years: Array<1 | 2 | 3 | 4>;
  max_ranked_preferences: number;
  year_weight: number;
  merit_weight: number;
  distance_weight_per_100km: number;
  accessibility_priority_bonus: number;
}

export interface AllotmentCycle {
  id: string;
  code: string;
  title: string;
  academic_term: string;
  status: ApplicationCycleStatus;
  opens_at: string;
  closes_at: string;
  policy: CyclePolicyRules;
  created_by: string;
  created_at: string;
  last_run_id: string | null;
}

export interface EligibilityRuleCheck {
  rule_code: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface EligibilityEvaluation {
  eligible: boolean;
  policy_version: string;
  computed_priority_score: number;
  score_breakdown: {
    year_points: number;
    merit_points: number;
    distance_points: number;
    accessibility_points: number;
  };
  checks: EligibilityRuleCheck[];
  evaluated_at: string;
}

export interface ApplicationAllotmentResult {
  run_id: string;
  cycle_id: string;
  room_id: string;
  room_label: string;
  block_id: string;
  block_name: string;
  floor: number;
  bed_id: string;
  bed_label: string;
  preference_rank: number | null;
  allotted_via: 'preference' | 'accessibility_priority' | 'fallback' | 'manual_override';
  priority_score: number;
  tie_breaker: number;
  explanation: string;
  assigned_at: string;
  slip_checksum: string;
}

export interface HostelApplication {
  id: string;
  cycle_id: string;
  student_id: string;
  student_code: string;
  student_name: string;
  student_gender: Student['gender'];
  student_year: 1 | 2 | 3 | 4;
  student_branch: string;
  status: ApplicationStatus;
  preferred_room_ids: string[];
  preferred_ac: boolean | null;
  preferred_capacity: 1 | 2 | 3 | 4 | null;
  home_distance_km: number;
  accessibility_requested: boolean;
  accessibility_verified: boolean;
  accessibility_note: string | null;
  declaration_accepted: boolean;
  eligibility: EligibilityEvaluation;
  waitlist_position: number | null;
  waitlist_reason: string | null;
  allotment: ApplicationAllotmentResult | null;
  reviewer_email: string | null;
  review_note: string | null;
  submitted_at: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CycleAllotmentRunSummary {
  run_id: string;
  cycle_id: string;
  seed: string;
  policy_version: string;
  dry_run: boolean;
  committed: boolean;
  executed_by: string;
  executed_at: string;
  total_eligible_applicants: number;
  allotted_count: number;
  waitlisted_count: number;
  first_choice_count: number;
  accessibility_honored_count: number;
  decisions: Array<{
    application_id: string;
    student_id: string;
    student_code: string;
    student_name: string;
    outcome: 'ALLOTTED' | 'WAITLISTED';
    priority_score: number;
    tie_breaker: number;
    room_label: string | null;
    bed_label: string | null;
    preference_rank: number | null;
    waitlist_position: number | null;
    explanation: string;
  }>;
}

export interface OfficialAllotmentSlip {
  slip_reference: string;
  checksum: string;
  issued_at: string;
  cycle: {
    id: string;
    code: string;
    title: string;
    academic_term: string;
    policy_version: string;
  };
  student: {
    student_id: string;
    student_code: string;
    name: string;
    branch: string;
    year: 1 | 2 | 3 | 4;
    verification_status: string;
    is_mock_development_record: boolean;
  };
  assignment: ApplicationAllotmentResult;
  application_status: ApplicationStatus;
}

export class ApplicationServiceError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ApplicationServiceError';
  }
}

const MERIT_POINTS: Record<CgpaBand, number> = {
  'A+': 5,
  A: 4,
  'B+': 3,
  B: 2,
  C: 1,
};

/**
 * Phase 3: Hostel Applications, Rule-Based Eligibility & Deterministic Allotment Service
 * ======================================================================================
 * Zero AI models are used in eligibility, scoring, waitlisting, or bed allocation.
 * Every decision is 100% deterministic, policy-versioned, auditable, and strictly
 * upholds institutional occupancy, capacity, gender-separation, and operational-status invariants.
 */
export class HostelApplicationService {
  private readonly cycles = new Map<string, AllotmentCycle>();
  private readonly applications = new Map<string, HostelApplication>();
  private readonly runHistory: CycleAllotmentRunSummary[] = [];

  constructor(
    private readonly repo: IHostelRepository,
    private readonly verificationService: StudentVerificationService,
    private readonly inventoryService: InstitutionalInventoryService
  ) {
    this.seedDefaultCycle();
  }

  private seedDefaultCycle(): void {
    const cycle: AllotmentCycle = {
      id: 'cyc-2026-monsoon',
      code: 'CYC-2026-MONSOON',
      title: 'Monsoon Semester 2026–27 Hostel Allotment',
      academic_term: 'Monsoon 2026–27',
      status: 'OPEN',
      opens_at: '2026-07-01T00:00:00.000Z',
      closes_at: '2027-01-31T23:59:59.000Z',
      policy: {
        policy_version: 'VVU-HP-2026.3',
        require_university_verification: true,
        enforce_gender_separation: true,
        eligible_years: [1, 2, 3, 4],
        max_ranked_preferences: 5,
        year_weight: 25,
        merit_weight: 10,
        distance_weight_per_100km: 2,
        accessibility_priority_bonus: 50,
      },
      created_by: 'admin.demo@hostelhub.local',
      created_at: '2026-07-01T08:00:00.000Z',
      last_run_id: null,
    };
    this.cycles.set(cycle.id, cycle);
  }

  public listCycles(): AllotmentCycle[] {
    return Array.from(this.cycles.values())
      .map((c) => structuredClone(c))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  public getCycleById(cycleId: string): AllotmentCycle | null {
    const found = this.cycles.get(cycleId);
    return found ? structuredClone(found) : null;
  }

  public async createCycle(
    actor: AuthUserProfile,
    input: {
      code: string;
      title: string;
      academic_term: string;
      opens_at: string;
      closes_at: string;
      status?: ApplicationCycleStatus;
      policy?: Partial<CyclePolicyRules>;
    }
  ): Promise<AllotmentCycle> {
    if (actor.role !== 'ADMIN') {
      throw new ApplicationServiceError('Only Administrators may create allotment cycles.', 403);
    }

    const normalizedCode = input.code.trim().toUpperCase();
    for (const existing of this.cycles.values()) {
      if (existing.code === normalizedCode) {
        throw new ApplicationServiceError(`Cycle code '${normalizedCode}' already exists.`, 409);
      }
    }

    const cycle: AllotmentCycle = {
      id: `cyc-${crypto.randomUUID().slice(0, 8)}`,
      code: normalizedCode,
      title: input.title.trim(),
      academic_term: input.academic_term.trim(),
      status: input.status ?? 'OPEN',
      opens_at: input.opens_at,
      closes_at: input.closes_at,
      policy: {
        policy_version: input.policy?.policy_version ?? 'VVU-HP-2026.3',
        require_university_verification: input.policy?.require_university_verification ?? true,
        enforce_gender_separation: input.policy?.enforce_gender_separation ?? true,
        eligible_years: input.policy?.eligible_years ?? [1, 2, 3, 4],
        max_ranked_preferences: input.policy?.max_ranked_preferences ?? 5,
        year_weight: input.policy?.year_weight ?? 25,
        merit_weight: input.policy?.merit_weight ?? 10,
        distance_weight_per_100km: input.policy?.distance_weight_per_100km ?? 2,
        accessibility_priority_bonus: input.policy?.accessibility_priority_bonus ?? 50,
      },
      created_by: actor.email,
      created_at: new Date().toISOString(),
      last_run_id: null,
    };

    this.cycles.set(cycle.id, cycle);
    await this.repo.appendAuditLog(actor.email, actor.role, 'ALLOTMENT_CYCLE_CREATED', {
      cycle_id: cycle.id,
      code: cycle.code,
      status: cycle.status,
      policy_version: cycle.policy.policy_version,
    });
    return structuredClone(cycle);
  }

  public async updateCycleStatus(
    actor: AuthUserProfile,
    cycleId: string,
    status: ApplicationCycleStatus
  ): Promise<AllotmentCycle> {
    if (actor.role !== 'ADMIN') {
      throw new ApplicationServiceError('Only Administrators may change cycle status.', 403);
    }
    const cycle = this.cycles.get(cycleId);
    if (!cycle) {
      throw new ApplicationServiceError(`Allotment cycle '${cycleId}' not found.`, 404);
    }
    const previous = cycle.status;
    cycle.status = status;
    await this.repo.appendAuditLog(actor.email, actor.role, 'ALLOTMENT_CYCLE_STATUS_UPDATED', {
      cycle_id: cycle.id,
      previous_status: previous,
      new_status: status,
    });
    return structuredClone(cycle);
  }

  public async evaluateEligibility(params: {
    cycle: AllotmentCycle;
    student: Student;
    preferredRoomIds: string[];
    homeDistanceKm: number;
    accessibilityVerified: boolean;
    declarationAccepted: boolean;
  }): Promise<EligibilityEvaluation> {
    const { cycle, student, preferredRoomIds, homeDistanceKm, accessibilityVerified, declarationAccepted } =
      params;
    const checks: EligibilityRuleCheck[] = [];

    // Rule 1: University identity verification
    const verRecord = this.verificationService.getRecordForStudent(
      student.id,
      student.student_code,
      Boolean(student.allotted_room_id)
    );
    const verPassed = !cycle.policy.require_university_verification || verRecord.status === 'VERIFIED';
    checks.push({
      rule_code: 'UNIV_IDENTITY_VERIFIED',
      label: 'University Enrollment Verification',
      passed: verPassed,
      detail: verPassed
        ? `Verified via ${verRecord.provider_name}${verRecord.is_mock_development_record ? ' (DEV MOCK)' : ''}.`
        : `Current verification status is ${verRecord.status}. Official university verification is required before eligibility.`,
    });

    // Rule 2: Academic year eligibility
    const yearPassed = cycle.policy.eligible_years.includes(student.year);
    checks.push({
      rule_code: 'ACADEMIC_YEAR_ELIGIBLE',
      label: 'Academic Year Policy',
      passed: yearPassed,
      detail: yearPassed
        ? `Year ${student.year} is eligible for ${cycle.academic_term}.`
        : `Year ${student.year} is not included in cycle eligible years (${cycle.policy.eligible_years.join(', ')}).`,
    });

    // Rule 3: Gender-compatible ranked room preferences
    const [rooms, blocks] = await Promise.all([this.repo.getRooms(), this.repo.getBlocks()]);
    const roomMap = new Map(rooms.map((r) => [r.id, r]));
    const blockMap = new Map(blocks.map((b) => [b.id, b]));

    const invalidRoomIds: string[] = [];
    const genderMismatchIds: string[] = [];
    for (const rid of preferredRoomIds) {
      const rm = roomMap.get(rid);
      if (!rm) {
        invalidRoomIds.push(rid);
        continue;
      }
      const blk = blockMap.get(rm.block_id);
      if (blk && cycle.policy.enforce_gender_separation && !isGenderCompatibleWithBlock(student.gender, blk)) {
        genderMismatchIds.push(`${blk.code}-${rm.number}`);
      }
    }

    const prefsValid =
      preferredRoomIds.length <= cycle.policy.max_ranked_preferences &&
      invalidRoomIds.length === 0 &&
      genderMismatchIds.length === 0;
    checks.push({
      rule_code: 'PREFERENCES_POLICY_COMPLIANT',
      label: 'Ranked Preferences & Gender Policy',
      passed: prefsValid,
      detail: prefsValid
        ? `${preferredRoomIds.length} ranked room preference(s) verified against gender and block rules.`
        : invalidRoomIds.length > 0
          ? `Unknown room ID(s): ${invalidRoomIds.join(', ')}.`
          : `Gender policy mismatch on room(s): ${genderMismatchIds.join(', ')}.`,
    });

    // Rule 4: Student declaration acceptance
    checks.push({
      rule_code: 'HOSTEL_DECLARATION_ACCEPTED',
      label: 'Hostel Code & Declaration',
      passed: declarationAccepted,
      detail: declarationAccepted
        ? 'Student accepted university hostel terms and allotment policy.'
        : 'Student must accept the institutional hostel declaration before submission.',
    });

    const yearPoints = Math.round(student.year * cycle.policy.year_weight * 100) / 100;
    const meritPoints =
      Math.round(MERIT_POINTS[student.cgpa_band] * cycle.policy.merit_weight * 100) / 100;
    const cappedKm = Math.max(0, Math.min(2500, homeDistanceKm));
    const distancePoints =
      Math.round((cappedKm / 100) * cycle.policy.distance_weight_per_100km * 100) / 100;
    const accessibilityPoints = accessibilityVerified
      ? cycle.policy.accessibility_priority_bonus
      : 0;
    const totalScore =
      Math.round((yearPoints + meritPoints + distancePoints + accessibilityPoints) * 100) / 100;

    return {
      eligible: checks.every((c) => c.passed),
      policy_version: cycle.policy.policy_version,
      computed_priority_score: totalScore,
      score_breakdown: {
        year_points: yearPoints,
        merit_points: meritPoints,
        distance_points: distancePoints,
        accessibility_points: accessibilityPoints,
      },
      checks,
      evaluated_at: new Date().toISOString(),
    };
  }

  public async upsertStudentApplication(
    actor: AuthUserProfile,
    input: {
      cycle_id: string;
      preferred_room_ids: string[];
      preferred_ac: boolean | null;
      preferred_capacity: 1 | 2 | 3 | 4 | null;
      home_distance_km: number;
      accessibility_requested: boolean;
      accessibility_note: string | null;
      declaration_accepted: boolean;
      submit_now: boolean;
    }
  ): Promise<HostelApplication> {
    if (actor.role !== 'STUDENT' || !actor.student_id) {
      throw new ApplicationServiceError('Only authenticated students may submit hostel applications.', 403);
    }

    const cycle = this.cycles.get(input.cycle_id);
    if (!cycle) {
      throw new ApplicationServiceError(`Allotment cycle '${input.cycle_id}' not found.`, 404);
    }
    if (cycle.status !== 'OPEN') {
      throw new ApplicationServiceError(
        `Cycle '${cycle.code}' is currently ${cycle.status} and not accepting applications.`,
        409
      );
    }

    const student = await this.repo.getStudentById(actor.student_id);
    if (!student) {
      throw new ApplicationServiceError('Student profile record not found.', 404);
    }

    const uniquePrefIds = Array.from(new Set(input.preferred_room_ids));
    if (uniquePrefIds.length > cycle.policy.max_ranked_preferences) {
      throw new ApplicationServiceError(
        `You may select at most ${cycle.policy.max_ranked_preferences} ranked room preferences.`,
        400
      );
    }

    // Check existing application for this student in this cycle
    const existing = Array.from(this.applications.values()).find(
      (a) => a.cycle_id === cycle.id && a.student_id === student.id && a.status !== 'WITHDRAWN'
    );
    if (
      existing &&
      (existing.status === 'ALLOTTED' || existing.status === 'ACCEPTED')
    ) {
      throw new ApplicationServiceError(
        'Cannot edit an application after a room/bed has already been allotted.',
        409
      );
    }

    // Validate gender mismatch immediately on submit_now
    const evaluation = await this.evaluateEligibility({
      cycle,
      student,
      preferredRoomIds: uniquePrefIds,
      homeDistanceKm: input.home_distance_km,
      accessibilityVerified: existing?.accessibility_verified ?? false,
      declarationAccepted: input.declaration_accepted,
    });

    if (input.submit_now) {
      if (!input.declaration_accepted) {
        throw new ApplicationServiceError(
          'You must accept the institutional hostel declaration before submitting your application.',
          400
        );
      }
      const prefCheck = evaluation.checks.find((c) => c.rule_code === 'PREFERENCES_POLICY_COMPLIANT');
      if (prefCheck && !prefCheck.passed) {
        throw new ApplicationServiceError(prefCheck.detail, 400);
      }
    }

    const now = new Date().toISOString();
    let nextStatus: ApplicationStatus = 'DRAFT';
    if (input.submit_now) {
      nextStatus = evaluation.eligible ? 'ELIGIBLE' : 'SUBMITTED';
    }

    const application: HostelApplication = {
      id: existing?.id ?? `app-${crypto.randomUUID().slice(0, 8)}`,
      cycle_id: cycle.id,
      student_id: student.id,
      student_code: student.student_code,
      student_name: student.name,
      student_gender: student.gender,
      student_year: student.year,
      student_branch: student.branch,
      status: nextStatus,
      preferred_room_ids: uniquePrefIds,
      preferred_ac: input.preferred_ac,
      preferred_capacity: input.preferred_capacity,
      home_distance_km: input.home_distance_km,
      accessibility_requested: input.accessibility_requested,
      accessibility_verified: existing?.accessibility_verified ?? false,
      accessibility_note: input.accessibility_note?.trim() || null,
      declaration_accepted: input.declaration_accepted,
      eligibility: evaluation,
      waitlist_position: null,
      waitlist_reason: null,
      allotment: existing?.allotment ?? null,
      reviewer_email: existing?.reviewer_email ?? null,
      review_note: existing?.review_note ?? null,
      submitted_at: input.submit_now ? now : existing?.submitted_at ?? null,
      responded_at: existing?.responded_at ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    this.applications.set(application.id, application);
    await this.repo.appendAuditLog(
      actor.email,
      actor.role,
      input.submit_now ? 'HOSTEL_APPLICATION_SUBMITTED' : 'HOSTEL_APPLICATION_SAVED_DRAFT',
      {
        application_id: application.id,
        cycle_id: cycle.id,
        status: application.status,
        eligible: evaluation.eligible,
        priority_score: evaluation.computed_priority_score,
      }
    );

    return structuredClone(application);
  }

  public async withdrawApplication(
    actor: AuthUserProfile,
    applicationId: string
  ): Promise<HostelApplication> {
    if (actor.role !== 'STUDENT' || !actor.student_id) {
      throw new ApplicationServiceError('Only students may withdraw their own application.', 403);
    }
    const app = this.applications.get(applicationId);
    if (!app) {
      throw new ApplicationServiceError('Application not found.', 404);
    }
    if (app.student_id !== actor.student_id) {
      throw new ApplicationServiceError('Forbidden: You may only withdraw your own application.', 403);
    }
    if (app.status === 'ALLOTTED' || app.status === 'ACCEPTED') {
      throw new ApplicationServiceError(
        'Cannot withdraw an already allotted application. Use offer decline instead.',
        409
      );
    }
    app.status = 'WITHDRAWN';
    app.waitlist_position = null;
    app.updated_at = new Date().toISOString();

    await this.repo.appendAuditLog(actor.email, actor.role, 'HOSTEL_APPLICATION_WITHDRAWN', {
      application_id: app.id,
      cycle_id: app.cycle_id,
    });
    return structuredClone(app);
  }

  public async getMyApplications(actor: AuthUserProfile): Promise<{
    cycles: AllotmentCycle[];
    applications: HostelApplication[];
  }> {
    if (actor.role !== 'STUDENT' || !actor.student_id) {
      throw new ApplicationServiceError('Student account required.', 403);
    }
    const mine = Array.from(this.applications.values())
      .filter((a) => a.student_id === actor.student_id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((a) => structuredClone(a));
    return {
      cycles: this.listCycles(),
      applications: mine,
    };
  }

  public async listApplicationsForStaff(
    actor: AuthUserProfile,
    filters?: { cycle_id?: string; status?: ApplicationStatus }
  ): Promise<{
    cycles: AllotmentCycle[];
    applications: HostelApplication[];
    runs: CycleAllotmentRunSummary[];
  }> {
    if (actor.role !== 'ADMIN' && actor.role !== 'WARDEN') {
      throw new ApplicationServiceError('Only Wardens or Administrators may view the applications register.', 403);
    }

    let list = Array.from(this.applications.values());
    if (filters?.cycle_id) {
      list = list.filter((a) => a.cycle_id === filters.cycle_id);
    }
    if (filters?.status) {
      list = list.filter((a) => a.status === filters.status);
    }

    // Warden scope: can view unallotted applications in queue + allotted applications in their assigned blocks
    if (actor.role === 'WARDEN') {
      list = list.filter(
        (a) => !a.allotment || canAccessBlock(actor, a.allotment.block_id)
      );
    }

    list.sort((a, b) => {
      if (a.waitlist_position !== null && b.waitlist_position !== null) {
        return a.waitlist_position - b.waitlist_position;
      }
      return b.eligibility.computed_priority_score - a.eligibility.computed_priority_score;
    });

    return {
      cycles: this.listCycles(),
      applications: list.map((a) => structuredClone(a)),
      runs: this.runHistory
        .filter((r) => !filters?.cycle_id || r.cycle_id === filters.cycle_id)
        .slice(0, 20)
        .map((r) => structuredClone(r)),
    };
  }

  public async reviewApplication(
    actor: AuthUserProfile,
    applicationId: string,
    input: {
      decision: 'UNDER_REVIEW' | 'ELIGIBLE' | 'REJECTED';
      accessibility_verified?: boolean;
      review_note: string;
    }
  ): Promise<HostelApplication> {
    if (actor.role !== 'ADMIN' && actor.role !== 'WARDEN') {
      throw new ApplicationServiceError('Only Administrators or Wardens may review applications.', 403);
    }
    const app = this.applications.get(applicationId);
    if (!app) {
      throw new ApplicationServiceError('Application not found.', 404);
    }
    if (app.status === 'WITHDRAWN' || app.status === 'ACCEPTED') {
      throw new ApplicationServiceError(`Application is ${app.status} and cannot be re-reviewed.`, 409);
    }

    const cycle = this.cycles.get(app.cycle_id);
    const student = await this.repo.getStudentById(app.student_id);
    if (!cycle || !student) {
      throw new ApplicationServiceError('Cycle or student record missing.', 404);
    }

    const nextAccessibilityVerified =
      input.accessibility_verified !== undefined
        ? input.accessibility_verified
        : app.accessibility_verified;

    const refreshedEval = await this.evaluateEligibility({
      cycle,
      student,
      preferredRoomIds: app.preferred_room_ids,
      homeDistanceKm: app.home_distance_km,
      accessibilityVerified: nextAccessibilityVerified,
      declarationAccepted: app.declaration_accepted,
    });

    // Hard institutional rule: even staff review CANNOT mark an unverified student ELIGIBLE when verification is required
    if (input.decision === 'ELIGIBLE' && !refreshedEval.eligible) {
      const failed = refreshedEval.checks.find((c) => !c.passed);
      throw new ApplicationServiceError(
        `Cannot mark application ELIGIBLE: ${failed?.detail ?? 'Policy eligibility check failed.'}`,
        409
      );
    }

    app.accessibility_verified = nextAccessibilityVerified;
    app.eligibility = refreshedEval;
    app.status = input.decision;
    app.reviewer_email = actor.email;
    app.review_note = input.review_note.trim();
    app.updated_at = new Date().toISOString();

    await this.repo.appendAuditLog(actor.email, actor.role, 'HOSTEL_APPLICATION_REVIEWED', {
      application_id: app.id,
      student_id: app.student_id,
      decision: input.decision,
      accessibility_verified: app.accessibility_verified,
      review_note: app.review_note,
    });

    return structuredClone(app);
  }

  /**
   * Executes a deterministic, reproducible bed-level allotment run for a cycle.
   * Respects:
   *   - Verified institutional eligibility (blocks unverified or non-ELIGIBLE applications)
   *   - Phase 2 bed/room operational status overrides (skips UNDER_MAINTENANCE / BLOCKED / RESERVED beds)
   *   - Gender separation
   *   - Ground-floor accessible bed prioritization for verified accessibility-need applicants
   *   - 1 active bed per student invariant & room capacity
   */
  public async executeCycleAllotment(
    actor: AuthUserProfile,
    params: {
      cycle_id: string;
      seed: string;
      dry_run: boolean;
    }
  ): Promise<CycleAllotmentRunSummary> {
    if (actor.role !== 'ADMIN') {
      throw new ApplicationServiceError('Only Administrators may execute institutional allotment runs.', 403);
    }

    const cycle = this.cycles.get(params.cycle_id);
    if (!cycle) {
      throw new ApplicationServiceError(`Allotment cycle '${params.cycle_id}' not found.`, 404);
    }

    const eligibleApps = Array.from(this.applications.values()).filter(
      (a) =>
        a.cycle_id === cycle.id &&
        (a.status === 'ELIGIBLE' || a.status === 'WAITLISTED')
    );

    if (eligibleApps.length === 0) {
      throw new ApplicationServiceError(
        'No ELIGIBLE or WAITLISTED applications found in this cycle to run allotment.',
        400
      );
    }

    const [blocks, hierarchy] = await Promise.all([
      this.repo.getBlocks(),
      this.inventoryService.getHierarchy(actor),
    ]);
    const blockMap = new Map<string, Block>(blocks.map((b) => [b.id, b]));

    // Build live available bed pool from Phase 2 inventory (respects room/bed operational overrides!)
    interface AvailableBedSlot {
      bed_id: string;
      bed_label: string;
      room_id: string;
      room_number: string;
      block_id: string;
      block_name: string;
      block_code: string;
      floor: number;
      ac: boolean;
      capacity: 1 | 2 | 3 | 4;
      is_accessible: boolean;
      taken: boolean;
    }

    const bedPool: AvailableBedSlot[] = [];
    for (const campus of hierarchy.campuses) {
      for (const hostel of campus.hostels) {
        for (const blk of hostel.blocks) {
          for (const floor of blk.floors_detail) {
            for (const roomSummary of floor.rooms) {
              if (
                roomSummary.derived_status === 'UNDER_MAINTENANCE' ||
                roomSummary.derived_status === 'BLOCKED' ||
                roomSummary.derived_status === 'RESERVED'
              ) {
                continue;
              }
              const detail = await this.inventoryService.getRoomBeds(roomSummary.id, actor);
              for (const bed of detail.beds) {
                if (bed.status === 'AVAILABLE' && !bed.is_occupied) {
                  bedPool.push({
                    bed_id: bed.id,
                    bed_label: bed.bed_label,
                    room_id: roomSummary.id,
                    room_number: roomSummary.number,
                    block_id: blk.id,
                    block_name: blk.name,
                    block_code: blk.code,
                    floor: roomSummary.floor,
                    ac: roomSummary.ac,
                    capacity: roomSummary.capacity,
                    is_accessible: bed.is_accessible,
                    taken: false,
                  });
                }
              }
            }
          }
        }
      }
    }

    // Re-evaluate eligibility and deterministic priority score + seeded tie-breaker
    const ranked = [];
    for (const app of eligibleApps) {
      const student = await this.repo.getStudentById(app.student_id);
      if (!student) continue;
      const evalNow = await this.evaluateEligibility({
        cycle,
        student,
        preferredRoomIds: app.preferred_room_ids,
        homeDistanceKm: app.home_distance_km,
        accessibilityVerified: app.accessibility_verified,
        declarationAccepted: app.declaration_accepted,
      });
      if (!evalNow.eligible) continue;

      ranked.push({
        app,
        student,
        evalNow,
        tieBreaker: seededTieBreaker(params.seed, student.id),
      });
    }

    ranked.sort((a, b) => {
      // Verified accessibility priority first, then priority_score DESC, then seeded tie-breaker DESC
      if (a.app.accessibility_verified !== b.app.accessibility_verified) {
        return a.app.accessibility_verified ? -1 : 1;
      }
      if (b.evalNow.computed_priority_score !== a.evalNow.computed_priority_score) {
        return b.evalNow.computed_priority_score - a.evalNow.computed_priority_score;
      }
      return b.tieBreaker - a.tieBreaker;
    });

    const runId = `run-cyc-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const decisions: CycleAllotmentRunSummary['decisions'] = [];
    const pendingCommits: Array<{
      app: HostelApplication;
      result: ApplicationAllotmentResult;
    }> = [];
    const pendingWaitlist: Array<{ app: HostelApplication; position: number; reason: string }> = [];

    let firstChoiceCount = 0;
    let accessibilityHonoredCount = 0;
    let waitlistCounter = 0;

    for (const item of ranked) {
      const { app, student, evalNow, tieBreaker } = item;

      const compatibleFreeBeds = bedPool.filter((slot) => {
        if (slot.taken) return false;
        const blk = blockMap.get(slot.block_id);
        if (!blk) return false;
        return !cycle.policy.enforce_gender_separation || isGenderCompatibleWithBlock(student.gender, blk);
      });

      let chosenSlot: AvailableBedSlot | null = null;
      let preferenceRank: number | null = null;
      let allottedVia: ApplicationAllotmentResult['allotted_via'] = 'fallback';
      let explanation = '';

      // 1. Verified accessibility need -> prioritize ground-floor accessible bed (matching preference if possible)
      if (app.accessibility_verified) {
        for (let i = 0; i < app.preferred_room_ids.length; i++) {
          const prefRoomId = app.preferred_room_ids[i];
          const match = compatibleFreeBeds.find((s) => s.room_id === prefRoomId && s.is_accessible);
          if (match) {
            chosenSlot = match;
            preferenceRank = i + 1;
            allottedVia = 'accessibility_priority';
            explanation = `Assigned ground-floor accessible Bed ${match.bed_label} in preferred room #${i + 1} (${match.block_code}-${match.room_number}) under verified accessibility priority.`;
            break;
          }
        }
        if (!chosenSlot) {
          const anyAccessible = compatibleFreeBeds.find((s) => s.is_accessible);
          if (anyAccessible) {
            chosenSlot = anyAccessible;
            allottedVia = 'accessibility_priority';
            explanation = `Assigned ground-floor accessible Bed ${anyAccessible.bed_label} in ${anyAccessible.block_code}-${anyAccessible.room_number} under verified accessibility priority.`;
          }
        }
      }

      // 2. Ranked preferences in strict order
      if (!chosenSlot) {
        for (let i = 0; i < app.preferred_room_ids.length; i++) {
          const prefRoomId = app.preferred_room_ids[i];
          const match = compatibleFreeBeds.find((s) => s.room_id === prefRoomId);
          if (match) {
            chosenSlot = match;
            preferenceRank = i + 1;
            allottedVia = 'preference';
            explanation = `Matched ranked preference #${i + 1} (${match.block_code}-${match.room_number}, Bed ${match.bed_label}) with priority score ${evalNow.computed_priority_score}.`;
            break;
          }
        }
      }

      // 3. Fallback matching AC / capacity preference, then any compatible available bed
      if (!chosenSlot && compatibleFreeBeds.length > 0) {
        const acAndCap = compatibleFreeBeds.find(
          (s) =>
            (app.preferred_ac === null || s.ac === app.preferred_ac) &&
            (app.preferred_capacity === null || s.capacity === app.preferred_capacity)
        );
        chosenSlot = acAndCap ?? compatibleFreeBeds[0];
        allottedVia = 'fallback';
        explanation = `Ranked preferences were full; assigned compatible available Bed ${chosenSlot.bed_label} in ${chosenSlot.block_code}-${chosenSlot.room_number} by deterministic priority score ${evalNow.computed_priority_score}.`;
      }

      if (chosenSlot) {
        chosenSlot.taken = true;
        if (preferenceRank === 1) firstChoiceCount += 1;
        if (allottedVia === 'accessibility_priority') accessibilityHonoredCount += 1;

        const slipChecksum = crypto
          .createHash('sha256')
          .update(`${runId}:${cycle.id}:${student.id}:${chosenSlot.bed_id}:${now}`)
          .digest('hex')
          .slice(0, 16)
          .toUpperCase();

        const result: ApplicationAllotmentResult = {
          run_id: runId,
          cycle_id: cycle.id,
          room_id: chosenSlot.room_id,
          room_label: `${chosenSlot.block_code}-${chosenSlot.room_number}`,
          block_id: chosenSlot.block_id,
          block_name: chosenSlot.block_name,
          floor: chosenSlot.floor,
          bed_id: chosenSlot.bed_id,
          bed_label: chosenSlot.bed_label,
          preference_rank: preferenceRank,
          allotted_via: allottedVia,
          priority_score: evalNow.computed_priority_score,
          tie_breaker: tieBreaker,
          explanation,
          assigned_at: now,
          slip_checksum: slipChecksum,
        };

        pendingCommits.push({ app, result });
        decisions.push({
          application_id: app.id,
          student_id: student.id,
          student_code: student.student_code,
          student_name: student.name,
          outcome: 'ALLOTTED',
          priority_score: evalNow.computed_priority_score,
          tie_breaker: tieBreaker,
          room_label: result.room_label,
          bed_label: result.bed_label,
          preference_rank: preferenceRank,
          waitlist_position: null,
          explanation,
        });
      } else {
        waitlistCounter += 1;
        const wlReason = `No compatible available beds remained at priority score ${evalNow.computed_priority_score}. Placed on deterministic waitlist #${waitlistCounter}.`;
        pendingWaitlist.push({ app, position: waitlistCounter, reason: wlReason });
        decisions.push({
          application_id: app.id,
          student_id: student.id,
          student_code: student.student_code,
          student_name: student.name,
          outcome: 'WAITLISTED',
          priority_score: evalNow.computed_priority_score,
          tie_breaker: tieBreaker,
          room_label: null,
          bed_label: null,
          preference_rank: null,
          waitlist_position: waitlistCounter,
          explanation: wlReason,
        });
      }
    }

    // If not dry_run, atomically commit all bed assignments to repository and applications
    if (!params.dry_run) {
      for (const commit of pendingCommits) {
        await this.repo.assignStudentToRoom(
          commit.app.student_id,
          commit.result.room_id,
          actor.email,
          actor.role
        );
        commit.app.status = 'ALLOTTED';
        commit.app.allotment = commit.result;
        commit.app.waitlist_position = null;
        commit.app.waitlist_reason = null;
        commit.app.updated_at = now;
      }
      for (const wl of pendingWaitlist) {
        wl.app.status = 'WAITLISTED';
        wl.app.waitlist_position = wl.position;
        wl.app.waitlist_reason = wl.reason;
        wl.app.updated_at = now;
      }
      cycle.last_run_id = runId;
    }

    const summary: CycleAllotmentRunSummary = {
      run_id: runId,
      cycle_id: cycle.id,
      seed: params.seed,
      policy_version: cycle.policy.policy_version,
      dry_run: params.dry_run,
      committed: !params.dry_run,
      executed_by: actor.email,
      executed_at: now,
      total_eligible_applicants: ranked.length,
      allotted_count: pendingCommits.length,
      waitlisted_count: pendingWaitlist.length,
      first_choice_count: firstChoiceCount,
      accessibility_honored_count: accessibilityHonoredCount,
      decisions,
    };

    this.runHistory.unshift(summary);

    await this.repo.appendAuditLog(
      actor.email,
      actor.role,
      params.dry_run ? 'CYCLE_ALLOTMENT_DRY_RUN' : 'CYCLE_ALLOTMENT_COMMITTED',
      {
        run_id: runId,
        cycle_id: cycle.id,
        seed: params.seed,
        allotted_count: summary.allotted_count,
        waitlisted_count: summary.waitlisted_count,
        policy_version: cycle.policy.policy_version,
      }
    );

    return structuredClone(summary);
  }

  public async manualOverrideAllotment(
    actor: AuthUserProfile,
    params: {
      application_id: string;
      target_room_id: string;
      justification: string;
    }
  ): Promise<HostelApplication> {
    if (actor.role !== 'ADMIN') {
      throw new ApplicationServiceError('Only Administrators may execute manual allotment overrides.', 403);
    }

    const app = this.applications.get(params.application_id);
    if (!app) {
      throw new ApplicationServiceError('Application not found.', 404);
    }
    const cycle = this.cycles.get(app.cycle_id);
    if (!cycle) {
      throw new ApplicationServiceError('Allotment cycle not found.', 404);
    }

    // Verify room operational status in Phase 2 inventory
    const roomDetail = await this.inventoryService.getRoomBeds(params.target_room_id, actor);
    if (
      roomDetail.room.derived_status === 'UNDER_MAINTENANCE' ||
      roomDetail.room.derived_status === 'BLOCKED'
    ) {
      throw new ApplicationServiceError(
        `Cannot manually allot into room ${roomDetail.block.code}-${roomDetail.room.number} while its status is ${roomDetail.room.derived_status}.`,
        409
      );
    }
    const freeBed = roomDetail.beds.find((b) => b.status === 'AVAILABLE' && !b.is_occupied);
    if (!freeBed) {
      throw new ApplicationServiceError(
        `No available bed remains in room ${roomDetail.block.code}-${roomDetail.room.number}.`,
        409
      );
    }

    // Repository enforces gender separation, capacity, and 1-active-bed invariant
    try {
      await this.repo.assignStudentToRoom(app.student_id, params.target_room_id, actor.email, actor.role);
    } catch (err) {
      throw new ApplicationServiceError(
        err instanceof Error ? err.message : 'Manual override violated room constraints.',
        409
      );
    }

    const now = new Date().toISOString();
    const overrideRunId = `ovr-${crypto.randomUUID().slice(0, 8)}`;
    const slipChecksum = crypto
      .createHash('sha256')
      .update(`${overrideRunId}:${cycle.id}:${app.student_id}:${freeBed.id}:${now}`)
      .digest('hex')
      .slice(0, 16)
      .toUpperCase();

    app.status = 'ALLOTTED';
    app.waitlist_position = null;
    app.waitlist_reason = null;
    app.reviewer_email = actor.email;
    app.review_note = `MANUAL OVERRIDE: ${params.justification.trim()}`;
    app.allotment = {
      run_id: overrideRunId,
      cycle_id: cycle.id,
      room_id: roomDetail.room.id,
      room_label: `${roomDetail.block.code}-${roomDetail.room.number}`,
      block_id: roomDetail.block.id,
      block_name: roomDetail.block.name,
      floor: roomDetail.room.floor,
      bed_id: freeBed.id,
      bed_label: freeBed.bed_label,
      preference_rank: null,
      allotted_via: 'manual_override',
      priority_score: app.eligibility.computed_priority_score,
      tie_breaker: 0,
      explanation: `Audited Admin Manual Override by ${actor.email}: ${params.justification.trim()}`,
      assigned_at: now,
      slip_checksum: slipChecksum,
    };
    app.updated_at = now;

    await this.repo.appendAuditLog(actor.email, actor.role, 'ALLOTMENT_MANUAL_OVERRIDE', {
      application_id: app.id,
      student_id: app.student_id,
      room_id: roomDetail.room.id,
      bed_id: freeBed.id,
      justification: params.justification.trim(),
    });

    return structuredClone(app);
  }

  public async respondToAllotmentOffer(
    actor: AuthUserProfile,
    applicationId: string,
    action: 'accept' | 'decline'
  ): Promise<HostelApplication> {
    if (actor.role !== 'STUDENT' || !actor.student_id) {
      throw new ApplicationServiceError('Only the allotted student may accept or decline an offer.', 403);
    }
    const app = this.applications.get(applicationId);
    if (!app) {
      throw new ApplicationServiceError('Application not found.', 404);
    }
    if (app.student_id !== actor.student_id) {
      throw new ApplicationServiceError('Forbidden: You may only respond to your own allotment offer.', 403);
    }
    if (app.status !== 'ALLOTTED' || !app.allotment) {
      throw new ApplicationServiceError('No active pending allotment offer exists for this application.', 409);
    }

    const now = new Date().toISOString();
    if (action === 'accept') {
      app.status = 'ACCEPTED';
      app.responded_at = now;
      app.updated_at = now;
      await this.repo.appendAuditLog(actor.email, actor.role, 'ALLOTMENT_OFFER_ACCEPTED', {
        application_id: app.id,
        room_id: app.allotment.room_id,
        bed_id: app.allotment.bed_id,
      });
    } else {
      await this.repo.vacateStudentRoom(app.student_id, actor.email, actor.role);
      app.status = 'DECLINED';
      app.responded_at = now;
      app.updated_at = now;
      await this.repo.appendAuditLog(actor.email, actor.role, 'ALLOTMENT_OFFER_DECLINED', {
        application_id: app.id,
        vacated_room_id: app.allotment.room_id,
      });
    }

    return structuredClone(app);
  }

  public async getOfficialAllotmentSlip(
    actor: AuthUserProfile,
    applicationId: string
  ): Promise<OfficialAllotmentSlip> {
    if (actor.role === 'MAINTENANCE_STAFF') {
      throw new ApplicationServiceError('Maintenance staff cannot access student allotment slips.', 403);
    }
    const app = this.applications.get(applicationId);
    if (!app || !app.allotment) {
      throw new ApplicationServiceError('Allotment slip is not available for this application.', 404);
    }
    if (actor.role === 'STUDENT' && actor.student_id !== app.student_id) {
      throw new ApplicationServiceError('Forbidden: You may only view your own allotment slip.', 403);
    }
    if (actor.role === 'WARDEN' && !canAccessBlock(actor, app.allotment.block_id)) {
      throw new ApplicationServiceError(
        'Forbidden: This allotment belongs to a block outside your assigned scope.',
        403
      );
    }

    const cycle = this.cycles.get(app.cycle_id)!;
    const verRecord = this.verificationService.getRecordForStudent(
      app.student_id,
      app.student_code,
      true
    );

    return {
      slip_reference: `SLIP-${cycle.code}-${app.student_code}`,
      checksum: app.allotment.slip_checksum,
      issued_at: app.allotment.assigned_at,
      cycle: {
        id: cycle.id,
        code: cycle.code,
        title: cycle.title,
        academic_term: cycle.academic_term,
        policy_version: cycle.policy.policy_version,
      },
      student: {
        student_id: app.student_id,
        student_code: app.student_code,
        name: app.student_name,
        branch: app.student_branch,
        year: app.student_year,
        verification_status: verRecord.status,
        is_mock_development_record: verRecord.is_mock_development_record,
      },
      assignment: structuredClone(app.allotment),
      application_status: app.status,
    };
  }
}

let sharedApplicationService: HostelApplicationService | null = null;

export function getApplicationService(
  repo: IHostelRepository,
  verificationService: StudentVerificationService,
  inventoryService: InstitutionalInventoryService
): HostelApplicationService {
  if (!sharedApplicationService) {
    sharedApplicationService = new HostelApplicationService(
      repo,
      verificationService,
      inventoryService
    );
  }
  return sharedApplicationService;
}

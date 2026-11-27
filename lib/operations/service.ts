import crypto from 'node:crypto';
import type { AuthUserProfile } from '../auth/roles.ts';
import { canAccessBlock } from '../auth/permissions.ts';
import type { IHostelRepository } from '../repo/interface.ts';
import type { MaintenanceTaskService } from '../maintenance/store.ts';
import type { MaintenanceCategory, MaintenancePriority, MaintenanceTask } from '../types.ts';

export type OccupancyLifecycleStatus =
  | 'PENDING_CHECKIN'
  | 'CHECKED_IN'
  | 'CHECKOUT_REQUESTED'
  | 'CHECKED_OUT';

export interface OccupancyCheckRecord {
  student_id: string;
  student_code: string;
  student_name: string;
  room_id: string;
  room_label: string;
  block_id: string;
  block_name: string;
  status: OccupancyLifecycleStatus;
  key_serial: string | null;
  room_condition_checkin: string | null;
  checked_in_at: string | null;
  checked_in_by: string | null;
  checkout_requested_at: string | null;
  checkout_reason: string | null;
  checkout_planned_date: string | null;
  checked_out_at: string | null;
  checked_out_by: string | null;
  key_returned: boolean;
  clearance_note: string | null;
  updated_at: string;
}

export type ComplaintCategory =
  | 'electrical'
  | 'plumbing'
  | 'furniture'
  | 'cleaning'
  | 'internet'
  | 'safety'
  | 'discipline'
  | 'mess_dining'
  | 'roommate'
  | 'other';

export type ComplaintStatus =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REJECTED';

export interface HostelComplaint {
  id: string;
  complaint_code: string;
  student_id: string;
  student_code: string;
  student_name: string;
  block_id: string;
  block_name: string;
  room_id: string;
  room_number: string;
  floor: number;
  category: ComplaintCategory;
  priority: MaintenancePriority;
  subject: string;
  description: string;
  status: ComplaintStatus;
  resolution_note: string | null;
  handled_by: string | null;
  escalated_maintenance_task_id: string | null;
  escalated_ticket_code: string | null;
  created_at: string;
  updated_at: string;
}

export type GatePassType = 'DAY_OUT' | 'OVERNIGHT' | 'HOME_LEAVE' | 'MEDICAL_EMERGENCY';
export type GatePassStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CHECKED_OUT_GATE'
  | 'RETURNED'
  | 'CANCELLED';

export interface GatePassRequest {
  id: string;
  pass_code: string | null;
  student_id: string;
  student_code: string;
  student_name: string;
  block_id: string;
  block_name: string;
  room_label: string;
  pass_type: GatePassType;
  destination: string;
  reason: string;
  departure_at: string;
  expected_return_at: string;
  emergency_contact_phone: string;
  status: GatePassStatus;
  reviewed_by: string | null;
  review_note: string | null;
  gate_exit_at: string | null;
  gate_return_at: string | null;
  created_at: string;
  updated_at: string;
}

export type VisitorStatus = 'SCHEDULED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'DENIED';

export interface VisitorEntry {
  id: string;
  visitor_code: string;
  student_id: string;
  student_code: string;
  student_name: string;
  block_id: string;
  block_name: string;
  room_label: string;
  visitor_name: string;
  relation: string;
  id_type: 'GOVT_ID' | 'PARENT_ID' | 'UNIVERSITY_ID';
  id_last_four: string; // Data minimization: never store full ID numbers
  purpose: string;
  scheduled_date: string;
  status: VisitorStatus;
  checked_in_at: string | null;
  checked_out_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
}

export class OperationsError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'OperationsError';
  }
}

const MAINTENANCE_CATEGORIES = new Set<string>([
  'electrical',
  'plumbing',
  'furniture',
  'cleaning',
  'internet',
  'safety',
]);

/**
 * Phase 4 — Institutional Hostel Operations Lifecycle Service
 * ===========================================================
 * Manages Check-In/Check-Out, Complaints & PII-Stripped Maintenance Escalation,
 * Gate Passes, and Visitor Register with strict block-scoped Warden authorization,
 * student ownership isolation, and unconditional denial of MAINTENANCE_STAFF.
 */
export class HostelOperationsService {
  private readonly occupancy = new Map<string, OccupancyCheckRecord>();
  private readonly complaints = new Map<string, HostelComplaint>();
  private readonly gatePasses = new Map<string, GatePassRequest>();
  private readonly visitors = new Map<string, VisitorEntry>();
  private complaintSeq = 401;
  private gatePassSeq = 901;
  private visitorSeq = 301;

  constructor(
    private readonly repo: IHostelRepository,
    private readonly maintenanceService: MaintenanceTaskService
  ) {}

  private assertNotMaintenance(actor: AuthUserProfile): void {
    if (actor.role === 'MAINTENANCE_STAFF') {
      throw new OperationsError(
        'Maintenance staff cannot access student occupancy, complaints, gate pass, or visitor records.',
        403
      );
    }
  }

  private async resolveStudentRoomContext(studentId: string) {
    const student = await this.repo.getStudentById(studentId);
    if (!student) {
      throw new OperationsError(`Student '${studentId}' not found.`, 404);
    }
    if (!student.allotted_room_id) {
      throw new OperationsError(
        'No active room allotment exists for this student. Complete room allotment first.',
        409
      );
    }
    const room = await this.repo.getRoomById(student.allotted_room_id);
    if (!room) {
      throw new OperationsError('Allotted room record not found.', 404);
    }
    const block = await this.repo.getBlockById(room.block_id);
    if (!block) {
      throw new OperationsError('Allotted block record not found.', 404);
    }
    return {
      student,
      room,
      block,
      room_label: `${block.code}-${room.number}`,
    };
  }

  // =========================================================================
  // A. CHECK-IN & CHECK-OUT OCCUPANCY LIFECYCLE
  // =========================================================================

  public async listOccupancyRecords(actor: AuthUserProfile): Promise<OccupancyCheckRecord[]> {
    this.assertNotMaintenance(actor);

    if (actor.role === 'STUDENT') {
      if (!actor.student_id) return [];
      const existing = this.occupancy.get(actor.student_id);
      if (existing) return [structuredClone(existing)];
      const student = await this.repo.getStudentById(actor.student_id);
      if (!student || !student.allotted_room_id) return [];
      const ctx = await this.resolveStudentRoomContext(actor.student_id);
      return [
        {
          student_id: ctx.student.id,
          student_code: ctx.student.student_code,
          student_name: ctx.student.name,
          room_id: ctx.room.id,
          room_label: ctx.room_label,
          block_id: ctx.block.id,
          block_name: ctx.block.name,
          status: 'PENDING_CHECKIN',
          key_serial: null,
          room_condition_checkin: null,
          checked_in_at: null,
          checked_in_by: null,
          checkout_requested_at: null,
          checkout_reason: null,
          checkout_planned_date: null,
          checked_out_at: null,
          checked_out_by: null,
          key_returned: false,
          clearance_note: null,
          updated_at: new Date().toISOString(),
        },
      ];
    }

    // WARDEN or ADMIN: return recorded occupancy entries plus sample of allotted students in scope
    const [students, rooms, blocks] = await Promise.all([
      this.repo.getStudents(),
      this.repo.getRooms(),
      this.repo.getBlocks(),
    ]);
    const roomMap = new Map(rooms.map((r) => [r.id, r]));
    const blockMap = new Map(blocks.map((b) => [b.id, b]));
    const results: OccupancyCheckRecord[] = [];

    for (const rec of this.occupancy.values()) {
      if (actor.role === 'ADMIN' || canAccessBlock(actor, rec.block_id)) {
        results.push(structuredClone(rec));
      }
    }

    // Include up to 25 pending allotted residents in scope who haven't checked in yet
    let pendingAdded = 0;
    for (const st of students) {
      if (this.occupancy.has(st.id) || !st.allotted_room_id) continue;
      const rm = roomMap.get(st.allotted_room_id);
      if (!rm) continue;
      if (actor.role === 'WARDEN' && !canAccessBlock(actor, rm.block_id)) continue;
      const blk = blockMap.get(rm.block_id);
      if (!blk) continue;
      results.push({
        student_id: st.id,
        student_code: st.student_code,
        student_name: st.name,
        room_id: rm.id,
        room_label: `${blk.code}-${rm.number}`,
        block_id: blk.id,
        block_name: blk.name,
        status: 'PENDING_CHECKIN',
        key_serial: null,
        room_condition_checkin: null,
        checked_in_at: null,
        checked_in_by: null,
        checkout_requested_at: null,
        checkout_reason: null,
        checkout_planned_date: null,
        checked_out_at: null,
        checked_out_by: null,
        key_returned: false,
        clearance_note: null,
        updated_at: new Date().toISOString(),
      });
      pendingAdded += 1;
      if (pendingAdded >= 25) break;
    }

    return results.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  public async recordCheckIn(
    actor: AuthUserProfile,
    input: {
      student_id: string;
      key_serial: string;
      room_condition_checkin: string;
    }
  ): Promise<OccupancyCheckRecord> {
    if (actor.role !== 'WARDEN' && actor.role !== 'ADMIN') {
      throw new OperationsError('Only Wardens or Administrators may record hostel check-ins.', 403);
    }
    const ctx = await this.resolveStudentRoomContext(input.student_id);
    if (!canAccessBlock(actor, ctx.block.id)) {
      throw new OperationsError(
        'Forbidden: You can only record check-ins within your assigned hostel blocks.',
        403
      );
    }

    const now = new Date().toISOString();
    const record: OccupancyCheckRecord = {
      student_id: ctx.student.id,
      student_code: ctx.student.student_code,
      student_name: ctx.student.name,
      room_id: ctx.room.id,
      room_label: ctx.room_label,
      block_id: ctx.block.id,
      block_name: ctx.block.name,
      status: 'CHECKED_IN',
      key_serial: input.key_serial.trim().toUpperCase(),
      room_condition_checkin: input.room_condition_checkin.trim(),
      checked_in_at: now,
      checked_in_by: actor.email,
      checkout_requested_at: null,
      checkout_reason: null,
      checkout_planned_date: null,
      checked_out_at: null,
      checked_out_by: null,
      key_returned: false,
      clearance_note: null,
      updated_at: now,
    };

    this.occupancy.set(ctx.student.id, record);
    await this.repo.appendAuditLog(actor.email, actor.role, 'RESIDENT_CHECKED_IN', {
      student_id: ctx.student.id,
      room_id: ctx.room.id,
      block_id: ctx.block.id,
      key_serial: record.key_serial,
    });
    return structuredClone(record);
  }

  public async requestCheckOut(
    actor: AuthUserProfile,
    input: {
      planned_date: string;
      reason: string;
    }
  ): Promise<OccupancyCheckRecord> {
    if (actor.role !== 'STUDENT' || !actor.student_id) {
      throw new OperationsError('Only authenticated students may submit a check-out request.', 403);
    }
    const ctx = await this.resolveStudentRoomContext(actor.student_id);
    const existing = this.occupancy.get(actor.student_id);
    const now = new Date().toISOString();

    const record: OccupancyCheckRecord = {
      student_id: ctx.student.id,
      student_code: ctx.student.student_code,
      student_name: ctx.student.name,
      room_id: ctx.room.id,
      room_label: ctx.room_label,
      block_id: ctx.block.id,
      block_name: ctx.block.name,
      status: 'CHECKOUT_REQUESTED',
      key_serial: existing?.key_serial ?? null,
      room_condition_checkin: existing?.room_condition_checkin ?? null,
      checked_in_at: existing?.checked_in_at ?? null,
      checked_in_by: existing?.checked_in_by ?? null,
      checkout_requested_at: now,
      checkout_reason: input.reason.trim(),
      checkout_planned_date: input.planned_date.trim(),
      checked_out_at: null,
      checked_out_by: null,
      key_returned: false,
      clearance_note: null,
      updated_at: now,
    };

    this.occupancy.set(ctx.student.id, record);
    await this.repo.appendAuditLog(actor.email, actor.role, 'RESIDENT_CHECKOUT_REQUESTED', {
      student_id: ctx.student.id,
      room_id: ctx.room.id,
      planned_date: record.checkout_planned_date,
    });
    return structuredClone(record);
  }

  public async completeCheckOut(
    actor: AuthUserProfile,
    studentId: string,
    input: {
      key_returned: boolean;
      clearance_note: string;
      vacate_room: boolean;
    }
  ): Promise<OccupancyCheckRecord> {
    if (actor.role !== 'WARDEN' && actor.role !== 'ADMIN') {
      throw new OperationsError('Only Wardens or Administrators may complete hostel check-outs.', 403);
    }
    const existing = this.occupancy.get(studentId);
    const ctx = await this.resolveStudentRoomContext(studentId);
    if (!canAccessBlock(actor, ctx.block.id)) {
      throw new OperationsError(
        'Forbidden: You can only complete check-outs within your assigned hostel blocks.',
        403
      );
    }
    if (!input.key_returned) {
      throw new OperationsError(
        'Room key return confirmation is mandatory before final hostel check-out clearance.',
        400
      );
    }

    if (input.vacate_room) {
      await this.repo.vacateStudentRoom(studentId, actor.email, actor.role);
    }

    const now = new Date().toISOString();
    const record: OccupancyCheckRecord = {
      student_id: ctx.student.id,
      student_code: ctx.student.student_code,
      student_name: ctx.student.name,
      room_id: ctx.room.id,
      room_label: ctx.room_label,
      block_id: ctx.block.id,
      block_name: ctx.block.name,
      status: 'CHECKED_OUT',
      key_serial: existing?.key_serial ?? null,
      room_condition_checkin: existing?.room_condition_checkin ?? null,
      checked_in_at: existing?.checked_in_at ?? null,
      checked_in_by: existing?.checked_in_by ?? null,
      checkout_requested_at: existing?.checkout_requested_at ?? now,
      checkout_reason: existing?.checkout_reason ?? 'Institutional check-out',
      checkout_planned_date: existing?.checkout_planned_date ?? now.slice(0, 10),
      checked_out_at: now,
      checked_out_by: actor.email,
      key_returned: true,
      clearance_note: input.clearance_note.trim(),
      updated_at: now,
    };

    this.occupancy.set(ctx.student.id, record);
    await this.repo.appendAuditLog(actor.email, actor.role, 'RESIDENT_CHECKED_OUT', {
      student_id: ctx.student.id,
      room_id: ctx.room.id,
      vacated: input.vacate_room,
      clearance_note: record.clearance_note,
    });
    return structuredClone(record);
  }

  // =========================================================================
  // B. COMPLAINTS & DATA-MINIMIZED MAINTENANCE ESCALATION
  // =========================================================================

  public async listComplaints(actor: AuthUserProfile): Promise<HostelComplaint[]> {
    this.assertNotMaintenance(actor);
    const all = Array.from(this.complaints.values()).sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
    if (actor.role === 'STUDENT') {
      return all.filter((c) => c.student_id === actor.student_id).map((c) => structuredClone(c));
    }
    if (actor.role === 'ADMIN') {
      return all.map((c) => structuredClone(c));
    }
    return all
      .filter((c) => canAccessBlock(actor, c.block_id))
      .map((c) => structuredClone(c));
  }

  public async createComplaint(
    actor: AuthUserProfile,
    input: {
      category: ComplaintCategory;
      priority: MaintenancePriority;
      subject: string;
      description: string;
    }
  ): Promise<HostelComplaint> {
    if (actor.role !== 'STUDENT' || !actor.student_id) {
      throw new OperationsError('Only authenticated students may submit hostel complaints.', 403);
    }
    const ctx = await this.resolveStudentRoomContext(actor.student_id);
    const now = new Date().toISOString();
    const id = `cmp-${crypto.randomUUID().slice(0, 8)}`;
    const code = `CMP-2026-${this.complaintSeq++}`;

    const complaint: HostelComplaint = {
      id,
      complaint_code: code,
      student_id: ctx.student.id,
      student_code: ctx.student.student_code,
      student_name: ctx.student.name,
      block_id: ctx.block.id,
      block_name: ctx.block.name,
      room_id: ctx.room.id,
      room_number: ctx.room.number,
      floor: ctx.room.floor,
      category: input.category,
      priority: input.priority,
      subject: input.subject.trim(),
      description: input.description.trim(),
      status: 'OPEN',
      resolution_note: null,
      handled_by: null,
      escalated_maintenance_task_id: null,
      escalated_ticket_code: null,
      created_at: now,
      updated_at: now,
    };

    this.complaints.set(id, complaint);
    await this.repo.appendAuditLog(actor.email, actor.role, 'HOSTEL_COMPLAINT_CREATED', {
      complaint_id: id,
      complaint_code: code,
      block_id: ctx.block.id,
      category: complaint.category,
    });
    return structuredClone(complaint);
  }

  public async updateComplaint(
    actor: AuthUserProfile,
    complaintId: string,
    input: {
      status: ComplaintStatus;
      resolution_note: string;
    }
  ): Promise<HostelComplaint> {
    if (actor.role !== 'WARDEN' && actor.role !== 'ADMIN') {
      throw new OperationsError('Only Wardens or Administrators may update complaints.', 403);
    }
    const existing = this.complaints.get(complaintId);
    if (!existing) {
      throw new OperationsError('Complaint not found.', 404);
    }
    if (!canAccessBlock(actor, existing.block_id)) {
      throw new OperationsError(
        'Forbidden: You can only manage complaints inside your assigned hostel blocks.',
        403
      );
    }

    existing.status = input.status;
    existing.resolution_note = input.resolution_note.trim();
    existing.handled_by = actor.email;
    existing.updated_at = new Date().toISOString();

    await this.repo.appendAuditLog(actor.email, actor.role, 'HOSTEL_COMPLAINT_UPDATED', {
      complaint_id: existing.id,
      status: existing.status,
    });
    return structuredClone(existing);
  }

  /**
   * Escalates an infrastructure complaint into a strictly data-minimized Maintenance Work Order.
   * Strips all student PII (name, email, student_code, personal text) before handing off to MaintenanceTaskService.
   */
  public async escalateComplaintToMaintenance(
    actor: AuthUserProfile,
    complaintId: string,
    input: {
      sanitized_summary: string;
      location_detail: string;
      assigned_to_id: string | null;
      assigned_to_name: string | null;
    }
  ): Promise<{ complaint: HostelComplaint; maintenance_task: MaintenanceTask }> {
    if (actor.role !== 'WARDEN' && actor.role !== 'ADMIN') {
      throw new OperationsError('Only Wardens or Administrators may dispatch maintenance work orders.', 403);
    }
    const existing = this.complaints.get(complaintId);
    if (!existing) {
      throw new OperationsError('Complaint not found.', 404);
    }
    if (!canAccessBlock(actor, existing.block_id)) {
      throw new OperationsError(
        'Forbidden: You can only escalate complaints from your assigned hostel blocks.',
        403
      );
    }
    if (existing.escalated_maintenance_task_id) {
      throw new OperationsError(
        `Complaint ${existing.complaint_code} is already escalated to work order ${existing.escalated_ticket_code}.`,
        409
      );
    }

    const maintCategory: MaintenanceCategory = MAINTENANCE_CATEGORIES.has(existing.category)
      ? (existing.category as MaintenanceCategory)
      : 'room_infrastructure';

    // Data minimization: zero student PII is passed to MaintenanceTaskService
    const task = this.maintenanceService.createTask(actor, {
      block_id: existing.block_id,
      block_name: existing.block_name,
      floor: existing.floor,
      room_number: existing.room_number,
      category: maintCategory,
      priority: existing.priority,
      summary: input.sanitized_summary.trim(),
      location_detail: input.location_detail.trim(),
      assigned_to_id: input.assigned_to_id,
      assigned_to_name: input.assigned_to_name,
    });

    existing.status = 'IN_PROGRESS';
    existing.handled_by = actor.email;
    existing.escalated_maintenance_task_id = task.id;
    existing.escalated_ticket_code = task.ticket_code;
    existing.resolution_note = `Dispatched sanitized maintenance work order ${task.ticket_code}.`;
    existing.updated_at = new Date().toISOString();

    await this.repo.appendAuditLog(actor.email, actor.role, 'COMPLAINT_ESCALATED_TO_MAINTENANCE', {
      complaint_id: existing.id,
      maintenance_task_id: task.id,
      ticket_code: task.ticket_code,
      block_id: existing.block_id,
    });

    return {
      complaint: structuredClone(existing),
      maintenance_task: task,
    };
  }

  // =========================================================================
  // C. GATE PASSES (LEAVE / OVERNIGHT / MEDICAL)
  // =========================================================================

  public async listGatePasses(actor: AuthUserProfile): Promise<GatePassRequest[]> {
    this.assertNotMaintenance(actor);
    const all = Array.from(this.gatePasses.values()).sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
    if (actor.role === 'STUDENT') {
      return all.filter((g) => g.student_id === actor.student_id).map((g) => structuredClone(g));
    }
    if (actor.role === 'ADMIN') {
      return all.map((g) => structuredClone(g));
    }
    return all
      .filter((g) => canAccessBlock(actor, g.block_id))
      .map((g) => structuredClone(g));
  }

  public async createGatePass(
    actor: AuthUserProfile,
    input: {
      pass_type: GatePassType;
      destination: string;
      reason: string;
      departure_at: string;
      expected_return_at: string;
      emergency_contact_phone: string;
    }
  ): Promise<GatePassRequest> {
    if (actor.role !== 'STUDENT' || !actor.student_id) {
      throw new OperationsError('Only authenticated students may apply for hostel gate passes.', 403);
    }
    if (Date.parse(input.expected_return_at) <= Date.parse(input.departure_at)) {
      throw new OperationsError('Expected return time must be after departure time.', 400);
    }

    const ctx = await this.resolveStudentRoomContext(actor.student_id);
    const now = new Date().toISOString();
    const id = `gp-${crypto.randomUUID().slice(0, 8)}`;

    const pass: GatePassRequest = {
      id,
      pass_code: null,
      student_id: ctx.student.id,
      student_code: ctx.student.student_code,
      student_name: ctx.student.name,
      block_id: ctx.block.id,
      block_name: ctx.block.name,
      room_label: ctx.room_label,
      pass_type: input.pass_type,
      destination: input.destination.trim(),
      reason: input.reason.trim(),
      departure_at: input.departure_at,
      expected_return_at: input.expected_return_at,
      emergency_contact_phone: input.emergency_contact_phone.trim(),
      status: 'PENDING',
      reviewed_by: null,
      review_note: null,
      gate_exit_at: null,
      gate_return_at: null,
      created_at: now,
      updated_at: now,
    };

    this.gatePasses.set(id, pass);
    await this.repo.appendAuditLog(actor.email, actor.role, 'GATE_PASS_REQUESTED', {
      gate_pass_id: id,
      pass_type: pass.pass_type,
      block_id: ctx.block.id,
    });
    return structuredClone(pass);
  }

  public async reviewGatePass(
    actor: AuthUserProfile,
    passId: string,
    input: {
      action: 'APPROVE' | 'REJECT' | 'MARK_EXITED' | 'MARK_RETURNED';
      review_note?: string;
    }
  ): Promise<GatePassRequest> {
    if (actor.role !== 'WARDEN' && actor.role !== 'ADMIN') {
      throw new OperationsError('Only Wardens or Administrators may review or log gate passes.', 403);
    }
    const pass = this.gatePasses.get(passId);
    if (!pass) {
      throw new OperationsError('Gate pass request not found.', 404);
    }
    if (!canAccessBlock(actor, pass.block_id)) {
      throw new OperationsError(
        'Forbidden: You can only approve or log gate passes for your assigned hostel blocks.',
        403
      );
    }

    const now = new Date().toISOString();
    if (input.action === 'APPROVE') {
      pass.status = 'APPROVED';
      pass.pass_code = pass.pass_code ?? `GP-2026-${this.gatePassSeq++}`;
      pass.reviewed_by = actor.email;
      pass.review_note = input.review_note?.trim() || 'Approved by hostel warden desk.';
    } else if (input.action === 'REJECT') {
      pass.status = 'REJECTED';
      pass.reviewed_by = actor.email;
      pass.review_note = input.review_note?.trim() || 'Gate pass request declined.';
    } else if (input.action === 'MARK_EXITED') {
      if (pass.status !== 'APPROVED') {
        throw new OperationsError('Only APPROVED gate passes can be marked exited at gate.', 409);
      }
      pass.status = 'CHECKED_OUT_GATE';
      pass.gate_exit_at = now;
    } else if (input.action === 'MARK_RETURNED') {
      if (pass.status !== 'CHECKED_OUT_GATE' && pass.status !== 'APPROVED') {
        throw new OperationsError('Only active gate passes can be marked returned.', 409);
      }
      pass.status = 'RETURNED';
      pass.gate_return_at = now;
    }
    pass.updated_at = now;

    await this.repo.appendAuditLog(actor.email, actor.role, `GATE_PASS_${input.action}`, {
      gate_pass_id: pass.id,
      pass_code: pass.pass_code,
      status: pass.status,
    });
    return structuredClone(pass);
  }

  public async cancelGatePass(actor: AuthUserProfile, passId: string): Promise<GatePassRequest> {
    if (actor.role !== 'STUDENT' || !actor.student_id) {
      throw new OperationsError('Only students may cancel their own gate pass.', 403);
    }
    const pass = this.gatePasses.get(passId);
    if (!pass) {
      throw new OperationsError('Gate pass not found.', 404);
    }
    if (pass.student_id !== actor.student_id) {
      throw new OperationsError('Forbidden: You may only cancel your own gate pass.', 403);
    }
    if (pass.status !== 'PENDING' && pass.status !== 'APPROVED') {
      throw new OperationsError(`Cannot cancel gate pass in status ${pass.status}.`, 409);
    }
    pass.status = 'CANCELLED';
    pass.updated_at = new Date().toISOString();

    await this.repo.appendAuditLog(actor.email, actor.role, 'GATE_PASS_CANCELLED', {
      gate_pass_id: pass.id,
    });
    return structuredClone(pass);
  }

  // =========================================================================
  // D. VISITOR REGISTER (DATA-MINIMIZED ID VERIFICATION)
  // =========================================================================

  public async listVisitors(actor: AuthUserProfile): Promise<VisitorEntry[]> {
    this.assertNotMaintenance(actor);
    const all = Array.from(this.visitors.values()).sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
    if (actor.role === 'STUDENT') {
      return all.filter((v) => v.student_id === actor.student_id).map((v) => structuredClone(v));
    }
    if (actor.role === 'ADMIN') {
      return all.map((v) => structuredClone(v));
    }
    return all
      .filter((v) => canAccessBlock(actor, v.block_id))
      .map((v) => structuredClone(v));
  }

  public async registerVisitor(
    actor: AuthUserProfile,
    input: {
      student_id?: string;
      visitor_name: string;
      relation: string;
      id_type: VisitorEntry['id_type'];
      id_last_four: string;
      purpose: string;
      scheduled_date: string;
    }
  ): Promise<VisitorEntry> {
    this.assertNotMaintenance(actor);
    const targetStudentId =
      actor.role === 'STUDENT' ? actor.student_id ?? '' : input.student_id ?? '';
    if (!targetStudentId) {
      throw new OperationsError('Host student ID is required to register a visitor.', 400);
    }

    const ctx = await this.resolveStudentRoomContext(targetStudentId);
    if (actor.role === 'WARDEN' && !canAccessBlock(actor, ctx.block.id)) {
      throw new OperationsError(
        'Forbidden: You can only register visitors for students in your assigned blocks.',
        403
      );
    }

    const now = new Date().toISOString();
    const id = `vis-${crypto.randomUUID().slice(0, 8)}`;
    const code = `VIS-2026-${this.visitorSeq++}`;

    const entry: VisitorEntry = {
      id,
      visitor_code: code,
      student_id: ctx.student.id,
      student_code: ctx.student.student_code,
      student_name: ctx.student.name,
      block_id: ctx.block.id,
      block_name: ctx.block.name,
      room_label: ctx.room_label,
      visitor_name: input.visitor_name.trim(),
      relation: input.relation.trim(),
      id_type: input.id_type,
      id_last_four: input.id_last_four.trim().slice(-4),
      purpose: input.purpose.trim(),
      scheduled_date: input.scheduled_date.trim(),
      status: 'SCHEDULED',
      checked_in_at: null,
      checked_out_at: null,
      verified_by: null,
      created_at: now,
      updated_at: now,
    };

    this.visitors.set(id, entry);
    await this.repo.appendAuditLog(actor.email, actor.role, 'VISITOR_REGISTERED', {
      visitor_id: id,
      visitor_code: code,
      block_id: ctx.block.id,
    });
    return structuredClone(entry);
  }

  public async updateVisitorStatus(
    actor: AuthUserProfile,
    visitorId: string,
    status: VisitorStatus
  ): Promise<VisitorEntry> {
    if (actor.role !== 'WARDEN' && actor.role !== 'ADMIN') {
      throw new OperationsError('Only Wardens or Administrators may log visitor entry/exit.', 403);
    }
    const entry = this.visitors.get(visitorId);
    if (!entry) {
      throw new OperationsError('Visitor record not found.', 404);
    }
    if (!canAccessBlock(actor, entry.block_id)) {
      throw new OperationsError(
        'Forbidden: You can only manage visitor logs for your assigned hostel blocks.',
        403
      );
    }

    const now = new Date().toISOString();
    entry.status = status;
    entry.verified_by = actor.email;
    if (status === 'CHECKED_IN') {
      entry.checked_in_at = now;
    } else if (status === 'CHECKED_OUT') {
      entry.checked_out_at = now;
    }
    entry.updated_at = now;

    await this.repo.appendAuditLog(actor.email, actor.role, 'VISITOR_STATUS_UPDATED', {
      visitor_id: entry.id,
      status,
    });
    return structuredClone(entry);
  }

  public getOverdueActiveGatePasses(nowIso = new Date().toISOString()): GatePassRequest[] {
    const nowMs = Date.parse(nowIso);
    const overdue: GatePassRequest[] = [];
    for (const pass of this.gatePasses.values()) {
      if (pass.status === 'CHECKED_OUT_GATE' && Date.parse(pass.expected_return_at) < nowMs) {
        overdue.push(structuredClone(pass));
      }
    }
    return overdue;
  }

  public async expireStaleScheduledVisitors(todayIso = new Date().toISOString().slice(0, 10)): Promise<VisitorEntry[]> {
    const expired: VisitorEntry[] = [];
    const now = new Date().toISOString();
    for (const entry of this.visitors.values()) {
      if (entry.status === 'SCHEDULED' && entry.scheduled_date < todayIso) {
        entry.status = 'DENIED';
        entry.verified_by = 'system:expired-visitor-sweep';
        entry.updated_at = now;
        expired.push(structuredClone(entry));
      }
    }
    if (expired.length > 0) {
      await this.repo.appendAuditLog('system@hostelhub.local', 'system', 'EXPIRED_VISITORS_SWEPT', {
        expired_count: expired.length,
        visitor_codes: expired.map((v) => v.visitor_code),
      });
    }
    return expired;
  }
}

let sharedOperationsService: HostelOperationsService | null = null;

export function getOperationsService(
  repo: IHostelRepository,
  maintenanceService: MaintenanceTaskService
): HostelOperationsService {
  if (!sharedOperationsService) {
    sharedOperationsService = new HostelOperationsService(repo, maintenanceService);
  }
  return sharedOperationsService;
}

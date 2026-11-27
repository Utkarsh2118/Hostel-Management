import crypto from 'node:crypto';
import {
  AllotmentRulesConfig,
  AllotmentRun,
  Announcement,
  AuditLog,
  Block,
  Dispute,
  DisputeStatus,
  Room,
  Student,
  SwapProposal,
  SwapRequest,
  SwapWantedCriteria,
  UserRole,
} from '../types.ts';
import { runDeterministicAllotment } from '../allotment/engine.ts';
import { detectValidSwapCycles, validateProposalExecution } from '../swap/engine.ts';
import {
  CreateRoomInput,
  IHostelRepository,
  UpdateRoomInput,
  UpdateStudentInput,
} from './interface.ts';
import { generateSyntheticDataset, SeedDataset } from './seedData.ts';

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * In-Memory Repository implementation behind IHostelRepository.
 * Designed with explicit snapshot/rollback transactional semantics for atomic swap
 * execution so Supabase (PostgreSQL RPC / transaction) can replace it without
 * touching any business logic or UI code.
 */
export class InMemoryHostelRepository implements IHostelRepository {
  private blocks = new Map<string, Block>();
  private rooms = new Map<string, Room>();
  private students = new Map<string, Student>();
  private runs: AllotmentRun[] = [];
  private swapRequests = new Map<string, SwapRequest>();
  private swapProposals = new Map<string, SwapProposal>();
  private announcements: Announcement[] = [];
  private disputes = new Map<string, Dispute>();
  private auditLogs: AuditLog[] = [];
  private rules: AllotmentRulesConfig;

  constructor(dataset?: SeedDataset) {
    const seed = dataset ?? generateSyntheticDataset(300, 'VIDYAVIHAR-2026');
    for (const b of seed.blocks) this.blocks.set(b.id, clone(b));
    for (const r of seed.rooms) this.rooms.set(r.id, clone(r));
    for (const s of seed.students) this.students.set(s.id, clone(s));
    this.runs = clone(seed.runs);
    for (const req of seed.swapRequests) this.swapRequests.set(req.id, clone(req));
    for (const prop of seed.swapProposals) this.swapProposals.set(prop.id, clone(prop));
    this.announcements = clone(seed.announcements);
    for (const d of seed.disputes) this.disputes.set(d.id, clone(d));
    this.auditLogs = clone(seed.auditLogs);
    this.rules = clone(seed.rules);
  }

  public async getBlocks(): Promise<Block[]> {
    return Array.from(this.blocks.values()).map(clone);
  }

  public async getBlockById(id: string): Promise<Block | null> {
    const b = this.blocks.get(id);
    return b ? clone(b) : null;
  }

  public async getRooms(filters?: {
    block_id?: string;
    floor?: number;
    ac?: boolean;
    capacity?: number;
    available_only?: boolean;
    tags?: Room['tags'];
  }): Promise<Room[]> {
    let list = Array.from(this.rooms.values());
    if (filters) {
      if (filters.block_id) {
        list = list.filter((r) => r.block_id === filters.block_id);
      }
      if (filters.floor !== undefined) {
        list = list.filter((r) => r.floor === filters.floor);
      }
      if (filters.ac !== undefined) {
        list = list.filter((r) => r.ac === filters.ac);
      }
      if (filters.capacity !== undefined) {
        list = list.filter((r) => r.capacity === filters.capacity);
      }
      if (filters.available_only) {
        list = list.filter((r) => r.occupants.length < r.capacity);
      }
      if (filters.tags && filters.tags.length > 0) {
        list = list.filter((r) => filters.tags!.every((t) => r.tags.includes(t)));
      }
    }
    return list
      .sort((a, b) => a.block_id.localeCompare(b.block_id) || a.floor - b.floor || a.number.localeCompare(b.number))
      .map(clone);
  }

  public async getRoomById(id: string): Promise<Room | null> {
    const r = this.rooms.get(id);
    return r ? clone(r) : null;
  }

  public async createRoom(
    input: CreateRoomInput,
    actor: string,
    actorRole: UserRole = 'ADMIN'
  ): Promise<Room> {
    const block = this.blocks.get(input.block_id);
    if (!block) {
      throw new Error(`Block '${input.block_id}' does not exist.`);
    }
    if (input.floor > block.floors) {
      throw new Error(`Floor ${input.floor} exceeds ${block.name}'s ${block.floors} floors.`);
    }
    const id = `${block.code.toLowerCase()}-${input.number.toLowerCase()}`;
    if (this.rooms.has(id)) {
      throw new Error(`Room ${block.code}-${input.number} already exists.`);
    }
    const room: Room = {
      id,
      block_id: input.block_id,
      floor: input.floor,
      number: input.number,
      capacity: input.capacity,
      ac: input.ac,
      tags: Array.from(new Set(input.tags)),
      occupants: [],
    };
    this.rooms.set(room.id, room);
    await this.appendAuditLog(actor, actorRole, 'ROOM_CREATED', {
      room_id: room.id,
      block_id: room.block_id,
      capacity: room.capacity,
    });
    return clone(room);
  }

  public async updateRoom(
    id: string,
    input: UpdateRoomInput,
    actor: string,
    actorRole: UserRole = 'ADMIN'
  ): Promise<Room> {
    const existing = this.rooms.get(id);
    if (!existing) {
      throw new Error(`Room '${id}' not found.`);
    }
    if (input.capacity !== undefined && input.capacity < existing.occupants.length) {
      throw new Error(
        `Cannot reduce capacity to ${input.capacity} while ${existing.occupants.length} student(s) occupy the room.`
      );
    }
    const updated: Room = {
      ...existing,
      capacity: input.capacity ?? existing.capacity,
      ac: input.ac ?? existing.ac,
      tags: input.tags ? Array.from(new Set(input.tags)) : existing.tags,
    };
    this.rooms.set(id, updated);
    await this.appendAuditLog(actor, actorRole, 'ROOM_UPDATED', {
      room_id: id,
      changes: input,
    });
    return clone(updated);
  }

  public async getStudents(): Promise<Student[]> {
    return Array.from(this.students.values()).map(clone);
  }

  public async getStudentById(id: string): Promise<Student | null> {
    const s = this.students.get(id);
    return s ? clone(s) : null;
  }

  public async createStudentRecord(input: {
    id: string;
    student_code: string;
    name: string;
    email: string;
    year: 1 | 2 | 3 | 4;
    branch: string;
    gender: Student['gender'];
  }): Promise<Student> {
    const student: Student = {
      id: input.id,
      student_code: input.student_code,
      name: input.name,
      email: input.email,
      year: input.year,
      branch: input.branch,
      gender: input.gender,
      cgpa_band: 'B+',
      sleep_schedule: 'early',
      study_style: 'quiet',
      cleanliness: 4,
      about_me: '',
      preferences: [],
      roommate_requests: [],
      allotted_room_id: null,
    };
    this.students.set(student.id, student);
    await this.appendAuditLog(student.email, 'STUDENT', 'STUDENT_ACCOUNT_REGISTERED', {
      student_id: student.id,
      student_code: student.student_code,
    });
    return clone(student);
  }

  public async updateStudent(
    id: string,
    input: UpdateStudentInput,
    actor: string
  ): Promise<Student> {
    const existing = this.students.get(id);
    if (!existing) {
      throw new Error(`Student '${id}' not found.`);
    }

    // Validate preferred room IDs belong to gender-eligible blocks if provided
    if (input.preferences) {
      const targetGender = input.gender ?? existing.gender;
      for (const roomId of input.preferences) {
        const room = this.rooms.get(roomId);
        if (!room) {
          throw new Error(`Preferred room '${roomId}' does not exist.`);
        }
        const block = this.blocks.get(room.block_id);
        if (
          !block ||
          (targetGender === 'male' && block.gender_type !== 'boys') ||
          (targetGender === 'female' && block.gender_type !== 'girls')
        ) {
          throw new Error(
            `Room ${room.number} in ${block?.name ?? 'unknown block'} is not eligible for ${targetGender} allotment.`
          );
        }
      }
    }

    const updated: Student = {
      ...existing,
      ...input,
      preferences: input.preferences ? input.preferences.slice(0, 5) : existing.preferences,
      roommate_requests: input.roommate_requests
        ? input.roommate_requests.filter((rid) => rid !== id && this.students.has(rid))
        : existing.roommate_requests,
    };

    this.students.set(id, updated);
    await this.appendAuditLog(actor, 'STUDENT', 'STUDENT_PROFILE_UPDATED', {
      student_id: id,
      preferences_count: updated.preferences.length,
    });
    return clone(updated);
  }

  public async toggleRoommateRequest(
    studentId: string,
    targetStudentId: string
  ): Promise<Student> {
    const student = this.students.get(studentId);
    const target = this.students.get(targetStudentId);
    if (!student || !target) {
      throw new Error('Student record not found.');
    }
    if (student.id === target.id) {
      throw new Error('You cannot send a roommate request to yourself.');
    }
    if (student.gender !== target.gender) {
      throw new Error('Roommate requests are permitted only within same-gender hostel blocks.');
    }

    const exists = student.roommate_requests.includes(targetStudentId);
    if (exists) {
      student.roommate_requests = student.roommate_requests.filter((id) => id !== targetStudentId);
    } else {
      if (student.roommate_requests.length >= 3) {
        throw new Error('You may keep up to 3 active roommate requests at a time.');
      }
      student.roommate_requests = [...student.roommate_requests, targetStudentId];
    }

    this.students.set(student.id, student);
    await this.appendAuditLog(student.email, 'STUDENT', exists ? 'ROOMMATE_REQUEST_REMOVED' : 'ROOMMATE_REQUEST_SENT', {
      student_id: student.id,
      target_student_id: targetStudentId,
    });
    return clone(student);
  }

  public async getAllotmentRules(): Promise<AllotmentRulesConfig> {
    return clone(this.rules);
  }

  public async updateAllotmentRules(
    rules: AllotmentRulesConfig,
    actor: string
  ): Promise<AllotmentRulesConfig> {
    this.rules = clone(rules);
    await this.appendAuditLog(actor, 'ADMIN', 'ALLOTMENT_RULES_UPDATED', { ...rules });
    return clone(this.rules);
  }

  public async getAllotmentRuns(): Promise<AllotmentRun[]> {
    return clone(this.runs).sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    );
  }

  public async getAllotmentRunById(id: string): Promise<AllotmentRun | null> {
    const found = this.runs.find((r) => r.id === id);
    return found ? clone(found) : null;
  }

  public async executeAllotmentRun(params: {
    label: string;
    seed: string;
    rules: AllotmentRulesConfig;
    apply_immediately: boolean;
    actor: string;
  }): Promise<AllotmentRun> {
    const students = Array.from(this.students.values());
    const rooms = Array.from(this.rooms.values());
    const blocks = Array.from(this.blocks.values());

    const output = runDeterministicAllotment({
      students,
      rooms,
      blocks,
      seed: params.seed,
      rules: params.rules,
    });

    const run: AllotmentRun = {
      id: `run-${crypto.randomUUID().slice(0, 8)}`,
      label: params.label,
      seed: params.seed,
      rules_snapshot: clone(params.rules),
      results: output.results,
      unallotted: output.unallotted,
      stats: output.stats,
      applied: false,
      created_by: params.actor,
      created_at: new Date().toISOString(),
    };

    this.runs.unshift(run);
    await this.appendAuditLog(params.actor, 'ADMIN', 'ALLOTMENT_RUN_EXECUTED', {
      run_id: run.id,
      seed: run.seed,
      allotted: run.stats.allotted_count,
      unallotted: run.stats.unallotted_count,
      runtime_ms: run.stats.runtime_ms,
    });

    if (params.apply_immediately) {
      return this.applyAllotmentRun(run.id, params.actor);
    }

    return clone(run);
  }

  public async applyAllotmentRun(runId: string, actor: string): Promise<AllotmentRun> {
    const targetRun = this.runs.find((r) => r.id === runId);
    if (!targetRun) {
      throw new Error(`Allotment run '${runId}' not found.`);
    }

    // Clear current occupants across all rooms & students, then apply run assignments atomically.
    const nextRoomOcc = new Map<string, string[]>();
    for (const room of this.rooms.values()) {
      nextRoomOcc.set(room.id, []);
    }

    for (const assignment of targetRun.results) {
      const room = this.rooms.get(assignment.room_id);
      if (!room) continue;
      const occ = nextRoomOcc.get(room.id)!;
      if (occ.length >= room.capacity) {
        throw new Error(`Cannot apply run: room ${room.number} capacity exceeded.`);
      }
      occ.push(assignment.student_id);
    }

    for (const [roomId, occ] of nextRoomOcc.entries()) {
      const room = this.rooms.get(roomId)!;
      room.occupants = occ;
    }

    const assignedMap = new Map(targetRun.results.map((r) => [r.student_id, r.room_id]));
    for (const student of this.students.values()) {
      student.allotted_room_id = assignedMap.get(student.id) ?? null;
    }

    for (const r of this.runs) {
      r.applied = r.id === runId;
    }

    // Cancel stale pending swap proposals because room assignments changed
    for (const prop of this.swapProposals.values()) {
      if (prop.status === 'pending') {
        prop.status = 'cancelled';
      }
    }

    await this.appendAuditLog(actor, 'ADMIN', 'ALLOTMENT_RUN_APPLIED', {
      run_id: runId,
      allotted_count: targetRun.stats.allotted_count,
    });

    return clone(targetRun);
  }

  public async getSwapRequests(): Promise<SwapRequest[]> {
    return Array.from(this.swapRequests.values())
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map(clone);
  }

  public async createSwapRequest(
    studentId: string,
    criteria: SwapWantedCriteria
  ): Promise<SwapRequest> {
    const student = this.students.get(studentId);
    if (!student) {
      throw new Error('Student not found.');
    }
    if (!student.allotted_room_id) {
      throw new Error('Only students with an active room allotment can post a swap request.');
    }

    // Prevent duplicate open/matched swap requests from the same student
    for (const existing of this.swapRequests.values()) {
      if (
        existing.student_id === studentId &&
        (existing.status === 'open' || existing.status === 'matched')
      ) {
        throw new Error(
          'You already have an active swap request on the board. Cancel it first before posting a new one.'
        );
      }
    }

    const request: SwapRequest = {
      id: `swreq-${crypto.randomUUID().slice(0, 6)}`,
      student_id: studentId,
      current_room_id: student.allotted_room_id,
      wanted_criteria: clone(criteria),
      status: 'open',
      created_at: new Date().toISOString(),
    };

    this.swapRequests.set(request.id, request);
    await this.appendAuditLog(student.email, 'STUDENT', 'SWAP_REQUEST_CREATED', {
      request_id: request.id,
      current_room_id: request.current_room_id,
    });

    return clone(request);
  }

  public async cancelSwapRequest(
    requestId: string,
    studentId: string,
    isPrivileged: boolean,
    actorEmail?: string,
    actorRole?: UserRole
  ): Promise<SwapRequest> {
    const req = this.swapRequests.get(requestId);
    if (!req) {
      throw new Error(`Swap request '${requestId}' not found.`);
    }
    if (!isPrivileged && req.student_id !== studentId) {
      throw new Error('You can only cancel your own swap request.');
    }
    if (req.status === 'executed') {
      throw new Error('Executed swap requests cannot be cancelled.');
    }

    req.status = 'cancelled';
    this.swapRequests.set(req.id, req);

    // Release any pending proposal containing this request so other participants are freed
    for (const prop of this.swapProposals.values()) {
      if (
        prop.status === 'pending' &&
        prop.cycle.some((step) => step.request_id === req.id)
      ) {
        prop.status = 'cancelled';
        this.releaseProposalParticipants(prop, req.id);
      }
    }

    await this.appendAuditLog(
      actorEmail ?? (isPrivileged ? 'staff@hostelhub.local' : studentId),
      actorRole ?? (isPrivileged ? 'ADMIN' : 'STUDENT'),
      'SWAP_REQUEST_CANCELLED',
      {
        request_id: req.id,
      }
    );

    return clone(req);
  }

  private expireStaleProposals(nowMs: number): void {
    for (const prop of this.swapProposals.values()) {
      if (prop.status === 'pending' && Date.parse(prop.expires_at) <= nowMs) {
        prop.status = 'expired';
        this.releaseProposalParticipants(prop);
        this.auditLogs.unshift({
          id: `aud-${crypto.randomUUID().slice(0, 8)}`,
          actor: 'system',
          actor_role: 'system',
          action: 'SWAP_PROPOSAL_EXPIRED',
          payload: { proposal_id: prop.id },
          timestamp: new Date(nowMs).toISOString(),
        });
      }
    }
  }

  private releaseProposalParticipants(
    proposal: SwapProposal,
    exceptRequestId?: string
  ): void {
    for (const step of proposal.cycle) {
      if (step.request_id === exceptRequestId) continue;
      const req = this.swapRequests.get(step.request_id);
      if (req && req.status === 'matched') {
        req.status = 'open';
        this.swapRequests.set(req.id, req);
      }
    }
  }

  public async getSwapProposals(nowMs = Date.now()): Promise<SwapProposal[]> {
    this.expireStaleProposals(nowMs);
    return Array.from(this.swapProposals.values())
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map(clone);
  }

  public async discoverAndCreateProposals(
    actor: string,
    nowMs = Date.now()
  ): Promise<SwapProposal[]> {
    this.expireStaleProposals(nowMs);

    // Exclude students currently locked in a pending proposal to prevent conflicting concurrent swaps
    const lockedStudents = new Set<string>();
    for (const prop of this.swapProposals.values()) {
      if (prop.status === 'pending') {
        for (const step of prop.cycle) {
          lockedStudents.add(step.student_id);
        }
      }
    }

    const candidates = detectValidSwapCycles({
      requests: Array.from(this.swapRequests.values()),
      students: Array.from(this.students.values()),
      rooms: Array.from(this.rooms.values()),
      blocks: Array.from(this.blocks.values()),
      excludedStudentIds: lockedStudents,
      maxCycles: 20,
    });

    const created: SwapProposal[] = [];

    // Greedily pick highest-scoring vertex-disjoint cycles so no student is placed in two overlapping proposals
    for (const candidate of candidates) {
      const overlaps = candidate.cycle.some((step) => lockedStudents.has(step.student_id));
      if (overlaps) continue;

      const acceptances: Record<string, boolean> = {};
      for (const step of candidate.cycle) {
        acceptances[step.student_id] = false;
        lockedStudents.add(step.student_id);
        const req = this.swapRequests.get(step.request_id);
        if (req) {
          req.status = 'matched';
          this.swapRequests.set(req.id, req);
        }
      }

      const proposal: SwapProposal = {
        id: `swprop-${crypto.randomUUID().slice(0, 6)}`,
        cycle: candidate.cycle,
        cycle_length: candidate.cycle_length,
        score: candidate.score,
        feasibility_summary: candidate.feasibility_summary,
        acceptances,
        rejected_by: null,
        status: 'pending',
        created_at: new Date(nowMs).toISOString(),
        expires_at: new Date(nowMs + 72 * 60 * 60 * 1000).toISOString(),
        executed_at: null,
      };

      this.swapProposals.set(proposal.id, proposal);
      created.push(clone(proposal));

      await this.appendAuditLog(actor, 'system', 'SWAP_PROPOSAL_CREATED', {
        proposal_id: proposal.id,
        cycle_length: proposal.cycle_length,
        participants: proposal.cycle.map((s) => s.student_id),
      });
    }

    return created;
  }

  public async respondToSwapProposal(params: {
    proposalId: string;
    studentId: string;
    action: 'accept' | 'reject';
    nowMs?: number;
  }): Promise<{ proposal: SwapProposal; executed: boolean; message: string }> {
    const nowMs = params.nowMs ?? Date.now();
    this.expireStaleProposals(nowMs);

    const proposal = this.swapProposals.get(params.proposalId);
    if (!proposal) {
      throw new Error(`Swap proposal '${params.proposalId}' not found.`);
    }

    const isParticipant = proposal.cycle.some((s) => s.student_id === params.studentId);
    if (!isParticipant) {
      throw new Error('Only participants in this swap cycle can accept or reject it.');
    }

    if (proposal.status !== 'pending') {
      throw new Error(`This swap proposal is already ${proposal.status}.`);
    }

    const student = this.students.get(params.studentId);
    const actorName = student?.email ?? params.studentId;

    if (params.action === 'reject') {
      proposal.status = 'rejected';
      proposal.rejected_by = params.studentId;
      this.swapProposals.set(proposal.id, proposal);
      this.releaseProposalParticipants(proposal);

      await this.appendAuditLog(actorName, 'STUDENT', 'SWAP_PROPOSAL_REJECTED', {
        proposal_id: proposal.id,
        rejected_by: params.studentId,
      });

      return {
        proposal: clone(proposal),
        executed: false,
        message: 'Proposal rejected. Original room assignments remain unchanged and other participants have been released.',
      };
    }

    // Record explicit acceptance
    proposal.acceptances[params.studentId] = true;
    this.swapProposals.set(proposal.id, proposal);

    await this.appendAuditLog(actorName, 'STUDENT', 'SWAP_PROPOSAL_ACCEPTED', {
      proposal_id: proposal.id,
      student_id: params.studentId,
    });

    const allAccepted = proposal.cycle.every((step) => proposal.acceptances[step.student_id]);
    if (!allAccepted) {
      const pendingCount = proposal.cycle.filter((s) => !proposal.acceptances[s.student_id]).length;
      return {
        proposal: clone(proposal),
        executed: false,
        message: `Acceptance recorded. Waiting for ${pendingCount} other participant(s) before executing the swap.`,
      };
    }

    // Atomic transactional commit with full snapshot rollback on any invariant failure
    const snapshotStudents = new Map<string, Student>();
    const snapshotRooms = new Map<string, Room>();
    const snapshotRequests = new Map<string, SwapRequest>();

    for (const step of proposal.cycle) {
      const s = this.students.get(step.student_id);
      const fromR = this.rooms.get(step.from_room_id);
      const toR = this.rooms.get(step.to_room_id);
      const req = this.swapRequests.get(step.request_id);
      if (s) snapshotStudents.set(s.id, clone(s));
      if (fromR) snapshotRooms.set(fromR.id, clone(fromR));
      if (toR) snapshotRooms.set(toR.id, clone(toR));
      if (req) snapshotRequests.set(req.id, clone(req));
    }

    try {
      const check = validateProposalExecution(
        proposal,
        this.students,
        this.rooms,
        this.blocks,
        nowMs
      );
      if (!check.valid) {
        throw new Error(check.reason ?? 'Swap failed pre-execution invariant validation.');
      }

      // Phase 1: Remove every cycling student from their current room.
      for (const step of proposal.cycle) {
        const fromRoom = this.rooms.get(step.from_room_id)!;
        fromRoom.occupants = fromRoom.occupants.filter((id) => id !== step.student_id);
      }

      // Phase 2: Insert every cycling student into their target room & update student record.
      for (const step of proposal.cycle) {
        const toRoom = this.rooms.get(step.to_room_id)!;
        if (toRoom.occupants.length >= toRoom.capacity) {
          throw new Error(`Atomic invariant failure: room ${toRoom.number} exceeded capacity.`);
        }
        toRoom.occupants.push(step.student_id);

        const s = this.students.get(step.student_id)!;
        s.allotted_room_id = toRoom.id;

        const req = this.swapRequests.get(step.request_id);
        if (req) {
          req.status = 'executed';
        }
      }

      proposal.status = 'executed';
      proposal.executed_at = new Date(nowMs).toISOString();
      this.swapProposals.set(proposal.id, proposal);

      await this.appendAuditLog('system', 'system', 'SWAP_EXECUTED_ATOMICALLY', {
        proposal_id: proposal.id,
        cycle_length: proposal.cycle_length,
        transfers: proposal.cycle.map((s) => ({
          student_id: s.student_id,
          from: s.from_room_label,
          to: s.to_room_label,
        })),
      });

      return {
        proposal: clone(proposal),
        executed: true,
        message: 'Room mil gaya! All participants accepted — the room exchange has been executed atomically.',
      };
    } catch (err) {
      // Atomic rollback to snapshots
      for (const [id, s] of snapshotStudents.entries()) this.students.set(id, s);
      for (const [id, r] of snapshotRooms.entries()) this.rooms.set(id, r);
      for (const [id, req] of snapshotRequests.entries()) this.swapRequests.set(id, req);
      proposal.status = 'cancelled';
      this.swapProposals.set(proposal.id, proposal);
      this.releaseProposalParticipants(proposal);

      const message = err instanceof Error ? err.message : 'Atomic swap execution failed and rolled back.';
      await this.appendAuditLog('system', 'system', 'SWAP_EXECUTION_ROLLED_BACK', {
        proposal_id: proposal.id,
        reason: message,
      });
      throw new Error(message);
    }
  }

  public async getAnnouncements(): Promise<Announcement[]> {
    return clone(this.announcements);
  }

  public async createAnnouncement(params: {
    title: string;
    body: string;
    issued_by: string;
    block_id?: string | null;
    priority: Announcement['priority'];
    actorRole: UserRole;
  }): Promise<Announcement> {
    const notice: Announcement = {
      id: `ann-${crypto.randomUUID().slice(0, 6)}`,
      title: params.title.trim(),
      body: params.body.trim(),
      issued_by: params.issued_by,
      block_id: params.block_id ?? null,
      priority: params.priority,
      date: new Date().toISOString().slice(0, 10),
    };
    this.announcements.unshift(notice);
    await this.appendAuditLog(params.issued_by, params.actorRole, 'NOTICE_PUBLISHED', {
      notice_id: notice.id,
      block_id: notice.block_id,
      priority: notice.priority,
    });
    return clone(notice);
  }

  public async getDisputes(): Promise<Dispute[]> {
    return Array.from(this.disputes.values())
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map(clone);
  }

  public async createDispute(params: {
    studentId: string;
    category: Dispute['category'];
    subject: string;
    description: string;
  }): Promise<Dispute> {
    const student = this.students.get(params.studentId);
    if (!student) {
      throw new Error('Student not found.');
    }
    const now = new Date().toISOString();
    const dispute: Dispute = {
      id: `disp-${crypto.randomUUID().slice(0, 6)}`,
      student_id: student.id,
      student_name: student.name,
      category: params.category,
      subject: params.subject,
      description: params.description,
      status: 'open',
      resolution_note: null,
      created_at: now,
      updated_at: now,
    };
    this.disputes.set(dispute.id, dispute);
    await this.appendAuditLog(student.email, 'STUDENT', 'DISPUTE_SUBMITTED', {
      dispute_id: dispute.id,
      category: dispute.category,
    });
    return clone(dispute);
  }

  public async updateDispute(
    id: string,
    status: DisputeStatus,
    resolutionNote: string,
    actor: string,
    actorRole: UserRole = 'ADMIN'
  ): Promise<Dispute> {
    const existing = this.disputes.get(id);
    if (!existing) {
      throw new Error(`Dispute '${id}' not found.`);
    }
    existing.status = status;
    existing.resolution_note = resolutionNote || existing.resolution_note;
    existing.updated_at = new Date().toISOString();
    this.disputes.set(id, existing);

    await this.appendAuditLog(actor, actorRole, 'DISPUTE_UPDATED', {
      dispute_id: id,
      status,
    });
    return clone(existing);
  }

  public async getAuditLogs(limit = 100): Promise<AuditLog[]> {
    return clone(this.auditLogs.slice(0, limit));
  }

  public async appendAuditLog(
    actor: string,
    actorRole: UserRole | 'system',
    action: string,
    payload: Record<string, unknown>
  ): Promise<AuditLog> {
    const entry: AuditLog = {
      id: `aud-${crypto.randomUUID().slice(0, 8)}`,
      actor,
      actor_role: actorRole,
      action,
      payload,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(entry);
    return clone(entry);
  }

  public async assignStudentToRoom(
    studentId: string,
    targetRoomId: string,
    actor: string,
    actorRole: UserRole = 'ADMIN'
  ): Promise<{ student: Student; room: Room }> {
    const student = this.students.get(studentId);
    if (!student) {
      throw new Error(`Student '${studentId}' not found.`);
    }
    const targetRoom = this.rooms.get(targetRoomId);
    if (!targetRoom) {
      throw new Error(`Target room '${targetRoomId}' not found.`);
    }
    const block = this.blocks.get(targetRoom.block_id);
    if (!block) {
      throw new Error(`Block '${targetRoom.block_id}' not found.`);
    }
    const genderOk =
      (student.gender === 'male' && block.gender_type === 'boys') ||
      (student.gender === 'female' && block.gender_type === 'girls');
    if (!genderOk) {
      throw new Error(
        `Gender policy violation: ${student.name} cannot be assigned to ${block.name} (${block.gender_type}).`
      );
    }

    const alreadyInTarget = targetRoom.occupants.includes(studentId);
    if (!alreadyInTarget && targetRoom.occupants.length >= targetRoom.capacity) {
      throw new Error(
        `Room ${block.code}-${targetRoom.number} is already at full capacity (${targetRoom.capacity}/${targetRoom.capacity}).`
      );
    }

    // Remove student from any prior room to strictly uphold the 1-active-bed-per-student invariant
    for (const room of this.rooms.values()) {
      if (room.id !== targetRoomId && room.occupants.includes(studentId)) {
        room.occupants = room.occupants.filter((id) => id !== studentId);
      }
    }

    if (!alreadyInTarget) {
      targetRoom.occupants = [...targetRoom.occupants, studentId];
    }
    student.allotted_room_id = targetRoomId;

    await this.appendAuditLog(actor, actorRole, 'BED_ALLOTMENT_COMMITTED', {
      student_id: studentId,
      room_id: targetRoomId,
      block_id: targetRoom.block_id,
    });

    return { student: clone(student), room: clone(targetRoom) };
  }

  public async vacateStudentRoom(
    studentId: string,
    actor: string,
    actorRole: UserRole = 'ADMIN'
  ): Promise<{ student: Student; previousRoomId: string | null }> {
    const student = this.students.get(studentId);
    if (!student) {
      throw new Error(`Student '${studentId}' not found.`);
    }
    const previousRoomId = student.allotted_room_id;
    for (const room of this.rooms.values()) {
      if (room.occupants.includes(studentId)) {
        room.occupants = room.occupants.filter((id) => id !== studentId);
      }
    }
    student.allotted_room_id = null;

    await this.appendAuditLog(actor, actorRole, 'BED_ALLOTMENT_VACATED', {
      student_id: studentId,
      previous_room_id: previousRoomId,
    });

    return { student: clone(student), previousRoomId };
  }
}

// Singleton repository instance for the Express server (swappable with SupabaseHostelRepository)
let repoInstance: IHostelRepository | null = null;

export function getHostelRepository(): IHostelRepository {
  if (!repoInstance) {
    repoInstance = new InMemoryHostelRepository();
  }
  return repoInstance;
}

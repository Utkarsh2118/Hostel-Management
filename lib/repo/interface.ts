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

export interface CreateRoomInput {
  block_id: string;
  floor: number;
  number: string;
  capacity: 1 | 2 | 3 | 4;
  ac: boolean;
  tags: Room['tags'];
}

export interface UpdateRoomInput {
  capacity?: 1 | 2 | 3 | 4;
  ac?: boolean;
  tags?: Room['tags'];
}

export interface UpdateStudentInput {
  name?: string;
  year?: 1 | 2 | 3 | 4;
  branch?: string;
  gender?: Student['gender'];
  cgpa_band?: Student['cgpa_band'];
  sleep_schedule?: Student['sleep_schedule'];
  study_style?: Student['study_style'];
  cleanliness?: 1 | 2 | 3 | 4 | 5;
  about_me?: string;
  preferences?: string[];
  roommate_requests?: string[];
}

export interface IHostelRepository {
  // Blocks & Rooms
  getBlocks(): Promise<Block[]>;
  getBlockById(id: string): Promise<Block | null>;
  getRooms(filters?: {
    block_id?: string;
    floor?: number;
    ac?: boolean;
    capacity?: number;
    available_only?: boolean;
    tags?: Room['tags'];
  }): Promise<Room[]>;
  getRoomById(id: string): Promise<Room | null>;
  createRoom(input: CreateRoomInput, actor: string): Promise<Room>;
  updateRoom(id: string, input: UpdateRoomInput, actor: string): Promise<Room>;

  // Students
  getStudents(): Promise<Student[]>;
  getStudentById(id: string): Promise<Student | null>;
  createStudentRecord(input: {
    id: string;
    student_code: string;
    name: string;
    email: string;
    year: 1 | 2 | 3 | 4;
    branch: string;
    gender: Student['gender'];
  }): Promise<Student>;
  updateStudent(id: string, input: UpdateStudentInput, actor: string): Promise<Student>;
  toggleRoommateRequest(studentId: string, targetStudentId: string): Promise<Student>;
  assignStudentToRoom(
    studentId: string,
    targetRoomId: string,
    actor: string,
    actorRole?: UserRole
  ): Promise<{ student: Student; room: Room }>;
  vacateStudentRoom(
    studentId: string,
    actor: string,
    actorRole?: UserRole
  ): Promise<{ student: Student; previousRoomId: string | null }>;

  // Allotment Rules & Runs
  getAllotmentRules(): Promise<AllotmentRulesConfig>;
  updateAllotmentRules(rules: AllotmentRulesConfig, actor: string): Promise<AllotmentRulesConfig>;
  getAllotmentRuns(): Promise<AllotmentRun[]>;
  getAllotmentRunById(id: string): Promise<AllotmentRun | null>;
  executeAllotmentRun(params: {
    label: string;
    seed: string;
    rules: AllotmentRulesConfig;
    apply_immediately: boolean;
    actor: string;
  }): Promise<AllotmentRun>;
  applyAllotmentRun(runId: string, actor: string): Promise<AllotmentRun>;

  // Swaps (Requests & Proposals with Atomic Execution)
  getSwapRequests(): Promise<SwapRequest[]>;
  createSwapRequest(studentId: string, criteria: SwapWantedCriteria): Promise<SwapRequest>;
  cancelSwapRequest(requestId: string, studentId: string, isPrivileged: boolean): Promise<SwapRequest>;
  getSwapProposals(nowMs?: number): Promise<SwapProposal[]>;
  discoverAndCreateProposals(actor: string, nowMs?: number): Promise<SwapProposal[]>;
  respondToSwapProposal(params: {
    proposalId: string;
    studentId: string;
    action: 'accept' | 'reject';
    nowMs?: number;
  }): Promise<{ proposal: SwapProposal; executed: boolean; message: string }>;

  // Disputes, Announcements, Audit Logs
  getAnnouncements(): Promise<Announcement[]>;
  createAnnouncement(params: {
    title: string;
    body: string;
    issued_by: string;
    block_id?: string | null;
    priority: Announcement['priority'];
    actorRole: UserRole;
  }): Promise<Announcement>;
  getDisputes(): Promise<Dispute[]>;
  createDispute(params: {
    studentId: string;
    category: Dispute['category'];
    subject: string;
    description: string;
  }): Promise<Dispute>;
  updateDispute(
    id: string,
    status: DisputeStatus,
    resolutionNote: string,
    actor: string,
    actorRole?: UserRole
  ): Promise<Dispute>;
  getAuditLogs(limit?: number): Promise<AuditLog[]>;
  appendAuditLog(
    actor: string,
    actorRole: UserRole | 'system',
    action: string,
    payload: Record<string, unknown>
  ): Promise<AuditLog>;
}

export type Gender = 'male' | 'female';
export type BlockGenderType = 'boys' | 'girls';
export type RoomTag = 'quiet' | 'near_mess' | 'near_stairs' | 'corner' | 'balcony';
export type SleepSchedule = 'early' | 'late';
export type StudyStyle = 'quiet' | 'group';
export type CgpaBand = 'A+' | 'A' | 'B+' | 'B' | 'C';
export type UserRole = 'STUDENT' | 'WARDEN' | 'MAINTENANCE_STAFF' | 'ADMIN';

export interface Block {
  id: string;
  name: string;
  code: string;
  gender_type: BlockGenderType;
  floors: number;
  has_mess_nearby: boolean;
  warden_name: string;
  description: string;
}

export interface Room {
  id: string;
  block_id: string;
  floor: number;
  number: string;
  capacity: 1 | 2 | 3 | 4;
  ac: boolean;
  tags: RoomTag[];
  occupants: string[]; // student IDs
}

export interface Student {
  id: string;
  student_code: string;
  name: string;
  email: string;
  year: 1 | 2 | 3 | 4;
  branch: string;
  gender: Gender;
  cgpa_band: CgpaBand;
  sleep_schedule: SleepSchedule;
  study_style: StudyStyle;
  cleanliness: 1 | 2 | 3 | 4 | 5;
  about_me: string;
  preferences: string[]; // up to 5 ranked room IDs
  roommate_requests: string[]; // optional student IDs
  allotted_room_id: string | null;
}

export interface AllotmentRulesConfig {
  year_weight: number;
  merit_weight: number;
  enable_merit_band: boolean;
  preserve_mutual_roommates: boolean;
  enable_pareto_pass: boolean;
}

export interface AllotmentAssignment {
  student_id: string;
  student_code: string;
  student_name: string;
  room_id: string;
  room_number: string;
  block_id: string;
  block_name: string;
  floor: number;
  preference_rank: number | null; // 1..5, or null if fallback/unranked
  priority_score: number;
  tie_breaker: number;
  allotted_via: 'preference' | 'mutual_roommate' | 'pareto_improvement' | 'fallback';
  explanation: string;
}

export interface UnallottedRecord {
  student_id: string;
  student_code: string;
  student_name: string;
  priority_score: number;
  reason: string;
}

export interface AllotmentStats {
  total_students: number;
  allotted_count: number;
  unallotted_count: number;
  first_choice_count: number;
  first_choice_pct: number;
  top_three_count: number;
  top_three_pct: number;
  avg_preference_rank: number;
  mutual_pairs_honored: number;
  pareto_swaps_executed: number;
  runtime_ms: number;
}

export interface AllotmentRun {
  id: string;
  label: string;
  seed: string;
  rules_snapshot: AllotmentRulesConfig;
  results: AllotmentAssignment[];
  unallotted: UnallottedRecord[];
  stats: AllotmentStats;
  applied: boolean;
  created_by: string;
  created_at: string;
}

export type SwapRequestStatus = 'open' | 'matched' | 'accepted' | 'executed' | 'cancelled';

export interface SwapWantedCriteria {
  preferred_room_ids?: string[];
  block_id?: string;
  floor_min?: number;
  floor_max?: number;
  ac?: boolean;
  capacity?: 1 | 2 | 3 | 4;
  required_tags?: RoomTag[];
  note?: string;
}

export interface SwapRequest {
  id: string;
  student_id: string;
  current_room_id: string;
  wanted_criteria: SwapWantedCriteria;
  status: SwapRequestStatus;
  created_at: string;
}

export type SwapProposalStatus = 'pending' | 'executed' | 'rejected' | 'expired' | 'cancelled';

export interface SwapCycleStep {
  student_id: string;
  student_name: string;
  student_code: string;
  request_id: string;
  from_room_id: string;
  from_room_label: string;
  to_room_id: string;
  to_room_label: string;
  reason: string;
}

export interface SwapProposal {
  id: string;
  cycle: SwapCycleStep[];
  cycle_length: 2 | 3 | 4;
  score: number;
  feasibility_summary: string;
  acceptances: Record<string, boolean>; // student_id -> accepted
  rejected_by: string | null;
  status: SwapProposalStatus;
  created_at: string;
  expires_at: string;
  executed_at: string | null;
}

export interface AuditLog {
  id: string;
  actor: string;
  actor_role: UserRole | 'system';
  action: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export type DisputeStatus = 'open' | 'under_review' | 'resolved' | 'dismissed';

export interface Dispute {
  id: string;
  student_id: string;
  student_name: string;
  category: 'allotment' | 'swap' | 'room_condition' | 'policy';
  subject: string;
  description: string;
  status: DisputeStatus;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  issued_by: string;
  block_id?: string | null;
  priority: 'urgent' | 'notice' | 'circular';
  date: string;
}

export interface RoommateMatch {
  student: Pick<
    Student,
    'id' | 'student_code' | 'name' | 'year' | 'branch' | 'gender' | 'sleep_schedule' | 'study_style' | 'cleanliness' | 'about_me' | 'allotted_room_id'
  >;
  score: number;
  breakdown: {
    sleep: number;
    study: number;
    cleanliness: number;
    bio_bonus: number;
  };
  explanation: string;
  is_mutual_request: boolean;
  requested_by_me: boolean;
  requested_me: boolean;
}

export interface NaturalLanguageRoomFilter {
  block: string | null;
  floor_min: number | null;
  floor_max: number | null;
  ac: boolean | null;
  tags: RoomTag[];
  capacity: number | null;
}

export type AiProviderState = 'gemini' | 'groq' | 'offline';

export interface AiStatusInfo {
  provider: AiProviderState;
  label: string;
  detail: string;
  gemini_configured: boolean;
  groq_configured: boolean;
  last_used_provider: AiProviderState;
  last_fallback_reason: string | null;
}

export interface SessionUser {
  id: string;
  role: UserRole;
  name: string;
  email: string;
  student_id: string | null;
  student_code: string | null;
  assigned_hostel_ids?: string[];
  assigned_block_ids: string[];
  mfa_enabled: boolean;
  permissions: string[];
}

export type MaintenanceCategory =
  | 'electrical'
  | 'plumbing'
  | 'furniture'
  | 'cleaning'
  | 'internet'
  | 'safety'
  | 'room_infrastructure';

export type MaintenancePriority = 'low' | 'medium' | 'high' | 'urgent';

export type MaintenanceStatus =
  | 'submitted'
  | 'assigned'
  | 'in_progress'
  | 'parts_unavailable'
  | 'resolved'
  | 'closed';

export interface MaintenanceWorkNote {
  id: string;
  author_name: string;
  author_role: 'MAINTENANCE_STAFF' | 'WARDEN' | 'ADMIN';
  note: string;
  parts_reported: string | null;
  timestamp: string;
}

export interface MaintenanceTask {
  id: string;
  ticket_code: string;
  block_id: string;
  block_name: string;
  floor: number;
  room_number: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  summary: string;
  location_detail: string;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  evidence_reference: string | null;
  parts_needed: string | null;
  work_notes: MaintenanceWorkNote[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

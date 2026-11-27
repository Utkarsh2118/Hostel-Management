import { z } from 'zod';

export const RoomTagSchema = z.enum([
  'quiet',
  'near_mess',
  'near_stairs',
  'corner',
  'balcony',
]);

export const GenderSchema = z.enum(['male', 'female']);
export const BlockGenderSchema = z.enum(['boys', 'girls']);
export const SleepScheduleSchema = z.enum(['early', 'late']);
export const StudyStyleSchema = z.enum(['quiet', 'group']);
export const CgpaBandSchema = z.enum(['A+', 'A', 'B+', 'B', 'C']);

export const UpdateStudentProfileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  year: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  branch: z.string().trim().min(2).max(60),
  gender: GenderSchema,
  cgpa_band: CgpaBandSchema,
  sleep_schedule: SleepScheduleSchema,
  study_style: StudyStyleSchema,
  cleanliness: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  about_me: z.string().trim().max(280).default(''),
  preferences: z
    .array(z.string().trim().min(1))
    .max(5, 'You can submit a maximum of 5 ranked room preferences')
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Preferences cannot contain duplicate rooms',
    }),
  roommate_requests: z
    .array(z.string().trim().min(1))
    .max(3, 'Maximum 3 roommate requests allowed')
    .optional(),
});

export const AllotmentRulesSchema = z.object({
  year_weight: z.number().min(0).max(100),
  merit_weight: z.number().min(0).max(100),
  enable_merit_band: z.boolean(),
  preserve_mutual_roommates: z.boolean(),
  enable_pareto_pass: z.boolean(),
});

export const RunAllotmentSchema = z.object({
  label: z.string().trim().min(2).max(80).default('Allotment Run'),
  seed: z.string().trim().min(1, 'Seed is required').max(64),
  rules: AllotmentRulesSchema,
  apply_immediately: z.boolean().default(false),
});

export const CreateRoomSchema = z.object({
  block_id: z.string().trim().min(1),
  floor: z.number().int().min(1).max(6),
  number: z.string().trim().min(2).max(12),
  capacity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  ac: z.boolean(),
  tags: z.array(RoomTagSchema).max(5),
});

export const UpdateRoomSchema = z.object({
  capacity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  ac: z.boolean().optional(),
  tags: z.array(RoomTagSchema).max(5).optional(),
});

export const CreateSwapRequestSchema = z.object({
  wanted_criteria: z.object({
    preferred_room_ids: z.array(z.string().trim().min(1)).max(5).optional(),
    block_id: z.string().trim().min(1).optional(),
    floor_min: z.number().int().min(1).max(6).optional(),
    floor_max: z.number().int().min(1).max(6).optional(),
    ac: z.boolean().optional(),
    capacity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    required_tags: z.array(RoomTagSchema).max(5).optional(),
    note: z.string().trim().max(240).optional(),
  }).refine(
    (c) =>
      (c.preferred_room_ids && c.preferred_room_ids.length > 0) ||
      Boolean(c.block_id) ||
      c.floor_min !== undefined ||
      c.floor_max !== undefined ||
      c.ac !== undefined ||
      c.capacity !== undefined ||
      (c.required_tags && c.required_tags.length > 0),
    {
      message: 'Specify at least one room criterion or target room for your swap request.',
    }
  ),
});

export const SwapProposalActionSchema = z.object({
  action: z.enum(['accept', 'reject']),
});

export const NaturalLanguageRoomFilterSchema = z.object({
  block: z.string().nullable().default(null),
  floor_min: z.number().int().min(1).max(6).nullable().default(null),
  floor_max: z.number().int().min(1).max(6).nullable().default(null),
  ac: z.boolean().nullable().default(null),
  tags: z.array(RoomTagSchema).default([]),
  capacity: z.number().int().min(1).max(4).nullable().default(null),
});

export const NaturalLanguageSearchRequestSchema = z.object({
  query: z.string().trim().min(2, 'Enter at least 2 characters to search').max(240),
});

export const AssistantQuerySchema = z.object({
  question: z.string().trim().min(2, 'Please type a question about hostel rules').max(400),
});

export const CreateDisputeSchema = z.object({
  category: z.enum(['allotment', 'swap', 'room_condition', 'policy']),
  subject: z.string().trim().min(4).max(120),
  description: z.string().trim().min(10).max(800),
});

export const UpdateDisputeSchema = z.object({
  status: z.enum(['open', 'under_review', 'resolved', 'dismissed']),
  resolution_note: z.string().trim().max(500),
});

export const UpdateRulesMarkdownSchema = z.object({
  content: z.string().trim().min(40, 'Rules document cannot be empty').max(30000),
});

export const ToggleRoommateRequestSchema = z.object({
  target_student_id: z.string().trim().min(1),
});

export const RoleSchema = z.enum(['STUDENT', 'WARDEN', 'MAINTENANCE_STAFF', 'ADMIN']);
export const AccountStatusSchema = z.enum(['active', 'inactive', 'pending_verification']);

export const LoginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your university email or student ID').max(120),
  password: z.string().min(1, 'Password is required').max(128),
  login_portal_role: RoleSchema,
  mfa_code: z.string().trim().max(10).optional(),
});

export const StrongPasswordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters long')
  .max(128)
  .refine((p) => /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p), {
    message: 'Password must include uppercase, lowercase, and at least one number',
  });

export const StudentRegisterSchema = z.object({
  full_name: z.string().trim().min(2, 'Full name is required').max(80),
  email: z.string().trim().email('Enter a valid university email address').max(120),
  student_code: z
    .string()
    .trim()
    .min(5, 'Student ID must be at least 5 characters')
    .max(24)
    .regex(/^[A-Za-z0-9-]+$/, 'Student ID can only contain letters, numbers, and hyphens'),
  password: StrongPasswordSchema,
  year: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  branch: z.string().trim().min(2).max(60),
  gender: GenderSchema,
});

export const InitialSetupSchema = z.object({
  admin_password: StrongPasswordSchema,
  warden_password: StrongPasswordSchema,
  maintenance_password: StrongPasswordSchema.optional(),
  student_password: StrongPasswordSchema,
});

export const ForgotPasswordSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
});

export const ResetPasswordSchema = z.object({
  token: z.string().trim().min(10, 'Reset token is required'),
  new_password: StrongPasswordSchema,
});

export const VerifyEmailSchema = z.object({
  token: z.string().trim().min(10, 'Verification token is required'),
});

export const ProvisionStaffSchema = z.object({
  full_name: z.string().trim().min(2, 'Full name is required').max(80),
  email: z.string().trim().email('Valid official email required').max(120),
  role: z.enum(['WARDEN', 'MAINTENANCE_STAFF', 'ADMIN']),
  assigned_block_ids: z.array(z.string().trim().min(1)).default([]),
  initial_password: StrongPasswordSchema.optional(),
});

export const UpdateAccountAccessSchema = z.object({
  role: RoleSchema.optional(),
  status: AccountStatusSchema.optional(),
  assigned_block_ids: z.array(z.string().trim().min(1)).optional(),
});

export const CreateNoticeSchema = z.object({
  title: z.string().trim().min(4, 'Notice title must be at least 4 characters').max(120),
  body: z.string().trim().min(10, 'Notice body must be at least 10 characters').max(1000),
  block_id: z.string().trim().min(1).nullable().optional(),
  priority: z.enum(['urgent', 'notice', 'circular']).default('notice'),
});

export const VerifyMfaSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit authenticator code'),
});

export const UpdateSecuritySettingsSchema = z.object({
  allowed_email_domain: z.string().trim().min(3).max(80).optional(),
  session_ttl_minutes: z.number().int().min(15).max(1440).optional(),
  max_failed_login_attempts: z.number().int().min(3).max(15).optional(),
  lockout_duration_minutes: z.number().int().min(1).max(60).optional(),
  require_admin_mfa: z.boolean().optional(),
});

export const MaintenanceCategorySchema = z.enum([
  'electrical',
  'plumbing',
  'furniture',
  'cleaning',
  'internet',
  'safety',
  'room_infrastructure',
]);

export const MaintenancePrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const MaintenanceStatusSchema = z.enum([
  'submitted',
  'assigned',
  'in_progress',
  'parts_unavailable',
  'resolved',
  'closed',
]);

export const CreateMaintenanceTaskSchema = z.object({
  block_id: z.string().trim().min(1),
  floor: z.number().int().min(1).max(10),
  room_number: z.string().trim().min(2).max(20),
  category: MaintenanceCategorySchema,
  priority: MaintenancePrioritySchema.default('medium'),
  summary: z.string().trim().min(5).max(240),
  location_detail: z.string().trim().min(3).max(160),
  assigned_to_id: z.string().trim().min(1).nullable().optional(),
});

export const UpdateMaintenanceTaskSchema = z.object({
  status: MaintenanceStatusSchema.optional(),
  work_note: z.string().trim().min(2).max(600).optional(),
  parts_needed: z.string().trim().max(200).nullable().optional(),
  evidence_reference: z.string().trim().max(180).nullable().optional(),
  assigned_to_id: z.string().trim().min(1).nullable().optional(),
});

// ── Phase 2: University Verification, Inventory & Private Documents ──────────

export const VerificationStatusSchema = z.enum([
  'PENDING',
  'VERIFIED',
  'REJECTED',
  'NEEDS_REVIEW',
  'EXPIRED',
  'SUSPENDED',
]);

export const SubmitVerificationSchema = z.object({
  university_student_code: z
    .string()
    .trim()
    .min(5, 'University Student ID must be at least 5 characters')
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, 'University Student ID may only include letters, numbers, and hyphens'),
  campus_code: z.string().trim().min(2).max(24).optional(),
});

export const ReviewVerificationSchema = z.object({
  university_student_code: z.string().trim().min(4).max(32),
  decision: VerificationStatusSchema,
  reason: z.string().trim().min(8, 'Provide an official audit reason (min 8 characters)').max(400),
});

export const AuthorizedRosterEntrySchema = z.object({
  university_student_id: z.string().trim().min(4).max(32),
  official_full_name: z.string().trim().min(2).max(100),
  official_email: z.string().trim().email().max(140),
  course_branch: z.string().trim().min(2).max(80),
  academic_year: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  enrollment_status: z.enum(['enrolled', 'leave', 'graduated', 'suspended']),
  campus_code: z.string().trim().min(2).max(24),
});

export const ImportRosterSchema = z.object({
  source_label: z.string().trim().min(3).max(120),
  expected_sha256: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{64}$/, 'Checksum must be a 64-character hex SHA-256 digest')
    .optional(),
  entries: z.array(AuthorizedRosterEntrySchema).min(1).max(2000),
});

export const UpdateRoomOperationalStatusSchema = z.object({
  status: z.enum(['AVAILABLE', 'UNDER_MAINTENANCE', 'BLOCKED', 'RESERVED']),
  reason: z.string().trim().min(5, 'Provide a reason for changing room operational status').max(300),
});

export const UpdateBedStatusSchema = z.object({
  status: z.enum(['AVAILABLE', 'RESERVED', 'MAINTENANCE']),
  reason: z.string().trim().min(5, 'Provide a reason for changing bed status').max(300),
  notes: z.string().trim().max(240).nullable().optional(),
});

export const DocumentCategorySchema = z.enum([
  'identity_document',
  'enrollment_proof',
  'hostel_form',
  'supporting_document',
  'allotment_letter',
  'fee_receipt',
]);

export const UploadDocumentSchema = z.object({
  category: DocumentCategorySchema,
  filename: z.string().trim().min(3, 'Filename is required').max(120),
  mime_type: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  content_base64: z.string().min(4, 'Document content is required').max(7_000_000),
});

export const ReviewDocumentSchema = z.object({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']),
  note: z.string().trim().min(4, 'Provide a review note').max(400),
});

// ── Phase 3: Hostel Applications, Eligibility & Deterministic Allotment ────

export const ApplicationCycleStatusSchema = z.enum([
  'UPCOMING',
  'OPEN',
  'CLOSED',
  'ALLOTTED',
  'ARCHIVED',
]);

export const CreateApplicationCycleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, 'Cycle code may only include letters, numbers, and hyphens'),
  title: z.string().trim().min(6).max(120),
  academic_term: z.string().trim().min(4).max(60),
  opens_at: z.string().trim().min(10).max(40),
  closes_at: z.string().trim().min(10).max(40),
  status: ApplicationCycleStatusSchema.optional(),
  policy: z
    .object({
      policy_version: z.string().trim().min(3).max(32).optional(),
      require_university_verification: z.boolean().optional(),
      enforce_gender_separation: z.boolean().optional(),
      eligible_years: z
        .array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]))
        .min(1)
        .max(4)
        .optional(),
      max_ranked_preferences: z.number().int().min(1).max(5).optional(),
      year_weight: z.number().min(0).max(100).optional(),
      merit_weight: z.number().min(0).max(100).optional(),
      distance_weight_per_100km: z.number().min(0).max(20).optional(),
      accessibility_priority_bonus: z.number().min(0).max(200).optional(),
    })
    .optional(),
});

export const UpdateCycleStatusSchema = z.object({
  status: ApplicationCycleStatusSchema,
});

export const UpsertApplicationSchema = z.object({
  cycle_id: z.string().trim().min(1),
  preferred_room_ids: z
    .array(z.string().trim().min(1))
    .max(5, 'Maximum 5 ranked room preferences allowed'),
  preferred_ac: z.boolean().nullable().default(null),
  preferred_capacity: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .nullable()
    .default(null),
  home_distance_km: z.number().min(0).max(5000).default(150),
  accessibility_requested: z.boolean().default(false),
  accessibility_note: z.string().trim().max(300).nullable().default(null),
  declaration_accepted: z.boolean().default(false),
  submit_now: z.boolean().default(false),
});

export const ReviewApplicationSchema = z.object({
  decision: z.enum(['UNDER_REVIEW', 'ELIGIBLE', 'REJECTED']),
  accessibility_verified: z.boolean().optional(),
  review_note: z.string().trim().min(6, 'Provide an official review note (min 6 chars)').max(400),
});

export const ExecuteCycleAllotmentSchema = z.object({
  seed: z.string().trim().min(3, 'Deterministic seed is required').max(64),
  dry_run: z.boolean().default(true),
});

export const RespondAllotmentOfferSchema = z.object({
  action: z.enum(['accept', 'decline']),
});

export const ManualAllotmentOverrideSchema = z.object({
  target_room_id: z.string().trim().min(1),
  justification: z
    .string()
    .trim()
    .min(10, 'Provide an official audit justification (min 10 chars)')
    .max(500),
});

// ── Phase 4: Check-In/Out, Complaints, Gate Passes & Visitor Register ──────

export const RecordCheckInSchema = z.object({
  student_id: z.string().trim().min(1),
  key_serial: z.string().trim().min(3, 'Room key serial is required').max(32),
  room_condition_checkin: z
    .string()
    .trim()
    .min(5, 'Record room handover condition note')
    .max(300),
});

export const RequestCheckOutSchema = z.object({
  planned_date: z.string().trim().min(8).max(32),
  reason: z.string().trim().min(6, 'Provide a check-out reason').max(300),
});

export const CompleteCheckOutSchema = z.object({
  key_returned: z.boolean(),
  clearance_note: z.string().trim().min(5, 'Provide a clearance note').max(300),
  vacate_room: z.boolean().default(true),
});

export const ComplaintCategorySchema = z.enum([
  'electrical',
  'plumbing',
  'furniture',
  'cleaning',
  'internet',
  'safety',
  'discipline',
  'mess_dining',
  'roommate',
  'other',
]);

export const ComplaintStatusSchema = z.enum([
  'OPEN',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
  'REJECTED',
]);

export const CreateComplaintSchema = z.object({
  category: ComplaintCategorySchema,
  priority: MaintenancePrioritySchema.default('medium'),
  subject: z.string().trim().min(5, 'Subject must be at least 5 characters').max(120),
  description: z.string().trim().min(10, 'Provide complaint details (min 10 chars)').max(800),
});

export const UpdateComplaintSchema = z.object({
  status: ComplaintStatusSchema,
  resolution_note: z.string().trim().min(5, 'Provide a resolution note').max(400),
});

export const EscalateComplaintSchema = z.object({
  sanitized_summary: z
    .string()
    .trim()
    .min(6, 'Provide a student-PII-free maintenance summary')
    .max(240),
  location_detail: z.string().trim().min(3).max(160),
  assigned_to_id: z.string().trim().min(1).nullable().optional(),
});

export const CreateGatePassSchema = z.object({
  pass_type: z.enum(['DAY_OUT', 'OVERNIGHT', 'HOME_LEAVE', 'MEDICAL_EMERGENCY']),
  destination: z.string().trim().min(3).max(120),
  reason: z.string().trim().min(6).max(300),
  departure_at: z.string().trim().min(10).max(40),
  expected_return_at: z.string().trim().min(10).max(40),
  emergency_contact_phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{8,20}$/, 'Enter a valid emergency contact phone number'),
});

export const ReviewGatePassSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'MARK_EXITED', 'MARK_RETURNED']),
  review_note: z.string().trim().max(300).optional(),
});

export const CreateVisitorSchema = z.object({
  student_id: z.string().trim().min(1).optional(),
  visitor_name: z.string().trim().min(2).max(80),
  relation: z.string().trim().min(2).max(40),
  id_type: z.enum(['GOVT_ID', 'PARENT_ID', 'UNIVERSITY_ID']),
  id_last_four: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{4}$/, 'Enter ONLY the last 4 characters of visitor ID (no full ID numbers)'),
  purpose: z.string().trim().min(4).max(200),
  scheduled_date: z.string().trim().min(8).max(32),
});

export const UpdateVisitorStatusSchema = z.object({
  status: z.enum(['SCHEDULED', 'CHECKED_IN', 'CHECKED_OUT', 'DENIED']),
});

// ── Phase 5: Fees & Billing Ledger, Notifications, Notices & Reporting ─────

export const FeeLineItemSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(16)
    .regex(/^[A-Za-z0-9_-]+$/, 'Line item code may only include letters, numbers, and hyphens'),
  label: z.string().trim().min(3).max(100),
  amount_inr: z.number().int().min(1).max(500_000),
});

export const CreateFeeInvoiceSchema = z.object({
  student_id: z.string().trim().min(1),
  academic_term: z.string().trim().min(4).max(60),
  due_date: z.string().trim().min(8).max(32),
  line_items: z.array(FeeLineItemSchema).min(1, 'At least one fee line item is required').max(12),
});

export const SubmitOfflinePaymentSchema = z.object({
  mode: z.enum(['BANK_NEFT_IMPS', 'UNIVERSITY_CHALLAN', 'DEMAND_DRAFT']),
  reference_number: z
    .string()
    .trim()
    .min(5, 'Enter a valid UTR / Bank Challan reference number')
    .max(64)
    .regex(/^[A-Za-z0-9/_-]+$/, 'Reference number contains invalid characters'),
  amount_inr: z.number().int().min(1).max(1_000_000),
  paid_on_date: z.string().trim().min(8).max(32),
});

export const VerifyPaymentSchema = z.object({
  decision: z.enum(['VERIFIED_PAID', 'REJECTED']),
  verification_note: z
    .string()
    .trim()
    .min(5, 'Provide a Finance Office verification note (min 5 chars)')
    .max(300),
});

export const ApplyFeeWaiverSchema = z.object({
  amount_inr: z.number().int().min(1).max(500_000),
  reason: z.string().trim().min(8, 'Provide an official audit justification (min 8 chars)').max(400),
});

export const PublishInstitutionalNoticeSchema = z.object({
  title: z.string().trim().min(5, 'Notice title must be at least 5 characters').max(140),
  body: z.string().trim().min(10, 'Notice body must be at least 10 characters').max(1500),
  audience: z.enum(['ALL_HOSTELS', 'BLOCK_RESIDENTS', 'MAINTENANCE_ADVISORY']),
  block_id: z.string().trim().min(1).nullable().default(null),
  pinned: z.boolean().default(false),
});

export const ReportExportDatasetSchema = z.enum(['occupancy', 'fees', 'complaints', 'gate_passes']);

// ── Phase 7: Background Jobs, Signed Payment Webhooks & Incident Controls ──

export const BackgroundJobNameSchema = z.enum([
  'OVERDUE_FEE_REMINDERS',
  'OVERDUE_GATE_PASS_ALERTS',
  'EXPIRED_VISITOR_SWEEP',
  'SESSION_AND_AUDIT_HEALTH_CHECK',
  'ALL',
]);

export const RunBackgroundJobSchema = z.object({
  job_name: BackgroundJobNameSchema,
  reference_date_iso: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Reference date must follow YYYY-MM-DD format')
    .optional(),
});

export const PaymentWebhookPayloadSchema = z.object({
  event_id: z
    .string()
    .trim()
    .min(6, 'Webhook event_id must be at least 6 characters')
    .max(80)
    .regex(/^[A-Za-z0-9_.:-]+$/, 'Webhook event_id contains invalid characters'),
  event_type: z.enum(['PAYMENT_CAPTURED', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED']),
  provider_name: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Provider name contains invalid characters'),
  invoice_id_or_code: z.string().trim().min(3).max(64),
  gateway_reference: z
    .string()
    .trim()
    .min(5)
    .max(64)
    .regex(/^[A-Za-z0-9/_-]+$/, 'Gateway reference contains invalid characters'),
  amount_inr: z.number().int().min(1).max(1_000_000),
  paid_on_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'paid_on_date must follow YYYY-MM-DD format'),
});

export const EmergencySessionRevocationSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Provide an official incident audit reason (minimum 10 characters)')
    .max(300),
});





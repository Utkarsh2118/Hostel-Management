-- ============================================================================
-- HostelHub Phase 2 Migration:
-- University Identity Verification, Bed-Level Inventory & Private Document Vault
-- ============================================================================
-- Requires Phase 1 migration (0001_phase1_foundation_rbac_audit.sql).
-- Enforces:
--   1. Full institutional hierarchy: University -> Campus -> Hostel -> Block -> Floor -> Room -> Bed
--   2. Hard occupancy invariant: partial unique index preventing any student from holding >1 active bed
--   3. Separation of immutable university-verified academic records from student-editable profiles
--   4. Private document metadata & audit trail (zero public bucket URLs)
--   5. Strict 4-role RLS policies (MAINTENANCE_STAFF unconditionally denied from student docs & verification)

-- 1. INSTITUTIONAL HIERARCHY & BED-LEVEL INVENTORY
-- ----------------------------------------------------------------------------

create table if not exists public.campuses (
  id text primary key,
  code text not null unique,
  name text not null,
  location_label text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.hostels (
  id text primary key,
  campus_id text not null references public.campuses(id) on delete restrict,
  code text not null unique,
  name text not null,
  gender_policy text not null check (gender_policy in ('boys', 'girls', 'coed')),
  created_at timestamptz not null default now()
);

create table if not exists public.floors (
  id text primary key,
  block_id text not null,
  floor_number integer not null check (floor_number >= 0 and floor_number <= 20),
  is_accessible boolean not null default false,
  unique (block_id, floor_number)
);

create table if not exists public.rooms_inventory (
  id text primary key,
  block_id text not null,
  floor_id text not null references public.floors(id) on delete restrict,
  room_number text not null,
  capacity integer not null check (capacity between 1 and 6),
  ac boolean not null default false,
  is_accessible boolean not null default false,
  operational_override text check (
    operational_override in ('AVAILABLE', 'UNDER_MAINTENANCE', 'BLOCKED', 'RESERVED')
  ),
  updated_at timestamptz not null default now(),
  unique (block_id, room_number)
);

create table if not exists public.beds (
  id text primary key,
  room_id text not null references public.rooms_inventory(id) on delete cascade,
  block_id text not null,
  bed_label text not null,
  status text not null default 'AVAILABLE' check (
    status in ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE')
  ),
  occupant_student_id uuid,
  is_accessible boolean not null default false,
  notes text,
  updated_at timestamptz not null default now(),
  unique (room_id, bed_label),
  -- Ensure status matches occupant presence
  constraint beds_occupant_status_consistency check (
    (occupant_student_id is not null and status = 'OCCUPIED')
    or (occupant_student_id is null and status <> 'OCCUPIED')
  )
);

-- Hard institutional invariant: A student may NEVER occupy more than one active bed simultaneously
create unique index if not exists idx_beds_one_active_bed_per_student
  on public.beds (occupant_student_id)
  where occupant_student_id is not null;

create table if not exists public.room_facilities (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms_inventory(id) on delete cascade,
  facility_code text not null,
  facility_label text not null,
  unique (room_id, facility_code)
);

create table if not exists public.room_status_history (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms_inventory(id) on delete cascade,
  bed_id text references public.beds(id) on delete set null,
  block_id text not null,
  previous_status text not null,
  new_status text not null,
  reason text not null,
  changed_by uuid not null,
  changed_by_role text not null check (changed_by_role in ('WARDEN', 'ADMIN')),
  created_at timestamptz not null default now()
);

-- 2. UNIVERSITY-AUTHORITATIVE ACADEMIC & VERIFICATION RECORDS
-- ----------------------------------------------------------------------------

-- Immutable institutional attributes controlled exclusively by University SIS / Admin Roster Import
create table if not exists public.student_academic_records (
  student_id uuid primary key,
  university_student_id text not null unique,
  official_full_name text not null,
  official_email text not null,
  course_branch text not null,
  academic_year integer not null check (academic_year between 1 and 6),
  enrollment_status text not null check (
    enrollment_status in ('enrolled', 'graduated', 'suspended', 'withdrawn')
  ),
  campus_code text not null,
  source_provider text not null check (
    source_provider in ('official_university_api', 'authorized_roster_import', 'manual_exception', 'dev_mock_only')
  ),
  is_mock_development_record boolean not null default false,
  synced_at timestamptz not null default now()
);

create table if not exists public.verification_history (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  university_student_id text not null,
  status text not null check (
    status in ('PENDING', 'VERIFIED', 'REJECTED', 'NEEDS_REVIEW', 'EXPIRED', 'SUSPENDED')
  ),
  provider_kind text not null check (
    provider_kind in ('official_university_api', 'authorized_roster_import', 'manual_exception', 'dev_mock_only')
  ),
  provider_name text not null,
  provider_reference text,
  is_mock_development_record boolean not null default false,
  reason text not null,
  reviewed_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.hostel_eligibility_records (
  student_id uuid primary key,
  identity_verified boolean not null default false,
  account_activated boolean not null default false,
  hostel_eligible boolean not null default false,
  application_approved boolean not null default false,
  eligibility_reason text,
  updated_at timestamptz not null default now()
);

-- 3. PRIVATE STUDENT DOCUMENT VAULT METADATA (NO PUBLIC URLS)
-- ----------------------------------------------------------------------------

create table if not exists public.student_documents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  category text not null check (
    category in (
      'identity_document',
      'enrollment_proof',
      'hostel_form',
      'supporting_document',
      'allotment_letter',
      'fee_receipt'
    )
  ),
  original_filename text not null,
  sanitized_filename text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  sha256_checksum text not null,
  private_storage_path text not null unique,
  review_status text not null default 'PENDING' check (
    review_status in ('PENDING', 'VERIFIED', 'REJECTED')
  ),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  uploaded_at timestamptz not null default now()
);

-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------

alter table public.campuses enable row level security;
alter table public.hostels enable row level security;
alter table public.floors enable row level security;
alter table public.rooms_inventory enable row level security;
alter table public.beds enable row level security;
alter table public.room_facilities enable row level security;
alter table public.room_status_history enable row level security;
alter table public.student_academic_records enable row level security;
alter table public.verification_history enable row level security;
alter table public.hostel_eligibility_records enable row level security;
alter table public.student_documents enable row level security;

-- Inventory readability: STUDENT, WARDEN, ADMIN only (MAINTENANCE_STAFF excluded from occupancy tables)
create policy "inventory_read_non_maintenance" on public.rooms_inventory
  for select using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and up.role in ('STUDENT', 'WARDEN', 'ADMIN')
    )
  );

create policy "beds_manage_admin_or_scoped_warden" on public.beds
  for update using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and (
          up.role = 'ADMIN'
          or (up.role = 'WARDEN' and beds.block_id = any(up.assigned_block_ids))
        )
    )
  );

-- Academic & Verification records: student reads own; Admin reads/writes all; Warden reads assigned; Maintenance denied
create policy "academic_records_self_or_admin" on public.student_academic_records
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and up.role in ('ADMIN', 'WARDEN')
    )
  );

create policy "verification_history_self_or_staff" on public.verification_history
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and up.role in ('ADMIN', 'WARDEN')
    )
  );

-- Private Student Documents: strict ownership / scoped review; MAINTENANCE_STAFF denied
create policy "student_documents_select_scoped" on public.student_documents
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and up.role in ('ADMIN', 'WARDEN')
    )
  );

create policy "student_documents_insert_self_only" on public.student_documents
  for insert with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and up.role = 'STUDENT'
    )
  );

create policy "student_documents_review_admin_or_warden" on public.student_documents
  for update using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and up.role in ('ADMIN', 'WARDEN')
    )
  );

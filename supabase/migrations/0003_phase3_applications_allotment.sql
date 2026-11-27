-- ============================================================================
-- HostelHub Phase 3 Migration:
-- Hostel Applications, Policy Eligibility, Waitlists & Deterministic Allotment
-- ============================================================================
-- Requires Phase 1 (0001) and Phase 2 (0002) migrations.
-- Enforces:
--   1. One active (non-withdrawn) hostel application per student per allotment cycle
--   2. Policy-versioned deterministic allotment runs and immutable override records
--   3. One active bed allotment per student per cycle
--   4. Strict 4-role RLS policies (MAINTENANCE_STAFF unconditionally denied)

create table if not exists public.allotment_cycles (
  id text primary key,
  code text not null unique,
  title text not null,
  academic_term text not null,
  status text not null check (status in ('UPCOMING', 'OPEN', 'CLOSED', 'ALLOTTED', 'ARCHIVED')),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  policy_version text not null,
  policy_rules jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint allotment_cycles_dates_valid check (closes_at > opens_at)
);

create table if not exists public.hostel_applications (
  id uuid primary key default gen_random_uuid(),
  cycle_id text not null references public.allotment_cycles(id) on delete restrict,
  student_id uuid not null,
  status text not null default 'DRAFT' check (
    status in (
      'DRAFT',
      'SUBMITTED',
      'UNDER_REVIEW',
      'ELIGIBLE',
      'WAITLISTED',
      'ALLOTTED',
      'ACCEPTED',
      'DECLINED',
      'REJECTED',
      'WITHDRAWN'
    )
  ),
  preferred_ac boolean,
  preferred_capacity integer check (preferred_capacity between 1 and 4),
  home_distance_km numeric(7, 2) not null default 0 check (home_distance_km >= 0),
  accessibility_requested boolean not null default false,
  accessibility_verified boolean not null default false,
  accessibility_note text,
  declaration_accepted boolean not null default false,
  eligibility_snapshot jsonb not null,
  computed_priority_score numeric(8, 2) not null default 0,
  waitlist_position integer,
  waitlist_reason text,
  reviewer_id uuid,
  review_note text,
  submitted_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hard invariant: A student can hold at most one active (non-withdrawn) application per cycle
create unique index if not exists idx_hostel_applications_one_active_per_cycle
  on public.hostel_applications (cycle_id, student_id)
  where status <> 'WITHDRAWN';

create table if not exists public.application_preferences (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.hostel_applications(id) on delete cascade,
  rank integer not null check (rank between 1 and 5),
  room_id text not null references public.rooms_inventory(id) on delete restrict,
  unique (application_id, rank),
  unique (application_id, room_id)
);

create table if not exists public.allotment_runs_v2 (
  id text primary key,
  cycle_id text not null references public.allotment_cycles(id) on delete restrict,
  seed text not null,
  policy_version text not null,
  dry_run boolean not null default true,
  committed boolean not null default false,
  executed_by uuid not null,
  summary jsonb not null,
  executed_at timestamptz not null default now()
);

create table if not exists public.bed_allotments (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references public.allotment_runs_v2(id) on delete restrict,
  cycle_id text not null references public.allotment_cycles(id) on delete restrict,
  application_id uuid not null references public.hostel_applications(id) on delete restrict,
  student_id uuid not null,
  room_id text not null references public.rooms_inventory(id) on delete restrict,
  bed_id text not null references public.beds(id) on delete restrict,
  allotted_via text not null check (
    allotted_via in ('preference', 'accessibility_priority', 'fallback', 'manual_override')
  ),
  priority_score numeric(8, 2) not null,
  tie_breaker numeric(12, 8) not null default 0,
  explanation text not null,
  slip_checksum text not null,
  active boolean not null default true,
  assigned_at timestamptz not null default now()
);

-- Hard invariant: One active bed allotment per student per cycle, and one active student per bed
create unique index if not exists idx_bed_allotments_one_active_student_per_cycle
  on public.bed_allotments (cycle_id, student_id)
  where active = true;

create unique index if not exists idx_bed_allotments_one_active_bed
  on public.bed_allotments (bed_id)
  where active = true;

create table if not exists public.allotment_overrides (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.hostel_applications(id) on delete restrict,
  student_id uuid not null,
  target_room_id text not null references public.rooms_inventory(id) on delete restrict,
  target_bed_id text not null references public.beds(id) on delete restrict,
  justification text not null,
  overridden_by uuid not null,
  created_at timestamptz not null default now()
);

-- ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------

alter table public.allotment_cycles enable row level security;
alter table public.hostel_applications enable row level security;
alter table public.application_preferences enable row level security;
alter table public.allotment_runs_v2 enable row level security;
alter table public.bed_allotments enable row level security;
alter table public.allotment_overrides enable row level security;

create policy "cycles_read_non_maintenance" on public.allotment_cycles
  for select using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and up.role in ('STUDENT', 'WARDEN', 'ADMIN')
    )
  );

create policy "cycles_manage_admin_only" on public.allotment_cycles
  for all using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and up.role = 'ADMIN'
    )
  );

create policy "applications_select_self_or_staff" on public.hostel_applications
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and up.role in ('WARDEN', 'ADMIN')
    )
  );

create policy "applications_write_self_student" on public.hostel_applications
  for insert with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and up.role = 'STUDENT'
    )
  );

create policy "allotments_select_self_or_staff" on public.bed_allotments
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and up.role in ('WARDEN', 'ADMIN')
    )
  );

create policy "overrides_admin_only" on public.allotment_overrides
  for all using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and up.role = 'ADMIN'
    )
  );

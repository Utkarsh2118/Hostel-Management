-- =============================================================================
-- HostelHub — PostgreSQL / Supabase Production Database Schema
-- Includes: Tables, Primary Keys, Foreign Keys, Constraints, Indexes,
-- Profiles + Warden Assignments + Admin Audit Logs, Anti-Self-Escalation
-- Triggers, and 3-Role Row Level Security (RLS) Policies (STUDENT / WARDEN / ADMIN).
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. Hostel Blocks
-- -----------------------------------------------------------------------------
create table if not exists public.blocks (
  id text primary key,
  name text not null unique,
  code text not null unique check (char_length(code) between 2 and 6),
  gender_type text not null check (gender_type in ('boys', 'girls')),
  floors integer not null check (floors between 1 and 10),
  has_mess_nearby boolean not null default false,
  warden_name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. User Profiles (Server-Authoritative Role Registry linked to auth.users)
--    Roles are strictly STUDENT, WARDEN, or ADMIN and can NEVER be self-modified.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique not null, -- references auth.users(id) on delete cascade
  full_name text not null,
  email text not null unique,
  student_code text unique,
  role text not null default 'STUDENT' check (role in ('STUDENT', 'WARDEN', 'MAINTENANCE_STAFF', 'ADMIN')),
  status text not null default 'active' check (status in ('active', 'inactive', 'pending_verification')),
  email_verified boolean not null default false,
  mfa_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles (role);
create index if not exists idx_profiles_auth_user on public.profiles (auth_user_id);

-- Prevent non-admin/client updates from altering `role` or `status` on public.profiles
create or replace function public.prevent_profile_role_self_escalation()
returns trigger
language plpgsql
security definer
as $$
begin
  if current_setting('role', true) <> 'service_role' then
    if new.role is distinct from old.role then
      raise exception 'Role modification is prohibited via ordinary profile updates.';
    end if;
    if new.status is distinct from old.status then
      raise exception 'Account status modification requires administrator authorization.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_prevent_profile_role_self_escalation on public.profiles;
create trigger trg_prevent_profile_role_self_escalation
  before update on public.profiles
  for each row
  execute function public.prevent_profile_role_self_escalation();

-- -----------------------------------------------------------------------------
-- 3. Warden & Maintenance Staff Block Assignments
-- -----------------------------------------------------------------------------
create table if not exists public.warden_assignments (
  id uuid primary key default gen_random_uuid(),
  warden_id uuid not null references public.profiles(id) on delete cascade,
  block_id text not null references public.blocks(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (warden_id, block_id)
);

create index if not exists idx_warden_assignments_warden on public.warden_assignments (warden_id);
create index if not exists idx_warden_assignments_block on public.warden_assignments (block_id);

create table if not exists public.maintenance_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,
  block_id text not null references public.blocks(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (staff_id, block_id)
);

create index if not exists idx_maint_assignments_staff on public.maintenance_staff_assignments (staff_id);
create index if not exists idx_maint_assignments_block on public.maintenance_staff_assignments (block_id);

-- -----------------------------------------------------------------------------
-- 4. Rooms
-- -----------------------------------------------------------------------------
create table if not exists public.rooms (
  id text primary key,
  block_id text not null references public.blocks(id) on delete cascade,
  floor integer not null check (floor >= 1),
  number text not null,
  capacity smallint not null check (capacity between 1 and 4),
  ac boolean not null default false,
  tags text[] not null default '{}'::text[]
    check (tags <@ array['quiet', 'near_mess', 'near_stairs', 'corner', 'balcony']::text[]),
  created_at timestamptz not null default now(),
  unique (block_id, number)
);

create index if not exists idx_rooms_block_floor on public.rooms (block_id, floor);
create index if not exists idx_rooms_tags on public.rooms using gin (tags);

-- -----------------------------------------------------------------------------
-- 5. Students (Linked to public.profiles where role = 'STUDENT')
-- -----------------------------------------------------------------------------
create table if not exists public.students (
  id text primary key,
  profile_id uuid unique references public.profiles(id) on delete set null,
  auth_user_id uuid unique,
  student_code text not null unique,
  name text not null,
  email text not null unique check (email ~* '^[a-z0-9._%+-]+@(univ\.edu\.in|hostelhub\.local)$'),
  year smallint not null check (year between 1 and 4),
  branch text not null,
  gender text not null check (gender in ('male', 'female')),
  cgpa_band text not null check (cgpa_band in ('A+', 'A', 'B+', 'B', 'C')),
  sleep_schedule text not null check (sleep_schedule in ('early', 'late')),
  study_style text not null check (study_style in ('quiet', 'group')),
  cleanliness smallint not null check (cleanliness between 1 and 5),
  about_me text not null default '' check (char_length(about_me) <= 280),
  allotted_room_id text references public.rooms(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_students_allotted_room on public.students (allotted_room_id);
create index if not exists idx_students_gender_year on public.students (gender, year);

-- -----------------------------------------------------------------------------
-- 6. Ranked Room Preferences (max 5 per student)
-- -----------------------------------------------------------------------------
create table if not exists public.student_preferences (
  student_id text not null references public.students(id) on delete cascade,
  rank smallint not null check (rank between 1 and 5),
  room_id text not null references public.rooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, rank),
  unique (student_id, room_id)
);

create index if not exists idx_preferences_room on public.student_preferences (room_id);

-- -----------------------------------------------------------------------------
-- 7. Mutual Roommate Requests
-- -----------------------------------------------------------------------------
create table if not exists public.roommate_requests (
  requester_id text not null references public.students(id) on delete cascade,
  target_id text not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (requester_id, target_id),
  check (requester_id <> target_id)
);

-- -----------------------------------------------------------------------------
-- 8. Allotment Runs & Assignments
-- -----------------------------------------------------------------------------
create table if not exists public.allotment_runs (
  id text primary key,
  label text not null,
  seed text not null,
  rules_snapshot jsonb not null,
  stats jsonb not null,
  applied boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.allotment_results (
  run_id text not null references public.allotment_runs(id) on delete cascade,
  student_id text not null references public.students(id) on delete cascade,
  room_id text references public.rooms(id) on delete set null,
  preference_rank smallint check (preference_rank is null or preference_rank between 1 and 5),
  priority_score numeric(8, 2) not null,
  tie_breaker numeric(8, 6) not null,
  allotted_via text check (allotted_via in ('preference', 'mutual_roommate', 'pareto_improvement', 'fallback', 'unallotted')),
  explanation text not null,
  primary key (run_id, student_id)
);

create index if not exists idx_allotment_results_room on public.allotment_results (run_id, room_id);

-- -----------------------------------------------------------------------------
-- 9. Swap Requests & Multi-Way Swap Proposals
-- -----------------------------------------------------------------------------
create table if not exists public.swap_requests (
  id text primary key,
  student_id text not null references public.students(id) on delete cascade,
  current_room_id text not null references public.rooms(id) on delete cascade,
  wanted_criteria jsonb not null,
  status text not null check (status in ('open', 'matched', 'accepted', 'executed', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists idx_swap_requests_status on public.swap_requests (status, created_at desc);
create unique index if not exists idx_one_active_swap_per_student
  on public.swap_requests (student_id)
  where status in ('open', 'matched');

create table if not exists public.swap_proposals (
  id text primary key,
  cycle jsonb not null,
  cycle_length smallint not null check (cycle_length between 2 and 4),
  score integer not null default 0,
  feasibility_summary text not null,
  acceptances jsonb not null default '{}'::jsonb,
  rejected_by text references public.students(id) on delete set null,
  status text not null check (status in ('pending', 'executed', 'rejected', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  executed_at timestamptz
);

create index if not exists idx_swap_proposals_status_exp on public.swap_proposals (status, expires_at);

-- -----------------------------------------------------------------------------
-- 10. Disputes & Announcements (Block-scoped or Campus-wide)
-- -----------------------------------------------------------------------------
create table if not exists public.disputes (
  id text primary key,
  student_id text not null references public.students(id) on delete cascade,
  category text not null check (category in ('allotment', 'swap', 'room_condition', 'policy')),
  subject text not null,
  description text not null,
  status text not null default 'open' check (status in ('open', 'under_review', 'resolved', 'dismissed')),
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id text primary key,
  title text not null,
  body text not null,
  issued_by text not null,
  block_id text references public.blocks(id) on delete set null,
  priority text not null check (priority in ('urgent', 'notice', 'circular')),
  published_date date not null default current_date
);

-- -----------------------------------------------------------------------------
-- 11. Operational Audit Logs & Immutable Admin Security Audit Logs
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id text primary key,
  actor text not null,
  actor_role text not null check (actor_role in ('STUDENT', 'WARDEN', 'ADMIN', 'system')),
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  timestamp timestamptz not null default now()
);

create index if not exists idx_audit_logs_timestamp on public.audit_logs (timestamp desc);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_user_id uuid references public.profiles(id) on delete set null,
  previous_value jsonb,
  new_value jsonb,
  timestamp timestamptz not null default now()
);

create index if not exists idx_admin_audit_logs_timestamp on public.admin_audit_logs (timestamp desc);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES — STRICT 3-ROLE ISOLATION
-- =============================================================================
alter table public.blocks enable row level security;
alter table public.profiles enable row level security;
alter table public.warden_assignments enable row level security;
alter table public.rooms enable row level security;
alter table public.students enable row level security;
alter table public.student_preferences enable row level security;
alter table public.roommate_requests enable row level security;
alter table public.allotment_runs enable row level security;
alter table public.allotment_results enable row level security;
alter table public.swap_requests enable row level security;
alter table public.swap_proposals enable row level security;
alter table public.disputes enable row level security;
alter table public.announcements enable row level security;
alter table public.audit_logs enable row level security;
alter table public.admin_audit_logs enable row level security;

-- Authoritative role helper functions reading strictly from public.profiles
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
as $$
  select role from public.profiles
  where auth_user_id = auth.uid() and status = 'active'
  limit 1;
$$;

create or replace function public.is_hostel_admin()
returns boolean
language sql
stable
security definer
as $$
  select public.current_user_role() = 'ADMIN';
$$;

create or replace function public.is_assigned_warden(target_block_id text)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.profiles p
    join public.warden_assignments wa on wa.warden_id = p.id
    where p.auth_user_id = auth.uid()
      and p.role = 'WARDEN'
      and p.status = 'active'
      and wa.block_id = target_block_id
  );
$$;

create or replace function public.is_student_in_warden_scope(target_student_id text)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.students s
    join public.rooms r on r.id = s.allotted_room_id
    where s.id = target_student_id
      and public.is_assigned_warden(r.block_id)
  );
$$;

-- Profiles: users read own profile; admins read/manage all profiles; ordinary users cannot change role
create policy "profiles_select_own_or_admin" on public.profiles
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_hostel_admin());

create policy "profiles_update_own_safe" on public.profiles
  for update to authenticated
  using (auth_user_id = auth.uid() or public.is_hostel_admin())
  with check (auth_user_id = auth.uid() or public.is_hostel_admin());

-- Warden Assignments: wardens may inspect own assignments; admins manage all
create policy "warden_assignments_read" on public.warden_assignments
  for select to authenticated
  using (
    warden_id in (select id from public.profiles where auth_user_id = auth.uid())
    or public.is_hostel_admin()
  );

create policy "warden_assignments_admin_write" on public.warden_assignments
  for all to authenticated
  using (public.is_hostel_admin());

-- Blocks: readable by authenticated campus users; writable strictly by ADMIN
create policy "blocks_read_all" on public.blocks
  for select to authenticated
  using (true);

create policy "blocks_admin_write" on public.blocks
  for all to authenticated
  using (public.is_hostel_admin());

-- Rooms: readable by authenticated campus users; writable by ADMIN or assigned WARDEN only
create policy "rooms_read_all" on public.rooms
  for select to authenticated
  using (true);

create policy "rooms_warden_or_admin_write" on public.rooms
  for all to authenticated
  using (public.is_hostel_admin() or public.is_assigned_warden(block_id))
  with check (public.is_hostel_admin() or public.is_assigned_warden(block_id));

-- Announcements: readable by authenticated users; writable by ADMIN (any) or WARDEN (assigned block only)
create policy "announcements_read_all" on public.announcements
  for select to authenticated
  using (true);

create policy "announcements_staff_write" on public.announcements
  for all to authenticated
  using (
    public.is_hostel_admin()
    or (block_id is not null and public.is_assigned_warden(block_id))
  )
  with check (
    public.is_hostel_admin()
    or (block_id is not null and public.is_assigned_warden(block_id))
  );

-- Students: STUDENT reads/updates own row; WARDEN reads students in assigned blocks; ADMIN full access
create policy "students_select_scoped" on public.students
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.is_hostel_admin()
    or public.is_student_in_warden_scope(id)
  );

create policy "students_update_own_or_admin" on public.students
  for update to authenticated
  using (auth_user_id = auth.uid() or public.is_hostel_admin())
  with check (auth_user_id = auth.uid() or public.is_hostel_admin());

-- Preferences: strictly student-owned or admin
create policy "preferences_own_or_admin" on public.student_preferences
  for all to authenticated
  using (
    student_id in (select id from public.students where auth_user_id = auth.uid())
    or public.is_hostel_admin()
  );

-- Roommate Requests: requester manages own; target views incoming; admin sees all
create policy "roommate_requests_select" on public.roommate_requests
  for select to authenticated
  using (
    requester_id in (select id from public.students where auth_user_id = auth.uid())
    or target_id in (select id from public.students where auth_user_id = auth.uid())
    or public.is_hostel_admin()
  );

create policy "roommate_requests_modify_own" on public.roommate_requests
  for all to authenticated
  using (
    requester_id in (select id from public.students where auth_user_id = auth.uid())
    or public.is_hostel_admin()
  );

-- Allotment Runs & Results: applied runs readable; all runs managed strictly by ADMIN
create policy "allotment_runs_read" on public.allotment_runs
  for select to authenticated
  using (applied = true or public.is_hostel_admin());

create policy "allotment_runs_admin_write" on public.allotment_runs
  for all to authenticated
  using (public.is_hostel_admin());

create policy "allotment_results_read" on public.allotment_results
  for select to authenticated
  using (
    student_id in (select id from public.students where auth_user_id = auth.uid())
    or public.is_hostel_admin()
    or public.is_student_in_warden_scope(student_id)
  );

-- Swap Requests: open/matched marketplace readable; owner/assigned warden/admin can manage
create policy "swap_requests_read_marketplace" on public.swap_requests
  for select to authenticated
  using (
    status in ('open', 'matched')
    or student_id in (select id from public.students where auth_user_id = auth.uid())
    or public.is_hostel_admin()
    or public.is_student_in_warden_scope(student_id)
  );

create policy "swap_requests_scoped_write" on public.swap_requests
  for all to authenticated
  using (
    student_id in (select id from public.students where auth_user_id = auth.uid())
    or public.is_hostel_admin()
    or public.is_student_in_warden_scope(student_id)
  );

-- Swap Proposals: visible to cycle participants, admins, or wardens
create policy "swap_proposals_participant_or_staff" on public.swap_proposals
  for select to authenticated
  using (
    public.is_hostel_admin()
    or public.current_user_role() = 'WARDEN'
    or acceptances ? (select id from public.students where auth_user_id = auth.uid())
  );

-- Disputes: STUDENT owns theirs; WARDEN resolves assigned-block disputes; ADMIN manages all
create policy "disputes_select_scoped" on public.disputes
  for select to authenticated
  using (
    student_id in (select id from public.students where auth_user_id = auth.uid())
    or public.is_hostel_admin()
    or public.is_student_in_warden_scope(student_id)
  );

create policy "disputes_insert_student" on public.disputes
  for insert to authenticated
  with check (
    student_id in (select id from public.students where auth_user_id = auth.uid())
  );

create policy "disputes_update_staff" on public.disputes
  for update to authenticated
  using (
    public.is_hostel_admin()
    or public.is_student_in_warden_scope(student_id)
  );

-- Audit Logs & Admin Audit Logs: strictly ADMIN read-only (inserts via service role / server)
create policy "audit_logs_admin_read" on public.audit_logs
  for select to authenticated
  using (public.is_hostel_admin());

create policy "admin_audit_logs_admin_read" on public.admin_audit_logs
  for select to authenticated
  using (public.is_hostel_admin());

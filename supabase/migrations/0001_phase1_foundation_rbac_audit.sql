-- =============================================================================
-- Migration: 0001_phase1_foundation_rbac_audit.sql
-- HostelHub Phase 1 — Foundation, 4-Role RBAC, Scoped Staff Assignments,
-- Institutional Hierarchy Skeleton, Append-Only Audit Logs, and PostgreSQL RLS.
-- Target: Supabase PostgreSQL 15+
-- =============================================================================

begin;

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. Normalized Institutional Roles & Permissions Registry
-- -----------------------------------------------------------------------------
create table if not exists public.roles (
  code text primary key check (code in ('STUDENT', 'WARDEN', 'MAINTENANCE_STAFF', 'ADMIN')),
  description text not null,
  is_privileged boolean not null default false,
  requires_mfa boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.permissions (
  code text primary key,
  domain text not null,
  description text not null
);

create table if not exists public.role_permissions (
  role_code text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

insert into public.roles (code, description, is_privileged, requires_mfa) values
  ('STUDENT', 'Verified university student applicant or hostel resident', false, false),
  ('WARDEN', 'Block/hostel-scoped residential warden', true, false),
  ('MAINTENANCE_STAFF', 'Block-scoped estate & facilities technician (zero student PII/finance access)', true, false),
  ('ADMIN', 'Institution-wide chief warden office administrator', true, true)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Institutional Hierarchy (University -> Campus -> Hostel -> Block)
-- -----------------------------------------------------------------------------
create table if not exists public.universities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  official_email_domain text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.campuses (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete restrict,
  code text not null,
  name text not null,
  address text not null default '',
  created_at timestamptz not null default now(),
  unique (university_id, code)
);

create table if not exists public.hostels (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  code text not null,
  name text not null,
  hostel_type text not null default 'residential',
  gender_eligibility text not null check (gender_eligibility in ('boys', 'girls', 'mixed_policy_controlled')),
  operational_status text not null default 'active' check (operational_status in ('active', 'maintenance', 'closed')),
  contact_info text not null default '',
  created_at timestamptz not null default now(),
  unique (campus_id, code)
);

create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete restrict,
  code text not null,
  name text not null,
  floor_count smallint not null check (floor_count between 1 and 20),
  has_mess_nearby boolean not null default false,
  operational_status text not null default 'active' check (operational_status in ('active', 'maintenance', 'closed')),
  created_at timestamptz not null default now(),
  unique (hostel_id, code)
);

create index if not exists idx_blocks_hostel on public.blocks (hostel_id);

-- -----------------------------------------------------------------------------
-- 3. Auth-Linked User Profiles (Server-Authoritative Role Registry)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique not null, -- references auth.users(id) on delete cascade
  full_name text not null,
  email text not null unique,
  university_student_id text unique,
  role text not null default 'STUDENT' references public.roles(code),
  account_status text not null default 'pending_verification'
    check (account_status in ('active', 'inactive', 'pending_verification', 'suspended')),
  email_verified boolean not null default false,
  mfa_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles (role);
create index if not exists idx_profiles_auth_user_id on public.profiles (auth_user_id);

-- Prevent any non-service-role client update from modifying role, account_status, or verification flags
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
security definer
as $$
begin
  if current_setting('role', true) <> 'service_role' then
    if new.role is distinct from old.role then
      raise exception 'Role changes require server-side administrator provisioning.';
    end if;
    if new.account_status is distinct from old.account_status then
      raise exception 'Account status changes require administrator authorization.';
    end if;
    if new.email_verified is distinct from old.email_verified then
      raise exception 'Verification flags are server-controlled.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_privileged_columns on public.profiles;
create trigger trg_guard_profile_privileged_columns
  before update on public.profiles
  for each row
  execute function public.guard_profile_privileged_columns();

-- -----------------------------------------------------------------------------
-- 4. Explicit Staff Scope Tables (Wardens & Maintenance Staff)
-- -----------------------------------------------------------------------------
create table if not exists public.warden_assignments (
  id uuid primary key default gen_random_uuid(),
  warden_profile_id uuid not null references public.profiles(id) on delete cascade,
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  block_id uuid not null references public.blocks(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique (warden_profile_id, block_id)
);

create table if not exists public.maintenance_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references public.profiles(id) on delete cascade,
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  block_id uuid not null references public.blocks(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique (staff_profile_id, block_id)
);

create index if not exists idx_warden_assignments_profile on public.warden_assignments (warden_profile_id);
create index if not exists idx_maint_assignments_profile on public.maintenance_staff_assignments (staff_profile_id);

-- -----------------------------------------------------------------------------
-- 5. Account Status History & University Verification Records
-- -----------------------------------------------------------------------------
create table if not exists public.account_status_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  previous_status text,
  new_status text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.university_verification_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  university_student_id text not null,
  provider_name text not null,
  provider_reference text,
  verification_status text not null
    check (verification_status in ('PENDING', 'VERIFIED', 'REJECTED', 'NEEDS_REVIEW', 'EXPIRED', 'SUSPENDED')),
  is_mock_development_record boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_univ_verification_profile on public.university_verification_records (profile_id);

-- -----------------------------------------------------------------------------
-- 6. Maintenance Work Orders (Strictly Minimized — Zero Student Academic/Finance PII)
-- -----------------------------------------------------------------------------
create table if not exists public.maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  ticket_code text not null unique,
  block_id uuid not null references public.blocks(id) on delete restrict,
  floor smallint not null check (floor >= 1),
  room_number text not null,
  category text not null check (category in ('electrical', 'plumbing', 'furniture', 'cleaning', 'internet', 'safety', 'room_infrastructure')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'submitted' check (status in ('submitted', 'assigned', 'in_progress', 'parts_unavailable', 'resolved', 'closed')),
  summary text not null,
  location_detail text not null,
  assigned_to_profile_id uuid references public.profiles(id) on delete set null,
  parts_needed text,
  evidence_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_maintenance_tasks_assignee on public.maintenance_tasks (assigned_to_profile_id, status);
create index if not exists idx_maintenance_tasks_block on public.maintenance_tasks (block_id, status);

-- -----------------------------------------------------------------------------
-- 7. Append-Only Audit Logs & System Settings
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_email text not null,
  actor_role text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_value jsonb,
  after_value jsonb,
  reason text,
  correlation_id text,
  source text not null default 'api',
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_created_at on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs (entity_type, entity_id);

-- Enforce append-only immutability on audit_logs
create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only; UPDATE and DELETE operations are prohibited.';
end;
$$;

drop trigger if exists trg_audit_logs_immutable on public.audit_logs;
create trigger trg_audit_logs_immutable
  before update or delete on public.audit_logs
  for each row
  execute function public.prevent_audit_log_mutation();

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 8. Row Level Security (RLS) Policies for 4-Role Institutional Isolation
-- -----------------------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
as $$
  select role from public.profiles where auth_user_id = auth.uid() and account_status = 'active' limit 1;
$$;

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
as $$
  select id from public.profiles where auth_user_id = auth.uid() and account_status = 'active' limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
as $$
  select coalesce(public.current_user_role() = 'ADMIN', false);
$$;

create or replace function public.is_assigned_warden_for_block(target_block_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.warden_assignments wa
    join public.profiles p on p.id = wa.warden_profile_id
    where p.auth_user_id = auth.uid()
      and p.role = 'WARDEN'
      and p.account_status = 'active'
      and wa.block_id = target_block_id
  );
$$;

create or replace function public.is_assigned_maintenance_for_block(target_block_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.maintenance_staff_assignments ma
    join public.profiles p on p.id = ma.staff_profile_id
    where p.auth_user_id = auth.uid()
      and p.role = 'MAINTENANCE_STAFF'
      and p.account_status = 'active'
      and ma.block_id = target_block_id
  );
$$;

alter table public.profiles enable row level security;
alter table public.warden_assignments enable row level security;
alter table public.maintenance_staff_assignments enable row level security;
alter table public.account_status_history enable row level security;
alter table public.university_verification_records enable row level security;
alter table public.maintenance_tasks enable row level security;
alter table public.audit_logs enable row level security;
alter table public.system_settings enable row level security;

-- Profiles: own profile or Admin; never cross-student or maintenance access to other profiles
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_admin());

create policy profiles_update_self_safe on public.profiles
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- Warden & Maintenance assignments: self-read or Admin management
create policy warden_assignments_select on public.warden_assignments
  for select to authenticated
  using (warden_profile_id = public.current_profile_id() or public.is_admin());

create policy maint_assignments_select on public.maintenance_staff_assignments
  for select to authenticated
  using (staff_profile_id = public.current_profile_id() or public.is_admin());

-- University verification records: student owns theirs; Admin reviews all
create policy verification_select_own_or_admin on public.university_verification_records
  for select to authenticated
  using (profile_id = public.current_profile_id() or public.is_admin());

-- Maintenance tasks: Admin all, Warden assigned blocks, Maintenance Staff ONLY assigned tasks in assigned blocks
create policy maintenance_tasks_select on public.maintenance_tasks
  for select to authenticated
  using (
    public.is_admin()
    or public.is_assigned_warden_for_block(block_id)
    or (
      assigned_to_profile_id = public.current_profile_id()
      and public.is_assigned_maintenance_for_block(block_id)
    )
  );

create policy maintenance_tasks_update on public.maintenance_tasks
  for update to authenticated
  using (
    public.is_admin()
    or public.is_assigned_warden_for_block(block_id)
    or (
      assigned_to_profile_id = public.current_profile_id()
      and public.is_assigned_maintenance_for_block(block_id)
    )
  );

-- Audit logs & system settings: strictly Admin read-only (inserts via service_role backend)
create policy audit_logs_admin_select on public.audit_logs
  for select to authenticated
  using (public.is_admin());

create policy system_settings_admin_all on public.system_settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

commit;

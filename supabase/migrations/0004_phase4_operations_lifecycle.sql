-- ============================================================================
-- HostelHub Phase 4 Migration:
-- Occupancy Check-In/Out, Complaints & Escalation, Gate Passes & Visitor Log
-- ============================================================================
-- Requires Phase 1–3 migrations.
-- Enforces strict 4-role RLS policies:
--   - STUDENT accesses ONLY own occupancy, complaints, gate passes, and visitors.
--   - WARDEN accesses/manages ONLY records within assigned_block_ids.
--   - ADMIN manages all institutional operations.
--   - MAINTENANCE_STAFF is unconditionally denied from all Phase 4 tables
--     (they see ONLY sanitized work orders in maintenance_tasks).

create table if not exists public.occupancy_check_records (
  student_id uuid primary key,
  room_id text not null references public.rooms_inventory(id) on delete restrict,
  block_id text not null,
  status text not null check (
    status in ('PENDING_CHECKIN', 'CHECKED_IN', 'CHECKOUT_REQUESTED', 'CHECKED_OUT')
  ),
  key_serial text,
  room_condition_checkin text,
  checked_in_at timestamptz,
  checked_in_by uuid,
  checkout_requested_at timestamptz,
  checkout_reason text,
  checkout_planned_date date,
  checked_out_at timestamptz,
  checked_out_by uuid,
  key_returned boolean not null default false,
  clearance_note text,
  updated_at timestamptz not null default now()
);

create table if not exists public.hostel_complaints (
  id uuid primary key default gen_random_uuid(),
  complaint_code text not null unique,
  student_id uuid not null,
  block_id text not null,
  room_id text not null references public.rooms_inventory(id) on delete restrict,
  category text not null check (
    category in (
      'electrical', 'plumbing', 'furniture', 'cleaning', 'internet',
      'safety', 'discipline', 'mess_dining', 'roommate', 'other'
    )
  ),
  priority text not null check (priority in ('low', 'medium', 'high', 'urgent')),
  subject text not null,
  description text not null,
  status text not null default 'OPEN' check (
    status in ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED')
  ),
  resolution_note text,
  handled_by uuid,
  escalated_maintenance_task_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gate_pass_requests (
  id uuid primary key default gen_random_uuid(),
  pass_code text unique,
  student_id uuid not null,
  block_id text not null,
  pass_type text not null check (
    pass_type in ('DAY_OUT', 'OVERNIGHT', 'HOME_LEAVE', 'MEDICAL_EMERGENCY')
  ),
  destination text not null,
  reason text not null,
  departure_at timestamptz not null,
  expected_return_at timestamptz not null,
  emergency_contact_phone text not null,
  status text not null default 'PENDING' check (
    status in ('PENDING', 'APPROVED', 'REJECTED', 'CHECKED_OUT_GATE', 'RETURNED', 'CANCELLED')
  ),
  reviewed_by uuid,
  review_note text,
  gate_exit_at timestamptz,
  gate_return_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gate_pass_return_after_departure check (expected_return_at > departure_at)
);

create table if not exists public.visitor_register (
  id uuid primary key default gen_random_uuid(),
  visitor_code text not null unique,
  student_id uuid not null,
  block_id text not null,
  visitor_name text not null,
  relation text not null,
  id_type text not null check (id_type in ('GOVT_ID', 'PARENT_ID', 'UNIVERSITY_ID')),
  id_last_four text not null check (char_length(id_last_four) = 4),
  purpose text not null,
  scheduled_date date not null,
  status text not null default 'SCHEDULED' check (
    status in ('SCHEDULED', 'CHECKED_IN', 'CHECKED_OUT', 'DENIED')
  ),
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  verified_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------

alter table public.occupancy_check_records enable row level security;
alter table public.hostel_complaints enable row level security;
alter table public.gate_pass_requests enable row level security;
alter table public.visitor_register enable row level security;

create policy "occupancy_select_scoped" on public.occupancy_check_records
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and (
          up.role = 'ADMIN'
          or (up.role = 'WARDEN' and occupancy_check_records.block_id = any(up.assigned_block_ids))
        )
    )
  );

create policy "complaints_select_scoped" on public.hostel_complaints
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and (
          up.role = 'ADMIN'
          or (up.role = 'WARDEN' and hostel_complaints.block_id = any(up.assigned_block_ids))
        )
    )
  );

create policy "gate_passes_select_scoped" on public.gate_pass_requests
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and (
          up.role = 'ADMIN'
          or (up.role = 'WARDEN' and gate_pass_requests.block_id = any(up.assigned_block_ids))
        )
    )
  );

create policy "visitors_select_scoped" on public.visitor_register
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.status = 'active'
        and (
          up.role = 'ADMIN'
          or (up.role = 'WARDEN' and visitor_register.block_id = any(up.assigned_block_ids))
        )
    )
  );

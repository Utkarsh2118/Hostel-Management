-- =============================================================================
-- HostelHub Phase 5: Fees & Billing Ledger, Notifications, Notices & Reporting
-- =============================================================================
-- Security guarantees:
--   1. Immutable financial auditability: students may submit offline references,
--      but ONLY ADMIN (Finance Office) may verify payments, issue invoices, or
--      approve fee waivers.
--   2. Strict MAINTENANCE_STAFF denial on all student billing & reporting tables.
--   3. Block-scoped Warden read visibility for clearance & notice publishing.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.fee_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_code TEXT NOT NULL UNIQUE,
  academic_term TEXT NOT NULL,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  block_id UUID REFERENCES public.hostel_blocks(id) ON DELETE SET NULL,
  room_label TEXT NOT NULL,
  due_date DATE NOT NULL,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal_inr INTEGER NOT NULL CHECK (subtotal_inr >= 0),
  waived_inr INTEGER NOT NULL DEFAULT 0 CHECK (waived_inr >= 0),
  total_payable_inr INTEGER NOT NULL CHECK (total_payable_inr >= 0),
  paid_inr INTEGER NOT NULL DEFAULT 0 CHECK (paid_inr >= 0 AND paid_inr <= total_payable_inr),
  balance_due_inr INTEGER NOT NULL CHECK (balance_due_inr >= 0),
  status TEXT NOT NULL CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED', 'CANCELLED')),
  issued_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fee_payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.fee_invoices(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  receipt_number TEXT UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('BANK_NEFT_IMPS', 'UNIVERSITY_CHALLAN', 'DEMAND_DRAFT')),
  reference_number TEXT NOT NULL,
  amount_inr INTEGER NOT NULL CHECK (amount_inr > 0),
  paid_on_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED_FOR_VERIFICATION', 'VERIFIED_PAID', 'REJECTED')),
  submitted_by UUID NOT NULL REFERENCES public.user_profiles(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by UUID REFERENCES public.user_profiles(id),
  verified_at TIMESTAMPTZ,
  verification_note TEXT,
  receipt_checksum TEXT,
  UNIQUE (invoice_id, reference_number)
);

CREATE TABLE IF NOT EXISTS public.fee_waiver_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.fee_invoices(id) ON DELETE RESTRICT,
  amount_inr INTEGER NOT NULL CHECK (amount_inr > 0),
  reason TEXT NOT NULL CHECK (char_length(reason) >= 8),
  approved_by UUID NOT NULL REFERENCES public.user_profiles(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.institutional_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('ALL_HOSTELS', 'BLOCK_RESIDENTS', 'MAINTENANCE_ADVISORY')),
  block_id UUID REFERENCES public.hostel_blocks(id) ON DELETE SET NULL,
  pinned BOOLEAN NOT NULL DEFAULT false,
  published_by UUID NOT NULL REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('BILLING', 'OPERATIONS', 'ALLOTMENT', 'NOTICE', 'SECURITY')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.report_export_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES public.user_profiles(id),
  actor_role TEXT NOT NULL CHECK (actor_role IN ('WARDEN', 'ADMIN')),
  dataset TEXT NOT NULL CHECK (dataset IN ('occupancy', 'fees', 'complaints', 'gate_passes')),
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  exported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fee_invoices_student ON public.fee_invoices(student_id);
CREATE INDEX IF NOT EXISTS idx_fee_invoices_block ON public.fee_invoices(block_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_invoice ON public.fee_payment_records(invoice_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_target ON public.user_notifications(target_user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notices_block ON public.institutional_notices(block_id);

-- =============================================================================
-- ROW LEVEL SECURITY (STRICT 4-ROLE ISOLATION)
-- =============================================================================
ALTER TABLE public.fee_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_waiver_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institutional_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_export_logs ENABLE ROW LEVEL SECURITY;

-- Fee Invoices: Student reads own; Warden reads assigned blocks; Admin full access; Maintenance denied
CREATE POLICY fee_invoices_select_student ON public.fee_invoices
  FOR SELECT USING (
    public.current_user_role() = 'STUDENT'
    AND student_id = public.current_student_id()
  );

CREATE POLICY fee_invoices_select_warden ON public.fee_invoices
  FOR SELECT USING (
    public.current_user_role() = 'WARDEN'
    AND block_id IS NOT NULL
    AND public.warden_can_access_block(block_id)
  );

CREATE POLICY fee_invoices_admin_all ON public.fee_invoices
  FOR ALL USING (public.current_user_role() = 'ADMIN')
  WITH CHECK (public.current_user_role() = 'ADMIN');

-- Fee Payment Records: Student reads own & inserts SUBMITTED_FOR_VERIFICATION only; Admin verifies
CREATE POLICY fee_payments_select_student ON public.fee_payment_records
  FOR SELECT USING (
    public.current_user_role() = 'STUDENT'
    AND student_id = public.current_student_id()
  );

CREATE POLICY fee_payments_insert_student ON public.fee_payment_records
  FOR INSERT WITH CHECK (
    public.current_user_role() = 'STUDENT'
    AND student_id = public.current_student_id()
    AND status = 'SUBMITTED_FOR_VERIFICATION'
    AND receipt_number IS NULL
    AND verified_by IS NULL
  );

CREATE POLICY fee_payments_admin_all ON public.fee_payment_records
  FOR ALL USING (public.current_user_role() = 'ADMIN')
  WITH CHECK (public.current_user_role() = 'ADMIN');

-- Fee Waivers: Admin manages; Student reads waivers on own invoices
CREATE POLICY fee_waivers_admin_all ON public.fee_waiver_adjustments
  FOR ALL USING (public.current_user_role() = 'ADMIN')
  WITH CHECK (public.current_user_role() = 'ADMIN');

CREATE POLICY fee_waivers_select_student ON public.fee_waiver_adjustments
  FOR SELECT USING (
    public.current_user_role() = 'STUDENT'
    AND EXISTS (
      SELECT 1 FROM public.fee_invoices fi
      WHERE fi.id = fee_waiver_adjustments.invoice_id
        AND fi.student_id = public.current_student_id()
    )
  );

-- Institutional Notices: Maintenance only sees ALL_HOSTELS or MAINTENANCE_ADVISORY; Wardens insert own blocks
CREATE POLICY notices_select_authenticated ON public.institutional_notices
  FOR SELECT USING (
    public.current_user_role() = 'ADMIN'
    OR (
      public.current_user_role() = 'MAINTENANCE_STAFF'
      AND audience IN ('ALL_HOSTELS', 'MAINTENANCE_ADVISORY')
    )
    OR (
      public.current_user_role() = 'WARDEN'
      AND (block_id IS NULL OR public.warden_can_access_block(block_id))
    )
    OR (
      public.current_user_role() = 'STUDENT'
      AND (
        block_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.students s
          JOIN public.rooms r ON r.id = s.allotted_room_id
          WHERE s.id = public.current_student_id()
            AND r.block_id = institutional_notices.block_id
        )
      )
    )
  );

CREATE POLICY notices_insert_warden ON public.institutional_notices
  FOR INSERT WITH CHECK (
    public.current_user_role() = 'WARDEN'
    AND block_id IS NOT NULL
    AND public.warden_can_access_block(block_id)
  );

CREATE POLICY notices_admin_all ON public.institutional_notices
  FOR ALL USING (public.current_user_role() = 'ADMIN')
  WITH CHECK (public.current_user_role() = 'ADMIN');

-- User Notifications: Strictly target_user_id = auth.uid()
CREATE POLICY notifications_select_own ON public.user_notifications
  FOR SELECT USING (target_user_id = auth.uid());

CREATE POLICY notifications_update_own ON public.user_notifications
  FOR UPDATE USING (target_user_id = auth.uid())
  WITH CHECK (target_user_id = auth.uid());

CREATE POLICY notifications_admin_insert ON public.user_notifications
  FOR INSERT WITH CHECK (public.current_user_role() IN ('ADMIN', 'WARDEN'));

-- Report Export Logs: Admin reads all; Warden reads own exports
CREATE POLICY report_exports_admin_all ON public.report_export_logs
  FOR ALL USING (public.current_user_role() = 'ADMIN')
  WITH CHECK (public.current_user_role() = 'ADMIN');

CREATE POLICY report_exports_warden_own ON public.report_export_logs
  FOR SELECT USING (
    public.current_user_role() = 'WARDEN'
    AND actor_id = auth.uid()
  );

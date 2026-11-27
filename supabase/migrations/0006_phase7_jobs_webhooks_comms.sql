-- ============================================================================
-- HostelHub Phase 7 Migration — Background Jobs, Outbound Communications Queue
-- and Cryptographically Verified Payment Webhook Events
-- ============================================================================
-- Security Posture:
--   * Strictly Admin / Service-Role isolated (students, wardens, and maintenance
--     staff have zero direct table access).
--   * Enforces database-level uniqueness on `dedupe_key` and `event_id` to
--     guarantee idempotent reminders and double-settlement protection.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.background_job_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_code          TEXT NOT NULL UNIQUE,
  job_name          TEXT NOT NULL CHECK (job_name IN (
                      'OVERDUE_FEE_REMINDERS',
                      'OVERDUE_GATE_PASS_ALERTS',
                      'EXPIRED_VISITOR_SWEEP',
                      'SESSION_AND_AUDIT_HEALTH_CHECK'
                    )),
  trigger_source    TEXT NOT NULL CHECK (trigger_source IN ('ADMIN_UI', 'CRON_ENDPOINT')),
  triggered_by      TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('COMPLETED', 'FAILED')),
  items_scanned     INTEGER NOT NULL DEFAULT 0 CHECK (items_scanned >= 0),
  items_acted       INTEGER NOT NULL DEFAULT 0 CHECK (items_acted >= 0),
  duration_ms       NUMERIC(10, 2) NOT NULL DEFAULT 0,
  summary           TEXT NOT NULL,
  executed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bg_job_runs_name_time
  ON public.background_job_runs (job_name, executed_at DESC);

CREATE TABLE IF NOT EXISTS public.outbound_communications_queue (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel             TEXT NOT NULL CHECK (channel IN ('EMAIL', 'SMS')),
  recipient_masked    TEXT NOT NULL,
  template_code       TEXT NOT NULL,
  subject             TEXT NOT NULL,
  body_preview        TEXT NOT NULL,
  dedupe_key          TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL CHECK (status IN (
                        'QUEUED_PROVIDER_UNCONFIGURED',
                        'PENDING_DISPATCH',
                        'DISPATCHED',
                        'FAILED'
                      )),
  provider_name       TEXT NOT NULL,
  provider_message_id TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbound_comms_status_created
  ON public.outbound_communications_queue (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            TEXT NOT NULL UNIQUE,
  event_type          TEXT NOT NULL CHECK (event_type IN (
                        'PAYMENT_CAPTURED',
                        'PAYMENT_FAILED',
                        'PAYMENT_REFUNDED'
                      )),
  provider_name       TEXT NOT NULL,
  invoice_id_or_code  TEXT NOT NULL,
  gateway_reference   TEXT NOT NULL,
  amount_inr          INTEGER NOT NULL CHECK (amount_inr > 0),
  outcome             TEXT NOT NULL CHECK (outcome IN (
                        'RECONCILED',
                        'RECORDED_NON_CREDIT',
                        'FAILED_RECONCILIATION'
                      )),
  receipt_number      TEXT,
  replay_attempts     INTEGER NOT NULL DEFAULT 0 CHECK (replay_attempts >= 0),
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_webhooks_received
  ON public.payment_webhook_events (received_at DESC);

-- ============================================================================
-- Strict Row Level Security (Admin-Only Operational Isolation)
-- ============================================================================

ALTER TABLE public.background_job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_communications_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_only_bg_jobs ON public.background_job_runs;
CREATE POLICY admin_only_bg_jobs
  ON public.background_job_runs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.role = 'ADMIN'
        AND p.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.role = 'ADMIN'
        AND p.status = 'active'
    )
  );

DROP POLICY IF EXISTS admin_only_outbound_comms ON public.outbound_communications_queue;
CREATE POLICY admin_only_outbound_comms
  ON public.outbound_communications_queue
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.role = 'ADMIN'
        AND p.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.role = 'ADMIN'
        AND p.status = 'active'
    )
  );

DROP POLICY IF EXISTS admin_only_payment_webhooks ON public.payment_webhook_events;
CREATE POLICY admin_only_payment_webhooks
  ON public.payment_webhook_events
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.role = 'ADMIN'
        AND p.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.role = 'ADMIN'
        AND p.status = 'active'
    )
  );

# HostelHub Phase 7 — Background Jobs, Payment Webhooks & Incident Runbook

## 1. Scheduled Institutional Lifecycle Jobs

HostelHub exposes deterministic, idempotent lifecycle maintenance jobs runnable either from the Admin Console (`POST /api/admin/jobs/run`) or by an external institutional cron scheduler (`POST /api/jobs/cron/run`).

### Cron Authentication Contract
- Set `BACKGROUND_JOB_SECRET` to a 32+ byte high-entropy random secret in the deployment secret manager.
- If `BACKGROUND_JOB_SECRET` is unset, `POST /api/jobs/cron/run` fails closed with **HTTP 503**.
- Cron callers must supply the header `X-Job-Secret: <secret>`. Verification uses constant-time `crypto.timingSafeEqual`.

### Supported Jobs
| Job Name | Purpose | Idempotency Strategy |
| --- | --- | --- |
| `OVERDUE_FEE_REMINDERS` | Scans `UNPAID` / `PARTIALLY_PAID` invoices past `due_date`, dispatches in-app notices, and queues outbound emails. | Deduplicated by `fee-overdue::<invoice_id>::<YYYY-MM-DD>`. |
| `OVERDUE_GATE_PASS_ALERTS` | Detects `CHECKED_OUT_GATE` passes past `expected_return_at`, notifies Wardens & Admins, and queues emergency SMS alert. | Deduplicated by `gatepass-overdue::<pass_id>::<YYYY-MM-DD>`. |
| `EXPIRED_VISITOR_SWEEP` | Marks unvisited `SCHEDULED` visitor entries from prior dates as `DENIED` (`system:expired-visitor-sweep`) and writes an audit event. | State transition is naturally idempotent. |
| `SESSION_AND_AUDIT_HEALTH_CHECK` | Purges expired server sessions and single-use verification/reset tokens, recording active session counts. | Safe for repeated execution. |

---

## 2. Cryptographically Signed Payment Gateway Webhooks

When the university configures an official payment gateway (e.g., BillDesk or Razorpay Institutional):
- Configure `PAYMENT_WEBHOOK_SECRET` in the server secret manager (minimum 16 characters; 32+ bytes recommended).
- If `PAYMENT_WEBHOOK_SECRET` is unset, `POST /api/webhooks/payments` fails closed with **HTTP 503** and never settles invoices.
- Required Headers:
  - `X-HostelHub-Timestamp`: Unix epoch seconds (must be within **±300 seconds** of server UTC time).
  - `X-HostelHub-Signature`: `v1=<hex>` where `<hex>` is `HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, "${timestamp}.${rawJsonBody}")`.
- Replay & Retry Safety:
  - Every `event_id` is recorded uniquely. Duplicate deliveries return HTTP 200 with `{ duplicate: true }` and **never** credit an invoice twice.

---

## 3. Outbound Email & SMS Provider Onboarding (Zero Fabricated Delivery)

- Until `RESEND_API_KEY` (Email) or `SMS_PROVIDER_API_KEY` (SMS) are provisioned by University IT, outbound reminders are stored cleanly in the outbox with status `QUEUED_PROVIDER_UNCONFIGURED`.
- Recipient emails and phone numbers are masked (`r***n@univ.edu.in`, `******4321`) inside operational queues and structured logs.

---

## 4. Incident Response & Break-Glass Session Revocation

- Live request counts, status class ratios (2xx/4xx/5xx), p95 latency, and a secret-scrubbed recent error ring buffer are available to Administrators at `/admin/readiness` (Operations & Metrics tab).
- During a credential compromise or institutional incident, an Administrator may invoke **Emergency Global Sign-Out** (`POST /api/admin/incident/revoke-sessions`) with a mandatory audit justification. This immediately revokes all active `STUDENT`, `WARDEN`, and `MAINTENANCE_STAFF` server sessions while keeping Admin sessions intact for ongoing containment.

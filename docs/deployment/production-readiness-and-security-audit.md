# HostelHub — Production Readiness, Security Audit & Institutional Deployment Runbook

## 1. Honest Readiness Statement
HostelHub has completed all 6 software engineering phases with full TypeScript strictness, server-verified 4-role RBAC, PostgreSQL Row Level Security migrations (`0001`–`0005`), HTTP security hardening, and automated regression tests.

**However, this codebase is NOT live-production-ready by itself** until the deploying university completes the infrastructure provisioning, credential configuration, and human governance approvals documented in Section 4 below.

---

## 2. Database Migration Execution Order (PostgreSQL / Supabase)
Apply migrations sequentially inside a staged environment first, verifying RLS policies after each step:
1. `supabase/migrations/0001_phase1_foundation_rbac_audit.sql` — 4-role profiles, block scopes, maintenance work orders, immutable audit log.
2. `supabase/migrations/0002_phase2_identity_inventory_documents.sql` — University verification records, roster batches, bed-level inventory, private document vault.
3. `supabase/migrations/0003_phase3_applications_allotment.sql` — Allotment cycles, applications, waitlists, deterministic allotment slips, manual override logs.
4. `supabase/migrations/0004_phase4_operations_lifecycle.sql` — Check-in/check-out records, complaints, gate passes, visitor register (with `char_length(id_last_four) = 4`).
5. `supabase/migrations/0005_phase5_fees_notifications_reporting.sql` — Fee invoices, offline payment submissions, waivers, notices, user notifications, report export logs.

---

## 3. Verified Application Security Controls
- **Authentication & Session Hygiene:** Server-issued opaque tokens in `HttpOnly`, `SameSite=Lax` cookies (`Secure` in production), scrypt password hashing, brute-force lockout, password-reset session revocation, and Admin TOTP MFA.
- **No Client Role Switching:** Roles are assigned and verified strictly server-side; role-portal mismatches return generic errors.
- **Block & Role Isolation:** Wardens are strictly scoped via `canAccessBlock(actor, blockId)`; `MAINTENANCE_STAFF` receive HTTP `403` on all student PII, allotment, operations, finance, and reporting endpoints.
- **Transport, CSRF & Error Hardening:** `X-Powered-By` disabled, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store` on `/api/*`, HSTS in production, CSRF header + same-origin validation, sliding-window rate limiting, and stack-trace-redacted JSON error responses with `X-Request-Id`.
- **Privacy & Export Safety:** Private documents served exclusively via 60-second user-bound HMAC-SHA256 signed URLs; visitor IDs truncated to 4 characters; CSV exports neutralize spreadsheet formula injection (`=`, `+`, `-`, `@`) and log every download.
- **Zero AI Authority:** AI is strictly advisory (policy Q&A and room search filters) and never decides eligibility, allotment, verification, billing, or authorization.

---

## 4. Mandatory University Prerequisites Before Production Go-Live
1. **Managed PostgreSQL / Supabase Persistence:** Provision production database, apply migrations `0001`–`0005`, configure automated encrypted daily backups and point-in-time recovery.
2. **Secret Management:** Inject high-entropy `SESSION_SECRET` (32+ bytes), `DATABASE_URL` / Supabase keys, and remove all `DEMO_*_PASSWORD` variables.
3. **Official University Identity Verification:** Configure `UNIVERSITY_API_BASE_URL` and official credentials (or establish signed SHA-256 Registrar CSV import SOP). Dev-only mock verification automatically throws in production.
4. **Transactional Email & Monitoring:** Configure `RESEND_API_KEY` (verified university sender domain) and `SENTRY_DSN` with alerting rules.
5. **Payment Gateway (Optional if Offline Challan Only):** Provide official institutional merchant credentials and webhook signing secret, or retain Finance-verified Bank NEFT/Challan workflow with Bursar approval.
6. **Institutional Governance Sign-Off:** Obtain formal written sign-off from the University Registrar, Chief Hostel Warden, Finance Officer/Bursar, and Campus Information Security Officer after staging UAT.

# HostelHub — System Architecture & Institutional Design

> **Deployment Readiness Notice**: HostelHub is currently operating in **Development Mode** with an in-memory repository and synthetic data. It must **not** be treated as production-ready or university-approved until Supabase PostgreSQL migrations are applied, official university student verification credentials are connected, payment/email providers are approved, and institutional security sign-off is completed.

## 1. Runtime Stack & Documented Technical Constraint

The AI Studio workspace runtime executes a full-stack **React 19 + Vite 8 + Express (`server.ts`) + TypeScript (strict mode) + Tailwind CSS v4 + Zod + Vitest** architecture on port 3000. Rather than discarding the verified, tested runtime and breaking live preview execution, HostelHub maintains a clean **modular monolith** matching all architectural layers (Presentation → API & RBAC Middleware → Application Services → Domain Engines → Repository Abstraction → PostgreSQL/Supabase Migrations & External Provider Interfaces).

## 2. Layered Modular Architecture

```
Browser / Mobile Web (React 19 + Tailwind CSS v4 — The Warden's Notice Board)
        |
        v
Express API Layer (server.ts)
  ├── attachServerSession (HttpOnly HMAC Cookie + Correlation ID)
  ├── requireCsrfProtection (Origin/Host + X-Requested-With)
  ├── SlidingWindowRateLimiter
  └── Zod Request Validation (lib/validation/schemas.ts)
        |
        v
Centralized Authorization Module (lib/auth/)
  ├── roles.ts (STUDENT | WARDEN | MAINTENANCE_STAFF | ADMIN)
  ├── permissions.ts (Least-privilege permission sets & block/hostel scopes)
  ├── middleware.ts (requireAuth, requireRole, requirePermission, requireAssignedBlock, requireAssignedHostel)
  ├── session.ts (Server-verified HMAC HttpOnly session store)
  └── authService.ts (scrypt hashing, TOTP MFA, lockout, staff provisioning, audit logs)
        |
        v
Domain & Application Services (lib/)
  ├── allotment/engine.ts (Deterministic priority + seeded tie-break + Pareto improvement)
  ├── swap/engine.ts (Directed graph DFS 2/3/4-way cycle detection + atomic swap)
  ├── compatibility/engine.ts (Transparent roommate compatibility scoring)
  ├── maintenance/store.ts (Data-minimized assigned work-order lifecycle)
  ├── config/env.ts (Strict startup env validation & integration readiness)
  └── ai/ (Advisory-only Gemini primary / Groq secondary / deterministic offline fallback)
        |
        v
Repository & Persistence Layer
  ├── lib/repo/interface.ts & memoryRepo.ts (Development synthetic store)
  ├── supabase/migrations/0001_phase1_foundation_rbac_audit.sql (Production PostgreSQL + RLS)
  └── db/schema.sql (Consolidated reference schema)
```

## 3. External University Integrations & Credentials Required

| Integration | Purpose | Required Credentials / Inputs | Current State |
| :--- | :--- | :--- | :--- |
| **University SIS / Identity API** | Authoritative enrollment & student ID verification | `UNIVERSITY_API_BASE_URL`, `UNIVERSITY_API_CLIENT_ID`, `UNIVERSITY_API_CLIENT_SECRET` or `UNIVERSITY_API_KEY`, signed import spec | **Unconfigured (Dev Mock Only)** |
| **Supabase PostgreSQL & Auth** | Persistent relational database, RLS, private Storage buckets | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` | **Migrations Ready (In-Memory Active)** |
| **Institutional Payment Gateway** | Sandbox/live hostel fee collection & verified webhooks | `PAYMENT_PROVIDER_SECRET`, `PAYMENT_WEBHOOK_SECRET`, university merchant onboarding | **Unconfigured (Sandbox Pending)** |
| **Transactional Email (Resend/SMTP)** | Verification links, allotment letters, swap consent & receipts | `RESEND_API_KEY`, verified university sender domain (SPF/DKIM/DMARC) | **Unconfigured** |
| **Error Monitoring (Sentry)** | Runtime exceptions, latency traces, alert routing | `SENTRY_DSN` | **Unconfigured** |
| **AI Providers (Advisory Only)** | NL room filter parsing & grounded rules Q&A | `GEMINI_API_KEY`, optional `GROQ_API_KEY` | **Advisory Only / Offline Fallback** |

## 4. Policies Required from University Administration

Before any institutional pilot or production launch, the university must formally supply and approve:
1. **Student Eligibility & Priority Policy**: Official enrollment rules, academic year weights, accessibility accommodations, and tie-breaking governance.
2. **Hostel & Gender Allocation Rules**: Official hostel/block gender policies and exception workflows.
3. **Fee Structure & Refund Policy**: Approved room/mess/deposit schedules, late fees, waivers, and reconciliation procedures.
4. **Gate Pass, Curfew & Visitor Policy**: Permitted hours, parental/warden approval thresholds, and visitor data retention duration.
5. **Data Retention & Privacy Policy**: Retention windows for identity documents, verification records, occupancy history, and audit logs.
6. **Admin MFA & Incident Response Policy**: Mandatory TOTP enrollment for privileged staff, key rotation cadence, and break-glass governance.

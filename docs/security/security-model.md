# HostelHub — Security Model & 4-Role RBAC Matrix

## 1. Core Security Invariants

1. **Zero Client-Side Role Authority**: No public role switcher exists. Roles (`STUDENT`, `WARDEN`, `MAINTENANCE_STAFF`, `ADMIN`) live exclusively in server-side profiles and PostgreSQL `public.profiles`.
2. **Portal Verification Without Role Granting**: Selecting a role portal on `/login` only checks that the authenticated account's server-stored role matches the chosen portal; mismatches return a generic authentication failure and emit a `LOGIN_PORTAL_ROLE_MISMATCH` audit event.
3. **Controlled Provisioning**: Public registration only ever creates `STUDENT` accounts (`role = 'STUDENT'` hardcoded server-side). `WARDEN`, `MAINTENANCE_STAFF`, and `ADMIN` accounts can only be provisioned by an authenticated `ADMIN`.
4. **Anti-Self-Escalation**: Even an `ADMIN` cannot alter their own role or deactivate themselves (enforced both in `HostelAuthService.updateAccountAccess` and PostgreSQL trigger `trg_guard_profile_privileged_columns`).
5. **Scoped Access & Data Minimization**:
   - `WARDEN` accounts are restricted to explicitly assigned hostel blocks (`warden_assignments`).
   - `MAINTENANCE_STAFF` accounts are restricted strictly to tickets assigned to them (`assigned_to_id === user.id`) inside their assigned blocks (`maintenance_staff_assignments`), with **zero access** to student academic records, CGPA, identity documents, allotment configuration, or financial data.
6. **Append-Only Audit Logging**: `public.audit_logs` rejects `UPDATE` and `DELETE` via database trigger `trg_audit_logs_immutable`. Passwords, session cookies, and tokens are never logged.

## 2. Four-Role RBAC Permission Matrix

| Capability / Domain | `STUDENT` | `WARDEN` | `MAINTENANCE_STAFF` | `ADMIN` |
| :--- | :---: | :---: | :---: | :---: |
| Own profile & preferences | Read / Update permitted | — | — | Manage all |
| Own allotment result | Read own | Read assigned blocks | — | Run, approve, publish all |
| Room inventory & blueprint | Read availability | Manage assigned blocks | — | Manage all campuses/blocks/rooms |
| Room exchanges (2/3/4-way) | Create & consent own | Review assigned blocks | — | Manage all & configure policy |
| Complaints / Disputes | Submit & track own | Resolve assigned blocks | — | Review all & escalate |
| Maintenance work orders | Track own request (Phase 5) | Create & assign in scope | Read & update **assigned tasks only** | Full institution-wide oversight |
| Student academic / PII records | Own only | Assigned blocks only | **STRICTLY DENIED (403)** | Authorized institution-wide |
| Financial records & fees | Own invoices (Phase 6) | — | **STRICTLY DENIED (403)** | Manage fee structures & reconciliation |
| Staff provisioning & roles | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** | Provision/revoke (no self-change) |
| Audit logs & env readiness | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** | Read-only append-only ledger |
| Admin TOTP MFA | — | — | — | Enroll / verify (mandatory in prod) |

## 3. Session, CSRF & Rate-Limit Controls

- **Password Hashing**: `crypto.scryptSync` with 16-byte per-user random salt and `crypto.timingSafeEqual` verification.
- **Sessions**: Server-verified HMAC-SHA256 signed `HttpOnly` cookies (`SameSite=None; Secure; Partitioned` over HTTPS/proxy; `SameSite=Lax` on plain HTTP localhost). Sessions are immediately revoked on logout, password reset, deactivation, or role change.
- **CSRF**: All state-changing `/api/*` requests require matching `Origin` against `Host`/`X-Forwarded-Host` or explicit `X-Requested-With: HostelHub`.
- **Brute-Force Lockout & Rate Limiting**: Sliding-window rate limiters on auth, write, and AI endpoints plus per-identifier+IP exponential/timed lockout after repeated failed sign-in attempts.

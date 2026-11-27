# University Student Verification & Integration Requirements

> **Institutional Authority Principle**: The university's Student Information System (SIS) or Registrar's Office is the sole authority for student identity, enrollment status, and hostel eligibility. HostelHub never fabricates official university verification results.

---

## 1. Supported Verification Providers

HostelHub abstracts student verification behind `UniversityVerificationProvider` (`lib/integrations/university/university-provider.ts`) and selects the active provider in strict priority order:

| Priority | Provider | Mode | Production Allowed? |
| :--- | :--- | :--- | :--- |
| 1 | `OfficialUniversityApiProvider` | Real-time HTTPS call to University SIS | **Yes (Preferred)** |
| 2 | `AuthorizedImportProvider` | Admin-uploaded SHA-256 verified Registrar roster | **Yes (Controlled Fallback)** |
| 3 | `DevMockUniversityProvider` | Local synthetic development check (`is_mock_development_record: true`) | **NO — throws error if `HOSTELHUB_ENV=production`** |

If neither the Official University API nor an Authorized Roster Import is configured in `production`, HostelHub refuses to fall back to the development mock and records verification requests as `NEEDS_REVIEW` until official university credentials are supplied.

---

## 2. Official University SIS REST API Contract

### Required Environment Variables (Server-Side Only)
Configure via server secrets (never expose in `VITE_*` variables):
- `UNIVERSITY_API_BASE_URL` — Must be `https://` pointing to an institutional domain (loopback, private RFC1918, and cloud metadata IPs are blocked for SSRF protection).
- `UNIVERSITY_API_KEY` — Bearer token or mutual-TLS / signed service credential issued by University IT.

### Request Specification
`POST {UNIVERSITY_API_BASE_URL}/v1/students/verify`

Headers:
- `Authorization: Bearer <UNIVERSITY_API_KEY>`
- `Content-Type: application/json`
- `X-HostelHub-Request-Id: <uuid>`

Body:
```json
{
  "university_student_id": "VV2024CO101",
  "email": "student@univ.edu.in",
  "full_name": "Student Legal Name"
}
```

### Expected Response Specification (`200 OK`)
```json
{
  "verified": true,
  "status": "VERIFIED",
  "reference_id": "SIS-2026-991042",
  "reason": "Active full-time enrollment confirmed for Monsoon 2026.",
  "student": {
    "university_student_id": "VV2024CO101",
    "official_full_name": "Student Legal Name",
    "official_email": "student@univ.edu.in",
    "course_branch": "Computer Science",
    "academic_year": 3,
    "enrollment_status": "enrolled",
    "campus_code": "CAMPUS-NORTH"
  }
}
```

---

## 3. Controlled Authorized Roster Import Format

When a live University SIS API is not yet provisioned, an authenticated **Admin** may import an official Registrar-signed roster batch via `POST /api/admin/verification/import`.

### Integrity & Governance Controls
1. **Admin-Only Endpoint**: `STUDENT`, `WARDEN`, and `MAINTENANCE_STAFF` receive `403 Forbidden`.
2. **SHA-256 Digest Verification**: When `expected_sha256` is provided, HostelHub computes the SHA-256 checksum over the canonicalized JSON array of roster entries and rejects the batch if the digest does not match.
3. **Immutable Audit Trail**: Every import logs `UNIVERSITY_ROSTER_IMPORTED` with batch ID, source label, entry count, actor email, and SHA-256 checksum.
4. **Enrollment Enforcement**: Students whose `enrollment_status` is `graduated`, `suspended`, or `withdrawn` are automatically marked `REJECTED` or `SUSPENDED`, never `VERIFIED`.

---

## 4. Separated Student Account Lifecycle States

HostelHub tracks five distinct checkpoints so authentication alone never grants hostel access:

1. **Authenticated** — User proved possession of account credentials / valid server-side session.
2. **Identity Verified** — University SIS or authorized Registrar roster confirmed active enrollment.
3. **Account Activated** — Account is active and not suspended or deactivated.
4. **Hostel Eligible** — Student meets institutional hostel eligibility rules.
5. **Application Approved** — Hostel allotment has been approved and a bed assigned.

---

## 5. Manual Exception Governance

For edge cases (e.g., late transfer students or name spelling mismatches), an **Admin** or block-scoped **Warden** may record a manual exception via `PATCH /api/verification/records/:studentId/review`:
- Requires an explicit audit reason (minimum 8 characters).
- Appends an immutable entry to `verification_history` and `audit_logs` recording the reviewer's identity, timestamp, decision, and justification.

---

## 6. Pending Institutional Sign-Off Checklist (Before Production Cutover)

- [ ] University IT provisions `UNIVERSITY_API_BASE_URL` and `UNIVERSITY_API_KEY` (or signs Registrar roster export workflow).
- [ ] Institutional email domain policy confirmed in `Admin → Security Settings`.
- [ ] Supabase PostgreSQL migrations (`0001` and `0002`) applied with private Storage bucket configured (`student-documents`, public access disabled).
- [ ] `HOSTELHUB_ENV=production` verified to reject `DevMockUniversityProvider`.

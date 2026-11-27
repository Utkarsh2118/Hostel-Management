# HostelHub Phase 3 — Applications, Eligibility & Deterministic Allotment Policy

> **Non-Negotiable Institutional Principle**: No AI or LLM model is ever permitted to make student eligibility, priority ranking, waitlist, bed assignment, or override decisions. All allotment outcomes are 100% deterministic, rule-based, policy-versioned, and auditable.

---

## 1. Application Lifecycle States

Every student hostel application within an institutional cycle moves through explicit server-controlled states:

1. `DRAFT` — Student is editing ranked preferences, distance, and accessibility request.
2. `SUBMITTED` — Submitted for the active cycle, awaiting verification or review.
3. `UNDER_REVIEW` — Flagged by a Warden or Admin for documentation or accessibility review.
4. `ELIGIBLE` — Passed all deterministic policy rules (University Verification, Academic Year, Gender-Compatible Preferences, Declaration).
5. `WAITLISTED` — Eligible applicant could not be assigned a compatible free bed; assigned deterministic `waitlist_position`.
6. `ALLOTTED` — Assigned a specific Campus → Hostel → Block → Floor → Room → Bed via deterministic run or audited manual override.
7. `ACCEPTED` / `DECLINED` — Student confirmed their bed assignment or declined (which immediately vacates and releases the bed back to inventory).
8. `REJECTED` / `WITHDRAWN` — Rejected with written audit note by authorized staff, or withdrawn by the student prior to allotment.

---

## 2. Deterministic Priority Scoring & Tie-Breaking

For cycle policy version `VVU-HP-2026.3`, each eligible applicant's priority score is computed transparently:

```text
priority_score =
    (academic_year * year_weight)
  + (merit_band_points * merit_weight)
  + (min(home_distance_km, 2500) / 100 * distance_weight_per_100km)
  + (accessibility_verified ? accessibility_priority_bonus : 0)
```

Ordering rules:
1. **Verified Accessibility Priority**: Applicants with staff-verified accessibility/medical needs are processed first and matched to ground-floor accessible beds (`is_accessible === true`).
2. **Priority Score Descending**: Higher deterministic `priority_score` ranks first.
3. **Reproducible Seeded Tie-Breaker**: Ties are broken deterministically via `seededTieBreaker(seed, student_id)`. Re-running with the same seed, inventory state, and eligible pool yields identical results.

---

## 3. Hard Institutional Invariants Enforced on Commit

1. **University Verification Gate**: When `require_university_verification` is enabled, unverified students (`status !== 'VERIFIED'`) cannot become `ELIGIBLE` and cannot be allotted — even by staff review.
2. **Gender Separation**: Boys' blocks accept male students only; girls' blocks accept female students only.
3. **Phase 2 Operational Status Respect**: Rooms marked `UNDER_MAINTENANCE`, `BLOCKED`, or `RESERVED`, and individual beds marked `MAINTENANCE` or `RESERVED`, are automatically excluded from allotment allocation.
4. **One Active Bed Per Student**: Committing a bed atomically removes any stale room reference and prevents double-allocation or exceeding room capacity.
5. **Dry-Run Before Commit**: Admins can run `dry_run: true` simulations to inspect first-choice rates, accessibility honors, and waitlist counts before executing a transactional commit (`dry_run: false`).

---

## 4. Audited Manual Override Governance

When an exceptional institutional case requires manual placement (`POST /api/applications/:id/override`):
- Restricted strictly to `ADMIN` accounts.
- Requires a written audit justification (minimum 10 characters).
- Still enforces room operational status, available bed check, gender policy, and capacity invariants.
- Appends an immutable `ALLOTMENT_MANUAL_OVERRIDE` entry to `audit_logs` and marks `allotted_via: 'manual_override'` on the Official Allotment Slip.

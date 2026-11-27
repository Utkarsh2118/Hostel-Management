# HostelHub Phase 5 — Billing Ledger, Financial Controls & Payment Gateway Readiness

## 1. Non-Fabrication Principle
HostelHub **never simulates or fabricates** online credit card, UPI, or net-banking payment gateway approvals.

- **Current Live Workflows (Zero Fabricated Transactions):**
  1. **Official Semester Invoice Issuance (`ADMIN` only):** Generates itemized hostel fee invoices (Room Rent, Mess Advance, Utility Levy) with immutable audit logs.
  2. **Offline Challan / Bank Transfer Reference Submission (`STUDENT`):** Students pay through the university's official bank account or challan counter and submit their UTR/Challan reference number (`SUBMITTED_FOR_VERIFICATION`). Students can **never** self-mark an invoice as `PAID`.
  3. **Finance Office Verification (`ADMIN` only):** Administrators reconcile references against university bank statements and mark them `VERIFIED_PAID` (issuing a SHA-256 Official Fee Receipt) or `REJECTED`. Duplicate verification and overpayments are blocked server-side.
  4. **Audited Fee Waivers (`ADMIN` only):** Scholarship or hardship fee adjustments require a mandatory justification and are permanently recorded in the audit ledger.

## 2. Prerequisites for Enabling Online Payment Gateway Checkout
Before enabling real-time online fee payments in production, the university must provide:
1. Official Merchant Account credentials (`PAYMENT_GATEWAY_KEY_ID`, `PAYMENT_GATEWAY_KEY_SECRET`) from the university's contracted gateway (e.g., BillDesk, Razorpay Institutional, SBI Collect API).
2. Dedicated server-side webhook signing secret (`PAYMENT_WEBHOOK_SECRET`) with HMAC signature verification and idempotent event deduplication.
3. University Bursar / Finance Office sign-off on refund, chargeback, and daily settlement reconciliation procedures.

## 3. Data Minimization & Role Isolation
- `MAINTENANCE_STAFF` receive HTTP `403` on all billing, fee receipt, and institutional reporting endpoints.
- `WARDEN` accounts have strictly **block-scoped read-only** access to fee clearance status and operational reports for their assigned blocks.
- All CSV exports enforce spreadsheet formula-injection protection and write an audit log entry (`INSTITUTIONAL_REPORT_EXPORTED`).

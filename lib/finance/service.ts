import crypto from 'node:crypto';
import type { AuthUserProfile } from '../auth/roles.ts';
import { canAccessBlock } from '../auth/permissions.ts';
import type { IHostelRepository } from '../repo/interface.ts';
import type { NotificationAndNoticeService } from '../notifications/service.ts';

export type FeeInvoiceStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED' | 'CANCELLED';

export type OfflinePaymentMode = 'BANK_NEFT_IMPS' | 'UNIVERSITY_CHALLAN' | 'DEMAND_DRAFT';
export type PaymentMode = OfflinePaymentMode | 'INSTITUTIONAL_GATEWAY_WEBHOOK';

export type PaymentRecordStatus = 'SUBMITTED_FOR_VERIFICATION' | 'VERIFIED_PAID' | 'REJECTED';

export interface FeeLineItem {
  code: string;
  label: string;
  amount_inr: number;
}

export interface FeePaymentRecord {
  id: string;
  receipt_number: string | null;
  invoice_id: string;
  student_id: string;
  mode: PaymentMode;
  reference_number: string;
  amount_inr: number;
  paid_on_date: string;
  status: PaymentRecordStatus;
  submitted_by: string;
  submitted_at: string;
  verified_by: string | null;
  verified_at: string | null;
  verification_note: string | null;
  receipt_checksum: string | null;
}

export interface FeeWaiverAdjustment {
  id: string;
  amount_inr: number;
  reason: string;
  approved_by: string;
  approved_at: string;
}

export interface FeeInvoice {
  id: string;
  invoice_code: string;
  academic_term: string;
  student_id: string;
  student_code: string;
  student_name: string;
  block_id: string | null;
  block_name: string;
  room_label: string;
  due_date: string;
  line_items: FeeLineItem[];
  subtotal_inr: number;
  waived_inr: number;
  total_payable_inr: number;
  paid_inr: number;
  balance_due_inr: number;
  status: FeeInvoiceStatus;
  payments: FeePaymentRecord[];
  waivers: FeeWaiverAdjustment[];
  issued_by: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentGatewayReadiness {
  configured: boolean;
  mode: 'UNCONFIGURED_UNIVERSITY_GATEWAY';
  supported_live_workflows: string[];
  required_for_online_checkout: string[];
}

export interface OfficialFeeReceipt {
  receipt_number: string;
  receipt_checksum: string;
  invoice_code: string;
  academic_term: string;
  student_name: string;
  student_code: string;
  room_label: string;
  mode: PaymentMode;
  reference_number: string;
  amount_inr: number;
  paid_on_date: string;
  verified_by: string;
  verified_at: string;
  remaining_balance_inr: number;
}

export class FinanceError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'FinanceError';
  }
}

/**
 * Phase 5 — Institutional Hostel Fee & Billing Ledger Service
 * ============================================================
 * - Never fabricates online payment gateway transactions.
 * - Students may submit offline bank/challan references for Finance Office verification,
 *   but can NEVER self-mark invoices as PAID.
 * - Only Administrators (Finance Office authority) may issue invoices, verify/reject payments,
 *   or record audited waivers.
 * - Wardens have block-scoped read-only visibility for clearance checks.
 * - Maintenance Staff are strictly denied (403).
 */
export class HostelFinanceService {
  private readonly invoices = new Map<string, FeeInvoice>();
  private readonly referenceIndex = new Set<string>(); // idempotency key: invoiceId::normalizedRef
  private invoiceSeq = 5001;
  private receiptSeq = 8001;
  private seeded = false;

  constructor(
    private readonly repo: IHostelRepository,
    private readonly notifications?: NotificationAndNoticeService
  ) {}

  private assertNotMaintenance(actor: AuthUserProfile): void {
    if (actor.role === 'MAINTENANCE_STAFF') {
      throw new FinanceError(
        'Maintenance staff cannot access student billing ledgers or fee records.',
        403
      );
    }
  }

  public getGatewayReadiness(): PaymentGatewayReadiness {
    return {
      configured: false,
      mode: 'UNCONFIGURED_UNIVERSITY_GATEWAY',
      supported_live_workflows: [
        'Official Semester Fee Invoice Generation (Admin)',
        'Student Offline Bank NEFT/IMPS & University Challan Reference Submission',
        'Admin Finance Office Verification & SHA-256 Official Receipt Issuance',
        'Audited Fee Waiver / Scholarship Adjustment Ledger',
      ],
      required_for_online_checkout: [
        'Official University Payment Gateway Merchant Credentials (e.g., BillDesk / Razorpay Institutional)',
        'Server-Side Webhook Signing Secret & Reconciliation Cron Job',
        'University Bursar / Finance Office Policy Sign-Off',
      ],
    };
  }

  private async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;
    const students = await this.repo.getStudents();
    const rooms = await this.repo.getRooms();
    const blocks = await this.repo.getBlocks();
    const roomMap = new Map(rooms.map((r) => [r.id, r]));
    const blockMap = new Map(blocks.map((b) => [b.id, b]));

    // Seed initial semester invoices for key demo students so portals show authentic live ledger data
    const seedIds = ['stu-001', 'stu-151', 'stu-002', 'stu-003'];
    for (const sid of seedIds) {
      const st = students.find((s) => s.id === sid);
      if (!st) continue;
      const room = st.allotted_room_id ? roomMap.get(st.allotted_room_id) : null;
      const block = room ? blockMap.get(room.block_id) : null;
      const roomRent = room?.ac ? 28000 : 18500;
      const lineItems: FeeLineItem[] = [
        { code: 'RENT', label: room?.ac ? 'Hostel Room Rent (AC)' : 'Hostel Room Rent (Standard)', amount_inr: roomRent },
        { code: 'MESS', label: 'Semester Mess & Dining Advance', amount_inr: 16500 },
        { code: 'UTIL', label: 'Electricity, Water & Campus LAN Levy', amount_inr: 3500 },
      ];
      const subtotal = lineItems.reduce((sum, item) => sum + item.amount_inr, 0);
      const now = new Date().toISOString();
      const id = `inv-seed-${sid}`;
      const code = `FEE-2026-${this.invoiceSeq++}`;

      this.invoices.set(id, {
        id,
        invoice_code: code,
        academic_term: 'Autumn 2026',
        student_id: st.id,
        student_code: st.student_code,
        student_name: st.name,
        block_id: block?.id ?? null,
        block_name: block?.name ?? 'Unallotted',
        room_label: room && block ? `${block.code}-${room.number}` : 'Pending Allotment',
        due_date: '2026-08-31',
        line_items: lineItems,
        subtotal_inr: subtotal,
        waived_inr: 0,
        total_payable_inr: subtotal,
        paid_inr: 0,
        balance_due_inr: subtotal,
        status: 'UNPAID',
        payments: [],
        waivers: [],
        issued_by: 'finance.office@univ.edu.in',
        created_at: now,
        updated_at: now,
      });
    }
  }

  private recomputeInvoiceTotals(inv: FeeInvoice): void {
    inv.subtotal_inr = inv.line_items.reduce((sum, item) => sum + item.amount_inr, 0);
    inv.waived_inr = inv.waivers.reduce((sum, w) => sum + w.amount_inr, 0);
    inv.total_payable_inr = Math.max(0, inv.subtotal_inr - inv.waived_inr);
    inv.paid_inr = inv.payments
      .filter((p) => p.status === 'VERIFIED_PAID')
      .reduce((sum, p) => sum + p.amount_inr, 0);
    inv.balance_due_inr = Math.max(0, inv.total_payable_inr - inv.paid_inr);

    if (inv.status === 'CANCELLED') return;
    if (inv.total_payable_inr === 0 && inv.waived_inr > 0) {
      inv.status = 'WAIVED';
    } else if (inv.balance_due_inr === 0) {
      inv.status = 'PAID';
    } else if (inv.paid_inr > 0) {
      inv.status = 'PARTIALLY_PAID';
    } else {
      inv.status = 'UNPAID';
    }
  }

  public async listInvoices(actor: AuthUserProfile): Promise<FeeInvoice[]> {
    this.assertNotMaintenance(actor);
    await this.ensureSeeded();
    const all = Array.from(this.invoices.values()).sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );

    if (actor.role === 'STUDENT') {
      return all.filter((inv) => inv.student_id === actor.student_id).map((inv) => structuredClone(inv));
    }
    if (actor.role === 'ADMIN') {
      return all.map((inv) => structuredClone(inv));
    }
    // WARDEN: block-scoped read-only visibility
    return all
      .filter((inv) => Boolean(inv.block_id && canAccessBlock(actor, inv.block_id)))
      .map((inv) => structuredClone(inv));
  }

  public async createInvoice(
    actor: AuthUserProfile,
    input: {
      student_id: string;
      academic_term: string;
      due_date: string;
      line_items: FeeLineItem[];
    }
  ): Promise<FeeInvoice> {
    if (actor.role !== 'ADMIN') {
      throw new FinanceError('Only Administrators (Finance Office) may issue hostel fee invoices.', 403);
    }
    await this.ensureSeeded();

    const student = await this.repo.getStudentById(input.student_id);
    if (!student) {
      throw new FinanceError(`Student '${input.student_id}' not found.`, 404);
    }

    const room = student.allotted_room_id ? await this.repo.getRoomById(student.allotted_room_id) : null;
    const block = room ? await this.repo.getBlockById(room.block_id) : null;
    const now = new Date().toISOString();
    const id = `inv-${crypto.randomUUID().slice(0, 8)}`;
    const code = `FEE-2026-${this.invoiceSeq++}`;

    const invoice: FeeInvoice = {
      id,
      invoice_code: code,
      academic_term: input.academic_term.trim(),
      student_id: student.id,
      student_code: student.student_code,
      student_name: student.name,
      block_id: block?.id ?? null,
      block_name: block?.name ?? 'Unallotted',
      room_label: room && block ? `${block.code}-${room.number}` : 'Pending Allotment',
      due_date: input.due_date.trim(),
      line_items: input.line_items.map((li) => ({
        code: li.code.trim().toUpperCase(),
        label: li.label.trim(),
        amount_inr: Math.round(li.amount_inr),
      })),
      subtotal_inr: 0,
      waived_inr: 0,
      total_payable_inr: 0,
      paid_inr: 0,
      balance_due_inr: 0,
      status: 'UNPAID',
      payments: [],
      waivers: [],
      issued_by: actor.email,
      created_at: now,
      updated_at: now,
    };

    this.recomputeInvoiceTotals(invoice);
    this.invoices.set(id, invoice);

    await this.repo.appendAuditLog(actor.email, actor.role, 'FEE_INVOICE_ISSUED', {
      invoice_id: id,
      invoice_code: code,
      student_id: student.id,
      total_payable_inr: invoice.total_payable_inr,
    });

    this.notifications?.notifyStudent(student.id, {
      category: 'BILLING',
      title: `Hostel Fee Invoice Issued (${code})`,
      body: `Invoice ${code} for ${invoice.academic_term} totaling INR ${invoice.total_payable_inr.toLocaleString('en-IN')} is due by ${invoice.due_date}.`,
    });

    return structuredClone(invoice);
  }

  /**
   * Students submit an offline Bank NEFT/IMPS or University Challan reference.
   * NEVER marks the invoice as PAID — requires Admin Finance Office verification.
   */
  public async submitOfflinePaymentReference(
    actor: AuthUserProfile,
    invoiceId: string,
    input: {
      mode: OfflinePaymentMode;
      reference_number: string;
      amount_inr: number;
      paid_on_date: string;
    }
  ): Promise<{ invoice: FeeInvoice; payment: FeePaymentRecord }> {
    if (actor.role !== 'STUDENT' || !actor.student_id) {
      throw new FinanceError('Only authenticated students may submit offline fee payment references.', 403);
    }
    await this.ensureSeeded();
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      throw new FinanceError('Fee invoice not found.', 404);
    }
    if (invoice.student_id !== actor.student_id) {
      throw new FinanceError('Forbidden: You may only submit payment references for your own invoices.', 403);
    }
    if (invoice.status === 'PAID' || invoice.status === 'WAIVED' || invoice.status === 'CANCELLED') {
      throw new FinanceError(`Invoice ${invoice.invoice_code} is already ${invoice.status}.`, 409);
    }

    const amount = Math.round(input.amount_inr);
    if (amount <= 0 || amount > invoice.balance_due_inr) {
      throw new FinanceError(
        `Submitted amount (INR ${amount}) must be between INR 1 and remaining balance INR ${invoice.balance_due_inr}.`,
        400
      );
    }

    const normalizedRef = input.reference_number.trim().toUpperCase();
    const idempotencyKey = `${invoice.id}::${normalizedRef}`;
    if (this.referenceIndex.has(idempotencyKey)) {
      throw new FinanceError(
        `Payment reference '${normalizedRef}' has already been submitted for this invoice.`,
        409
      );
    }

    const now = new Date().toISOString();
    const payment: FeePaymentRecord = {
      id: `pay-${crypto.randomUUID().slice(0, 8)}`,
      receipt_number: null,
      invoice_id: invoice.id,
      student_id: invoice.student_id,
      mode: input.mode,
      reference_number: normalizedRef,
      amount_inr: amount,
      paid_on_date: input.paid_on_date.trim(),
      status: 'SUBMITTED_FOR_VERIFICATION',
      submitted_by: actor.email,
      submitted_at: now,
      verified_by: null,
      verified_at: null,
      verification_note: null,
      receipt_checksum: null,
    };

    this.referenceIndex.add(idempotencyKey);
    invoice.payments.push(payment);
    invoice.updated_at = now;

    await this.repo.appendAuditLog(actor.email, actor.role, 'FEE_PAYMENT_REFERENCE_SUBMITTED', {
      invoice_id: invoice.id,
      payment_id: payment.id,
      reference_number: normalizedRef,
      amount_inr: amount,
      mode: payment.mode,
    });

    return {
      invoice: structuredClone(invoice),
      payment: structuredClone(payment),
    };
  }

  /**
   * Admin Finance Office verifies or rejects a submitted offline payment reference.
   * Strictly idempotent: already verified or rejected records cannot be re-verified.
   */
  public async verifyOrRejectPayment(
    actor: AuthUserProfile,
    invoiceId: string,
    paymentId: string,
    input: {
      decision: 'VERIFIED_PAID' | 'REJECTED';
      verification_note: string;
    }
  ): Promise<{ invoice: FeeInvoice; payment: FeePaymentRecord }> {
    if (actor.role !== 'ADMIN') {
      throw new FinanceError('Only Administrators (Finance Office) may verify or reject fee payments.', 403);
    }
    await this.ensureSeeded();
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      throw new FinanceError('Fee invoice not found.', 404);
    }
    const payment = invoice.payments.find((p) => p.id === paymentId);
    if (!payment) {
      throw new FinanceError('Payment submission not found on this invoice.', 404);
    }
    if (payment.status !== 'SUBMITTED_FOR_VERIFICATION') {
      throw new FinanceError(
        `Payment ${payment.reference_number} has already been processed (${payment.status}). Duplicate verification blocked.`,
        409
      );
    }

    if (input.decision === 'VERIFIED_PAID' && payment.amount_inr > invoice.balance_due_inr) {
      throw new FinanceError(
        `Verification blocked: amount INR ${payment.amount_inr} exceeds remaining balance INR ${invoice.balance_due_inr}.`,
        400
      );
    }

    const now = new Date().toISOString();
    payment.status = input.decision;
    payment.verified_by = actor.email;
    payment.verified_at = now;
    payment.verification_note = input.verification_note.trim();

    if (input.decision === 'VERIFIED_PAID') {
      const receiptNumber = `RCPT-2026-${this.receiptSeq++}`;
      payment.receipt_number = receiptNumber;
      payment.receipt_checksum = crypto
        .createHash('sha256')
        .update(
          `${receiptNumber}|${invoice.invoice_code}|${invoice.student_code}|${payment.reference_number}|${payment.amount_inr}|${now}`
        )
        .digest('hex')
        .slice(0, 16)
        .toUpperCase();
    }

    this.recomputeInvoiceTotals(invoice);
    invoice.updated_at = now;

    await this.repo.appendAuditLog(
      actor.email,
      actor.role,
      input.decision === 'VERIFIED_PAID' ? 'FEE_PAYMENT_VERIFIED' : 'FEE_PAYMENT_REJECTED',
      {
        invoice_id: invoice.id,
        invoice_code: invoice.invoice_code,
        payment_id: payment.id,
        receipt_number: payment.receipt_number,
        amount_inr: payment.amount_inr,
        balance_due_inr: invoice.balance_due_inr,
      }
    );

    this.notifications?.notifyStudent(invoice.student_id, {
      category: 'BILLING',
      title:
        input.decision === 'VERIFIED_PAID'
          ? `Payment Verified — Receipt ${payment.receipt_number}`
          : `Payment Reference Declined (${payment.reference_number})`,
      body:
        input.decision === 'VERIFIED_PAID'
          ? `Finance Office verified INR ${payment.amount_inr.toLocaleString('en-IN')} against ${invoice.invoice_code}. Remaining balance: INR ${invoice.balance_due_inr.toLocaleString('en-IN')}.`
          : `Reference ${payment.reference_number} was not confirmed by Finance Office: ${payment.verification_note}`,
    });

    return {
      invoice: structuredClone(invoice),
      payment: structuredClone(payment),
    };
  }

  public async applyAuditedWaiver(
    actor: AuthUserProfile,
    invoiceId: string,
    input: {
      amount_inr: number;
      reason: string;
    }
  ): Promise<FeeInvoice> {
    if (actor.role !== 'ADMIN') {
      throw new FinanceError('Only Administrators may issue audited fee waivers or adjustments.', 403);
    }
    await this.ensureSeeded();
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      throw new FinanceError('Fee invoice not found.', 404);
    }
    const amount = Math.round(input.amount_inr);
    if (amount <= 0 || amount > invoice.balance_due_inr) {
      throw new FinanceError(
        `Waiver amount (INR ${amount}) must be between INR 1 and remaining balance INR ${invoice.balance_due_inr}.`,
        400
      );
    }

    const now = new Date().toISOString();
    invoice.waivers.push({
      id: `wav-${crypto.randomUUID().slice(0, 8)}`,
      amount_inr: amount,
      reason: input.reason.trim(),
      approved_by: actor.email,
      approved_at: now,
    });
    this.recomputeInvoiceTotals(invoice);
    invoice.updated_at = now;

    await this.repo.appendAuditLog(actor.email, actor.role, 'FEE_WAIVER_APPLIED', {
      invoice_id: invoice.id,
      amount_inr: amount,
      reason: input.reason.trim(),
      balance_due_inr: invoice.balance_due_inr,
    });

    this.notifications?.notifyStudent(invoice.student_id, {
      category: 'BILLING',
      title: `Fee Waiver Applied (${invoice.invoice_code})`,
      body: `An audited adjustment of INR ${amount.toLocaleString('en-IN')} was credited (${input.reason.trim()}). Remaining balance: INR ${invoice.balance_due_inr.toLocaleString('en-IN')}.`,
    });

    return structuredClone(invoice);
  }

  public async getOfficialReceipt(
    actor: AuthUserProfile,
    invoiceId: string,
    paymentId: string
  ): Promise<OfficialFeeReceipt> {
    this.assertNotMaintenance(actor);
    await this.ensureSeeded();
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      throw new FinanceError('Fee invoice not found.', 404);
    }
    if (actor.role === 'STUDENT' && invoice.student_id !== actor.student_id) {
      throw new FinanceError('Forbidden: You may only view receipts for your own invoices.', 403);
    }
    if (actor.role === 'WARDEN' && (!invoice.block_id || !canAccessBlock(actor, invoice.block_id))) {
      throw new FinanceError('Forbidden: Receipt is outside your assigned hostel blocks.', 403);
    }
    const payment = invoice.payments.find((p) => p.id === paymentId);
    if (!payment || payment.status !== 'VERIFIED_PAID' || !payment.receipt_number) {
      throw new FinanceError('Official receipt is only available for Finance-verified payments.', 404);
    }

    return {
      receipt_number: payment.receipt_number,
      receipt_checksum: payment.receipt_checksum ?? '',
      invoice_code: invoice.invoice_code,
      academic_term: invoice.academic_term,
      student_name: invoice.student_name,
      student_code: invoice.student_code,
      room_label: invoice.room_label,
      mode: payment.mode,
      reference_number: payment.reference_number,
      amount_inr: payment.amount_inr,
      paid_on_date: payment.paid_on_date,
      verified_by: payment.verified_by ?? 'finance.office@univ.edu.in',
      verified_at: payment.verified_at ?? payment.submitted_at,
      remaining_balance_inr: invoice.balance_due_inr,
    };
  }

  public async getOverdueInvoicesSnapshot(
    referenceDateIso = new Date().toISOString().slice(0, 10)
  ): Promise<FeeInvoice[]> {
    await this.ensureSeeded();
    const overdue: FeeInvoice[] = [];
    for (const inv of this.invoices.values()) {
      if (
        (inv.status === 'UNPAID' || inv.status === 'PARTIALLY_PAID') &&
        inv.balance_due_inr > 0 &&
        inv.due_date < referenceDateIso
      ) {
        overdue.push(structuredClone(inv));
      }
    }
    return overdue;
  }

  /**
   * Reconciles a cryptographically verified institutional payment gateway webhook event.
   * Caller MUST verify HMAC-SHA256 signature, replay timestamp window, and event_id uniqueness first.
   */
  public async reconcileVerifiedGatewayPayment(input: {
    invoice_id_or_code: string;
    gateway_event_id: string;
    gateway_reference: string;
    amount_inr: number;
    paid_on_date: string;
    provider_name: string;
  }): Promise<{ invoice: FeeInvoice; payment: FeePaymentRecord }> {
    await this.ensureSeeded();
    const needle = input.invoice_id_or_code.trim();
    let invoice = this.invoices.get(needle);
    if (!invoice) {
      for (const inv of this.invoices.values()) {
        if (inv.invoice_code.toUpperCase() === needle.toUpperCase()) {
          invoice = inv;
          break;
        }
      }
    }
    if (!invoice) {
      throw new FinanceError(`Invoice '${needle}' not found for gateway settlement.`, 404);
    }
    if (invoice.status === 'PAID' || invoice.status === 'WAIVED' || invoice.status === 'CANCELLED') {
      throw new FinanceError(`Invoice ${invoice.invoice_code} is already ${invoice.status}.`, 409);
    }

    const amount = Math.round(input.amount_inr);
    if (amount <= 0 || amount > invoice.balance_due_inr) {
      throw new FinanceError(
        `Gateway settlement amount INR ${amount} exceeds remaining balance INR ${invoice.balance_due_inr}.`,
        400
      );
    }

    const normalizedRef = input.gateway_reference.trim().toUpperCase();
    const idempotencyKey = `${invoice.id}::${normalizedRef}`;
    if (this.referenceIndex.has(idempotencyKey)) {
      throw new FinanceError(
        `Gateway reference '${normalizedRef}' has already been reconciled on invoice ${invoice.invoice_code}.`,
        409
      );
    }

    const now = new Date().toISOString();
    const receiptNumber = `RCPT-2026-${this.receiptSeq++}`;
    const receiptChecksum = crypto
      .createHash('sha256')
      .update(
        `${receiptNumber}|${invoice.invoice_code}|${invoice.student_code}|${normalizedRef}|${amount}|${now}`
      )
      .digest('hex')
      .slice(0, 16)
      .toUpperCase();

    const verifierIdentity = `gateway-webhook:${input.provider_name}`;
    const payment: FeePaymentRecord = {
      id: `pay-gw-${crypto.randomUUID().slice(0, 8)}`,
      receipt_number: receiptNumber,
      invoice_id: invoice.id,
      student_id: invoice.student_id,
      mode: 'INSTITUTIONAL_GATEWAY_WEBHOOK',
      reference_number: normalizedRef,
      amount_inr: amount,
      paid_on_date: input.paid_on_date.trim(),
      status: 'VERIFIED_PAID',
      submitted_by: verifierIdentity,
      submitted_at: now,
      verified_by: verifierIdentity,
      verified_at: now,
      verification_note: `Cryptographically verified webhook event ${input.gateway_event_id} (${input.provider_name}).`,
      receipt_checksum: receiptChecksum,
    };

    this.referenceIndex.add(idempotencyKey);
    invoice.payments.push(payment);
    this.recomputeInvoiceTotals(invoice);
    invoice.updated_at = now;

    await this.repo.appendAuditLog(verifierIdentity, 'system', 'FEE_PAYMENT_GATEWAY_RECONCILED', {
      invoice_id: invoice.id,
      invoice_code: invoice.invoice_code,
      payment_id: payment.id,
      gateway_event_id: input.gateway_event_id,
      receipt_number: receiptNumber,
      amount_inr: amount,
      balance_due_inr: invoice.balance_due_inr,
    });

    this.notifications?.notifyStudent(invoice.student_id, {
      category: 'BILLING',
      title: `Gateway Settlement Confirmed — Receipt ${receiptNumber}`,
      body: `Verified institutional gateway payment of INR ${amount.toLocaleString('en-IN')} credited to ${invoice.invoice_code}. Remaining balance: INR ${invoice.balance_due_inr.toLocaleString('en-IN')}.`,
    });

    return {
      invoice: structuredClone(invoice),
      payment: structuredClone(payment),
    };
  }
}

let sharedFinanceService: HostelFinanceService | null = null;

export function getFinanceService(
  repo: IHostelRepository,
  notifications?: NotificationAndNoticeService
): HostelFinanceService {
  if (!sharedFinanceService) {
    sharedFinanceService = new HostelFinanceService(repo, notifications);
  }
  return sharedFinanceService;
}

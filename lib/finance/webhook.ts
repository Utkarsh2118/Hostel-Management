import crypto from 'node:crypto';
import type { IHostelRepository } from '../repo/interface.ts';
import type { FeeInvoice, FeePaymentRecord, HostelFinanceService } from './service.ts';

export type PaymentWebhookEventType = 'PAYMENT_CAPTURED' | 'PAYMENT_FAILED' | 'PAYMENT_REFUNDED';

export interface PaymentWebhookPayload {
  event_id: string;
  event_type: PaymentWebhookEventType;
  provider_name: string;
  invoice_id_or_code: string;
  gateway_reference: string;
  amount_inr: number;
  paid_on_date: string;
}

export interface PaymentWebhookEventRecord {
  event_id: string;
  event_type: PaymentWebhookEventType;
  provider_name: string;
  invoice_id_or_code: string;
  gateway_reference: string;
  amount_inr: number;
  outcome: 'RECONCILED' | 'RECORDED_NON_CREDIT' | 'FAILED_RECONCILIATION';
  receipt_number: string | null;
  replay_attempts: number;
  received_at: string;
}

export class PaymentWebhookError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'PaymentWebhookError';
  }
}

const REPLAY_WINDOW_SECONDS = 300; // ±5 minutes

export function computePaymentWebhookSignature(
  rawBody: string,
  timestampSeconds: number,
  secret: string
): string {
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest('hex');
  return `v1=${digest}`;
}

function isUsableWebhookSecret(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.length >= 16 && !trimmed.startsWith('MY_') && !trimmed.startsWith('CHANGE_ME');
}

/**
 * Phase 7 — Cryptographically Signed Institutional Payment Webhook Service
 * ========================================================================
 * - Fails closed with HTTP 503 when PAYMENT_WEBHOOK_SECRET is not configured.
 * - Verifies `X-HostelHub-Signature: v1=<hmac-sha256>` over `${timestamp}.${rawBody}`
 *   using constant-time `crypto.timingSafeEqual`.
 * - Enforces ±5 minute replay timestamp window (`X-HostelHub-Timestamp`).
 * - Deduplicates `event_id` strictly so webhook retries NEVER double-credit invoices.
 */
export class PaymentWebhookService {
  private readonly processedEvents = new Map<string, PaymentWebhookEventRecord>();

  constructor(
    private readonly financeService: HostelFinanceService,
    private readonly repo: IHostelRepository,
    private readonly secretResolver: () => string | undefined = () =>
      process.env.PAYMENT_WEBHOOK_SECRET
  ) {}

  public getStatus(): {
    configured: boolean;
    replay_window_seconds: number;
    processed_events_count: number;
  } {
    return {
      configured: isUsableWebhookSecret(this.secretResolver()),
      replay_window_seconds: REPLAY_WINDOW_SECONDS,
      processed_events_count: this.processedEvents.size,
    };
  }

  public listEvents(limit = 50): PaymentWebhookEventRecord[] {
    return Array.from(this.processedEvents.values())
      .sort((a, b) => b.received_at.localeCompare(a.received_at))
      .slice(0, Math.max(1, Math.min(200, limit)))
      .map((item) => structuredClone(item));
  }

  public async verifyAndProcess(input: {
    rawBody: string;
    signatureHeader: string | undefined;
    timestampHeader: string | undefined;
    payload: PaymentWebhookPayload;
    nowMs?: number;
  }): Promise<{
    duplicate: boolean;
    event: PaymentWebhookEventRecord;
    invoice?: FeeInvoice;
    payment?: FeePaymentRecord;
  }> {
    const secret = this.secretResolver();
    if (!isUsableWebhookSecret(secret)) {
      throw new PaymentWebhookError(
        'Payment webhook receiver is disabled: PAYMENT_WEBHOOK_SECRET is not configured on the server.',
        503
      );
    }

    if (!input.timestampHeader || !/^\d{10,13}$/.test(input.timestampHeader.trim())) {
      throw new PaymentWebhookError(
        'Missing or invalid X-HostelHub-Timestamp header (expected Unix epoch seconds).',
        401
      );
    }

    const parsedTs = Number(input.timestampHeader.trim());
    const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
    if (!Number.isFinite(parsedTs) || Math.abs(nowSec - parsedTs) > REPLAY_WINDOW_SECONDS) {
      throw new PaymentWebhookError(
        'Webhook timestamp is outside the allowed 5-minute replay protection window.',
        401
      );
    }

    const providedSig = (input.signatureHeader ?? '').trim();
    if (!/^v1=[a-fA-F0-9]{64}$/.test(providedSig)) {
      throw new PaymentWebhookError(
        'Missing or malformed X-HostelHub-Signature header (expected v1=<sha256-hex>).',
        401
      );
    }

    const expectedSig = computePaymentWebhookSignature(input.rawBody, parsedTs, secret.trim());
    const providedBuf = Buffer.from(providedSig.toLowerCase(), 'utf8');
    const expectedBuf = Buffer.from(expectedSig.toLowerCase(), 'utf8');
    if (
      providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      await this.repo.appendAuditLog('gateway-webhook', 'system', 'PAYMENT_WEBHOOK_SIGNATURE_REJECTED', {
        event_id: input.payload.event_id,
        provider_name: input.payload.provider_name,
      });
      throw new PaymentWebhookError('Invalid webhook HMAC-SHA256 signature.', 401);
    }

    // Strict event_id idempotency check (prevents duplicate settlement on gateway retries)
    const existing = this.processedEvents.get(input.payload.event_id);
    if (existing) {
      existing.replay_attempts += 1;
      return {
        duplicate: true,
        event: structuredClone(existing),
      };
    }

    const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();

    if (input.payload.event_type === 'PAYMENT_CAPTURED') {
      const reconciled = await this.financeService.reconcileVerifiedGatewayPayment({
        invoice_id_or_code: input.payload.invoice_id_or_code,
        gateway_event_id: input.payload.event_id,
        gateway_reference: input.payload.gateway_reference,
        amount_inr: input.payload.amount_inr,
        paid_on_date: input.payload.paid_on_date,
        provider_name: input.payload.provider_name,
      });

      const record: PaymentWebhookEventRecord = {
        event_id: input.payload.event_id,
        event_type: input.payload.event_type,
        provider_name: input.payload.provider_name,
        invoice_id_or_code: reconciled.invoice.invoice_code,
        gateway_reference: reconciled.payment.reference_number,
        amount_inr: reconciled.payment.amount_inr,
        outcome: 'RECONCILED',
        receipt_number: reconciled.payment.receipt_number,
        replay_attempts: 0,
        received_at: nowIso,
      };
      this.processedEvents.set(record.event_id, record);

      return {
        duplicate: false,
        event: structuredClone(record),
        invoice: reconciled.invoice,
        payment: reconciled.payment,
      };
    }

    // Non-crediting events (PAYMENT_FAILED / PAYMENT_REFUNDED) are audited and recorded cleanly
    const record: PaymentWebhookEventRecord = {
      event_id: input.payload.event_id,
      event_type: input.payload.event_type,
      provider_name: input.payload.provider_name,
      invoice_id_or_code: input.payload.invoice_id_or_code,
      gateway_reference: input.payload.gateway_reference.trim().toUpperCase(),
      amount_inr: Math.round(input.payload.amount_inr),
      outcome: 'RECORDED_NON_CREDIT',
      receipt_number: null,
      replay_attempts: 0,
      received_at: nowIso,
    };
    this.processedEvents.set(record.event_id, record);

    await this.repo.appendAuditLog(
      `gateway-webhook:${input.payload.provider_name}`,
      'system',
      `PAYMENT_WEBHOOK_${input.payload.event_type}`,
      {
        event_id: record.event_id,
        invoice_id_or_code: record.invoice_id_or_code,
        gateway_reference: record.gateway_reference,
        amount_inr: record.amount_inr,
      }
    );

    return {
      duplicate: false,
      event: structuredClone(record),
    };
  }
}

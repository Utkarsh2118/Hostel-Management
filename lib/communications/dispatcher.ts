import crypto from 'node:crypto';

export type CommunicationChannel = 'EMAIL' | 'SMS';

export type CommunicationDeliveryStatus =
  | 'QUEUED_PROVIDER_UNCONFIGURED'
  | 'PENDING_DISPATCH'
  | 'DISPATCHED'
  | 'FAILED';

export interface OutboundCommunicationRecord {
  id: string;
  channel: CommunicationChannel;
  recipient_masked: string;
  template_code: string;
  subject: string;
  body_preview: string;
  dedupe_key: string;
  status: CommunicationDeliveryStatus;
  provider_name: string;
  provider_message_id: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommunicationsProviderStatus {
  email: {
    configured: boolean;
    provider: string;
    detail: string;
  };
  sms: {
    configured: boolean;
    provider: string;
    detail: string;
  };
}

function isRealSecret(val: string | undefined): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  return trimmed.length >= 8 && !trimmed.startsWith('MY_') && !trimmed.startsWith('CHANGE_ME');
}

export function maskEmail(email: string): string {
  const clean = email.trim().toLowerCase();
  const [local, domain] = clean.split('@');
  if (!local || !domain) return '***@invalid';
  if (local.length <= 2) return `${local[0] ?? '*'}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `${'*'.repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

/**
 * Phase 7 — Outbound Institutional Communications Queue & Provider Abstraction
 * ==========================================================================
 * - Never fabricates email or SMS delivery when provider credentials (RESEND_API_KEY
 *   or SMS_PROVIDER_API_KEY) are absent.
 * - Stores messages cleanly with status `QUEUED_PROVIDER_UNCONFIGURED` and enforces
 *   idempotency via `dedupe_key` so scheduled jobs never spam students.
 * - Masks recipient contact details in queue views and structured logs.
 */
export class OutboundCommunicationsDispatcher {
  private readonly queue: OutboundCommunicationRecord[] = [];
  private readonly dedupeIndex = new Map<string, OutboundCommunicationRecord>();

  constructor(private readonly envSource: () => NodeJS.ProcessEnv = () => process.env) {}

  public getProviderStatus(): CommunicationsProviderStatus {
    const env = this.envSource();
    const emailConfigured = isRealSecret(env.RESEND_API_KEY);
    const smsConfigured = isRealSecret(env.SMS_PROVIDER_API_KEY);

    return {
      email: {
        configured: emailConfigured,
        provider: emailConfigured ? 'RESEND_INSTITUTIONAL_SMTP' : 'UNCONFIGURED_EMAIL_PROVIDER',
        detail: emailConfigured
          ? 'RESEND_API_KEY detected; institutional email dispatch enabled.'
          : 'RESEND_API_KEY not configured; outbound emails are held honestly in queue as QUEUED_PROVIDER_UNCONFIGURED.',
      },
      sms: {
        configured: smsConfigured,
        provider: smsConfigured ? 'INSTITUTIONAL_SMS_GATEWAY' : 'UNCONFIGURED_SMS_PROVIDER',
        detail: smsConfigured
          ? 'SMS_PROVIDER_API_KEY detected; SMS gateway dispatch enabled.'
          : 'SMS_PROVIDER_API_KEY not configured; outbound SMS alerts are held in queue as QUEUED_PROVIDER_UNCONFIGURED.',
      },
    };
  }

  public enqueue(input: {
    channel: CommunicationChannel;
    recipient: string;
    template_code: string;
    subject: string;
    body_preview: string;
    dedupe_key: string;
  }): { record: OutboundCommunicationRecord; deduplicated: boolean } {
    const existing = this.dedupeIndex.get(input.dedupe_key);
    if (existing) {
      return { record: structuredClone(existing), deduplicated: true };
    }

    const providers = this.getProviderStatus();
    const configured =
      input.channel === 'EMAIL' ? providers.email.configured : providers.sms.configured;
    const providerName =
      input.channel === 'EMAIL' ? providers.email.provider : providers.sms.provider;

    const now = new Date().toISOString();
    const record: OutboundCommunicationRecord = {
      id: `comm-${crypto.randomUUID().slice(0, 8)}`,
      channel: input.channel,
      recipient_masked:
        input.channel === 'EMAIL' ? maskEmail(input.recipient) : maskPhone(input.recipient),
      template_code: input.template_code,
      subject: input.subject.trim().slice(0, 140),
      body_preview: input.body_preview.trim().slice(0, 240),
      dedupe_key: input.dedupe_key,
      // Never fabricate DISPATCHED without a real live provider HTTP acknowledgement
      status: configured ? 'PENDING_DISPATCH' : 'QUEUED_PROVIDER_UNCONFIGURED',
      provider_name: providerName,
      provider_message_id: null,
      attempts: 0,
      last_error: configured
        ? null
        : 'External provider credentials not configured; message held in outbox without fabricating delivery.',
      created_at: now,
      updated_at: now,
    };

    this.queue.unshift(record);
    if (this.queue.length > 250) {
      this.queue.pop();
    }
    this.dedupeIndex.set(input.dedupe_key, record);

    return { record: structuredClone(record), deduplicated: false };
  }

  public listQueue(limit = 50): OutboundCommunicationRecord[] {
    return this.queue.slice(0, Math.max(1, Math.min(200, limit))).map((item) => structuredClone(item));
  }

  public getSummary(): {
    providers: CommunicationsProviderStatus;
    totals: {
      total_queued: number;
      provider_unconfigured: number;
      pending_dispatch: number;
      dispatched: number;
      failed: number;
    };
  } {
    let provider_unconfigured = 0;
    let pending_dispatch = 0;
    let dispatched = 0;
    let failed = 0;

    for (const item of this.queue) {
      if (item.status === 'QUEUED_PROVIDER_UNCONFIGURED') provider_unconfigured += 1;
      else if (item.status === 'PENDING_DISPATCH') pending_dispatch += 1;
      else if (item.status === 'DISPATCHED') dispatched += 1;
      else if (item.status === 'FAILED') failed += 1;
    }

    return {
      providers: this.getProviderStatus(),
      totals: {
        total_queued: this.queue.length,
        provider_unconfigured,
        pending_dispatch,
        dispatched,
        failed,
      },
    };
  }
}

let sharedCommsDispatcher: OutboundCommunicationsDispatcher | null = null;

export function getCommunicationsDispatcher(): OutboundCommunicationsDispatcher {
  if (!sharedCommsDispatcher) {
    sharedCommsDispatcher = new OutboundCommunicationsDispatcher();
  }
  return sharedCommsDispatcher;
}

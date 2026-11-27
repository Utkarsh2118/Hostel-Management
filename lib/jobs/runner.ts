import crypto from 'node:crypto';
import type { IHostelRepository } from '../repo/interface.ts';
import type { HostelAuthService } from '../auth/authService.ts';
import type { HostelFinanceService } from '../finance/service.ts';
import type { HostelOperationsService } from '../operations/service.ts';
import type { NotificationAndNoticeService } from '../notifications/service.ts';
import type { OutboundCommunicationsDispatcher } from '../communications/dispatcher.ts';
import type { UserRole } from '../types.ts';

export type BackgroundJobName =
  | 'OVERDUE_FEE_REMINDERS'
  | 'OVERDUE_GATE_PASS_ALERTS'
  | 'EXPIRED_VISITOR_SWEEP'
  | 'SESSION_AND_AUDIT_HEALTH_CHECK'
  | 'ALL';

export interface BackgroundJobRunRecord {
  run_id: string;
  job_name: Exclude<BackgroundJobName, 'ALL'>;
  trigger_source: 'ADMIN_UI' | 'CRON_ENDPOINT';
  triggered_by: string;
  status: 'COMPLETED' | 'FAILED';
  items_scanned: number;
  items_acted: number;
  duration_ms: number;
  summary: string;
  executed_at: string;
}

export interface CronSecretCheckResult {
  ok: boolean;
  statusCode: number;
  error?: string;
}

function isUsableJobSecret(secret: string | undefined): secret is string {
  if (!secret) return false;
  const trimmed = secret.trim();
  return trimmed.length >= 16 && !trimmed.startsWith('MY_') && !trimmed.startsWith('CHANGE_ME');
}

export function verifyBackgroundJobSecret(
  providedHeader: string | undefined,
  configuredSecret: string | undefined = process.env.BACKGROUND_JOB_SECRET
): CronSecretCheckResult {
  if (!isUsableJobSecret(configuredSecret)) {
    return {
      ok: false,
      statusCode: 503,
      error:
        'Scheduled cron endpoint is disabled: BACKGROUND_JOB_SECRET is not configured on the server.',
    };
  }
  const provided = (providedHeader ?? '').trim();
  if (!provided) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Missing X-Job-Secret authentication header.',
    };
  }
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(configuredSecret.trim(), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Invalid X-Job-Secret credential.',
    };
  }
  return { ok: true, statusCode: 200 };
}

/**
 * Phase 7 — Deterministic Institutional Background Job Runner
 * ===========================================================
 * Executes idempotent hostel lifecycle sweeps runnable either by an authenticated
 * Administrator from the Ops Console OR via external scheduler presenting a
 * timing-safe `X-Job-Secret` header matching `BACKGROUND_JOB_SECRET`.
 */
export class InstitutionalJobRunner {
  private readonly history: BackgroundJobRunRecord[] = [];

  constructor(
    private readonly deps: {
      repo: IHostelRepository;
      authService: HostelAuthService;
      financeService: HostelFinanceService;
      operationsService: HostelOperationsService;
      notificationService: NotificationAndNoticeService;
      commsDispatcher: OutboundCommunicationsDispatcher;
    }
  ) {}

  public isCronSecretConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return isUsableJobSecret(env.BACKGROUND_JOB_SECRET);
  }

  public listHistory(limit = 40): BackgroundJobRunRecord[] {
    return this.history.slice(0, Math.max(1, Math.min(100, limit))).map((h) => structuredClone(h));
  }

  public async runJob(
    jobName: BackgroundJobName,
    context: {
      trigger_source: 'ADMIN_UI' | 'CRON_ENDPOINT';
      triggered_by: string;
      actor_role: UserRole | 'system';
      reference_date_iso?: string;
    }
  ): Promise<BackgroundJobRunRecord[]> {
    const jobsToRun: Array<Exclude<BackgroundJobName, 'ALL'>> =
      jobName === 'ALL'
        ? [
            'OVERDUE_FEE_REMINDERS',
            'OVERDUE_GATE_PASS_ALERTS',
            'EXPIRED_VISITOR_SWEEP',
            'SESSION_AND_AUDIT_HEALTH_CHECK',
          ]
        : [jobName];

    const runs: BackgroundJobRunRecord[] = [];
    for (const singleJob of jobsToRun) {
      const rec = await this.executeSingleJob(singleJob, context);
      runs.push(rec);
    }
    return runs;
  }

  private async executeSingleJob(
    jobName: Exclude<BackgroundJobName, 'ALL'>,
    context: {
      trigger_source: 'ADMIN_UI' | 'CRON_ENDPOINT';
      triggered_by: string;
      actor_role: UserRole | 'system';
      reference_date_iso?: string;
    }
  ): Promise<BackgroundJobRunRecord> {
    const startNs = process.hrtime.bigint();
    const executedAt = new Date().toISOString();
    const refDate = context.reference_date_iso?.trim() || executedAt.slice(0, 10);

    let itemsScanned = 0;
    let itemsActed = 0;
    let summary = '';

    if (jobName === 'OVERDUE_FEE_REMINDERS') {
      const overdueInvoices = await this.deps.financeService.getOverdueInvoicesSnapshot(refDate);
      const students = await this.deps.repo.getStudents();
      const studentMap = new Map(students.map((s) => [s.id, s]));
      itemsScanned = overdueInvoices.length;

      for (const inv of overdueInvoices) {
        const student = studentMap.get(inv.student_id);
        const dedupeKey = `fee-overdue::${inv.id}::${refDate}`;
        const queued = this.deps.commsDispatcher.enqueue({
          channel: 'EMAIL',
          recipient: student?.email ?? `${inv.student_code.toLowerCase()}@univ.edu.in`,
          template_code: 'FEE_INVOICE_OVERDUE_REMINDER',
          subject: `Hostel Fee Overdue Reminder — ${inv.invoice_code}`,
          body_preview: `Invoice ${inv.invoice_code} (${inv.academic_term}) has an outstanding balance of INR ${inv.balance_due_inr.toLocaleString('en-IN')} past due date ${inv.due_date}.`,
          dedupe_key: dedupeKey,
        });

        if (!queued.deduplicated) {
          itemsActed += 1;
          this.deps.notificationService.notifyStudent(inv.student_id, {
            category: 'BILLING',
            title: `Overdue Fee Reminder (${inv.invoice_code})`,
            body: `Balance of INR ${inv.balance_due_inr.toLocaleString('en-IN')} was due on ${inv.due_date}. Submit your NEFT/Challan reference on the Fee Ledger desk.`,
          });
        }
      }

      summary = `Scanned ${itemsScanned} overdue invoice(s) as of ${refDate}; dispatched ${itemsActed} deduplicated reminder(s).`;
    } else if (jobName === 'OVERDUE_GATE_PASS_ALERTS') {
      const referenceNowIso = context.reference_date_iso
        ? `${refDate}T23:59:59.000Z`
        : executedAt;
      const overduePasses = this.deps.operationsService.getOverdueActiveGatePasses(referenceNowIso);
      itemsScanned = overduePasses.length;

      for (const pass of overduePasses) {
        const dedupeKey = `gatepass-overdue::${pass.id}::${refDate}`;
        const queued = this.deps.commsDispatcher.enqueue({
          channel: 'SMS',
          recipient: pass.emergency_contact_phone,
          template_code: 'GATE_PASS_OVERDUE_ALERT',
          subject: `Overdue Gate Pass Alert — ${pass.pass_code ?? pass.id}`,
          body_preview: `Resident ${pass.student_code} (${pass.room_label}) has not logged return past ${pass.expected_return_at}.`,
          dedupe_key: dedupeKey,
        });

        if (!queued.deduplicated) {
          itemsActed += 1;
          const title = `Overdue Gate Pass (${pass.pass_code ?? pass.id}) — ${pass.room_label}`;
          const body = `Resident ${pass.student_name} (${pass.student_code}) exited on ${pass.pass_type} and missed expected return (${pass.expected_return_at}).`;
          this.deps.notificationService.notifyRole('WARDEN', {
            category: 'OPERATIONS',
            title,
            body,
          });
          this.deps.notificationService.notifyRole('ADMIN', {
            category: 'OPERATIONS',
            title,
            body,
          });
        }
      }

      summary = `Scanned ${itemsScanned} overdue active gate pass(es); raised ${itemsActed} deduplicated alert(s).`;
    } else if (jobName === 'EXPIRED_VISITOR_SWEEP') {
      const expiredVisitors = await this.deps.operationsService.expireStaleScheduledVisitors(refDate);
      itemsScanned = expiredVisitors.length;
      itemsActed = expiredVisitors.length;
      summary = `Swept ${itemsActed} expired unvisited scheduled visitor entry/entries prior to ${refDate}.`;
    } else if (jobName === 'SESSION_AND_AUDIT_HEALTH_CHECK') {
      const authStats = this.deps.authService.purgeExpiredAuthArtifacts();
      itemsScanned =
        authStats.active_sessions +
        authStats.expired_sessions_purged +
        authStats.expired_tokens_purged;
      itemsActed = authStats.expired_sessions_purged + authStats.expired_tokens_purged;
      summary = `Purged ${authStats.expired_sessions_purged} expired session(s) and ${authStats.expired_tokens_purged} stale token(s); ${authStats.active_sessions} active session(s) retained.`;
    }

    const durationMs = Math.round((Number(process.hrtime.bigint() - startNs) / 1_000_000) * 100) / 100;
    const record: BackgroundJobRunRecord = {
      run_id: `job-${crypto.randomUUID().slice(0, 8)}`,
      job_name: jobName,
      trigger_source: context.trigger_source,
      triggered_by: context.triggered_by,
      status: 'COMPLETED',
      items_scanned: itemsScanned,
      items_acted: itemsActed,
      duration_ms: durationMs,
      summary,
      executed_at: executedAt,
    };

    this.history.unshift(record);
    if (this.history.length > 60) {
      this.history.pop();
    }

    await this.deps.repo.appendAuditLog(
      context.triggered_by,
      context.actor_role,
      'BACKGROUND_JOB_EXECUTED',
      {
        run_id: record.run_id,
        job_name: record.job_name,
        trigger_source: record.trigger_source,
        items_scanned: record.items_scanned,
        items_acted: record.items_acted,
        duration_ms: record.duration_ms,
      }
    );

    return structuredClone(record);
  }
}

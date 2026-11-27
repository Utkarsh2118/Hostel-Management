import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  CheckCircle2,
  Database,
  Mail,
  Play,
  Printer,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Webhook,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { ProductionReadinessReport } from '../../lib/security/readiness';
import type {
  BackgroundJobName,
  BackgroundJobRunRecord,
} from '../../lib/jobs/runner';
import type {
  CommunicationsProviderStatus,
  OutboundCommunicationRecord,
} from '../../lib/communications/dispatcher';
import type { PaymentWebhookEventRecord } from '../../lib/finance/webhook';
import type { ObservabilitySnapshot } from '../../lib/observability/metrics';
import type { ToastMessage } from '../components/layout/ToastContainer';

export interface ProductionReadinessPageProps {
  onToast: (tone: ToastMessage['tone'], text: string) => void;
}

interface AdminOpsOverview {
  observability: ObservabilitySnapshot;
  jobs: {
    cron_secret_configured: boolean;
    history: BackgroundJobRunRecord[];
  };
  communications: {
    summary: {
      providers: CommunicationsProviderStatus;
      totals: {
        total_queued: number;
        provider_unconfigured: number;
        pending_dispatch: number;
        dispatched: number;
        failed: number;
      };
    };
    queue: OutboundCommunicationRecord[];
  };
  webhooks: {
    status: {
      configured: boolean;
      replay_window_seconds: number;
      processed_events_count: number;
    };
    events: PaymentWebhookEventRecord[];
  };
  active_sessions: number;
}

type ReadinessTab = 'readiness' | 'jobs_webhooks' | 'outbox_incident';

const JOB_CATALOG: Array<{
  name: BackgroundJobName;
  label: string;
  description: string;
}> = [
  {
    name: 'OVERDUE_FEE_REMINDERS',
    label: 'Overdue Fee Reminders',
    description:
      'Scans unpaid/partial invoices past due date, issues in-app notices, and queues deduplicated email reminders.',
  },
  {
    name: 'OVERDUE_GATE_PASS_ALERTS',
    label: 'Overdue Gate Pass Alerts',
    description:
      'Flags checked-out residents past expected return timestamp, alerts Wardens/Admins, and queues emergency SMS.',
  },
  {
    name: 'EXPIRED_VISITOR_SWEEP',
    label: 'Expired Visitor Sweep',
    description:
      'Closes unvisited scheduled visitor passes from prior dates cleanly with an audit entry.',
  },
  {
    name: 'SESSION_AND_AUDIT_HEALTH_CHECK',
    label: 'Session & Token Hygiene',
    description:
      'Purges expired server sessions and single-use verification/reset tokens from active memory.',
  },
];

export const ProductionReadinessPage: React.FC<ProductionReadinessPageProps> = ({ onToast }) => {
  const [activeTab, setActiveTab] = useState<ReadinessTab>('readiness');
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ProductionReadinessReport | null>(null);
  const [ops, setOps] = useState<AdminOpsOverview | null>(null);
  const [runningJob, setRunningJob] = useState<BackgroundJobName | null>(null);
  const [referenceDate, setReferenceDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [revokeReason, setRevokeReason] = useState('');
  const [revokingSessions, setRevokingSessions] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [readinessRes, opsRes] = await Promise.all([
        apiFetch<{ report: ProductionReadinessReport }>('/api/admin/readiness'),
        apiFetch<AdminOpsOverview>('/api/admin/ops/overview'),
      ]);
      setReport(readinessRes.report);
      setOps(opsRes);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to load readiness & operational telemetry.'
      );
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleRunJob = async (jobName: BackgroundJobName) => {
    setRunningJob(jobName);
    try {
      const res = await apiFetch<{ runs: BackgroundJobRunRecord[]; message: string }>(
        '/api/admin/jobs/run',
        {
          method: 'POST',
          body: JSON.stringify({
            job_name: jobName,
            reference_date_iso: referenceDate || undefined,
          }),
        }
      );
      onToast('success', res.message);
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to execute background job.');
    } finally {
      setRunningJob(null);
    }
  };

  const handleEmergencyRevoke = async (e: React.FormEvent) => {
    e.preventDefault();
    if (revokeReason.trim().length < 10) {
      onToast('error', 'Enter an official incident audit reason (at least 10 characters).');
      return;
    }
    setRevokingSessions(true);
    try {
      const res = await apiFetch<{ revoked_count: number; message: string }>(
        '/api/admin/incident/revoke-sessions',
        {
          method: 'POST',
          body: JSON.stringify({ reason: revokeReason.trim() }),
        }
      );
      onToast('success', res.message);
      setRevokeReason('');
      await loadAll();
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to execute emergency session revocation.'
      );
    } finally {
      setRevokingSessions(false);
    }
  };

  if (loading || !report || !ops) {
    return (
      <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
        Running Server-Side Security, Readiness &amp; Operational Telemetry Audit...
      </div>
    );
  }

  const passedControls = report.security_controls.filter((c) => c.verified).length;
  const openBlockers = report.institutional_blockers.filter((b) => b.status === 'BLOCKED').length;
  const presentMigrations = report.migrations.filter((m) => m.present_on_disk).length;

  return (
    <div className="space-y-6">
      {/* Masthead */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink p-5 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 border-b-2 border-[#1F2A5A] pb-4">
          <div>
            <p className="font-mono-code text-xs font-bold tracking-[0.16em] text-[#C2552D] uppercase">
              PHASES 6 &amp; 7 · SECURITY AUDIT, BACKGROUND JOBS, WEBHOOKS &amp; INCIDENT OPS
            </p>
            <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] leading-tight mt-1">
              Production Readiness &amp; Operations Desk
            </h1>
            <p className="text-sm text-[#465078] mt-1">
              Live server-side audit of security controls, SQL RLS migrations, scheduled lifecycle
              jobs, HMAC payment webhooks, outbound communication queues, and incident controls.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 print:hidden">
            <button
              type="button"
              onClick={() => void loadAll()}
              className="px-3 py-2 bg-[#F1E6CF] text-[#1F2A5A] font-mono-code text-xs font-bold border-2 border-[#1F2A5A] inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              Refresh Audit
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3.5 py-2 bg-[#1F2A5A] text-[#F8F2E4] font-mono-code text-xs font-bold border-2 border-[#1F2A5A] inline-flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              Print Sign-Off Sheet
            </button>
          </div>
        </div>

        {/* Honest Readiness Stamp */}
        <div
          className={`border-2 p-4 flex items-start gap-3 ${
            report.production_ready
              ? 'bg-[#F1E6CF] border-[#5E8C6A]'
              : 'bg-[#FBE9A6] border-[#B3261E]'
          }`}
        >
          {report.production_ready ? (
            <ShieldCheck className="w-6 h-6 text-[#5E8C6A] shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <AlertOctagon className="w-6 h-6 text-[#B3261E] shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <div className="space-y-1">
            <p className="font-mono-code text-xs font-bold uppercase text-[#1F2A5A]">
              Environment: {report.environment.toUpperCase()} · Audited{' '}
              {new Date(report.generated_at).toLocaleString()}
            </p>
            <p className="font-bold text-sm text-[#B3261E]">{report.readiness_verdict}</p>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono-code text-xs">
          <div className="bg-[#F1E6CF] border border-[#1F2A5A] p-3">
            <span className="block text-[10px] uppercase text-[#465078]">Security Controls</span>
            <span className="font-bold text-lg text-[#5E8C6A] tabular-nums">
              {passedControls}/{report.security_controls.length}
            </span>
          </div>
          <div className="bg-[#F1E6CF] border border-[#1F2A5A] p-3">
            <span className="block text-[10px] uppercase text-[#465078]">SQL Migrations</span>
            <span className="font-bold text-lg text-[#1F2A5A] tabular-nums">
              {presentMigrations}/{report.migrations.length}
            </span>
          </div>
          <div className="bg-[#F1E6CF] border border-[#1F2A5A] p-3">
            <span className="block text-[10px] uppercase text-[#465078]">Go-Live Blockers</span>
            <span className="font-bold text-lg text-[#B3261E] tabular-nums">{openBlockers}</span>
          </div>
          <div className="bg-[#F1E6CF] border border-[#1F2A5A] p-3">
            <span className="block text-[10px] uppercase text-[#465078]">API Requests / p95</span>
            <span className="font-bold text-lg text-[#1F2A5A] tabular-nums">
              {ops.observability.total_api_requests} · {ops.observability.p95_latency_ms}ms
            </span>
          </div>
        </div>

        {/* Tab Strip */}
        <nav
          aria-label="Readiness and operations tabs"
          className="flex flex-wrap gap-2 border-t-2 border-[#1F2A5A] pt-3 print:hidden"
        >
          <button
            type="button"
            onClick={() => setActiveTab('readiness')}
            className={`px-3.5 py-2 font-mono-code text-xs font-bold border-2 border-[#1F2A5A] ${
              activeTab === 'readiness'
                ? 'bg-[#1F2A5A] text-[#F8F2E4]'
                : 'bg-[#F1E6CF] text-[#1F2A5A]'
            }`}
          >
            01 · Go-Live Readiness &amp; Controls
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('jobs_webhooks')}
            className={`px-3.5 py-2 font-mono-code text-xs font-bold border-2 border-[#1F2A5A] ${
              activeTab === 'jobs_webhooks'
                ? 'bg-[#1F2A5A] text-[#F8F2E4]'
                : 'bg-[#F1E6CF] text-[#1F2A5A]'
            }`}
          >
            02 · Scheduled Jobs &amp; Payment Webhooks ({ops.jobs.history.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('outbox_incident')}
            className={`px-3.5 py-2 font-mono-code text-xs font-bold border-2 border-[#1F2A5A] ${
              activeTab === 'outbox_incident'
                ? 'bg-[#1F2A5A] text-[#F8F2E4]'
                : 'bg-[#F1E6CF] text-[#1F2A5A]'
            }`}
          >
            03 · Outbound Queue, Metrics &amp; Incident Ops
          </button>
        </nav>
      </section>

      {/* TAB 1: GO-LIVE READINESS & CONTROLS */}
      {activeTab === 'readiness' && (
        <>
          <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5">
              University Prerequisites Required Before Production Launch
            </h2>
            <div className="space-y-2.5">
              {report.institutional_blockers.map((blk) => (
                <article
                  key={blk.id}
                  className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-3.5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2"
                >
                  <div className="space-y-0.5">
                    <p className="font-mono-code text-[10px] font-bold uppercase text-[#465078]">
                      {blk.category.replace('_', ' ')}
                    </p>
                    <h3 className="font-bold text-sm text-[#1F2A5A]">{blk.title}</h3>
                    <p className="text-xs text-[#465078]">{blk.requirement}</p>
                  </div>
                  <span
                    className={`px-2.5 py-1 font-mono-code text-[11px] font-bold border border-[#1F2A5A] shrink-0 self-start ${
                      blk.status === 'READY'
                        ? 'bg-[#5E8C6A] text-[#F8F2E4]'
                        : 'bg-[#B3261E] text-[#F8F2E4]'
                    }`}
                  >
                    {blk.status}
                  </span>
                </article>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-7 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-3">
              <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5">
                Verified Application Security Controls ({passedControls})
              </h2>
              <div className="space-y-2">
                {report.security_controls.map((ctrl) => (
                  <div
                    key={ctrl.id}
                    className="bg-[#F1E6CF] border border-[#1F2A5A] p-3 flex items-start gap-2.5"
                  >
                    {ctrl.verified ? (
                      <CheckCircle2
                        className="w-4 h-4 text-[#5E8C6A] shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                    ) : (
                      <XCircle
                        className="w-4 h-4 text-[#B3261E] shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                    )}
                    <div className="text-xs">
                      <p className="font-bold text-[#1F2A5A]">
                        [{ctrl.domain}] {ctrl.control}
                      </p>
                      <p className="text-[#465078] mt-0.5">{ctrl.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="lg:col-span-5 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
              <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5 inline-flex items-center gap-2">
                <Database className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
                PostgreSQL RLS Migrations
              </h2>
              <ol className="space-y-2 font-mono-code text-xs">
                {report.migrations.map((mig) => (
                  <li
                    key={mig.filename}
                    className="bg-[#F1E6CF] border border-[#1F2A5A] p-2.5 flex items-start justify-between gap-2"
                  >
                    <div>
                      <p className="font-bold text-[#1F2A5A] break-all">{mig.filename}</p>
                      <p className="text-[11px] text-[#465078] mt-0.5">{mig.phase}</p>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold border border-[#1F2A5A] shrink-0 ${
                        mig.present_on_disk
                          ? 'bg-[#5E8C6A] text-[#F8F2E4]'
                          : 'bg-[#B3261E] text-[#F8F2E4]'
                      }`}
                    >
                      {mig.present_on_disk ? 'PRESENT' : 'MISSING'}
                    </span>
                  </li>
                ))}
              </ol>

              <div className="border-t-2 border-[#1F2A5A] pt-3 space-y-2">
                <h3 className="font-mono-code text-xs font-bold uppercase text-[#1F2A5A]">
                  External Integration Status
                </h3>
                {report.env_validation.integrations.map((intg) => (
                  <div
                    key={intg.id}
                    className="bg-[#F1E6CF] border border-[#1F2A5A]/60 p-2.5 text-xs space-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#1F2A5A]">{intg.name}</span>
                      <span className="font-mono-code text-[10px] font-bold uppercase text-[#C2552D]">
                        {intg.state.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#465078]">{intg.detail}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      {/* TAB 2: SCHEDULED BACKGROUND JOBS & SIGNED PAYMENT WEBHOOKS */}
      {activeTab === 'jobs_webhooks' && (
        <div className="space-y-6">
          <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 border-b border-[#1F2A5A]/30 pb-3">
              <div>
                <h2 className="font-display text-2xl text-[#1F2A5A]">
                  Institutional Lifecycle Background Jobs
                </h2>
                <p className="text-xs text-[#465078] mt-0.5">
                  Cron Endpoint <span className="font-mono-code font-bold">/api/jobs/cron/run</span>{' '}
                  Secret Status:{' '}
                  <span
                    className={`font-mono-code font-bold ${
                      ops.jobs.cron_secret_configured ? 'text-[#5E8C6A]' : 'text-[#B3261E]'
                    }`}
                  >
                    {ops.jobs.cron_secret_configured
                      ? 'CONFIGURED (TIMING-SAFE X-JOB-SECRET)'
                      : 'UNCONFIGURED (FAILS CLOSED HTTP 503)'}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs font-mono-code text-[#1F2A5A]">
                  <span className="block text-[10px] uppercase text-[#465078]">
                    Reference Date (YYYY-MM-DD)
                  </span>
                  <input
                    type="date"
                    value={referenceDate}
                    onChange={(e) => setReferenceDate(e.target.value)}
                    className="mt-1 px-2.5 py-1.5 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs font-mono-code"
                  />
                </label>
                <button
                  type="button"
                  disabled={runningJob !== null}
                  onClick={() => void handleRunJob('ALL')}
                  className="px-3.5 py-2 bg-[#1F2A5A] text-[#F8F2E4] font-mono-code text-xs font-bold border-2 border-[#1F2A5A] inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  {runningJob === 'ALL' ? 'Running Full Sweep...' : 'Run All 4 Lifecycle Jobs'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {JOB_CATALOG.map((job) => (
                <article
                  key={job.name}
                  className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-3.5 flex flex-col justify-between gap-3"
                >
                  <div>
                    <p className="font-mono-code text-[10px] font-bold uppercase text-[#C2552D]">
                      {job.name}
                    </p>
                    <h3 className="font-bold text-sm text-[#1F2A5A] mt-0.5">{job.label}</h3>
                    <p className="text-xs text-[#465078] mt-1">{job.description}</p>
                  </div>
                  <button
                    type="button"
                    disabled={runningJob !== null}
                    onClick={() => void handleRunJob(job.name)}
                    className="self-start px-3 py-1.5 bg-[#F8F2E4] text-[#1F2A5A] font-mono-code text-xs font-bold border-2 border-[#1F2A5A] inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Play className="w-3 h-3" aria-hidden="true" />
                    {runningJob === job.name ? 'Executing...' : 'Trigger Now'}
                  </button>
                </article>
              ))}
            </div>

            <div className="border-t-2 border-[#1F2A5A] pt-3 space-y-2">
              <h3 className="font-mono-code text-xs font-bold uppercase text-[#1F2A5A]">
                Recent Job Execution Register ({ops.jobs.history.length})
              </h3>
              {ops.jobs.history.length === 0 ? (
                <p className="text-xs text-[#465078] bg-[#F1E6CF] border border-[#1F2A5A] p-3">
                  No background jobs executed in this server lifecycle yet. Trigger any job above to
                  verify deduplicated reminders, overdue alerts, and audit recording.
                </p>
              ) : (
                <div className="overflow-x-auto border-2 border-[#1F2A5A]">
                  <table className="w-full text-left font-mono-code text-xs">
                    <thead className="bg-[#1F2A5A] text-[#F8F2E4] uppercase text-[10px]">
                      <tr>
                        <th className="p-2">Job</th>
                        <th className="p-2">Source</th>
                        <th className="p-2">Scanned / Acted</th>
                        <th className="p-2">Duration</th>
                        <th className="p-2">Summary</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1F2A5A]/30 bg-[#F1E6CF]">
                      {ops.jobs.history.map((run) => (
                        <tr key={run.run_id}>
                          <td className="p-2 font-bold text-[#1F2A5A]">{run.job_name}</td>
                          <td className="p-2 text-[#465078]">{run.trigger_source}</td>
                          <td className="p-2 tabular-nums">
                            {run.items_scanned} / {run.items_acted}
                          </td>
                          <td className="p-2 tabular-nums">{run.duration_ms}ms</td>
                          <td className="p-2 font-sans text-[#1F2A5A]">{run.summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {/* Signed Payment Gateway Webhook Ledger */}
          <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1F2A5A]/30 pb-2.5">
              <h2 className="font-display text-2xl text-[#1F2A5A] inline-flex items-center gap-2">
                <Webhook className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
                Signed Payment Gateway Webhook Receiver
              </h2>
              <span
                className={`px-2.5 py-1 font-mono-code text-[11px] font-bold border border-[#1F2A5A] ${
                  ops.webhooks.status.configured
                    ? 'bg-[#5E8C6A] text-[#F8F2E4]'
                    : 'bg-[#FBE9A6] text-[#B3261E]'
                }`}
              >
                {ops.webhooks.status.configured
                  ? 'HMAC-SHA256 ACTIVE'
                  : 'DISABLED (PAYMENT_WEBHOOK_SECRET UNSET · HTTP 503)'}
              </span>
            </div>
            <p className="text-xs text-[#465078]">
              Endpoint <span className="font-mono-code font-bold">POST /api/webhooks/payments</span>{' '}
              enforces constant-time <span className="font-mono-code">X-HostelHub-Signature</span>{' '}
              verification, ±{ops.webhooks.status.replay_window_seconds}s timestamp replay guard,
              and strict <span className="font-mono-code">event_id</span> idempotency.
            </p>
            {ops.webhooks.events.length === 0 ? (
              <p className="text-xs text-[#465078] bg-[#F1E6CF] border border-[#1F2A5A] p-3">
                No verified institutional gateway webhook events processed yet. Offline Bank
                NEFT/Challan verification remains active on the Finance desk.
              </p>
            ) : (
              <div className="overflow-x-auto border-2 border-[#1F2A5A]">
                <table className="w-full text-left font-mono-code text-xs">
                  <thead className="bg-[#1F2A5A] text-[#F8F2E4] uppercase text-[10px]">
                    <tr>
                      <th className="p-2">Event ID</th>
                      <th className="p-2">Type</th>
                      <th className="p-2">Invoice</th>
                      <th className="p-2">Amount (INR)</th>
                      <th className="p-2">Receipt</th>
                      <th className="p-2">Replays Blocked</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F2A5A]/30 bg-[#F1E6CF]">
                    {ops.webhooks.events.map((ev) => (
                      <tr key={ev.event_id}>
                        <td className="p-2 font-bold text-[#1F2A5A]">{ev.event_id}</td>
                        <td className="p-2">{ev.event_type}</td>
                        <td className="p-2">{ev.invoice_id_or_code}</td>
                        <td className="p-2 tabular-nums">
                          {ev.amount_inr.toLocaleString('en-IN')}
                        </td>
                        <td className="p-2">{ev.receipt_number ?? '—'}</td>
                        <td className="p-2 tabular-nums">{ev.replay_attempts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 3: OUTBOUND COMMUNICATIONS QUEUE, LIVE METRICS & BREAK-GLASS */}
      {activeTab === 'outbox_incident' && (
        <div className="space-y-6">
          {/* Outbound Email & SMS Queue */}
          <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5 inline-flex items-center gap-2">
              <Mail className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
              Outbound Communications Queue (Zero Fabricated Delivery)
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono-code font-bold uppercase text-[#1F2A5A]">
                    Email Adapter
                  </span>
                  <span className="font-mono-code text-[10px] font-bold text-[#C2552D]">
                    {ops.communications.summary.providers.email.provider}
                  </span>
                </div>
                <p className="text-[#465078]">
                  {ops.communications.summary.providers.email.detail}
                </p>
              </div>
              <div className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono-code font-bold uppercase text-[#1F2A5A]">
                    SMS Adapter
                  </span>
                  <span className="font-mono-code text-[10px] font-bold text-[#C2552D]">
                    {ops.communications.summary.providers.sms.provider}
                  </span>
                </div>
                <p className="text-[#465078]">{ops.communications.summary.providers.sms.detail}</p>
              </div>
            </div>

            {ops.communications.queue.length === 0 ? (
              <p className="text-xs text-[#465078] bg-[#F1E6CF] border border-[#1F2A5A] p-3">
                Outbound queue is empty. Run an Overdue Fee or Gate Pass job from Tab 02 to inspect
                masked, deduplicated outbox records.
              </p>
            ) : (
              <div className="overflow-x-auto border-2 border-[#1F2A5A]">
                <table className="w-full text-left font-mono-code text-xs">
                  <thead className="bg-[#1F2A5A] text-[#F8F2E4] uppercase text-[10px]">
                    <tr>
                      <th className="p-2">Channel</th>
                      <th className="p-2">Recipient (Masked)</th>
                      <th className="p-2">Template</th>
                      <th className="p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F2A5A]/30 bg-[#F1E6CF]">
                    {ops.communications.queue.map((item) => (
                      <tr key={item.id}>
                        <td className="p-2 font-bold text-[#1F2A5A]">{item.channel}</td>
                        <td className="p-2">{item.recipient_masked}</td>
                        <td className="p-2">{item.template_code}</td>
                        <td className="p-2 text-[#B3261E] font-bold">{item.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Live API Telemetry + Emergency Break-Glass */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-7 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-3">
              <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5 inline-flex items-center gap-2">
                <Activity className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
                Live API Telemetry &amp; Latency
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono-code text-xs">
                <div className="bg-[#F1E6CF] border border-[#1F2A5A] p-2.5">
                  <span className="block text-[10px] text-[#465078]">2XX OK</span>
                  <span className="font-bold text-base text-[#5E8C6A] tabular-nums">
                    {ops.observability.status_2xx}
                  </span>
                </div>
                <div className="bg-[#F1E6CF] border border-[#1F2A5A] p-2.5">
                  <span className="block text-[10px] text-[#465078]">4XX CLIENT</span>
                  <span className="font-bold text-base text-[#C2552D] tabular-nums">
                    {ops.observability.status_4xx}
                  </span>
                </div>
                <div className="bg-[#F1E6CF] border border-[#1F2A5A] p-2.5">
                  <span className="block text-[10px] text-[#465078]">5XX SERVER</span>
                  <span className="font-bold text-base text-[#B3261E] tabular-nums">
                    {ops.observability.status_5xx}
                  </span>
                </div>
                <div className="bg-[#F1E6CF] border border-[#1F2A5A] p-2.5">
                  <span className="block text-[10px] text-[#465078]">AVG / P95</span>
                  <span className="font-bold text-base text-[#1F2A5A] tabular-nums">
                    {ops.observability.avg_latency_ms} / {ops.observability.p95_latency_ms}ms
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto border border-[#1F2A5A]">
                <table className="w-full text-left font-mono-code text-[11px]">
                  <thead className="bg-[#1F2A5A] text-[#F8F2E4] uppercase text-[10px]">
                    <tr>
                      <th className="p-2">Normalized Route</th>
                      <th className="p-2">Hits</th>
                      <th className="p-2">Errors</th>
                      <th className="p-2">Avg ms</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F2A5A]/25 bg-[#F1E6CF]">
                    {ops.observability.top_routes.map((rt) => (
                      <tr key={rt.route_key}>
                        <td className="p-2 font-bold text-[#1F2A5A]">{rt.route_key}</td>
                        <td className="p-2 tabular-nums">{rt.count}</td>
                        <td className="p-2 tabular-nums text-[#B3261E]">{rt.error_count}</td>
                        <td className="p-2 tabular-nums">{rt.avg_ms}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Break-Glass Emergency Global Session Revocation */}
            <section className="lg:col-span-5 bg-[#F8F2E4] border-2 border-[#B3261E] shadow-ink-sm p-5 space-y-3">
              <h2 className="font-display text-2xl text-[#B3261E] border-b border-[#B3261E]/30 pb-2.5 inline-flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-[#B3261E]" aria-hidden="true" />
                Incident Break-Glass Control
              </h2>
              <p className="text-xs text-[#465078]">
                Active server sessions across all roles:{' '}
                <strong className="font-mono-code text-[#1F2A5A] tabular-nums">
                  {ops.active_sessions}
                </strong>
                . Use Emergency Global Sign-Out during suspected credential compromise to revoke
                all non-Admin sessions immediately while preserving your active Admin session.
              </p>
              <form onSubmit={(e) => void handleEmergencyRevoke(e)} className="space-y-3">
                <label className="block text-xs font-mono-code text-[#1F2A5A]">
                  <span className="block font-bold uppercase text-[10px] text-[#B3261E]">
                    Mandatory Incident Audit Justification (min 10 chars)
                  </span>
                  <textarea
                    rows={3}
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    placeholder="e.g., Campus IT security bulletin — rotating staff credentials after phishing incident"
                    className="mt-1 w-full p-2.5 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs font-sans"
                  />
                </label>
                <button
                  type="submit"
                  disabled={revokingSessions}
                  className="w-full py-2.5 px-4 bg-[#B3261E] text-[#F8F2E4] font-mono-code text-xs font-bold uppercase border-2 border-[#1F2A5A] disabled:opacity-50"
                >
                  {revokingSessions
                    ? 'Revoking Active Sessions...'
                    : 'Revoke All Non-Admin Sessions Now'}
                </button>
              </form>
            </section>
          </div>
        </div>
      )}
    </div>
  );
};

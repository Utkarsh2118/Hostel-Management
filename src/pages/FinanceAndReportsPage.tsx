import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  Download,
  IndianRupee,
  Megaphone,
  PlusSquare,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { FeeInvoice, PaymentGatewayReadiness } from '../../lib/finance/service';
import type { InstitutionalNotice, NoticeAudience } from '../../lib/notifications/service';
import type { ExportDataset, InstitutionalReportSummary } from '../../lib/reports/service';
import type { Block, SessionUser } from '../../lib/types';
import type { ToastMessage } from '../components/layout/ToastContainer';

export interface FinanceAndReportsPageProps {
  sessionUser: SessionUser;
  initialTab?: StaffFinanceTab;
  onToast: (tone: ToastMessage['tone'], text: string) => void;
}

type StaffFinanceTab = 'finance' | 'notices' | 'reports';

const BADGE_STYLE: Record<string, string> = {
  UNPAID: 'bg-[#FBE9A6] text-[#1F2A5A]',
  PARTIALLY_PAID: 'bg-[#C2552D] text-[#F8F2E4]',
  PAID: 'bg-[#5E8C6A] text-[#F8F2E4]',
  WAIVED: 'bg-[#1F2A5A] text-[#F8F2E4]',
  SUBMITTED_FOR_VERIFICATION: 'bg-[#F2C94C] text-[#1F2A5A]',
  VERIFIED_PAID: 'bg-[#5E8C6A] text-[#F8F2E4]',
  REJECTED: 'bg-[#B3261E] text-[#F8F2E4]',
};

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

export const FinanceAndReportsPage: React.FC<FinanceAndReportsPageProps> = ({
  sessionUser,
  initialTab = 'finance',
  onToast,
}) => {
  const [activeTab, setActiveTab] = useState<StaffFinanceTab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<FeeInvoice[]>([]);
  const [gateway, setGateway] = useState<PaymentGatewayReadiness | null>(null);
  const [notices, setNotices] = useState<InstitutionalNotice[]>([]);
  const [summary, setSummary] = useState<InstitutionalReportSummary | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);

  // Admin: Create Invoice Form
  const [newStudentId, setNewStudentId] = useState('stu-001');
  const [newTerm, setNewTerm] = useState('Spring 2027');
  const [newDueDate, setNewDueDate] = useState('2027-01-31');
  const [newRoomRent, setNewRoomRent] = useState<number>(20000);
  const [newMessFee, setNewMessFee] = useState<number>(16500);
  const [creatingInv, setCreatingInv] = useState(false);

  // Admin: Waiver Form
  const [waiverInvId, setWaiverInvId] = useState<string | null>(null);
  const [waiverAmount, setWaiverAmount] = useState<number>(5000);
  const [waiverReason, setWaiverReason] = useState('');

  // Notice Publisher Form
  const [ntcTitle, setNtcTitle] = useState('');
  const [ntcBody, setNtcBody] = useState('');
  const [ntcAudience, setNtcAudience] = useState<NoticeAudience>(
    sessionUser.role === 'ADMIN' ? 'ALL_HOSTELS' : 'BLOCK_RESIDENTS'
  );
  const [ntcBlockId, setNtcBlockId] = useState<string>('');
  const [ntcPinned, setNtcPinned] = useState(false);
  const [publishingNotice, setPublishingNotice] = useState(false);

  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [finRes, noticeRes, repRes, roomsRes] = await Promise.all([
        apiFetch<{ invoices: FeeInvoice[]; gateway_readiness: PaymentGatewayReadiness }>(
          '/api/finance/invoices'
        ),
        apiFetch<{ notices: InstitutionalNotice[] }>('/api/institutional-notices'),
        apiFetch<{ summary: InstitutionalReportSummary }>('/api/reports/summary'),
        apiFetch<{ blocks: Block[] }>('/api/rooms'),
      ]);
      setInvoices(finRes.invoices);
      setGateway(finRes.gateway_readiness);
      setNotices(noticeRes.notices);
      setSummary(repRes.summary);
      setBlocks(roomsRes.blocks);
      if (sessionUser.role === 'WARDEN' && !ntcBlockId && repRes.summary.blocks.length > 0) {
        setNtcBlockId(repRes.summary.blocks[0].block_id);
      }
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to load finance and institutional reports.'
      );
    } finally {
      setLoading(false);
    }
  }, [ntcBlockId, onToast, sessionUser.role]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingInv(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/finance/invoices', {
        method: 'POST',
        body: JSON.stringify({
          student_id: newStudentId,
          academic_term: newTerm,
          due_date: newDueDate,
          line_items: [
            { code: 'RENT', label: 'Semester Hostel Room Rent', amount_inr: Number(newRoomRent) },
            { code: 'MESS', label: 'Semester Mess & Dining Advance', amount_inr: Number(newMessFee) },
          ],
        }),
      });
      onToast('success', res.message);
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to issue fee invoice.');
    } finally {
      setCreatingInv(false);
    }
  };

  const handleVerifyPayment = async (
    invoiceId: string,
    paymentId: string,
    decision: 'VERIFIED_PAID' | 'REJECTED'
  ) => {
    setBusyKey(`ver-${paymentId}-${decision}`);
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/finance/invoices/${encodeURIComponent(invoiceId)}/payments/${encodeURIComponent(paymentId)}/verify`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            decision,
            verification_note:
              decision === 'VERIFIED_PAID'
                ? 'Confirmed against university bank settlement statement.'
                : 'Transaction reference not found in bank reconciliation feed.',
          }),
        }
      );
      onToast(decision === 'VERIFIED_PAID' ? 'success' : 'info', res.message);
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to process payment verification.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleApplyWaiver = async (invoiceId: string) => {
    setBusyKey(`wav-${invoiceId}`);
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/finance/invoices/${encodeURIComponent(invoiceId)}/waivers`,
        {
          method: 'POST',
          body: JSON.stringify({
            amount_inr: Number(waiverAmount),
            reason: waiverReason,
          }),
        }
      );
      onToast('success', res.message);
      setWaiverInvId(null);
      setWaiverReason('');
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to apply fee waiver.');
    } finally {
      setBusyKey(null);
    }
  };

  const handlePublishNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    setPublishingNotice(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/institutional-notices', {
        method: 'POST',
        body: JSON.stringify({
          title: ntcTitle,
          body: ntcBody,
          audience: ntcAudience,
          block_id: ntcBlockId || null,
          pinned: ntcPinned,
        }),
      });
      onToast('success', res.message);
      setNtcTitle('');
      setNtcBody('');
      setNtcPinned(false);
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to publish notice.');
    } finally {
      setPublishingNotice(false);
    }
  };

  const handleDownloadCsv = async (dataset: ExportDataset) => {
    setBusyKey(`csv-${dataset}`);
    try {
      const res = await fetch(`/api/reports/export?dataset=${encodeURIComponent(dataset)}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || 'CSV export failed.');
      }
      const csvText = await res.text();
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hostelhub-${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onToast('success', `Exported audited ${dataset.replace('_', ' ')} CSV report.`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to export CSV.');
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
        Loading Institutional Finance Ledger &amp; Reporting Desk...
      </div>
    );
  }

  const scopedBlocks =
    sessionUser.role === 'ADMIN'
      ? blocks
      : blocks.filter((b) => summary?.blocks.some((sb) => sb.block_id === b.id));

  return (
    <div className="space-y-6">
      {/* Masthead */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 border-b-2 border-[#1F2A5A] pb-4">
          <div>
            <p className="font-mono-code text-xs font-bold tracking-[0.16em] text-[#C2552D] uppercase">
              PHASE 5 · {sessionUser.role === 'ADMIN' ? 'FINANCE OFFICE & INSTITUTIONAL' : 'BLOCK-SCOPED'}{' '}
              REPORTING DESK
            </p>
            <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] leading-tight mt-1">
              Fee Ledger, Notice Publishing &amp; Audited Reports
            </h1>
            <p className="text-sm text-[#465078] mt-1">
              {sessionUser.role === 'ADMIN'
                ? 'Full Finance Office controls: issue semester invoices, verify bank/challan references, issue audited waivers, and export sanitized institutional CSV reports.'
                : 'Block-scoped clearance visibility for your assigned blocks, official block notice publishing, and scoped operational exports.'}
            </p>
          </div>
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono-code text-xs shrink-0">
              <div className="bg-[#F1E6CF] border border-[#1F2A5A] px-3 py-2">
                <span className="block text-[10px] uppercase text-[#465078]">Occupancy</span>
                <span className="font-bold text-[#1F2A5A] tabular-nums">
                  {summary.totals.occupancy_pct}%
                </span>
              </div>
              <div className="bg-[#F1E6CF] border border-[#1F2A5A] px-3 py-2">
                <span className="block text-[10px] uppercase text-[#465078]">Collected</span>
                <span className="font-bold text-[#5E8C6A] tabular-nums">
                  {formatInr(summary.totals.total_collected_inr)}
                </span>
              </div>
              <div className="bg-[#F1E6CF] border border-[#1F2A5A] px-3 py-2">
                <span className="block text-[10px] uppercase text-[#465078]">Outstanding</span>
                <span className="font-bold text-[#B3261E] tabular-nums">
                  {formatInr(summary.totals.total_outstanding_inr)}
                </span>
              </div>
              <div className="bg-[#F1E6CF] border border-[#1F2A5A] px-3 py-2">
                <span className="block text-[10px] uppercase text-[#465078]">Pending Verify</span>
                <span className="font-bold text-[#C2552D] tabular-nums">
                  {summary.totals.pending_payment_verifications}
                </span>
              </div>
            </div>
          )}
        </div>

        <div role="tablist" className="grid grid-cols-3 gap-2 mt-4">
          {(
            [
              { id: 'finance', label: '01 · Fee Ledger & Clearance', icon: IndianRupee },
              { id: 'notices', label: '02 · Institutional Notices', icon: Megaphone },
              { id: 'reports', label: '03 · Reports & CSV Exports', icon: BarChart3 },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'px-3 py-2.5 border-2 border-[#1F2A5A] font-mono-code text-xs font-bold text-left inline-flex items-center gap-2',
                  active
                    ? 'bg-[#FBE9A6] text-[#1F2A5A] shadow-ink-sm'
                    : 'bg-[#F1E6CF] text-[#465078] hover:bg-[#F8F2E4]',
                ].join(' ')}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* TAB 1: FEE LEDGER & VERIFICATION */}
      {activeTab === 'finance' && (
        <div className="space-y-5">
          {gateway && (
            <div className="bg-[#FBE9A6] border-2 border-[#1F2A5A] p-3.5 text-xs text-[#1F2A5A] flex items-center justify-between gap-3 flex-wrap">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#5E8C6A] shrink-0" aria-hidden="true" />
                <strong>Gateway Mode:</strong> {gateway.mode} — Offline Bank Challan / NEFT
                reconciliation active; no fabricated online charges.
              </span>
              <span className="font-mono-code text-[11px] font-bold text-[#C2552D]">
                {sessionUser.role === 'ADMIN' ? 'ADMIN WRITE ACCESS' : 'WARDEN READ-ONLY SCOPE'}
              </span>
            </div>
          )}

          {/* Admin-Only: Issue New Invoice */}
          {sessionUser.role === 'ADMIN' && (
            <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-3">
              <h2 className="font-display text-2xl text-[#1F2A5A] inline-flex items-center gap-2">
                <PlusSquare className="w-5 h-5 text-[#C2552D]" aria-hidden="true" />
                Issue Semester Fee Invoice
              </h2>
              <form
                onSubmit={(e) => void handleCreateInvoice(e)}
                className="grid grid-cols-1 sm:grid-cols-6 gap-2.5 items-end"
              >
                <div>
                  <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                    Student ID
                  </label>
                  <input
                    type="text"
                    required
                    value={newStudentId}
                    onChange={(e) => setNewStudentId(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs"
                  />
                </div>
                <div>
                  <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                    Academic Term
                  </label>
                  <input
                    type="text"
                    required
                    value={newTerm}
                    onChange={(e) => setNewTerm(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs"
                  />
                </div>
                <div>
                  <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                    Due Date
                  </label>
                  <input
                    type="date"
                    required
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full px-2 py-1.5 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs"
                  />
                </div>
                <div>
                  <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                    Room Rent (₹)
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={newRoomRent}
                    onChange={(e) => setNewRoomRent(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                    Mess Advance (₹)
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={newMessFee}
                    onChange={(e) => setNewMessFee(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs tabular-nums"
                  />
                </div>
                <button
                  type="submit"
                  disabled={creatingInv}
                  className="py-2 px-3 bg-[#C2552D] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A] shadow-ink-sm hover:bg-[#A64420]"
                >
                  {creatingInv ? 'Issuing...' : 'Issue Invoice'}
                </button>
              </form>
            </section>
          )}

          {/* Invoice Ledger */}
          <section className="space-y-3">
            {invoices.map((inv) => (
              <article
                key={inv.id}
                className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono-code text-xs font-bold text-[#1F2A5A]">
                      {inv.invoice_code} · {inv.student_name} ({inv.student_code}) · {inv.room_label}
                    </p>
                    <p className="font-mono-code text-[11px] text-[#465078] tabular-nums">
                      Payable {formatInr(inv.total_payable_inr)} · Paid {formatInr(inv.paid_inr)} ·
                      Waived {formatInr(inv.waived_inr)} · Balance{' '}
                      <strong className="text-[#B3261E]">{formatInr(inv.balance_due_inr)}</strong>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-0.5 font-mono-code text-[11px] font-bold border border-[#1F2A5A] ${
                        BADGE_STYLE[inv.status] ?? 'bg-[#F1E6CF]'
                      }`}
                    >
                      {inv.status}
                    </span>
                    {sessionUser.role === 'ADMIN' && inv.balance_due_inr > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setWaiverInvId(waiverInvId === inv.id ? null : inv.id)
                        }
                        className="px-2.5 py-1 bg-[#F1E6CF] border border-[#1F2A5A] font-mono-code text-[11px] font-bold text-[#1F2A5A]"
                      >
                        Apply Waiver
                      </button>
                    )}
                  </div>
                </div>

                {/* Admin Waiver Form */}
                {sessionUser.role === 'ADMIN' && waiverInvId === inv.id && (
                  <div className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-3 flex flex-wrap items-end gap-2.5">
                    <div>
                      <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                        Waiver Amount (INR)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={inv.balance_due_inr}
                        value={waiverAmount}
                        onChange={(e) => setWaiverAmount(Number(e.target.value))}
                        className="w-32 px-2 py-1.5 bg-[#F8F2E4] border border-[#1F2A5A] font-mono-code text-xs tabular-nums"
                      />
                    </div>
                    <div className="flex-1 min-w-[200px]">
                      <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                        Official Audit Justification
                      </label>
                      <input
                        type="text"
                        value={waiverReason}
                        onChange={(e) => setWaiverReason(e.target.value)}
                        placeholder="Merit-cum-Means Scholarship Order #2026-44"
                        className="w-full px-2.5 py-1.5 bg-[#F8F2E4] border border-[#1F2A5A] text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={busyKey === `wav-${inv.id}`}
                      onClick={() => void handleApplyWaiver(inv.id)}
                      className="px-3.5 py-1.5 bg-[#1F2A5A] text-[#F8F2E4] font-bold text-xs border border-[#1F2A5A]"
                    >
                      Commit Waiver
                    </button>
                  </div>
                )}

                {/* Payment Submissions Queue */}
                {inv.payments.length > 0 && (
                  <div className="space-y-2 border-t border-[#1F2A5A]/20 pt-2.5">
                    {inv.payments.map((p) => (
                      <div
                        key={p.id}
                        className="bg-[#F1E6CF] border border-[#1F2A5A] p-2.5 flex flex-wrap items-center justify-between gap-2 font-mono-code text-xs"
                      >
                        <div>
                          <span className="font-bold text-[#1F2A5A]">
                            {p.mode} · Ref {p.reference_number} · {formatInr(p.amount_inr)}
                          </span>
                          <span className="block text-[11px] text-[#465078]">
                            Date {p.paid_on_date}
                            {p.receipt_number ? ` · Receipt ${p.receipt_number}` : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold border border-[#1F2A5A] ${
                              BADGE_STYLE[p.status] ?? 'bg-[#F8F2E4]'
                            }`}
                          >
                            {p.status}
                          </span>
                          {sessionUser.role === 'ADMIN' &&
                            p.status === 'SUBMITTED_FOR_VERIFICATION' && (
                              <>
                                <button
                                  type="button"
                                  disabled={busyKey === `ver-${p.id}-VERIFIED_PAID`}
                                  onClick={() =>
                                    void handleVerifyPayment(inv.id, p.id, 'VERIFIED_PAID')
                                  }
                                  className="px-2.5 py-1 bg-[#5E8C6A] text-[#F8F2E4] font-bold text-[11px] border border-[#1F2A5A] inline-flex items-center gap-1"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                  Verify Paid
                                </button>
                                <button
                                  type="button"
                                  disabled={busyKey === `ver-${p.id}-REJECTED`}
                                  onClick={() =>
                                    void handleVerifyPayment(inv.id, p.id, 'REJECTED')
                                  }
                                  className="px-2.5 py-1 bg-[#B3261E] text-[#F8F2E4] font-bold text-[11px] border border-[#1F2A5A] inline-flex items-center gap-1"
                                >
                                  <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                                  Reject
                                </button>
                              </>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </section>
        </div>
      )}

      {/* TAB 2: INSTITUTIONAL NOTICES */}
      {activeTab === 'notices' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-5 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5">
              Publish Official Hostel Notice
            </h2>
            <form onSubmit={(e) => void handlePublishNotice(e)} className="space-y-3">
              <div>
                <label className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1">
                  Title
                </label>
                <input
                  type="text"
                  required
                  minLength={5}
                  value={ntcTitle}
                  onChange={(e) => setNtcTitle(e.target.value)}
                  placeholder="e.g., Mess Committee Monthly Inspection Schedule"
                  className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1">
                    Audience
                  </label>
                  <select
                    value={ntcAudience}
                    onChange={(e) => setNtcAudience(e.target.value as NoticeAudience)}
                    className="w-full px-2 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs"
                  >
                    {sessionUser.role === 'ADMIN' && (
                      <option value="ALL_HOSTELS">All Hostels</option>
                    )}
                    <option value="BLOCK_RESIDENTS">Block Residents</option>
                    <option value="MAINTENANCE_ADVISORY">Maintenance Advisory</option>
                  </select>
                </div>
                <div>
                  <label className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1">
                    Target Block
                  </label>
                  <select
                    value={ntcBlockId}
                    onChange={(e) => setNtcBlockId(e.target.value)}
                    className="w-full px-2 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs"
                  >
                    {sessionUser.role === 'ADMIN' && <option value="">All University Hostels</option>}
                    {scopedBlocks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1">
                  Notice Body
                </label>
                <textarea
                  required
                  minLength={10}
                  rows={4}
                  value={ntcBody}
                  onChange={(e) => setNtcBody(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-bold text-[#1F2A5A]">
                <input
                  type="checkbox"
                  checked={ntcPinned}
                  onChange={(e) => setNtcPinned(e.target.checked)}
                />
                Pin to top of Hostel Notice Board
              </label>
              <button
                type="submit"
                disabled={publishingNotice}
                className="w-full py-2.5 bg-[#C2552D] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A] shadow-ink-sm"
              >
                {publishingNotice ? 'Publishing...' : 'Publish Official Notice'}
              </button>
            </form>
          </section>

          <section className="lg:col-span-7 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-3">
            <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5">
              Active Notice Board ({notices.length})
            </h2>
            {notices.map((ntc) => (
              <article
                key={ntc.id}
                className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-3.5 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2 font-mono-code text-[11px]">
                  <span className="font-bold text-[#1F2A5A]">
                    {ntc.notice_code} · {ntc.block_name} · {ntc.audience}
                  </span>
                  {ntc.pinned && (
                    <span className="px-2 py-0.5 bg-[#B3261E] text-[#F8F2E4] font-bold">PINNED</span>
                  )}
                </div>
                <h3 className="font-bold text-sm text-[#1F2A5A]">{ntc.title}</h3>
                <p className="text-xs text-[#465078]">{ntc.body}</p>
              </article>
            ))}
          </section>
        </div>
      )}

      {/* TAB 3: INSTITUTIONAL REPORTS & AUDITED CSV EXPORTS */}
      {activeTab === 'reports' && summary && (
        <div className="space-y-5">
          <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1F2A5A]/30 pb-3">
              <div>
                <h2 className="font-display text-2xl text-[#1F2A5A]">
                  Audited CSV Data Exports ({summary.scope.replace('_', ' ')})
                </h2>
                <p className="text-xs text-[#465078]">
                  Every export enforces spreadsheet formula-injection sanitization and records an
                  immutable audit event.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: 'occupancy', label: 'Occupancy CSV' },
                    { id: 'fees', label: 'Fee Ledger CSV' },
                    { id: 'complaints', label: 'Complaints CSV' },
                    { id: 'gate_passes', label: 'Gate Passes CSV' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={busyKey === `csv-${item.id}`}
                    onClick={() => void handleDownloadCsv(item.id)}
                    className="px-3 py-2 bg-[#1F2A5A] text-[#F8F2E4] font-mono-code text-xs font-bold border border-[#1F2A5A] inline-flex items-center gap-1.5 hover:bg-[#273570]"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Block-by-Block Institutional Table */}
            <div className="overflow-x-auto border-2 border-[#1F2A5A]">
              <table className="w-full text-left border-collapse font-mono-code text-xs">
                <thead>
                  <tr className="bg-[#1F2A5A] text-[#F8F2E4]">
                    <th className="px-3 py-2.5">Hostel Block</th>
                    <th className="px-3 py-2.5 text-right">Beds (Occ/Tot)</th>
                    <th className="px-3 py-2.5 text-right">Occ %</th>
                    <th className="px-3 py-2.5 text-right">Open Cmps</th>
                    <th className="px-3 py-2.5 text-right">Maint Open</th>
                    <th className="px-3 py-2.5 text-right">Collected</th>
                    <th className="px-3 py-2.5 text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F2A5A]/20 bg-[#F1E6CF]">
                  {summary.blocks.map((b) => (
                    <tr key={b.block_id}>
                      <td className="px-3 py-2.5 font-bold text-[#1F2A5A]">
                        {b.block_name} ({b.block_code})
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {b.occupied_beds} / {b.total_beds}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums">
                        {b.occupancy_pct}%
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{b.open_complaints}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {b.active_maintenance_tasks}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-[#5E8C6A] tabular-nums">
                        {formatInr(b.collected_inr)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-[#B3261E] tabular-nums">
                        {formatInr(b.outstanding_inr)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

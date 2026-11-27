import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  FileSpreadsheet,
  IndianRupee,
  Megaphone,
  Printer,
  Receipt,
  ShieldAlert,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  FeeInvoice,
  OfflinePaymentMode,
  OfficialFeeReceipt,
  PaymentGatewayReadiness,
} from '../../lib/finance/service';
import type { InstitutionalNotice, UserNotification } from '../../lib/notifications/service';
import type { ToastMessage } from '../components/layout/ToastContainer';

export interface StudentFinancePageProps {
  onToast: (tone: ToastMessage['tone'], text: string) => void;
}

type FinanceTab = 'ledger' | 'notices';

const INVOICE_BADGE: Record<string, string> = {
  UNPAID: 'bg-[#FBE9A6] text-[#1F2A5A]',
  PARTIALLY_PAID: 'bg-[#C2552D] text-[#F8F2E4]',
  PAID: 'bg-[#5E8C6A] text-[#F8F2E4]',
  WAIVED: 'bg-[#1F2A5A] text-[#F8F2E4]',
  CANCELLED: 'bg-[#465078] text-[#F8F2E4]',
  SUBMITTED_FOR_VERIFICATION: 'bg-[#F2C94C] text-[#1F2A5A]',
  VERIFIED_PAID: 'bg-[#5E8C6A] text-[#F8F2E4]',
  REJECTED: 'bg-[#B3261E] text-[#F8F2E4]',
};

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

export const StudentFinancePage: React.FC<StudentFinancePageProps> = ({ onToast }) => {
  const [activeTab, setActiveTab] = useState<FinanceTab>('ledger');
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<FeeInvoice[]>([]);
  const [gateway, setGateway] = useState<PaymentGatewayReadiness | null>(null);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notices, setNotices] = useState<InstitutionalNotice[]>([]);
  const [activeReceipt, setActiveReceipt] = useState<OfficialFeeReceipt | null>(null);

  // Payment reference submission state
  const [payInvoiceId, setPayInvoiceId] = useState<string | null>(null);
  const [payMode, setPayMode] = useState<OfflinePaymentMode>('BANK_NEFT_IMPS');
  const [payReference, setPayReference] = useState('');
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [finRes, notifRes, noticeRes] = await Promise.all([
        apiFetch<{ invoices: FeeInvoice[]; gateway_readiness: PaymentGatewayReadiness }>(
          '/api/finance/invoices'
        ),
        apiFetch<{ notifications: UserNotification[]; unread_count: number }>('/api/notifications'),
        apiFetch<{ notices: InstitutionalNotice[] }>('/api/institutional-notices'),
      ]);
      setInvoices(finRes.invoices);
      setGateway(finRes.gateway_readiness);
      setNotifications(notifRes.notifications);
      setUnreadCount(notifRes.unread_count);
      setNotices(noticeRes.notices);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to load student fee ledger and notices.'
      );
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSubmitPaymentRef = async (e: React.FormEvent, invoiceId: string) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/finance/invoices/${encodeURIComponent(invoiceId)}/payments`,
        {
          method: 'POST',
          body: JSON.stringify({
            mode: payMode,
            reference_number: payReference,
            amount_inr: Number(payAmount),
            paid_on_date: payDate,
          }),
        }
      );
      onToast('success', res.message);
      setPayInvoiceId(null);
      setPayReference('');
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to submit payment reference.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoadReceipt = async (invoiceId: string, paymentId: string) => {
    try {
      const res = await apiFetch<{ receipt: OfficialFeeReceipt }>(
        `/api/finance/invoices/${encodeURIComponent(invoiceId)}/payments/${encodeURIComponent(paymentId)}/receipt`
      );
      setActiveReceipt(res.receipt);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to load official receipt.');
    }
  };

  const handleMarkRead = async (notificationId: string) => {
    try {
      await apiFetch(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: 'PATCH',
      });
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to update notification.');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await apiFetch<{ message: string }>('/api/notifications/read-all', {
        method: 'POST',
      });
      onToast('info', res.message);
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to mark notifications read.');
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
        Loading Student Fee Ledger &amp; Notice Inbox...
      </div>
    );
  }

  const totalBalanceDue = invoices.reduce((s, inv) => s + inv.balance_due_inr, 0);
  const totalPaid = invoices.reduce((s, inv) => s + inv.paid_inr, 0);

  return (
    <div className="space-y-6">
      {/* Masthead */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 border-b-2 border-[#1F2A5A] pb-4">
          <div>
            <p className="font-mono-code text-xs font-bold tracking-[0.16em] text-[#C2552D] uppercase">
              PHASE 5 · HOSTEL FEE LEDGER &amp; INSTITUTIONAL NOTICES
            </p>
            <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] leading-tight mt-1">
              Semester Dues, Official Receipts &amp; Alerts
            </h1>
            <p className="text-sm text-[#465078] mt-1">
              Submit your NEFT/IMPS or University Bank Challan reference for Finance Office
              verification. Receipts are issued strictly after institutional reconciliation.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 font-mono-code text-xs shrink-0">
            <div className="bg-[#F1E6CF] border border-[#1F2A5A] px-3 py-2">
              <span className="block text-[10px] uppercase text-[#465078]">Verified Paid</span>
              <span className="font-bold text-[#5E8C6A] tabular-nums">{formatInr(totalPaid)}</span>
            </div>
            <div className="bg-[#F1E6CF] border border-[#1F2A5A] px-3 py-2">
              <span className="block text-[10px] uppercase text-[#465078]">Balance Due</span>
              <span className="font-bold text-[#B3261E] tabular-nums">
                {formatInr(totalBalanceDue)}
              </span>
            </div>
            <div className="bg-[#F1E6CF] border border-[#1F2A5A] px-3 py-2">
              <span className="block text-[10px] uppercase text-[#465078]">Unread Alerts</span>
              <span className="font-bold text-[#1F2A5A] tabular-nums">{unreadCount}</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div role="tablist" className="grid grid-cols-2 gap-2 mt-4">
          <button
            role="tab"
            type="button"
            aria-selected={activeTab === 'ledger'}
            onClick={() => setActiveTab('ledger')}
            className={[
              'px-3 py-2.5 border-2 border-[#1F2A5A] font-mono-code text-xs font-bold text-left inline-flex items-center gap-2',
              activeTab === 'ledger'
                ? 'bg-[#FBE9A6] text-[#1F2A5A] shadow-ink-sm'
                : 'bg-[#F1E6CF] text-[#465078] hover:bg-[#F8F2E4]',
            ].join(' ')}
          >
            <IndianRupee className="w-4 h-4 shrink-0" aria-hidden="true" />
            01 · Fee Invoices &amp; Receipts ({invoices.length})
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={activeTab === 'notices'}
            onClick={() => setActiveTab('notices')}
            className={[
              'px-3 py-2.5 border-2 border-[#1F2A5A] font-mono-code text-xs font-bold text-left inline-flex items-center gap-2',
              activeTab === 'notices'
                ? 'bg-[#FBE9A6] text-[#1F2A5A] shadow-ink-sm'
                : 'bg-[#F1E6CF] text-[#465078] hover:bg-[#F8F2E4]',
            ].join(' ')}
          >
            <Bell className="w-4 h-4 shrink-0" aria-hidden="true" />
            02 · Notifications ({unreadCount} unread) &amp; Notices
          </button>
        </div>
      </section>

      {/* Transparent Payment Gateway Readiness Notice */}
      {activeTab === 'ledger' && gateway && !gateway.configured && (
        <section className="bg-[#FBE9A6] border-2 border-[#1F2A5A] p-4 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-[#B3261E] shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-xs text-[#1F2A5A] space-y-1">
            <p className="font-mono-code font-bold uppercase text-[#B3261E]">
              ONLINE PAYMENT GATEWAY NOT CONFIGURED — OFFICIAL BANK CHALLAN / NEFT ACTIVE
            </p>
            <p>
              Instant online card/UPI checkout requires official university merchant credentials and
              webhook signing keys. Please pay via your university bank account or challan counter
              and submit your transaction reference below for Finance Office verification.
            </p>
          </div>
        </section>
      )}

      {/* Printable Official Fee Receipt */}
      {activeTab === 'ledger' && activeReceipt && (
        <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-[#1F2A5A] pb-3">
            <div className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-[#5E8C6A]" aria-hidden="true" />
              <div>
                <h2 className="font-display text-2xl text-[#1F2A5A]">
                  Official University Hostel Fee Receipt
                </h2>
                <p className="font-mono-code text-[11px] text-[#465078]">
                  Receipt {activeReceipt.receipt_number} · SHA-256 Checksum:{' '}
                  {activeReceipt.receipt_checksum}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3.5 py-1.5 bg-[#1F2A5A] text-[#F8F2E4] font-mono-code text-xs font-bold border border-[#1F2A5A] inline-flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                Print Receipt
              </button>
              <button
                type="button"
                onClick={() => setActiveReceipt(null)}
                className="px-3 py-1.5 bg-[#F1E6CF] text-[#1F2A5A] font-mono-code text-xs font-bold border border-[#1F2A5A]"
              >
                Close
              </button>
            </div>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#F1E6CF] border border-[#1F2A5A] p-4 font-mono-code text-xs">
            <div>
              <dt className="text-[10px] uppercase text-[#465078]">Resident</dt>
              <dd className="font-bold text-[#1F2A5A] mt-0.5">
                {activeReceipt.student_name} ({activeReceipt.student_code})
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase text-[#465078]">Invoice / Term</dt>
              <dd className="font-bold text-[#1F2A5A] mt-0.5">
                {activeReceipt.invoice_code} · {activeReceipt.academic_term}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase text-[#465078]">Amount Verified</dt>
              <dd className="font-bold text-[#5E8C6A] mt-0.5 tabular-nums">
                {formatInr(activeReceipt.amount_inr)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase text-[#465078]">Mode &amp; Reference</dt>
              <dd className="font-bold text-[#1F2A5A] mt-0.5">
                {activeReceipt.mode} · {activeReceipt.reference_number}
              </dd>
            </div>
          </dl>
          <p className="font-mono-code text-[11px] text-[#465078]">
            Verified by {activeReceipt.verified_by} on{' '}
            {new Date(activeReceipt.verified_at).toLocaleString()} · Remaining Invoice Balance:{' '}
            {formatInr(activeReceipt.remaining_balance_inr)}
          </p>
        </section>
      )}

      {/* TAB 1: FEE LEDGER */}
      {activeTab === 'ledger' && (
        <section className="space-y-4">
          {invoices.length === 0 ? (
            <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] p-6 text-sm text-[#465078]">
              No hostel fee invoices have been issued to your account yet.
            </div>
          ) : (
            invoices.map((inv) => (
              <article
                key={inv.id}
                className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-[#1F2A5A] pb-3">
                  <div>
                    <p className="font-mono-code text-xs font-bold text-[#C2552D]">
                      {inv.invoice_code} · {inv.academic_term} · Due {inv.due_date}
                    </p>
                    <h2 className="font-display text-2xl text-[#1F2A5A] mt-0.5">
                      {inv.block_name} ({inv.room_label})
                    </h2>
                  </div>
                  <span
                    className={`px-3 py-1 font-mono-code text-xs font-bold border-2 border-[#1F2A5A] ${
                      INVOICE_BADGE[inv.status] ?? 'bg-[#F1E6CF]'
                    }`}
                  >
                    {inv.status}
                  </span>
                </div>

                {/* Line Items Table */}
                <div className="overflow-x-auto border border-[#1F2A5A]">
                  <table className="w-full text-left border-collapse font-mono-code text-xs">
                    <thead>
                      <tr className="bg-[#1F2A5A] text-[#F8F2E4]">
                        <th className="px-3 py-2">Code</th>
                        <th className="px-3 py-2">Fee Head</th>
                        <th className="px-3 py-2 text-right">Amount (INR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1F2A5A]/20 bg-[#F1E6CF]">
                      {inv.line_items.map((li) => (
                        <tr key={li.code}>
                          <td className="px-3 py-2 font-bold text-[#1F2A5A]">{li.code}</td>
                          <td className="px-3 py-2 text-[#1F2A5A]">{li.label}</td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums">
                            {formatInr(li.amount_inr)}
                          </td>
                        </tr>
                      ))}
                      {inv.waived_inr > 0 && (
                        <tr className="bg-[#FBE9A6]">
                          <td className="px-3 py-2 font-bold text-[#5E8C6A]">WAIVER</td>
                          <td className="px-3 py-2 text-[#1F2A5A]">
                            Audited Scholarship / Institutional Waiver
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-[#5E8C6A] tabular-nums">
                            -{formatInr(inv.waived_inr)}
                          </td>
                        </tr>
                      )}
                      <tr className="bg-[#F8F2E4] font-bold">
                        <td className="px-3 py-2" colSpan={2}>
                          Total Payable / Verified Paid / Remaining Balance
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatInr(inv.total_payable_inr)} · Paid {formatInr(inv.paid_inr)} · Due{' '}
                          <span className="text-[#B3261E]">{formatInr(inv.balance_due_inr)}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Payment Submissions & Receipts */}
                {inv.payments.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-mono-code text-[11px] font-bold uppercase text-[#465078]">
                      Submitted Payment References
                    </p>
                    {inv.payments.map((p) => (
                      <div
                        key={p.id}
                        className="bg-[#F1E6CF] border border-[#1F2A5A] p-3 flex flex-wrap items-center justify-between gap-2 font-mono-code text-xs"
                      >
                        <div>
                          <span className="font-bold text-[#1F2A5A]">
                            {p.mode} · Ref {p.reference_number} · {formatInr(p.amount_inr)}
                          </span>
                          <span className="block text-[11px] text-[#465078]">
                            Paid on {p.paid_on_date}
                            {p.verification_note ? ` · Finance Note: ${p.verification_note}` : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 text-[11px] font-bold border border-[#1F2A5A] ${
                              INVOICE_BADGE[p.status] ?? 'bg-[#F8F2E4]'
                            }`}
                          >
                            {p.status}
                          </span>
                          {p.status === 'VERIFIED_PAID' && (
                            <button
                              type="button"
                              onClick={() => void handleLoadReceipt(inv.id, p.id)}
                              className="px-2.5 py-1 bg-[#1F2A5A] text-[#F8F2E4] font-bold text-[11px] border border-[#1F2A5A] inline-flex items-center gap-1"
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                              Official Receipt
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Submit Offline Payment Reference */}
                {inv.balance_due_inr > 0 && (
                  <div>
                    {payInvoiceId !== inv.id ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPayInvoiceId(inv.id);
                          setPayAmount(inv.balance_due_inr);
                        }}
                        className="px-4 py-2 bg-[#C2552D] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A] shadow-ink-sm hover:bg-[#A64420]"
                      >
                        Submit Bank NEFT / Challan Reference
                      </button>
                    ) : (
                      <form
                        onSubmit={(e) => void handleSubmitPaymentRef(e, inv.id)}
                        className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-4 space-y-3"
                      >
                        <p className="font-mono-code text-xs font-bold uppercase text-[#1F2A5A]">
                          Log Offline Payment for Finance Office Verification
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                          <div>
                            <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                              Payment Mode
                            </label>
                            <select
                              value={payMode}
                              onChange={(e) => setPayMode(e.target.value as OfflinePaymentMode)}
                              className="w-full px-2 py-1.5 bg-[#F8F2E4] border border-[#1F2A5A] font-mono-code text-xs"
                            >
                              <option value="BANK_NEFT_IMPS">Bank NEFT / IMPS</option>
                              <option value="UNIVERSITY_CHALLAN">University Challan</option>
                              <option value="DEMAND_DRAFT">Demand Draft</option>
                            </select>
                          </div>
                          <div>
                            <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                              UTR / Challan Ref #
                            </label>
                            <input
                              type="text"
                              required
                              minLength={5}
                              value={payReference}
                              onChange={(e) => setPayReference(e.target.value)}
                              placeholder="UTR202608140091"
                              className="w-full px-2.5 py-1.5 bg-[#F8F2E4] border border-[#1F2A5A] font-mono-code text-xs uppercase"
                            />
                          </div>
                          <div>
                            <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                              Amount (INR)
                            </label>
                            <input
                              type="number"
                              required
                              min={1}
                              max={inv.balance_due_inr}
                              value={payAmount}
                              onChange={(e) => setPayAmount(Number(e.target.value))}
                              className="w-full px-2.5 py-1.5 bg-[#F8F2E4] border border-[#1F2A5A] font-mono-code text-xs tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                              Payment Date
                            </label>
                            <input
                              type="date"
                              required
                              value={payDate}
                              onChange={(e) => setPayDate(e.target.value)}
                              className="w-full px-2 py-1.5 bg-[#F8F2E4] border border-[#1F2A5A] font-mono-code text-xs"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            disabled={submitting}
                            className="px-4 py-1.5 bg-[#5E8C6A] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A]"
                          >
                            {submitting ? 'Submitting...' : 'Submit for Finance Verification'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayInvoiceId(null)}
                            className="px-3 py-1.5 bg-[#F8F2E4] text-[#1F2A5A] font-bold text-xs border border-[#1F2A5A]"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </article>
            ))
          )}
        </section>
      )}

      {/* TAB 2: NOTIFICATIONS & OFFICIAL NOTICES */}
      {activeTab === 'notices' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-6 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#1F2A5A]/30 pb-2.5">
              <h2 className="font-display text-2xl text-[#1F2A5A] inline-flex items-center gap-2">
                <Bell className="w-5 h-5 text-[#C2552D]" aria-hidden="true" />
                Personal Notifications ({unreadCount} unread)
              </h2>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void handleMarkAllRead()}
                  className="px-2.5 py-1 bg-[#F1E6CF] border border-[#1F2A5A] font-mono-code text-[11px] font-bold text-[#1F2A5A]"
                >
                  Mark All Read
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-[#465078] bg-[#F1E6CF] border border-[#1F2A5A]/30 p-4">
                No personal account alerts yet. Billing verifications and hostel notifications appear
                here automatically.
              </p>
            ) : (
              <div className="space-y-2.5">
                {notifications.map((n) => (
                  <article
                    key={n.id}
                    className={`border-2 border-[#1F2A5A] p-3.5 space-y-1 ${
                      n.read ? 'bg-[#F1E6CF]/60' : 'bg-[#FBE9A6]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-mono-code text-[11px]">
                      <span className="font-bold text-[#C2552D]">{n.category}</span>
                      <span className="text-[#465078]">
                        {new Date(n.created_at).toLocaleString()}
                      </span>
                    </div>
                    <h3 className="font-bold text-sm text-[#1F2A5A]">{n.title}</h3>
                    <p className="text-xs text-[#465078]">{n.body}</p>
                    {!n.read && (
                      <button
                        type="button"
                        onClick={() => void handleMarkRead(n.id)}
                        className="mt-1 px-2.5 py-1 bg-[#F8F2E4] border border-[#1F2A5A] font-mono-code text-[11px] font-bold text-[#1F2A5A] inline-flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#5E8C6A]" aria-hidden="true" />
                        Mark Read
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="lg:col-span-6 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5 inline-flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
              Official Hostel Notices ({notices.length})
            </h2>
            <div className="space-y-3">
              {notices.map((ntc) => (
                <article
                  key={ntc.id}
                  className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-3.5 space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono-code text-[11px]">
                    <span className="font-bold text-[#1F2A5A]">
                      {ntc.notice_code} · {ntc.block_name}
                    </span>
                    {ntc.pinned && (
                      <span className="px-2 py-0.5 bg-[#B3261E] text-[#F8F2E4] font-bold">
                        PINNED
                      </span>
                    )}
                  </div>
                  <h3 className="font-bold text-sm text-[#1F2A5A]">{ntc.title}</h3>
                  <p className="text-xs text-[#465078]">{ntc.body}</p>
                  <p className="font-mono-code text-[10px] text-[#465078]">
                    Issued by {ntc.published_by} ({ntc.published_role})
                  </p>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Hammer, PackageX, Wrench } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { MaintenanceStatus, MaintenanceTask, SessionUser } from '../../lib/types';
import { Stamp } from '../components/ui/Stamp';

interface MaintenanceDashboardPageProps {
  sessionUser: SessionUser;
  initialFilter?: 'active' | 'history';
  onToast: (tone: 'success' | 'error' | 'info', text: string) => void;
}

const STATUS_OPTIONS: Array<{ value: MaintenanceStatus; label: string }> = [
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'parts_unavailable', label: 'Parts Unavailable' },
  { value: 'resolved', label: 'Resolved (Pending Warden Closure)' },
];

export const MaintenanceDashboardPage: React.FC<MaintenanceDashboardPageProps> = ({
  sessionUser,
  initialFilter = 'active',
  onToast,
}) => {
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'history'>(initialFilter);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Work order update form state
  const [nextStatus, setNextStatus] = useState<MaintenanceStatus>('in_progress');
  const [workNote, setWorkNote] = useState('');
  const [partsNeeded, setPartsNeeded] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTab(initialFilter);
  }, [initialFilter]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ tasks: MaintenanceTask[] }>('/api/maintenance/tasks');
      setTasks(res.tasks);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to load assigned maintenance work orders.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const filteredTasks = useMemo(() => {
    if (tab === 'history') {
      return tasks.filter((t) => t.status === 'resolved' || t.status === 'closed');
    }
    return tasks.filter((t) => t.status !== 'resolved' && t.status !== 'closed');
  }, [tasks, tab]);

  const selectedTask = useMemo(() => {
    const inFiltered = filteredTasks.find((t) => t.id === selectedTaskId);
    return inFiltered ?? filteredTasks[0] ?? null;
  }, [filteredTasks, selectedTaskId]);

  useEffect(() => {
    if (selectedTask) {
      setNextStatus(
        selectedTask.status === 'closed' ? 'resolved' : selectedTask.status
      );
      setPartsNeeded(selectedTask.parts_needed ?? '');
      setEvidenceRef(selectedTask.evidence_reference ?? '');
      setWorkNote('');
    }
  }, [selectedTask?.id]);

  const counts = useMemo(() => {
    const activeCount = tasks.filter(
      (t) => t.status !== 'resolved' && t.status !== 'closed'
    ).length;
    const partsHoldCount = tasks.filter((t) => t.status === 'parts_unavailable').length;
    const resolvedCount = tasks.filter(
      (t) => t.status === 'resolved' || t.status === 'closed'
    ).length;
    return { activeCount, partsHoldCount, resolvedCount };
  }, [tasks]);

  const handleUpdateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ task: MaintenanceTask; message: string }>(
        `/api/maintenance/tasks/${selectedTask.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: nextStatus,
            ...(workNote.trim() ? { work_note: workNote.trim() } : {}),
            parts_needed: partsNeeded.trim() ? partsNeeded.trim() : null,
            evidence_reference: evidenceRef.trim() ? evidenceRef.trim() : null,
          }),
        }
      );
      setTasks((prev) => prev.map((t) => (t.id === res.task.id ? res.task : t)));
      setWorkNote('');
      onToast('success', res.message);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to save maintenance update.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-7">
      {/* Header Register */}
      <header className="border-b-2 border-[#1F2A5A] pb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono-code text-xs text-[#465078]">
            ESTATE &amp; FACILITIES DESK · ASSIGNED BLOCKS:{' '}
            {sessionUser.assigned_block_ids.join(', ') || 'NONE'}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] mt-1">
            Maintenance Work Order Register
          </h1>
          <p className="text-sm text-[#465078] mt-1 max-w-2xl">
            Scoped view for {sessionUser.name}. Displays only work orders explicitly assigned to your
            account. Student academic, identity, and fee registers remain strictly isolated.
          </p>
        </div>
        <Stamp label="MAINTENANCE STAFF" variant="green" size="sm" />
      </header>

      {/* Summary Ledger Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm p-4">
          <div className="flex items-center justify-between text-xs font-mono-code text-[#465078]">
            <span>OPEN WORK ORDERS</span>
            <Wrench className="w-4 h-4 text-[#1F2A5A]" aria-hidden="true" />
          </div>
          <p className="font-display text-3xl text-[#1F2A5A] mt-2 tabular-nums">
            {counts.activeCount}
          </p>
          <p className="text-xs text-[#465078] mt-0.5">Assigned to your duty register</p>
        </div>

        <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm p-4">
          <div className="flex items-center justify-between text-xs font-mono-code text-[#465078]">
            <span>AWAITING PARTS</span>
            <PackageX className="w-4 h-4 text-[#C2552D]" aria-hidden="true" />
          </div>
          <p className="font-display text-3xl text-[#C2552D] mt-2 tabular-nums">
            {counts.partsHoldCount}
          </p>
          <p className="text-xs text-[#465078] mt-0.5">Reported for store requisition</p>
        </div>

        <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm p-4">
          <div className="flex items-center justify-between text-xs font-mono-code text-[#465078]">
            <span>COMPLETED LOG</span>
            <CheckCircle2 className="w-4 h-4 text-[#295234]" aria-hidden="true" />
          </div>
          <p className="font-display text-3xl text-[#295234] mt-2 tabular-nums">
            {counts.resolvedCount}
          </p>
          <p className="text-xs text-[#465078] mt-0.5">Resolved &amp; verified tasks</p>
        </div>
      </section>

      {/* Interactive Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex border-2 border-[#1F2A5A] rounded-[2px] bg-[#F1E6CF]">
          <button
            type="button"
            onClick={() => setTab('active')}
            className={`px-4 py-2 text-xs font-bold whitespace-nowrap transition-colors ${
              tab === 'active'
                ? 'bg-[#1F2A5A] text-[#F8F2E4]'
                : 'text-[#1F2A5A] hover:bg-[#FBE9A6]'
            }`}
          >
            Active Queue ({counts.activeCount})
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={`px-4 py-2 text-xs font-bold whitespace-nowrap border-l-2 border-[#1F2A5A] transition-colors ${
              tab === 'history'
                ? 'bg-[#1F2A5A] text-[#F8F2E4]'
                : 'text-[#1F2A5A] hover:bg-[#FBE9A6]'
            }`}
          >
            Completed Log ({counts.resolvedCount})
          </button>
        </div>

        <button
          type="button"
          onClick={() => void loadTasks()}
          className="px-3.5 py-2 text-xs font-bold text-[#1F2A5A] bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6]"
        >
          Refresh Register
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-4 bg-[#F8F2E4] border-2 border-[#B3261E] text-sm font-bold text-[#B3261E]"
        >
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
          Loading assigned maintenance work orders...
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="p-10 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] text-center space-y-2">
          <ClipboardList className="w-8 h-8 text-[#465078] mx-auto" aria-hidden="true" />
          <p className="font-display text-2xl text-[#1F2A5A]">
            No {tab === 'active' ? 'Open' : 'Completed'} Work Orders
          </p>
          <p className="text-sm text-[#465078]">
            You currently have no {tab === 'active' ? 'active' : 'completed'} maintenance tickets in
            your assigned blocks.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Ticket Queue */}
          <section className="lg:col-span-5 space-y-3">
            {filteredTasks.map((task) => {
              const isSelected = selectedTask?.id === task.id;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`w-full text-left p-4 border-2 border-[#1F2A5A] rounded-[2px] transition-colors ${
                    isSelected
                      ? 'bg-[#FBE9A6] shadow-ink'
                      : 'bg-[#F8F2E4] hover:bg-[#F1E6CF] shadow-ink-sm'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 font-mono-code text-[11px] text-[#465078]">
                    <span className="font-bold text-[#1F2A5A]">{task.ticket_code}</span>
                    <span className="uppercase font-bold">
                      {task.priority} · {task.status.replace('_', ' ')}
                    </span>
                  </div>
                  <h2 className="font-display text-xl text-[#1F2A5A] mt-1.5 leading-snug">
                    {task.room_number} · {task.block_name}
                  </h2>
                  <p className="text-sm text-[#1F2A5A]/90 mt-1 line-clamp-2">{task.summary}</p>
                  <div className="mt-2.5 pt-2 border-t border-[#1F2A5A]/20 flex items-center justify-between text-xs font-mono-code text-[#465078]">
                    <span className="uppercase">{task.category.replace('_', ' ')}</span>
                    <span>Floor {task.floor}</span>
                  </div>
                </button>
              );
            })}
          </section>

          {/* Right: Active Ticket Work Sheet */}
          {selectedTask && (
            <section className="lg:col-span-7 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-[#1F2A5A] pb-3">
                <div>
                  <p className="font-mono-code text-xs text-[#465078]">
                    {selectedTask.ticket_code} · {selectedTask.block_name} · Floor{' '}
                    {selectedTask.floor}
                  </p>
                  <h2 className="font-display text-2xl text-[#1F2A5A] mt-1">
                    Room {selectedTask.room_number} — {selectedTask.category.replace('_', ' ')}
                  </h2>
                </div>
                <Stamp
                  label={selectedTask.status.replace('_', ' ').toUpperCase()}
                  variant={selectedTask.status === 'resolved' ? 'green' : 'brick'}
                  size="sm"
                />
              </div>

              <div className="space-y-2 text-sm text-[#1F2A5A]">
                <p className="font-bold">{selectedTask.summary}</p>
                <p className="text-xs font-mono-code text-[#465078]">
                  Location: {selectedTask.location_detail}
                </p>
                {selectedTask.parts_needed && (
                  <p className="text-xs font-bold text-[#B3261E] bg-[#FBE9A6] border border-[#1F2A5A] px-3 py-2">
                    Parts Requisition Flagged: {selectedTask.parts_needed}
                  </p>
                )}
              </div>

              {/* Update Work Order Form */}
              <form
                onSubmit={handleUpdateTask}
                className="space-y-4 pt-3 border-t border-[#1F2A5A]/25"
              >
                <h3 className="font-display text-xl text-[#1F2A5A] flex items-center gap-2">
                  <Hammer className="w-4 h-4" aria-hidden="true" />
                  Record Work Progress &amp; Completion
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <label className="block">
                    <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                      Ticket Status
                    </span>
                    <select
                      value={nextStatus}
                      onChange={(e) => setNextStatus(e.target.value as MaintenanceStatus)}
                      className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] font-mono-code text-xs font-bold"
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                      Unavailable Parts / Material Request
                    </span>
                    <input
                      type="text"
                      value={partsNeeded}
                      onChange={(e) => setPartsNeeded(e.target.value)}
                      placeholder="e.g., 40mm PVC trap gasket"
                      className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] text-xs"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                    Maintenance Evidence / Inspection Reference
                  </span>
                  <input
                    type="text"
                    value={evidenceRef}
                    onChange={(e) => setEvidenceRef(e.target.value)}
                    placeholder="e.g., completion-photo-n204-fan-regulator"
                    className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] font-mono-code text-xs"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                    Work Note (Appended to Ticket History)
                  </span>
                  <textarea
                    rows={3}
                    value={workNote}
                    onChange={(e) => setWorkNote(e.target.value)}
                    placeholder="Describe inspection findings, repairs completed, or store items required..."
                    className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] text-sm"
                  />
                </label>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 text-xs font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420] disabled:opacity-50"
                >
                  {saving ? 'Updating Work Order...' : 'Save Work Order Update'}
                </button>
              </form>

              {/* Chronological Work Notes */}
              <div className="pt-4 border-t border-[#1F2A5A]/25 space-y-2.5">
                <h3 className="font-mono-code text-xs font-bold text-[#465078] uppercase">
                  Work Log History ({selectedTask.work_notes.length})
                </h3>
                {selectedTask.work_notes.length === 0 ? (
                  <p className="text-xs text-[#465078]">No work notes recorded yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {selectedTask.work_notes.map((entry) => (
                      <li
                        key={entry.id}
                        className="p-3 bg-[#F1E6CF] border border-[#1F2A5A]/40 rounded-[2px] text-xs space-y-1"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 font-mono-code text-[11px] text-[#465078]">
                          <span className="font-bold text-[#1F2A5A]">
                            {entry.author_name} ({entry.author_role})
                          </span>
                          <span>{new Date(entry.timestamp).toLocaleString('en-IN')}</span>
                        </div>
                        <p className="text-[#1F2A5A]">{entry.note}</p>
                        {entry.parts_reported && (
                          <p className="font-mono-code text-[11px] text-[#B3261E]">
                            Parts reported: {entry.parts_reported}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

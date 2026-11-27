import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Block, RoomTag, SwapProposal, UserRole } from '../../lib/types';
import {
  SwapNoticeBoard,
  type EnrichedSwapRequest,
} from '../components/swaps/SwapNoticeBoard';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Stamp } from '../components/ui/Stamp';

interface SwapsApiResponse {
  requests: EnrichedSwapRequest[];
  proposals: SwapProposal[];
}

interface SwapsPageProps {
  activeRole: UserRole;
  activeStudentId: string | null;
  onToast: (tone: 'success' | 'error' | 'info', text: string) => void;
  onSwapsChanged: () => void;
}

const SWAP_TAGS: RoomTag[] = ['quiet', 'near_mess', 'near_stairs', 'corner', 'balcony'];

export const SwapsPage: React.FC<SwapsPageProps> = ({
  activeRole,
  activeStudentId,
  onToast,
  onSwapsChanged,
}) => {
  const [data, setData] = useState<SwapsApiResponse | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'board' | 'mine' | 'history'>('board');
  const [showPostForm, setShowPostForm] = useState(false);

  // New Swap Request form state
  const [targetBlockId, setTargetBlockId] = useState('');
  const [floorMin, setFloorMin] = useState('');
  const [floorMax, setFloorMax] = useState('');
  const [acPref, setAcPref] = useState<'any' | 'true' | 'false'>('any');
  const [capPref, setCapPref] = useState('');
  const [reqTags, setReqTags] = useState<RoomTag[]>([]);
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);

  // Confirm modal state for Accept/Reject or Cancel
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    tone: 'primary' | 'danger';
    actionFn: () => Promise<void>;
  } | null>(null);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      apiFetch<SwapsApiResponse>('/api/swaps'),
      apiFetch<{ blocks: Block[] }>('/api/blocks'),
    ])
      .then(([swapsRes, blocksRes]) => {
        setData(swapsRes);
        setBlocks(blocksRes.blocks);
      })
      .catch((err) => {
        onToast('error', err instanceof Error ? err.message : 'Unable to load swap marketplace.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [activeRole, activeStudentId]);

  const currentStudentId = activeRole === 'STUDENT' ? activeStudentId : null;

  const filteredRequests = useMemo(() => {
    const all = data?.requests ?? [];
    if (activeTab === 'mine' && currentStudentId) {
      return all.filter((r) => r.student_id === currentStudentId);
    }
    if (activeTab === 'history') {
      return all.filter((r) => r.status === 'executed' || r.status === 'cancelled');
    }
    return all.filter((r) => r.status === 'open' || r.status === 'matched');
  }, [data, activeTab, currentStudentId]);

  const filteredProposals = useMemo(() => {
    const all = data?.proposals ?? [];
    if (activeTab === 'mine' && currentStudentId) {
      return all.filter((p) => p.cycle.some((s) => s.student_id === currentStudentId));
    }
    if (activeTab === 'history') {
      return all.filter((p) => p.status !== 'pending');
    }
    return all.filter((p) => p.status === 'pending');
  }, [data, activeTab, currentStudentId]);

  const handlePostSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    const criteria: Record<string, unknown> = {};
    if (targetBlockId) criteria.block_id = targetBlockId;
    if (floorMin) criteria.floor_min = Number(floorMin);
    if (floorMax) criteria.floor_max = Number(floorMax);
    if (acPref !== 'any') criteria.ac = acPref === 'true';
    if (capPref) criteria.capacity = Number(capPref);
    if (reqTags.length > 0) criteria.required_tags = reqTags;
    if (note.trim()) criteria.note = note.trim();

    if (
      !criteria.block_id &&
      criteria.floor_min === undefined &&
      criteria.floor_max === undefined &&
      criteria.ac === undefined &&
      criteria.capacity === undefined &&
      !criteria.required_tags
    ) {
      onToast('error', 'Choose at least one desired room feature (block, floor, AC, capacity, or tag).');
      return;
    }

    setPosting(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/swaps/requests', {
        method: 'POST',
        body: JSON.stringify({ wanted_criteria: criteria }),
      });
      onToast('success', res.message);
      setShowPostForm(false);
      setTargetBlockId('');
      setFloorMin('');
      setFloorMax('');
      setAcPref('any');
      setCapPref('');
      setReqTags([]);
      setNote('');
      loadData();
      onSwapsChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to post swap chit.');
    } finally {
      setPosting(false);
    }
  };

  const handleDiscoverCycles = async () => {
    setMatching(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/swaps/discover', {
        method: 'POST',
      });
      onToast('info', res.message);
      loadData();
      onSwapsChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Cycle detection failed.');
    } finally {
      setMatching(false);
    }
  };

  const handleRespondProposal = (proposalId: string, action: 'accept' | 'reject') => {
    setConfirmState({
      open: true,
      title: action === 'accept' ? 'Confirm Room Swap Acceptance' : 'Reject Swap Proposal?',
      description:
        action === 'accept'
          ? 'If all other participants in this cycle have accepted, rooms will exchange atomically right now and be recorded in the Warden Audit Log.'
          : 'Rejecting cancels this cycle proposal, preserves everyone’s current room, and releases the other participants back to the open board.',
      confirmLabel: action === 'accept' ? 'Yes, Accept Swap' : 'Reject Proposal',
      tone: action === 'accept' ? 'primary' : 'danger',
      actionFn: async () => {
        setBusyProposalId(proposalId);
        try {
          const res = await apiFetch<{ message: string; executed: boolean }>(
            `/api/swaps/proposals/${proposalId}/respond`,
            {
              method: 'POST',
              body: JSON.stringify({ action }),
            }
          );
          onToast(res.executed ? 'success' : 'info', res.message);
          loadData();
          onSwapsChanged();
        } catch (err) {
          onToast('error', err instanceof Error ? err.message : 'Swap response failed.');
        } finally {
          setBusyProposalId(null);
        }
      },
    });
  };

  const handleCancelRequest = (requestId: string) => {
    setConfirmState({
      open: true,
      title: 'Remove Swap Chit?',
      description:
        'This cancels your swap notice and releases any pending swap cycle that included your request.',
      confirmLabel: 'Remove Chit',
      tone: 'danger',
      actionFn: async () => {
        try {
          const res = await apiFetch<{ message: string }>(`/api/swaps/requests/${requestId}`, {
            method: 'DELETE',
          });
          onToast('info', res.message);
          loadData();
          onSwapsChanged();
        } catch (err) {
          onToast('error', err instanceof Error ? err.message : 'Unable to cancel request.');
        }
      },
    });
  };

  return (
    <div className="space-y-7">
      <header className="border-b-2 border-[#1F2A5A] pb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono-code text-xs text-[#465078]">
            DIRECTED GRAPH CYCLE ENGINE · 2-WAY, 3-WAY &amp; 4-WAY ATOMIC SWAPS
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] mt-1">
            Room-Exchange Notice Board
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={matching}
            onClick={handleDiscoverCycles}
            className="px-4 py-2 text-sm font-bold text-[#1F2A5A] bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6] inline-flex items-center gap-2 whitespace-nowrap disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${matching ? 'animate-spin' : ''}`} aria-hidden="true" />
            {matching ? 'Scanning Cycles...' : 'Run Cycle Matcher'}
          </button>
          {activeRole === 'STUDENT' && (
            <button
              type="button"
              onClick={() => setShowPostForm((v) => !v)}
              className="px-4 py-2 text-sm font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420] whitespace-nowrap"
            >
              {showPostForm ? 'Close Chit Form' : 'Pin a Swap Chit'}
            </button>
          )}
        </div>
      </header>

      {/* Post New Swap Request Form */}
      {showPostForm && activeRole === 'STUDENT' && (
        <form
          onSubmit={handlePostSwap}
          className="bg-[#FBE9A6] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-4 animate-chit"
        >
          <div className="border-b border-[#1F2A5A]/30 pb-2">
            <h2 className="font-display text-xl text-[#1F2A5A]">
              Pin Your Room-Exchange Request
            </h2>
            <p className="text-xs text-[#465078]">
              Describe what room you want. Our cycle engine automatically checks 2-way, 3-way, and
              4-way feasible cycles within gender-matched blocks.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Desired Block</span>
              <select
                value={targetBlockId}
                onChange={(e) => setTargetBlockId(e.target.value)}
                className="w-full px-3 py-2 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                <option value="">Any Eligible Block</option>
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.gender_type})
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">AC Requirement</span>
              <select
                value={acPref}
                onChange={(e) => setAcPref(e.target.value as 'any' | 'true' | 'false')}
                className="w-full px-3 py-2 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                <option value="any">Either AC or Non-AC</option>
                <option value="true">AC Required</option>
                <option value="false">Non-AC Preferred</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Capacity</span>
              <select
                value={capPref}
                onChange={(e) => setCapPref(e.target.value)}
                className="w-full px-3 py-2 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                <option value="">Any Capacity</option>
                <option value="1">1-Seater</option>
                <option value="2">2-Seater</option>
                <option value="3">3-Seater</option>
                <option value="4">4-Seater</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Min Floor</span>
                <input
                  type="number"
                  min={1}
                  max={4}
                  value={floorMin}
                  onChange={(e) => setFloorMin(e.target.value)}
                  placeholder="1"
                  className="w-full px-2.5 py-2 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Max Floor</span>
                <input
                  type="number"
                  min={1}
                  max={4}
                  value={floorMax}
                  onChange={(e) => setFloorMax(e.target.value)}
                  placeholder="4"
                  className="w-full px-2.5 py-2 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-[#1F2A5A]">Required Tags:</span>
            {SWAP_TAGS.map((tag) => {
              const active = reqTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    setReqTags((prev) =>
                      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                    )
                  }
                  className={[
                    'px-2.5 py-1 font-mono-code border border-[#1F2A5A] rounded-[2px]',
                    active ? 'bg-[#1F2A5A] text-[#F8F2E4]' : 'bg-[#F8F2E4] text-[#1F2A5A]',
                  ].join(' ')}
                >
                  {tag.replace('_', ' ')}
                </button>
              );
            })}
          </div>

          <label className="block">
            <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
              Note for Other Residents (optional)
            </span>
            <input
              type="text"
              maxLength={240}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g., Looking to move closer to morning lab shuttle or quiet upper corridor..."
              className="w-full px-3 py-2 text-sm bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
            />
          </label>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowPostForm(false)}
              className="px-4 py-2 text-xs font-bold bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={posting}
              className="px-5 py-2 text-xs font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm disabled:opacity-50"
            >
              {posting ? 'Pinning...' : 'Pin Chit & Check Matches'}
            </button>
          </div>
        </form>
      )}

      {/* Segmented View Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#1F2A5A]/30 pb-3">
        {[
          { id: 'board', label: 'Active Board & Proposals' },
          { id: 'mine', label: 'My Requests & Proposals' },
          { id: 'history', label: 'Swap History' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as 'board' | 'mine' | 'history')}
            className={[
              'px-4 py-2 text-xs font-bold border-2 border-[#1F2A5A] rounded-[2px] whitespace-nowrap',
              activeTab === tab.id
                ? 'bg-[#1F2A5A] text-[#F8F2E4]'
                : 'bg-[#F8F2E4] text-[#1F2A5A] hover:bg-[#FBE9A6]',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
          Loading swap notice board...
        </div>
      ) : activeTab === 'history' ? (
        <section className="space-y-4">
          <h2 className="font-display text-2xl text-[#1F2A5A]">
            Completed, Rejected &amp; Expired Swap Proposals
          </h2>
          {filteredProposals.length === 0 ? (
            <div className="p-6 bg-[#F8F2E4] border-2 border-[#1F2A5A] text-sm text-[#465078]">
              No completed or archived swap proposals recorded yet.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredProposals.map((prop) => (
                <article
                  key={prop.id}
                  className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono-code text-xs font-bold text-[#1F2A5A]">
                      {prop.cycle_length}-WAY SWAP · {prop.id}
                    </span>
                    <Stamp
                      label={prop.status.toUpperCase()}
                      variant={prop.status === 'executed' ? 'green' : 'red'}
                      size="sm"
                    />
                  </div>
                  <p className="mt-2 text-sm text-[#465078]">{prop.feasibility_summary}</p>
                  <ul className="mt-3 space-y-1 font-mono-code text-xs text-[#1F2A5A]">
                    {prop.cycle.map((step) => (
                      <li key={step.student_id}>
                        {step.student_name}: {step.from_room_label} → {step.to_room_label}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
        <SwapNoticeBoard
          requests={filteredRequests}
          proposals={filteredProposals}
          activeStudentId={currentStudentId}
          isAdmin={activeRole === 'ADMIN'}
          busyProposalId={busyProposalId}
          onRespondProposal={handleRespondProposal}
          onCancelRequest={handleCancelRequest}
        />
      )}

      {confirmState && (
        <ConfirmDialog
          open={confirmState.open}
          title={confirmState.title}
          description={confirmState.description}
          confirmLabel={confirmState.confirmLabel}
          tone={confirmState.tone}
          onCancel={() => setConfirmState(null)}
          onConfirm={async () => {
            const fn = confirmState.actionFn;
            setConfirmState(null);
            await fn();
          }}
        />
      )}
    </div>
  );
};

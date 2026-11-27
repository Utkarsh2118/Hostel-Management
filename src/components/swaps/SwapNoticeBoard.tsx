import React from 'react';
import type { SwapProposal, SwapRequest } from '../../../lib/types';
import { deterministicTilt } from '../../../lib/utils/prng';
import { Stamp } from '../ui/Stamp';

export interface EnrichedSwapRequest extends SwapRequest {
  student_name: string;
  student_code: string;
  student_gender: 'male' | 'female';
  student_year: number;
  current_room_label: string;
  current_room_meta: {
    floor: number;
    capacity: number;
    ac: boolean;
    tags: string[];
    block_name: string;
  } | null;
  wanted_room_labels: string[];
  wanted_block_name: string | null;
}

interface SwapNoticeBoardProps {
  requests: EnrichedSwapRequest[];
  proposals: SwapProposal[];
  activeStudentId: string | null;
  isAdmin: boolean;
  busyProposalId: string | null;
  onRespondProposal: (proposalId: string, action: 'accept' | 'reject') => void;
  onCancelRequest: (requestId: string) => void;
}

function formatExpiry(expiresAt: string): string {
  const diffMs = Date.parse(expiresAt) - Date.now();
  if (diffMs <= 0) return 'Expired';
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${mins}m remaining`;
}

export const SwapNoticeBoard: React.FC<SwapNoticeBoardProps> = ({
  requests,
  proposals,
  activeStudentId,
  isAdmin,
  busyProposalId,
  onRespondProposal,
  onCancelRequest,
}) => {
  const pendingProposals = proposals.filter((p) => p.status === 'pending');

  return (
    <div className="space-y-8">
      {/* Active Multi-Way & Two-Way Proposals with Hand-Drawn SVG Connecting Arrows */}
      {pendingProposals.length > 0 && (
        <section aria-labelledby="active-cycles-heading" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-[#1F2A5A] pb-2">
            <div>
              <h2 id="active-cycles-heading" className="font-display text-2xl text-[#1F2A5A]">
                Matched Swap Cycles Ready for Consent
              </h2>
              <p className="text-sm text-[#465078]">
                Every participant in a cycle must click Accept before rooms exchange atomically.
              </p>
            </div>
            <span className="font-hand text-base text-[#C2552D]">
              Sabki haan zaroori hai ↓
            </span>
          </div>

          <div className="space-y-6">
            {pendingProposals.map((proposal) => {
              const isParticipant = Boolean(
                activeStudentId &&
                  proposal.cycle.some((s) => s.student_id === activeStudentId)
              );
              const hasAccepted = Boolean(
                activeStudentId && proposal.acceptances[activeStudentId]
              );
              const acceptedCount = proposal.cycle.filter(
                (s) => proposal.acceptances[s.student_id]
              ).length;

              return (
                <article
                  key={proposal.id}
                  className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#1F2A5A]/25 pb-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono-code text-[#465078]">
                        <span className="font-bold text-[#1F2A5A]">
                          {proposal.cycle_length}-WAY SWAP CYCLE
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>ID {proposal.id}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Consent: {acceptedCount}/{proposal.cycle.length} accepted
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{formatExpiry(proposal.expires_at)}</span>
                      </div>
                      <p className="mt-1 text-sm text-[#1F2A5A] font-medium">
                        {proposal.feasibility_summary}
                      </p>
                    </div>

                    <Stamp label="PENDING CONSENT" variant="brick" size="sm" />
                  </div>

                  {/* Cycle Nodes Connected by Hand-Drawn SVG Arrows */}
                  <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
                    {proposal.cycle.map((step, idx) => {
                      const accepted = Boolean(proposal.acceptances[step.student_id]);
                      const isMe = step.student_id === activeStudentId;
                      return (
                        <div key={step.student_id} className="relative flex flex-col">
                          <div
                            className={[
                              'flex-1 border-2 border-[#1F2A5A] rounded-[2px] p-4',
                              isMe ? 'bg-[#FBE9A6]' : 'bg-[#F1E6CF]',
                            ].join(' ')}
                          >
                            <div className="flex items-center justify-between gap-2 text-xs font-mono-code">
                              <span className="font-bold text-[#1F2A5A]">
                                Step {idx + 1} of {proposal.cycle.length}
                              </span>
                              <span
                                className={
                                  accepted
                                    ? 'font-bold text-[#295234]'
                                    : 'font-bold text-[#B3261E]'
                                }
                              >
                                {accepted ? 'ACCEPTED' : 'AWAITING'}
                              </span>
                            </div>

                            <p className="mt-2 font-bold text-[#1F2A5A]">
                              {step.student_name} {isMe ? '(You)' : ''}
                            </p>
                            <p className="font-mono-code text-xs text-[#465078]">
                              {step.student_code}
                            </p>

                            <div className="mt-3 py-2 px-2.5 bg-[#F8F2E4] border border-[#1F2A5A] rounded-[2px] flex items-center justify-between gap-2 font-mono-code text-sm font-bold text-[#1F2A5A]">
                              <span>{step.from_room_label}</span>
                              {/* Hand-drawn arrow SVG */}
                              <svg
                                width="36"
                                height="14"
                                viewBox="0 0 36 14"
                                aria-hidden="true"
                                className="shrink-0 text-[#C2552D]"
                              >
                                <path
                                  d="M2 7 C 12 5, 22 9, 32 7 M26 2 L33 7 L26 12"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                              <span className="text-[#295234]">{step.to_room_label}</span>
                            </div>

                            <p className="mt-2 text-xs text-[#465078] leading-snug">
                              {step.reason}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Closed-Loop Cycle SVG Ribbon Summary */}
                  <div className="mt-4 px-3 py-2 bg-[#F1E6CF] border border-[#1F2A5A]/40 rounded-[2px] flex flex-wrap items-center gap-2 font-mono-code text-xs text-[#1F2A5A]">
                    <span className="font-bold">Closed Loop:</span>
                    {proposal.cycle.map((step, i) => (
                      <React.Fragment key={step.student_id}>
                        <span>
                          {step.student_name.split(' ')[0]} ({step.from_room_label})
                        </span>
                        <span aria-hidden="true" className="text-[#C2552D] font-bold">
                          →
                        </span>
                        {i === proposal.cycle.length - 1 && (
                          <span>{proposal.cycle[0].from_room_label} (cycle closes)</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>

                  {/* Explicit ACCEPT / REJECT Actions for Participant */}
                  <div className="mt-4 pt-3 border-t border-[#1F2A5A]/25 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-[#465078]">
                      {isParticipant
                        ? hasAccepted
                          ? 'You have accepted this swap cycle. Waiting for remaining participants.'
                          : 'Review your room change above, then accept or reject.'
                        : 'Viewing cycle status. Only participating students may accept or reject.'}
                    </div>

                    {isParticipant && (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          disabled={busyProposalId === proposal.id}
                          onClick={() => onRespondProposal(proposal.id, 'reject')}
                          className="px-4 py-2 text-sm font-bold text-[#B3261E] bg-[#F8F2E4] border-2 border-[#B3261E] rounded-[2px] hover:bg-[#B3261E] hover:text-[#F8F2E4] transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          REJECT SWAP
                        </button>
                        <button
                          type="button"
                          disabled={busyProposalId === proposal.id || hasAccepted}
                          onClick={() => onRespondProposal(proposal.id, 'accept')}
                          className="px-4 py-2 text-sm font-bold text-[#F8F2E4] bg-[#295234] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#1f3f28] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {busyProposalId === proposal.id
                            ? 'Updating...'
                            : hasAccepted
                              ? 'ACCEPTED ✓'
                              : 'ACCEPT SWAP'}
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Irregular Pinned Notice-Board Grid for Individual Swap Chits */}
      <section aria-labelledby="swap-chits-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-[#1F2A5A] pb-2 mb-5">
          <h2 id="swap-chits-heading" className="font-display text-2xl text-[#1F2A5A]">
            Pinned Room-Exchange Chits
          </h2>
          <span className="font-mono-code text-xs text-[#465078]">
            {requests.length} notice(s) on board
          </span>
        </div>

        {requests.length === 0 ? (
          <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] p-8 text-center">
            <p className="font-hand text-xl text-[#1F2A5A]">
              Abhi koi swap request nahi hai. Pehla chit tum laga do.
            </p>
            <p className="mt-1 text-sm text-[#465078]">
              Use the &ldquo;Pin a Swap Chit&rdquo; form above to list what room features you are looking for.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {requests.map((req) => {
              // Deterministic slight tilt from request ID (never random on render)
              const tilt = deterministicTilt(req.id, 1.3);
              const isMine = req.student_id === activeStudentId;
              const canCancel =
                (isMine || isAdmin) &&
                (req.status === 'open' || req.status === 'matched');

              const criteriaBits: string[] = [];
              if (req.wanted_room_labels.length > 0) {
                criteriaBits.push(`Target: ${req.wanted_room_labels.join(', ')}`);
              }
              if (req.wanted_block_name) criteriaBits.push(req.wanted_block_name);
              if (req.wanted_criteria.floor_min || req.wanted_criteria.floor_max) {
                criteriaBits.push(
                  `Floor ${req.wanted_criteria.floor_min ?? 1}–${req.wanted_criteria.floor_max ?? 4}`
                );
              }
              if (req.wanted_criteria.ac !== undefined) {
                criteriaBits.push(req.wanted_criteria.ac ? 'AC required' : 'Non-AC');
              }
              if (req.wanted_criteria.capacity) {
                criteriaBits.push(`${req.wanted_criteria.capacity}-seater`);
              }
              if (req.wanted_criteria.required_tags?.length) {
                criteriaBits.push(req.wanted_criteria.required_tags.join(', '));
              }

              return (
                <article
                  key={req.id}
                  style={{ transform: `rotate(${tilt}deg)` }}
                  className={[
                    'relative border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 flex flex-col justify-between transition-transform duration-150 hover:rotate-0',
                    isMine ? 'bg-[#FBE9A6]' : 'bg-[#F8F2E4]',
                  ].join(' ')}
                >
                  {/* Subtle tape strip at top center */}
                  <div
                    aria-hidden="true"
                    className="tape-strip w-16 h-3.5 absolute -top-2 left-1/2 -translate-x-1/2"
                  />

                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-base text-[#1F2A5A]">
                          {req.student_name} {isMine ? '(You)' : ''}
                        </p>
                        <p className="font-mono-code text-xs text-[#465078]">
                          {req.student_code} · Year {req.student_year} ·{' '}
                          {req.student_gender === 'male' ? 'Boys' : 'Girls'}
                        </p>
                      </div>
                      <span className="font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] border border-[#1F2A5A] px-1.5 py-0.5 bg-[#F1E6CF]">
                        {req.status}
                      </span>
                    </div>

                    <div className="mt-4 pt-3 border-t border-[#1F2A5A]/25 space-y-2 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs text-[#465078]">Currently in</span>
                        <span className="font-mono-code font-bold text-[#1F2A5A]">
                          {req.current_room_label}
                          {req.current_room_meta
                            ? ` (${req.current_room_meta.ac ? 'AC' : 'Non-AC'}, ${req.current_room_meta.capacity}-bed)`
                            : ''}
                        </span>
                      </div>

                      <div>
                        <span className="text-xs text-[#465078] block">Looking for</span>
                        <p className="font-mono-code text-xs font-bold text-[#295234] mt-0.5">
                          {criteriaBits.join(' · ') || 'Open criteria'}
                        </p>
                      </div>

                      {req.wanted_criteria.note && (
                        <p className="text-sm text-[#1F2A5A] pt-1 leading-snug">
                          &ldquo;{req.wanted_criteria.note}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-[#1F2A5A]/20 flex items-center justify-between gap-2 text-xs text-[#465078]">
                    <span className="font-mono-code">
                      Posted {new Date(req.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </span>
                    {canCancel && (
                      <button
                        type="button"
                        onClick={() => onCancelRequest(req.id)}
                        className="font-semibold text-[#B3261E] hover:underline whitespace-nowrap"
                      >
                        Remove chit
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

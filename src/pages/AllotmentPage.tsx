import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { AllotmentRun } from '../../lib/types';
import type { StudentWorkspaceResponse } from './StudentDashboardPage';
import { AllotmentRegister } from '../components/allotment/AllotmentRegister';
import { Stamp } from '../components/ui/Stamp';

interface AllotmentPageProps {
  activeStudentId: string;
  onNavigate: (path: string) => void;
}

export const AllotmentPage: React.FC<AllotmentPageProps> = ({
  activeStudentId,
  onNavigate,
}) => {
  const [workspace, setWorkspace] = useState<StudentWorkspaceResponse | null>(null);
  const [runs, setRuns] = useState<AllotmentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      apiFetch<StudentWorkspaceResponse>('/api/students/me'),
      apiFetch<{ runs: AllotmentRun[] }>('/api/allotment/runs'),
    ])
      .then(([ws, runData]) => {
        if (!active) return;
        setWorkspace(ws);
        setRuns(runData.runs);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load allotment data.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeStudentId]);

  if (loading && !workspace) {
    return (
      <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
        Fetching official allotment slip and register...
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="p-5 bg-[#F8F2E4] border-2 border-[#B3261E] text-sm text-[#B3261E]">
        {error ?? 'Allotment information unavailable.'}
      </div>
    );
  }

  const { student, allotted_room, roommates, allotment_record, unallotted_record, active_run } =
    workspace;
  const officialRun = runs.find((r) => r.applied) ?? runs[0] ?? null;

  return (
    <div className="space-y-8">
      <header className="border-b-2 border-[#1F2A5A] pb-5">
        <p className="font-mono-code text-xs text-[#465078]">
          OFFICIAL ALLOTMENT SLIP &amp; VERIFIED REGISTER
        </p>
        <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] mt-1">
          Hostel Allotment Result
        </h1>
      </header>

      {/* Formal Paper Allotment Slip */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#1F2A5A] pb-5">
          <div>
            <p className="font-mono-code text-xs text-[#465078]">
              VIDYAVIHAR UNIVERSITY · ALLOTMENT SLIP ·{' '}
              {active_run
                ? new Date(active_run.created_at).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })
                : '—'}
            </p>
            <h2 className="text-2xl font-bold text-[#1F2A5A] mt-1">
              {student.name}{' '}
              <span className="font-mono-code text-base font-normal text-[#465078]">
                ({student.student_code})
              </span>
            </h2>
            <p className="text-sm text-[#465078] mt-0.5">
              Year {student.year} · {student.branch} · Run Seed:{' '}
              <span className="font-mono-code text-[#1F2A5A] font-bold">
                {active_run?.seed ?? '—'}
              </span>
            </p>
          </div>
          <Stamp
            label={allotted_room ? 'ALLOTTED' : 'UNALLOTTED'}
            variant={allotted_room ? 'green' : 'red'}
            animate
          />
        </div>

        {allotted_room ? (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <dl className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div className="bg-[#F1E6CF] border border-[#1F2A5A]/40 p-3">
                <dt className="text-xs text-[#465078]">Allotted Block</dt>
                <dd className="font-bold text-[#1F2A5A] mt-0.5">{allotted_room.block_name}</dd>
              </div>
              <div className="bg-[#F1E6CF] border border-[#1F2A5A]/40 p-3">
                <dt className="text-xs text-[#465078]">Floor</dt>
                <dd className="font-mono-code font-bold text-[#1F2A5A] mt-0.5">
                  Floor {allotted_room.floor}
                </dd>
              </div>
              <div className="bg-[#FBE9A6] border-2 border-[#1F2A5A] p-3">
                <dt className="text-xs text-[#465078]">Room Number</dt>
                <dd className="font-mono-code text-lg font-bold text-[#1F2A5A] mt-0.5">
                  {allotted_room.block_code}-{allotted_room.number}
                </dd>
              </div>
              <div className="bg-[#F1E6CF] border border-[#1F2A5A]/40 p-3">
                <dt className="text-xs text-[#465078]">Preference Rank</dt>
                <dd className="font-mono-code font-bold text-[#295234] mt-0.5">
                  {allotment_record?.preference_rank
                    ? `Choice #${allotment_record.preference_rank}`
                    : 'Swap / Paired'}
                </dd>
              </div>
              <div className="bg-[#F1E6CF] border border-[#1F2A5A]/40 p-3">
                <dt className="text-xs text-[#465078]">Priority Score</dt>
                <dd className="font-mono-code font-bold text-[#1F2A5A] mt-0.5">
                  {allotment_record?.priority_score ?? '—'}
                </dd>
              </div>
              <div className="bg-[#F1E6CF] border border-[#1F2A5A]/40 p-3">
                <dt className="text-xs text-[#465078]">Room Type</dt>
                <dd className="font-semibold text-[#1F2A5A] mt-0.5">
                  {allotted_room.capacity}-bed · {allotted_room.ac ? 'AC' : 'Non-AC'}
                </dd>
              </div>
            </dl>

            <div className="lg:col-span-5 space-y-4">
              <div className="bg-[#F1E6CF] border border-[#1F2A5A]/40 p-4">
                <h3 className="font-mono-code text-xs font-bold text-[#465078] uppercase">
                  Allotment Explanation
                </h3>
                <p className="mt-1.5 text-sm text-[#1F2A5A] leading-relaxed">
                  {allotment_record?.explanation ??
                    'Room assigned via verified room swap or official run.'}
                </p>
              </div>

              <div className="bg-[#F1E6CF] border border-[#1F2A5A]/40 p-4">
                <h3 className="font-mono-code text-xs font-bold text-[#465078] uppercase">
                  Assigned Roommates ({roommates.length})
                </h3>
                {roommates.length === 0 ? (
                  <p className="mt-1 text-xs text-[#465078]">
                    {allotted_room.capacity === 1
                      ? 'Single-occupancy room.'
                      : 'No other resident currently occupies the remaining bed(s).'}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {roommates.map((rm) => (
                      <li key={rm.id} className="flex items-baseline justify-between gap-2">
                        <span className="font-bold text-[#1F2A5A]">{rm.name}</span>
                        <span className="font-mono-code text-xs text-[#465078]">
                          Yr {rm.year} · {rm.branch}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="p-4 bg-[#F1E6CF] border-2 border-[#B3261E] rounded-[2px]">
              <h3 className="font-bold text-[#B3261E]">Reason for Non-Allotment</h3>
              <p className="mt-1 text-sm text-[#1F2A5A]">
                {unallotted_record?.reason ??
                  'No room was allotted in the active run. Review your submitted preferences or contact the Block Warden.'}
              </p>
              {unallotted_record && (
                <p className="mt-2 font-mono-code text-xs text-[#465078]">
                  Recorded Priority Score: {unallotted_record.priority_score}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onNavigate('/student/profile')}
                className="px-4 py-2 text-sm font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                Revise 5 Ranked Preferences
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/rooms')}
                className="px-4 py-2 text-sm font-bold text-[#1F2A5A] bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                Inspect Open Rooms on Blueprint
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Formal Administrative Allotment Register */}
      {officialRun && (
        <AllotmentRegister
          title={officialRun.label}
          seed={officialRun.seed}
          entries={officialRun.results}
          highlightStudentId={student.id}
        />
      )}
    </div>
  );
};

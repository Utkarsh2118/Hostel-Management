import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { RoommateMatch } from '../../lib/types';

interface RoommatesResponse {
  student_preferences: {
    sleep_schedule: string;
    study_style: string;
    cleanliness: number;
    about_me: string;
    roommate_requests: string[];
  };
  matches: Array<RoommateMatch & { room_label: string }>;
  disclaimer: string;
}

interface RoommatesPageProps {
  activeStudentId: string;
  onNavigate: (path: string) => void;
  onToast: (tone: 'success' | 'error' | 'info', text: string) => void;
}

export const RoommatesPage: React.FC<RoommatesPageProps> = ({
  activeStudentId,
  onNavigate,
  onToast,
}) => {
  const [data, setData] = useState<RoommatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadMatches = () => {
    setLoading(true);
    apiFetch<RoommatesResponse>('/api/roommates/matches')
      .then((res) => setData(res))
      .catch((err) =>
        onToast('error', err instanceof Error ? err.message : 'Unable to load roommate matches.')
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadMatches();
  }, [activeStudentId]);

  const handleToggleRequest = async (targetId: string) => {
    setBusyId(targetId);
    try {
      const res = await apiFetch<{ message: string }>('/api/roommates/request', {
        method: 'POST',
        body: JSON.stringify({ target_student_id: targetId }),
      });
      onToast('success', res.message);
      loadMatches();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Could not update roommate request.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-7">
      <header className="border-b-2 border-[#1F2A5A] pb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="font-mono-code text-xs text-[#465078]">
            DETERMINISTIC HABIT ALIGNMENT · TOP 5 SAME-BLOCK CANDIDATES
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] mt-1">
            Roommate Finder
          </h1>
          <p className="mt-1.5 text-sm text-[#465078]">
            {data?.disclaimer ??
              'Scores are deterministic rule-based estimates based on sleep schedule, study style, and cleanliness—not a guaranteed prediction.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('/student/profile')}
          className="px-4 py-2 text-xs font-bold text-[#1F2A5A] bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6] whitespace-nowrap"
        >
          Update My Living Habits
        </button>
      </header>

      {/* Your Active Habit Baseline */}
      {data && (
        <div className="bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs font-mono-code text-[#1F2A5A]">
          <span>
            Your Baseline: Sleep <strong>{data.student_preferences.sleep_schedule}</strong> ·
            Study <strong>{data.student_preferences.study_style}</strong> · Cleanliness{' '}
            <strong>{data.student_preferences.cleanliness}/5</strong>
          </span>
          <span className="text-[#465078]">
            Active Requests: {data.student_preferences.roommate_requests.length} / 3
          </span>
        </div>
      )}

      {loading && !data ? (
        <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
          Computing habit compatibility scores...
        </div>
      ) : (
        <div className="space-y-5">
          {(data?.matches ?? []).map((match, idx) => (
            <article
              key={match.student.id}
              className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center"
            >
              {/* Rank & Identity (5 cols) */}
              <div className="lg:col-span-5">
                <div className="flex items-baseline gap-2.5">
                  <span className="font-mono-code text-xs font-bold text-[#C2552D]">
                    MATCH #{idx + 1}
                  </span>
                  <span className="font-mono-code text-xs text-[#465078]">
                    {match.student.student_code} · Current: {match.room_label}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-[#1F2A5A] mt-1">
                  {match.student.name}
                </h2>
                <p className="text-sm text-[#465078]">
                  Year {match.student.year} · {match.student.branch}
                </p>
                {match.student.about_me && (
                  <p className="mt-2.5 text-sm text-[#1F2A5A] bg-[#F1E6CF] border border-[#1F2A5A]/25 px-3 py-2 leading-snug">
                    &ldquo;{match.student.about_me}&rdquo;
                  </p>
                )}
              </div>

              {/* Transparent Breakdown (4 cols) */}
              <div className="lg:col-span-4 space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-bold text-[#465078]">Rule-Based Score</span>
                  <span className="font-mono-code text-2xl font-bold text-[#295234]">
                    {match.score}%
                  </span>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-center font-mono-code text-xs">
                  <div className="bg-[#F1E6CF] border border-[#1F2A5A]/30 p-2">
                    <dt className="text-[10px] text-[#465078]">SLEEP</dt>
                    <dd className="font-bold text-[#1F2A5A] mt-0.5">
                      {match.breakdown.sleep}/35
                    </dd>
                  </div>
                  <div className="bg-[#F1E6CF] border border-[#1F2A5A]/30 p-2">
                    <dt className="text-[10px] text-[#465078]">STUDY</dt>
                    <dd className="font-bold text-[#1F2A5A] mt-0.5">
                      {match.breakdown.study}/30
                    </dd>
                  </div>
                  <div className="bg-[#F1E6CF] border border-[#1F2A5A]/30 p-2">
                    <dt className="text-[10px] text-[#465078]">CLEAN</dt>
                    <dd className="font-bold text-[#1F2A5A] mt-0.5">
                      {match.breakdown.cleanliness}/35
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-[#465078] leading-snug">{match.explanation}</p>
              </div>

              {/* Request Action (3 cols) */}
              <div className="lg:col-span-3 flex flex-col items-stretch lg:items-end gap-2">
                {match.is_mutual_request && (
                  <span className="font-mono-code text-xs font-bold text-[#295234]">
                    MUTUAL MATCH CONFIRMED
                  </span>
                )}
                {!match.is_mutual_request && match.requested_me && (
                  <span className="font-mono-code text-xs font-bold text-[#C2552D]">
                    REQUESTED YOU
                  </span>
                )}

                <button
                  type="button"
                  disabled={busyId === match.student.id}
                  onClick={() => handleToggleRequest(match.student.id)}
                  className={[
                    'px-4 py-2.5 text-xs font-bold border-2 border-[#1F2A5A] rounded-[2px] whitespace-nowrap transition-colors disabled:opacity-50',
                    match.requested_by_me
                      ? 'bg-[#FBE9A6] text-[#1F2A5A] hover:bg-[#E6D7B8]'
                      : 'bg-[#C2552D] text-[#F8F2E4] shadow-ink-sm hover:bg-[#A64420]',
                  ].join(' ')}
                >
                  {busyId === match.student.id
                    ? 'Saving...'
                    : match.requested_by_me
                      ? 'Withdraw Request'
                      : match.requested_me
                        ? 'Accept Mutual Request'
                        : 'Request Roommate'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

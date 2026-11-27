import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { CgpaBand, Gender, SleepSchedule, Student, StudyStyle } from '../../lib/types';
import type { StudentWorkspaceResponse } from './StudentDashboardPage';

interface StudentProfilePageProps {
  activeStudentId: string;
  onToast: (tone: 'success' | 'error' | 'info', text: string) => void;
  onProfileSaved: () => void;
}

const BRANCHES = [
  'Computer Science',
  'Electrical Engineering',
  'Mechanical Engineering',
  'Electronics & Comm.',
  'Civil Engineering',
  'Mathematics & Computing',
  'Chemical Engineering',
  'Biotechnology',
];

export const StudentProfilePage: React.FC<StudentProfilePageProps> = ({
  activeStudentId,
  onToast,
  onProfileSaved,
}) => {
  const [workspace, setWorkspace] = useState<StudentWorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [year, setYear] = useState<1 | 2 | 3 | 4>(3);
  const [branch, setBranch] = useState('Computer Science');
  const [gender, setGender] = useState<Gender>('male');
  const [cgpaBand, setCgpaBand] = useState<CgpaBand>('A');
  const [sleepSchedule, setSleepSchedule] = useState<SleepSchedule>('late');
  const [studyStyle, setStudyStyle] = useState<StudyStyle>('quiet');
  const [cleanliness, setCleanliness] = useState<1 | 2 | 3 | 4 | 5>(4);
  const [aboutMe, setAboutMe] = useState('');
  const [preferences, setPreferences] = useState<string[]>([]);
  const [roomSearch, setRoomSearch] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch<StudentWorkspaceResponse>('/api/students/me')
      .then((res) => {
        if (!active) return;
        setWorkspace(res);
        const s = res.student;
        setName(s.name);
        setYear(s.year);
        setBranch(s.branch);
        setGender(s.gender);
        setCgpaBand(s.cgpa_band);
        setSleepSchedule(s.sleep_schedule);
        setStudyStyle(s.study_style);
        setCleanliness(s.cleanliness);
        setAboutMe(s.about_me);
        setPreferences(s.preferences);
      })
      .catch((err) => {
        if (active) setFormError(err instanceof Error ? err.message : 'Unable to load profile.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeStudentId]);

  const eligibleRoomMap = useMemo(() => {
    const map = new Map<string, StudentWorkspaceResponse['eligible_rooms'][number]>();
    for (const r of workspace?.eligible_rooms ?? []) {
      map.set(r.id, r);
    }
    return map;
  }, [workspace]);

  const filteredCatalogRooms = useMemo(() => {
    const list = workspace?.eligible_rooms ?? [];
    const q = roomSearch.trim().toLowerCase();
    return list
      .filter((r) => !preferences.includes(r.id))
      .filter((r) => {
        if (!q) return true;
        return (
          `${r.block_code}-${r.number}`.toLowerCase().includes(q) ||
          r.block_name.toLowerCase().includes(q) ||
          r.tags.some((t) => t.includes(q)) ||
          (q === 'ac' && r.ac)
        );
      })
      .slice(0, 18);
  }, [workspace, preferences, roomSearch]);

  const addPreference = (roomId: string) => {
    if (preferences.length >= 5) {
      onToast('info', 'You can rank at most 5 rooms. Remove one to add another.');
      return;
    }
    if (preferences.includes(roomId)) return;
    setPreferences((prev) => [...prev, roomId]);
  };

  const removePreference = (roomId: string) => {
    setPreferences((prev) => prev.filter((id) => id !== roomId));
  };

  const movePreference = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= preferences.length) return;
    setPreferences((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (name.trim().length < 2) {
      setFormError('Full name must be at least 2 characters.');
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch<{ student: Student; message: string }>('/api/students/me', {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim(),
          year,
          branch,
          gender,
          cgpa_band: cgpaBand,
          sleep_schedule: sleepSchedule,
          study_style: studyStyle,
          cleanliness,
          about_me: aboutMe.trim(),
          preferences,
        }),
      });
      onToast('success', res.message);
      onProfileSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to save profile.';
      setFormError(msg);
      onToast('error', msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !workspace) {
    return (
      <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
        Loading student profile form...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="border-b-2 border-[#1F2A5A] pb-5">
        <p className="font-mono-code text-xs text-[#465078]">
          STUDENT FOLIO &amp; RANKED CHOICE SUBMISSION · {workspace?.student.student_code}
        </p>
        <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] mt-1">
          Profile &amp; Room Preferences
        </h1>
        <p className="mt-1 text-sm text-[#465078] max-w-2xl">
          Update your living habits for roommate matching and submit up to five ranked rooms for
          the next deterministic allotment run.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        {/* Left: Personal & Lifestyle Form (6 cols) */}
        <section className="lg:col-span-6 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-6 space-y-5">
          <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/25 pb-2">
            1. Student Particulars &amp; Living Style
          </h2>

          {formError && (
            <div className="p-3 bg-[#F1E6CF] border-2 border-[#B3261E] text-sm text-[#B3261E]">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block sm:col-span-2">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Full Name *</span>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Student ID</span>
              <input
                type="text"
                readOnly
                value={workspace?.student.student_code ?? ''}
                className="w-full px-3 py-2 text-sm font-mono-code bg-[#E6D7B8] border-2 border-[#1F2A5A]/60 rounded-[2px] text-[#465078]"
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Academic Year *</span>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value) as 1 | 2 | 3 | 4)}
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                <option value={1}>1st Year</option>
                <option value={2}>2nd Year</option>
                <option value={3}>3rd Year</option>
                <option value={4}>4th Year (Senior)</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Branch *</span>
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                {BRANCHES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                Hostel Eligibility Gender *
              </span>
              <select
                value={gender}
                onChange={(e) => {
                  const next = e.target.value as Gender;
                  setGender(next);
                  // Clear incompatible preferences when gender changes
                  setPreferences([]);
                }}
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                <option value="male">Male (Boys Bhavans)</option>
                <option value="female">Female (Girls Bhavans)</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">CGPA Merit Band</span>
              <select
                value={cgpaBand}
                onChange={(e) => setCgpaBand(e.target.value as CgpaBand)}
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                <option value="A+">A+ (9.0+)</option>
                <option value="A">A (8.0–8.9)</option>
                <option value="B+">B+ (7.0–7.9)</option>
                <option value="B">B (6.0–6.9)</option>
                <option value="C">C (&lt; 6.0)</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Sleep Schedule *</span>
              <select
                value={sleepSchedule}
                onChange={(e) => setSleepSchedule(e.target.value as SleepSchedule)}
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                <option value="early">Early Sleeper (before 11:30 PM)</option>
                <option value="late">Late Owl (after midnight)</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Study Style *</span>
              <select
                value={studyStyle}
                onChange={(e) => setStudyStyle(e.target.value as StudyStyle)}
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                <option value="quiet">Quiet Independent Study</option>
                <option value="group">Group Discussion &amp; Study</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                Cleanliness Preference (1–5) *
              </span>
              <select
                value={cleanliness}
                onChange={(e) => setCleanliness(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                <option value={1}>1 — Relaxed</option>
                <option value={2}>2 — Casual</option>
                <option value={3}>3 — Moderate</option>
                <option value={4}>4 — Neat &amp; Organized</option>
                <option value={5}>5 — Spotless Daily</option>
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                Short About-Me Note (optional, used locally for roommate matching)
              </span>
              <textarea
                rows={3}
                maxLength={280}
                value={aboutMe}
                onChange={(e) => setAboutMe(e.target.value)}
                placeholder="Share hobbies, routines, or study habits for prospective roommates..."
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              />
              <span className="font-mono-code text-[11px] text-[#465078]">
                {aboutMe.length}/280 characters
              </span>
            </label>
          </div>
        </section>

        {/* Right: Ranked Room Preferences Builder (6 cols) */}
        <section className="lg:col-span-6 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-6 space-y-5">
          <div className="border-b border-[#1F2A5A]/25 pb-2">
            <h2 className="font-display text-2xl text-[#1F2A5A]">
              2. Ranked Room Choices ({preferences.length} / 5)
            </h2>
            <p className="text-xs text-[#465078] mt-1 leading-relaxed">
              <strong>How ranking works:</strong> During Serial Dictatorship, when your priority
              turn arrives, the engine checks Choice #1 first, then #2 through #5, assigning you to
              the highest-ranked room that still has an open bed. Always list your genuine top
              preference first.
            </p>
          </div>

          {/* Ranked Preference List */}
          <div className="space-y-2.5">
            {preferences.length === 0 ? (
              <div className="p-4 bg-[#F1E6CF] border border-dashed border-[#1F2A5A] text-sm text-[#465078]">
                No room choices ranked yet. Select up to 5 eligible rooms from the catalog below.
              </div>
            ) : (
              preferences.map((roomId, index) => {
                const room = eligibleRoomMap.get(roomId);
                return (
                  <div
                    key={roomId}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-[#FBE9A6] border-2 border-[#1F2A5A] rounded-[2px]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono-code text-sm font-bold text-[#C2552D] shrink-0">
                        #{index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-mono-code text-sm font-bold text-[#1F2A5A] truncate">
                          {room ? `${room.block_code}-${room.number} (${room.block_name})` : roomId}
                        </p>
                        {room && (
                          <p className="text-xs text-[#465078]">
                            Floor {room.floor} · {room.capacity}-seater · {room.ac ? 'AC' : 'Non-AC'}
                            {room.tags.length > 0 ? ` · ${room.tags.join(', ')}` : ''}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        aria-label={`Move choice ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => movePreference(index, -1)}
                        className="p-1.5 bg-[#F8F2E4] border border-[#1F2A5A] rounded-[2px] disabled:opacity-35"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move choice ${index + 1} down`}
                        disabled={index === preferences.length - 1}
                        onClick={() => movePreference(index, 1)}
                        className="p-1.5 bg-[#F8F2E4] border border-[#1F2A5A] rounded-[2px] disabled:opacity-35"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove choice ${index + 1}`}
                        onClick={() => removePreference(roomId)}
                        className="p-1.5 bg-[#F8F2E4] border border-[#B3261E] text-[#B3261E] rounded-[2px]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Eligible Room Picker */}
          <div className="pt-3 border-t border-[#1F2A5A]/25 space-y-2.5">
            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                Add Eligible Room to Preference List
              </span>
              <input
                type="search"
                value={roomSearch}
                onChange={(e) => setRoomSearch(e.target.value)}
                placeholder="Filter by room no., block (NB/VB/KB/NM), ac, quiet..."
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              />
            </label>

            <div className="max-h-56 overflow-y-auto border border-[#1F2A5A]/40 divide-y divide-[#1F2A5A]/15 bg-[#F1E6CF]/60">
              {filteredCatalogRooms.map((room) => (
                <div
                  key={room.id}
                  className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <span className="font-mono-code font-bold text-[#1F2A5A]">
                      {room.block_code}-{room.number}
                    </span>{' '}
                    <span className="text-[#465078]">
                      · Fl {room.floor} · {room.capacity}-bed · {room.ac ? 'AC' : 'Non-AC'}
                      {room.tags.length > 0 ? ` · ${room.tags.join(', ')}` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={preferences.length >= 5}
                    onClick={() => addPreference(room.id)}
                    className="px-2.5 py-1 font-bold text-[#1F2A5A] bg-[#F8F2E4] border border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6] disabled:opacity-40 inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    <Plus className="w-3 h-3" /> Add
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t-2 border-[#1F2A5A] flex items-center justify-between gap-3">
            <span className="text-xs text-[#465078]">
              Changes apply immediately to your profile and next allotment run.
            </span>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 text-sm font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-50 whitespace-nowrap"
            >
              {saving ? 'Saving...' : 'Save Profile & Choices'}
            </button>
          </div>
        </section>
      </form>
    </div>
  );
};

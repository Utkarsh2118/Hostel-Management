import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { Stamp } from '../components/ui/Stamp';

interface RegisterPageProps {
  onNavigate: (path: string) => void;
  onToast: (tone: 'success' | 'error' | 'info', text: string) => void;
}

const BRANCHES = [
  'Computer Science',
  'Electronics & Comm.',
  'Mechanical Engg.',
  'Civil Engg.',
  'Electrical Engg.',
  'Mathematics & Computing',
];

export const RegisterPage: React.FC<RegisterPageProps> = ({ onNavigate, onToast }) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [year, setYear] = useState<1 | 2 | 3 | 4>(2);
  const [branch, setBranch] = useState(BRANCHES[0]);
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Step 2: Email verification token confirmation
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [verifyToken, setVerifyToken] = useState('');
  const [devTokenHint, setDevTokenHint] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifiedDone, setVerifiedDone] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<{
        message: string;
        email: string;
        devVerificationToken?: string;
      }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim(),
          student_code: studentCode.trim().toUpperCase(),
          password,
          year,
          branch,
          gender,
        }),
      });
      setRegisteredEmail(res.email);
      if (res.devVerificationToken) {
        setDevTokenHint(res.devVerificationToken);
        setVerifyToken(res.devVerificationToken);
      }
      onToast('success', res.message);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to register student account.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setVerifying(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: verifyToken.trim() }),
      });
      setVerifiedDone(true);
      onToast('success', res.message);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Email verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header className="border-b-2 border-[#1F2A5A] pb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => onNavigate('/login')}
            className="inline-flex items-center gap-1 text-xs font-bold text-[#465078] hover:text-[#1F2A5A] mb-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            Back to Sign In
          </button>
          <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A]">
            Student Account Registration
          </h1>
          <p className="text-xs text-[#465078] mt-1">
            Public registration issues the <strong className="font-mono-code">STUDENT</strong> role
            server-side only. Warden and Admin accounts cannot be self-registered.
          </p>
        </div>
        <Stamp label="STUDENT ONLY" variant="green" size="sm" />
      </header>

      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 bg-[#F8F2E4] border-2 border-[#B3261E] text-xs font-bold text-[#B3261E]"
        >
          {errorMsg}
        </div>
      )}

      {verifiedDone ? (
        <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-7 space-y-4">
          <div className="flex items-center gap-2 text-[#295234]">
            <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
            <h2 className="font-display text-2xl text-[#1F2A5A]">University Email Verified</h2>
          </div>
          <p className="text-sm text-[#1F2A5A]">
            Your student account (<strong>{registeredEmail}</strong>) is now active with role{' '}
            <span className="font-mono-code font-bold">STUDENT</span>. Sign in via Student Login to
            submit ranked room preferences and inspect the Bhavan floor blueprints.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('/login')}
            className="px-5 py-2.5 text-sm font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420]"
          >
            Proceed to Student Login →
          </button>
        </section>
      ) : registeredEmail ? (
        <form
          onSubmit={handleVerifyEmail}
          className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-6 space-y-4"
        >
          <h2 className="font-display text-2xl text-[#1F2A5A]">Verify University Email</h2>
          <p className="text-sm text-[#465078]">
            Enter the single-use verification token sent to{' '}
            <strong className="text-[#1F2A5A]">{registeredEmail}</strong> to activate your Student
            account.
          </p>

          {devTokenHint && (
            <div className="p-3 bg-[#FBE9A6] border border-[#1F2A5A] text-xs font-mono-code text-[#1F2A5A]">
              Local Dev Preview Token (no SMTP attached): <strong>{devTokenHint}</strong>
            </div>
          )}

          <label className="block">
            <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
              Email Verification Token *
            </span>
            <input
              type="text"
              required
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
              className="w-full px-3 py-2 font-mono-code text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
            />
          </label>

          <button
            type="submit"
            disabled={verifying}
            className="px-5 py-2.5 text-sm font-bold text-[#F8F2E4] bg-[#295234] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm disabled:opacity-50"
          >
            {verifying ? 'Verifying...' : 'Verify Email & Activate Student Account'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={handleRegister}
          className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-6 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Full Name *</span>
              <input
                type="text"
                required
                minLength={2}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g., Meera Deshmukh"
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                University Student ID *
              </span>
              <input
                type="text"
                required
                value={studentCode}
                onChange={(e) => setStudentCode(e.target.value.toUpperCase())}
                placeholder="VV2026CS401"
                className="w-full px-3 py-2 font-mono-code text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
              University Email (@univ.edu.in) *
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="meera.deshmukh@univ.edu.in"
              className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Year *</span>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value) as 1 | 2 | 3 | 4)}
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                <option value={1}>1st Year</option>
                <option value={2}>2nd Year</option>
                <option value={3}>3rd Year</option>
                <option value={4}>4th Year</option>
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
                Hostel Wing Eligibility *
              </span>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as 'male' | 'female')}
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                <option value="male">Male (Boys Bhavans)</option>
                <option value="female">Female (Girls Bhavans)</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                Password (min 10 chars, Aa1) *
              </span>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 pr-9 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#465078] p-1"
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                Confirm Password *
              </span>
              <input
                type={showPwd ? 'text' : 'password'}
                required
                minLength={10}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              />
            </label>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-[#465078]">
              Role assigned automatically on server: <strong className="font-mono-code">STUDENT</strong>
            </span>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 text-sm font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420] disabled:opacity-50"
            >
              {submitting ? 'Registering...' : 'Create Student Account'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

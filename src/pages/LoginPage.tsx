import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  Lock,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { ApiError, apiFetch } from '../lib/api';
import type { Role } from '../../lib/auth/roles';
import type { SessionUser } from '../../lib/types';
import { Stamp } from '../components/ui/Stamp';

interface SetupStatusResponse {
  needsInitialSetup: boolean;
  supabaseConfigured: boolean;
  allowedEmailDomain: string;
}

interface LoginSuccessResponse {
  user: SessionUser;
  redirectTo: string;
  message: string;
  mfaRequired?: boolean;
  error?: string;
}

interface LoginPageProps {
  initialPortal?: Role | null;
  sessionExpired?: boolean;
  onLoginSuccess: (user: SessionUser, redirectTo: string) => void;
  onNavigate: (path: string) => void;
  onToast: (tone: 'success' | 'error' | 'info', text: string) => void;
}

const PORTAL_CARDS: Array<{
  role: Role;
  code: string;
  title: string;
  subtitle: string;
  identifierLabel: string;
  identifierPlaceholder: string;
  accountHint: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    role: 'STUDENT',
    code: 'PORTAL 01',
    title: 'Student Login',
    subtitle: 'Preferences, room allotment slip, floor blueprints, swap board & roommate matches.',
    identifierLabel: 'University Email or Student ID',
    identifierPlaceholder: 'student.demo@hostelhub.local or VV2024CO101',
    accountHint: 'Demo student email: student.demo@hostelhub.local (or ID VV2024CO101)',
    icon: GraduationCap,
  },
  {
    role: 'WARDEN',
    code: 'PORTAL 02',
    title: 'Warden Login',
    subtitle: 'Assigned Bhavan occupancy, room maintenance, swap oversight, complaints & notices.',
    identifierLabel: 'Official Warden Email',
    identifierPlaceholder: 'warden.demo@hostelhub.local',
    accountHint: 'Demo warden email: warden.demo@hostelhub.local (Nilgiri & Kaveri Bhavans)',
    icon: Building2,
  },
  {
    role: 'MAINTENANCE_STAFF',
    code: 'PORTAL 03',
    title: 'Maintenance Login',
    subtitle: 'Assigned work orders, ticket progress notes, parts requisition & completion logs.',
    identifierLabel: 'Official Maintenance Staff Email',
    identifierPlaceholder: 'maintenance.demo@hostelhub.local',
    accountHint: 'Demo technician email: maintenance.demo@hostelhub.local (Nilgiri & Kaveri)',
    icon: Wrench,
  },
  {
    role: 'ADMIN',
    code: 'PORTAL 04',
    title: 'Admin Login',
    subtitle: 'Allotment engine, staff provisioning, role governance, security & audit registers.',
    identifierLabel: 'Official Administrator Email',
    identifierPlaceholder: 'admin.demo@hostelhub.local',
    accountHint: 'Demo admin email: admin.demo@hostelhub.local',
    icon: ShieldCheck,
  },
];

export const LoginPage: React.FC<LoginPageProps> = ({
  initialPortal = null,
  sessionExpired = false,
  onLoginSuccess,
  onNavigate,
  onToast,
}) => {
  const [selectedPortal, setSelectedPortal] = useState<Role | null>(initialPortal);
  const [setupStatus, setSetupStatus] = useState<SetupStatusResponse | null>(null);

  // Login form state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // One-time Initial Setup form state (when no env demo passwords are set)
  const [adminPwd, setAdminPwd] = useState('');
  const [wardenPwd, setWardenPwd] = useState('');
  const [maintenancePwd, setMaintenancePwd] = useState('');
  const [studentPwd, setStudentPwd] = useState('');
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<SetupStatusResponse>('/api/auth/setup-status')
      .then((res) => {
        if (active) setSetupStatus(res);
      })
      .catch(() => {
        // Non-fatal
      });
    return () => {
      active = false;
    };
  }, []);

  const activePortalMeta = PORTAL_CARDS.find((p) => p.role === selectedPortal) ?? null;

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setBootstrapError(null);
    setBootstrapping(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify({
          admin_password: adminPwd,
          warden_password: wardenPwd,
          ...(maintenancePwd.trim() ? { maintenance_password: maintenancePwd.trim() } : {}),
          student_password: studentPwd,
        }),
      });
      setSetupStatus((prev) => (prev ? { ...prev, needsInitialSetup: false } : prev));
      setAdminPwd('');
      setWardenPwd('');
      setMaintenancePwd('');
      setStudentPwd('');
      onToast('success', res.message);
    } catch (err) {
      setBootstrapError(err instanceof Error ? err.message : 'Unable to complete initial setup.');
    } finally {
      setBootstrapping(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPortal) return;
    setErrorMsg(null);
    setSubmitting(true);

    try {
      const res = await apiFetch<LoginSuccessResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier: identifier.trim(),
          password,
          login_portal_role: selectedPortal,
          ...(mfaCode.trim() ? { mfa_code: mfaCode.trim() } : {}),
        }),
      });

      // Handle 200 MFA challenge response
      if (res.mfaRequired && !res.user) {
        setMfaRequired(true);
        setErrorMsg(res.error ?? 'Enter your 6-digit authenticator code to continue.');
        return;
      }

      onToast('success', res.message);
      onLoginSuccess(res.user, res.redirectTo);
    } catch (err) {
      if (err instanceof ApiError && err.mfaRequired) {
        setMfaRequired(true);
      }
      setErrorMsg(
        err instanceof Error ? err.message : 'Invalid credentials or unauthorized portal access.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-7">
      <header className="border-b-2 border-[#1F2A5A] pb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono-code text-xs text-[#465078]">
            VIDYAVIHAR UNIVERSITY · SERVER-VERIFIED AUTHENTICATION GATE
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] mt-1">
            Sign In to HostelHub
          </h1>
        </div>
        <Stamp label="VERIFIED ACCESS" variant="ink" size="sm" />
      </header>

      {sessionExpired && (
        <div
          role="alert"
          className="p-4 bg-[#FBE9A6] border-2 border-[#1F2A5A] rounded-[2px] text-sm text-[#1F2A5A]"
        >
          <strong>Session Expired:</strong> Your previous session expired or was revoked. Please
          sign in again through your assigned portal.
        </div>
      )}

      {/* One-Time Initial Campus Setup (only shown when env passwords are not set) */}
      {setupStatus?.needsInitialSetup && (
        <section className="bg-[#FBE9A6] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#1F2A5A]/30 pb-3">
            <div>
              <p className="font-mono-code text-xs font-bold text-[#B3261E]">
                ONE-TIME INITIAL CAMPUS SETUP · NO HARDCODED PASSWORDS
              </p>
              <h2 className="font-display text-2xl text-[#1F2A5A] mt-1">
                Initialize Campus Account Passwords
              </h2>
              <p className="text-xs text-[#1F2A5A] mt-1">
                Choose strong passwords (min 10 characters with uppercase, lowercase, and a number)
                for the pre-seeded Admin, Warden, and Student accounts. Once submitted, this setup
                form locks permanently.
              </p>
            </div>
            <Stamp label="FIRST RUN" variant="brick" size="sm" />
          </div>

          {bootstrapError && (
            <div className="p-3 bg-[#F8F2E4] border-2 border-[#B3261E] text-xs font-bold text-[#B3261E]">
              {bootstrapError}
            </div>
          )}

          <form onSubmit={handleBootstrap} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                Admin Password *
                <span className="block font-mono-code font-normal text-[11px] text-[#465078]">
                  admin.demo@hostelhub.local
                </span>
              </span>
              <input
                type="password"
                required
                minLength={10}
                value={adminPwd}
                onChange={(e) => setAdminPwd(e.target.value)}
                placeholder="Min 10 chars (Aa1...)"
                className="w-full px-3 py-2 text-sm bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                Warden Password *
                <span className="block font-mono-code font-normal text-[11px] text-[#465078]">
                  warden.demo@hostelhub.local
                </span>
              </span>
              <input
                type="password"
                required
                minLength={10}
                value={wardenPwd}
                onChange={(e) => setWardenPwd(e.target.value)}
                placeholder="Min 10 chars (Aa1...)"
                className="w-full px-3 py-2 text-sm bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                Maintenance Staff Password (optional)
                <span className="block font-mono-code font-normal text-[11px] text-[#465078]">
                  maintenance.demo@hostelhub.local
                </span>
              </span>
              <input
                type="password"
                minLength={10}
                value={maintenancePwd}
                onChange={(e) => setMaintenancePwd(e.target.value)}
                placeholder="Defaults to Warden pwd if blank"
                className="w-full px-3 py-2 text-sm bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                Student Password *
                <span className="block font-mono-code font-normal text-[11px] text-[#465078]">
                  student.demo@hostelhub.local
                </span>
              </span>
              <input
                type="password"
                required
                minLength={10}
                value={studentPwd}
                onChange={(e) => setStudentPwd(e.target.value)}
                placeholder="Min 10 chars (Aa1...)"
                className="w-full px-3 py-2 text-sm bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
              />
            </label>

            <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-xs text-[#465078]">
                Passwords are salted &amp; hashed server-side using scrypt and never stored in plaintext.
              </span>
              <button
                type="submit"
                disabled={bootstrapping}
                className="px-5 py-2.5 text-xs font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420] disabled:opacity-50"
              >
                {bootstrapping ? 'Securing Accounts...' : 'Complete Initial Setup & Lock'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* STEP 1: Role Portal Selection */}
      {!activePortalMeta ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-2xl text-[#1F2A5A]">
              Step 1 — Select Your Login Portal
            </h2>
            <p className="text-xs text-[#465078]">
              Portal selection sets the sign-in flow only; your role is strictly verified by the server.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {PORTAL_CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.role}
                  type="button"
                  onClick={() => {
                    setSelectedPortal(card.role);
                    setErrorMsg(null);
                    setMfaRequired(false);
                    setMfaCode('');
                  }}
                  className="text-left bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 hover:bg-[#FBE9A6] transition-colors flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono-code text-[11px] font-bold text-[#465078]">
                        {card.code}
                      </span>
                      <Icon className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
                    </div>
                    <h3 className="font-display text-2xl text-[#1F2A5A]">{card.title}</h3>
                    <p className="text-sm text-[#465078] leading-snug">{card.subtitle}</p>
                  </div>
                  <div className="pt-3 border-t border-[#1F2A5A]/25 flex items-center justify-between text-xs font-bold text-[#C2552D]">
                    <span>Continue to {card.title}</span>
                    <span>→</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-[#465078] border-t border-[#1F2A5A]/25">
            <span>
              New VidyaVihar student?{' '}
              <button
                type="button"
                onClick={() => onNavigate('/register')}
                className="font-bold text-[#C2552D] hover:underline"
              >
                Register a Student Account →
              </button>
            </span>
            <span>
              Warden &amp; Admin accounts are provisioned strictly by the Chief Warden Office.
            </span>
          </div>
        </section>
      ) : (
        /* STEP 2: Credential Authentication Form */
        <section className="max-w-xl mx-auto bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-6 sm:p-7 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#1F2A5A] pb-3">
            <div>
              <button
                type="button"
                onClick={() => {
                  setSelectedPortal(null);
                  setErrorMsg(null);
                  setMfaRequired(false);
                  setMfaCode('');
                }}
                className="inline-flex items-center gap-1 text-xs font-bold text-[#465078] hover:text-[#1F2A5A] mb-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                Change Login Portal
              </button>
              <h2 className="font-display text-2xl text-[#1F2A5A]">{activePortalMeta.title}</h2>
            </div>
            <Stamp label={activePortalMeta.role} variant="brick" size="sm" />
          </div>

          <p className="text-xs font-mono-code text-[#465078] bg-[#F1E6CF] border border-[#1F2A5A]/30 px-3 py-2">
            {activePortalMeta.accountHint}
          </p>

          {errorMsg && (
            <div
              role="alert"
              className="p-3 bg-[#F1E6CF] border-2 border-[#B3261E] text-xs font-bold text-[#B3261E]"
            >
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                {activePortalMeta.identifierLabel} *
              </span>
              <input
                type="text"
                required
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={activePortalMeta.identifierPlaceholder}
                className="w-full px-3 py-2.5 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] text-[#1F2A5A]"
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Password *</span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your account password"
                  className="w-full px-3 py-2.5 pr-10 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] text-[#1F2A5A]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#465078] hover:text-[#1F2A5A] p-1"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </label>

            {mfaRequired && selectedPortal === 'ADMIN' && (
              <label className="block bg-[#FBE9A6] border-2 border-[#1F2A5A] p-3 rounded-[2px]">
                <span className="text-xs font-bold text-[#1F2A5A] flex items-center gap-1.5 mb-1">
                  <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                  Admin 6-Digit Authenticator Code (MFA) *
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full px-3 py-2 font-mono-code text-base tracking-[0.25em] bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
                />
              </label>
            )}

            <button
              type="submit"
              disabled={submitting || Boolean(setupStatus?.needsInitialSetup)}
              className="w-full py-2.5 text-sm font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420] disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" aria-hidden="true" />
              {submitting ? 'Verifying Credentials...' : `Sign In to ${activePortalMeta.title}`}
            </button>
          </form>

          <div className="pt-3 border-t border-[#1F2A5A]/25 flex flex-wrap items-center justify-between gap-2 text-xs">
            <button
              type="button"
              onClick={() => onNavigate('/forgot-password')}
              className="font-bold text-[#1F2A5A] hover:underline"
            >
              Forgot Password / Activate Staff Account?
            </button>

            {selectedPortal === 'STUDENT' && (
              <button
                type="button"
                onClick={() => onNavigate('/register')}
                className="font-bold text-[#C2552D] hover:underline"
              >
                New Student Registration →
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
};

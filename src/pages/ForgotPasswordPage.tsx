import React, { useState } from 'react';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface ForgotPasswordPageProps {
  mode: 'forgot' | 'reset';
  onNavigate: (path: string) => void;
  onToast: (tone: 'success' | 'error' | 'info', text: string) => void;
}

export const ForgotPasswordPage: React.FC<ForgotPasswordPageProps> = ({
  mode,
  onNavigate,
  onToast,
}) => {
  const [step, setStep] = useState<'request' | 'complete'>(mode === 'reset' ? 'complete' : 'request');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [devResetToken, setDevResetToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ message: string; devResetToken?: string }>(
        '/api/auth/forgot-password',
        {
          method: 'POST',
          body: JSON.stringify({ email: email.trim() }),
        }
      );
      setNotice(res.message);
      if (res.devResetToken) {
        setDevResetToken(res.devResetToken);
        setToken(res.devResetToken);
      }
      setStep('complete');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to process reset request.');
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          token: token.trim(),
          new_password: newPassword,
        }),
      });
      onToast('success', res.message);
      onNavigate('/login');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to reset password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <header className="border-b-2 border-[#1F2A5A] pb-4">
        <button
          type="button"
          onClick={() => onNavigate('/login')}
          className="inline-flex items-center gap-1 text-xs font-bold text-[#465078] hover:text-[#1F2A5A] mb-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          Back to Sign In
        </button>
        <h1 className="font-display text-3xl text-[#1F2A5A]">
          {step === 'request' ? 'Reset Your Password' : 'Set New Account Password'}
        </h1>
        <p className="text-xs text-[#465078] mt-1">
          Completing a password reset immediately revokes all existing active sessions on the server.
        </p>
      </header>

      {errorMsg && (
        <div
          role="alert"
          className="p-3 bg-[#F8F2E4] border-2 border-[#B3261E] text-xs font-bold text-[#B3261E]"
        >
          {errorMsg}
        </div>
      )}

      {notice && (
        <div className="p-3 bg-[#FBE9A6] border-2 border-[#1F2A5A] text-xs text-[#1F2A5A]">
          {notice}
        </div>
      )}

      {step === 'request' ? (
        <form
          onSubmit={handleRequestReset}
          className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-6 space-y-4"
        >
          <label className="block">
            <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
              Registered University / Official Email *
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@univ.edu.in"
              className="w-full px-3 py-2.5 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep('complete')}
              className="text-xs font-bold text-[#465078] hover:text-[#1F2A5A] hover:underline"
            >
              Already have a reset or activation token?
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2.5 text-sm font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm disabled:opacity-50"
            >
              {busy ? 'Generating Token...' : 'Request Reset Link'}
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={handleCompleteReset}
          className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-6 space-y-4"
        >
          {devResetToken && (
            <div className="p-3 bg-[#FBE9A6] border border-[#1F2A5A] text-xs font-mono-code text-[#1F2A5A]">
              Local Dev Preview Reset Token: <strong>{devResetToken}</strong>
            </div>
          )}

          <label className="block">
            <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
              Single-Use Reset or Staff Activation Token *
            </span>
            <input
              type="text"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste token from email or administrator"
              className="w-full px-3 py-2 font-mono-code text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
              New Password (min 10 chars, uppercase, lowercase &amp; digit) *
            </span>
            <input
              type="password"
              required
              minLength={10}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
              Confirm New Password *
            </span>
            <input
              type="password"
              required
              minLength={10}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 text-sm font-bold text-[#F8F2E4] bg-[#295234] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <KeyRound className="w-4 h-4" aria-hidden="true" />
            {busy ? 'Updating Password...' : 'Update Password & Revoke Old Sessions'}
          </button>
        </form>
      )}
    </div>
  );
};

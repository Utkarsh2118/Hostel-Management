import React, { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, UserPlus } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type {
  AccountStatus,
  AdminAuditLog,
  AuthUserProfile,
  Role,
  SystemSecuritySettings,
} from '../../../lib/auth/roles';
import type { EnvironmentValidationResult } from '../../../lib/config/env';
import type { Block, SessionUser } from '../../../lib/types';
import { Stamp } from '../ui/Stamp';

interface AdminAccountsSecurityPanelProps {
  currentUser: SessionUser;
  blocks: Block[];
  onSessionRefresh: () => void;
  onToast: (tone: 'success' | 'error' | 'info', text: string) => void;
}

export const AdminAccountsSecurityPanel: React.FC<AdminAccountsSecurityPanelProps> = ({
  currentUser,
  blocks,
  onSessionRefresh,
  onToast,
}) => {
  const [accounts, setAccounts] = useState<AuthUserProfile[]>([]);
  const [adminLogs, setAdminLogs] = useState<AdminAuditLog[]>([]);
  const [settings, setSettings] = useState<SystemSecuritySettings | null>(null);
  const [envStatus, setEnvStatus] = useState<EnvironmentValidationResult | null>(null);
  const [loading, setLoading] = useState(true);

  // Provision Staff Form
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'WARDEN' | 'MAINTENANCE_STAFF' | 'ADMIN'>('WARDEN');
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>(['blk-nilgiri']);
  const [initialPassword, setInitialPassword] = useState('');
  const [provisioning, setProvisioning] = useState(false);
  const [devActivationToken, setDevActivationToken] = useState<string | null>(null);

  // MFA Setup State
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);

  // Security Settings Saving
  const [savingSettings, setSavingSettings] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [accRes, logRes, setRes, envRes] = await Promise.all([
        apiFetch<{ accounts: AuthUserProfile[] }>('/api/admin/accounts'),
        apiFetch<{ logs: AdminAuditLog[] }>('/api/admin/audit-logs'),
        apiFetch<{ settings: SystemSecuritySettings }>('/api/admin/security-settings'),
        apiFetch<EnvironmentValidationResult>('/api/admin/environment'),
      ]);
      setAccounts(accRes.accounts);
      setAdminLogs(logRes.logs);
      setSettings(setRes.settings);
      setEnvStatus(envRes);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to load account & security registers.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleProvisionStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    const needsBlocks = role === 'WARDEN' || role === 'MAINTENANCE_STAFF';
    if (needsBlocks && selectedBlocks.length === 0) {
      onToast('error', `Select at least one hostel block for a ${role} account.`);
      return;
    }
    setProvisioning(true);
    setDevActivationToken(null);
    try {
      const res = await apiFetch<{
        message: string;
        devActivationToken?: string;
      }>('/api/admin/accounts/provision', {
        method: 'POST',
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim(),
          role,
          assigned_block_ids: needsBlocks ? selectedBlocks : [],
          ...(initialPassword.trim() ? { initial_password: initialPassword.trim() } : {}),
        }),
      });
      onToast('success', res.message);
      if (res.devActivationToken) {
        setDevActivationToken(res.devActivationToken);
      }
      setFullName('');
      setEmail('');
      setInitialPassword('');
      await loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to provision staff account.');
    } finally {
      setProvisioning(false);
    }
  };

  const handleUpdateAccount = async (
    accountId: string,
    payload: { role?: Role; status?: AccountStatus; assigned_block_ids?: string[] }
  ) => {
    try {
      const res = await apiFetch<{ message: string }>(`/api/admin/accounts/${accountId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      onToast('success', res.message);
      await loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to update account access.');
    }
  };

  const handleBeginMfa = async () => {
    setMfaBusy(true);
    try {
      const res = await apiFetch<{ secret: string; message: string }>('/api/admin/mfa/setup', {
        method: 'POST',
      });
      setMfaSecret(res.secret);
      onToast('info', res.message);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to initialize MFA.');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleConfirmMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setMfaBusy(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/admin/mfa/confirm', {
        method: 'POST',
        body: JSON.stringify({ code: mfaCode.trim() }),
      });
      setMfaSecret(null);
      setMfaCode('');
      onToast('success', res.message);
      onSessionRefresh();
      await loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Invalid authenticator code.');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleDisableMfa = async () => {
    setMfaBusy(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/admin/mfa/disable', {
        method: 'POST',
      });
      onToast('info', res.message);
      onSessionRefresh();
      await loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to disable MFA.');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleSaveSecuritySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSavingSettings(true);
    try {
      const res = await apiFetch<{ settings: SystemSecuritySettings; message: string }>(
        '/api/admin/security-settings',
        {
          method: 'PUT',
          body: JSON.stringify(settings),
        }
      );
      setSettings(res.settings);
      onToast('success', res.message);
      await loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to update security settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading && accounts.length === 0) {
    return (
      <div className="py-12 text-center font-mono-code text-sm text-[#465078]">
        Loading accounts, roles &amp; security audit register...
      </div>
    );
  }

  return (
    <div className="space-y-7">
      {/* Row 1: Provision Official Warden / Admin Account + Admin MFA */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleProvisionStaff}
          className="lg:col-span-7 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-4"
        >
          <div className="flex items-start justify-between gap-2 border-b border-[#1F2A5A]/25 pb-2">
            <div>
              <h2 className="font-display text-2xl text-[#1F2A5A] flex items-center gap-2">
                <UserPlus className="w-5 h-5" aria-hidden="true" />
                Provision Official Warden / Admin Account
              </h2>
              <p className="text-xs text-[#465078]">
                Staff accounts cannot be self-registered. Roles are assigned strictly server-side.
              </p>
            </div>
            <Stamp label="ADMIN ONLY" variant="red" size="sm" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <label className="block">
              <span className="text-xs font-bold block mb-1">Full Name *</span>
              <input
                type="text"
                required
                minLength={2}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g., Prof. Kavita Joshi"
                className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold block mb-1">Official Email *</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="kavita.warden@univ.edu.in"
                className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <label className="block">
              <span className="text-xs font-bold block mb-1">Assigned Role *</span>
              <select
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as 'WARDEN' | 'MAINTENANCE_STAFF' | 'ADMIN')
                }
                className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] font-mono-code font-bold"
              >
                <option value="WARDEN">WARDEN (Block-Scoped)</option>
                <option value="MAINTENANCE_STAFF">MAINTENANCE_STAFF (Task &amp; Block-Scoped)</option>
                <option value="ADMIN">ADMIN (System-Wide)</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold block mb-1">
                Optional Initial Password (or leave blank for activation link)
              </span>
              <input
                type="password"
                minLength={10}
                value={initialPassword}
                onChange={(e) => setInitialPassword(e.target.value)}
                placeholder="Min 10 chars (Aa1...)"
                className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              />
            </label>
          </div>

          {(role === 'WARDEN' || role === 'MAINTENANCE_STAFF') && (
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-[#1F2A5A] block">
                Assign Authorized Hostel Blocks *
              </span>
              <div className="flex flex-wrap gap-2">
                {blocks.map((b) => {
                  const active = selectedBlocks.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() =>
                        setSelectedBlocks((prev) =>
                          prev.includes(b.id) ? prev.filter((id) => id !== b.id) : [...prev, b.id]
                        )
                      }
                      className={`px-3 py-1.5 text-xs font-mono-code border-2 border-[#1F2A5A] rounded-[2px] ${
                        active ? 'bg-[#1F2A5A] text-[#F8F2E4] font-bold' : 'bg-[#F1E6CF] text-[#1F2A5A]'
                      }`}
                    >
                      {b.name} ({b.code})
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {devActivationToken && (
            <div className="p-3 bg-[#FBE9A6] border-2 border-[#1F2A5A] text-xs font-mono-code text-[#1F2A5A]">
              Staff Activation Token (redeem on /reset-password):{' '}
              <strong>{devActivationToken}</strong>
            </div>
          )}

          <button
            type="submit"
            disabled={provisioning}
            className="px-5 py-2.5 text-xs font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420] disabled:opacity-50"
          >
            {provisioning ? 'Provisioning...' : `Provision ${role} Account`}
          </button>
        </form>

        {/* Admin MFA & Global Security Settings */}
        <div className="lg:col-span-5 space-y-5">
          <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-[#1F2A5A]/25 pb-2">
              <h2 className="font-display text-xl text-[#1F2A5A] flex items-center gap-2">
                <KeyRound className="w-4 h-4" aria-hidden="true" />
                Admin MFA (TOTP)
              </h2>
              <Stamp
                label={currentUser.mfa_enabled ? 'ENABLED' : 'OPTIONAL'}
                variant={currentUser.mfa_enabled ? 'green' : 'ink'}
                size="sm"
              />
            </div>

            {currentUser.mfa_enabled ? (
              <div className="space-y-3">
                <p className="text-xs text-[#295234] font-semibold">
                  6-digit TOTP authenticator verification is active on your Admin account.
                </p>
                <button
                  type="button"
                  disabled={mfaBusy}
                  onClick={() => void handleDisableMfa()}
                  className="px-3.5 py-2 text-xs font-bold text-[#B3261E] bg-[#F1E6CF] border-2 border-[#B3261E] rounded-[2px]"
                >
                  Disable MFA
                </button>
              </div>
            ) : mfaSecret ? (
              <form onSubmit={handleConfirmMfa} className="space-y-3">
                <p className="text-xs text-[#465078]">
                  Add this Base32 TOTP secret to Google Authenticator / 1Password, then enter the
                  generated 6-digit code:
                </p>
                <div className="p-2.5 bg-[#FBE9A6] border border-[#1F2A5A] font-mono-code text-xs font-bold break-all">
                  {mfaSecret}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    maxLength={6}
                    pattern="\d{6}"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="flex-1 px-3 py-2 font-mono-code text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
                  />
                  <button
                    type="submit"
                    disabled={mfaBusy}
                    className="px-4 py-2 text-xs font-bold text-[#F8F2E4] bg-[#295234] border-2 border-[#1F2A5A] rounded-[2px]"
                  >
                    Verify
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-[#465078]">
                  Protect administrator login with an RFC 6238 authenticator app code.
                </p>
                <button
                  type="button"
                  disabled={mfaBusy}
                  onClick={() => void handleBeginMfa()}
                  className="px-4 py-2 text-xs font-bold text-[#F8F2E4] bg-[#1F2A5A] border-2 border-[#1F2A5A] rounded-[2px]"
                >
                  Set Up Admin TOTP MFA
                </button>
              </div>
            )}
          </section>

          {settings && (
            <form
              onSubmit={handleSaveSecuritySettings}
              className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-3"
            >
              <h2 className="font-display text-xl text-[#1F2A5A] flex items-center gap-2 border-b border-[#1F2A5A]/25 pb-2">
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                Global Security Settings
              </h2>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <label className="block col-span-2">
                  <span className="font-bold block mb-1">University Email Domain</span>
                  <input
                    type="text"
                    value={settings.allowed_email_domain}
                    onChange={(e) =>
                      setSettings({ ...settings, allowed_email_domain: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 font-mono-code bg-[#F1E6CF] border border-[#1F2A5A] rounded-[2px]"
                  />
                </label>
                <label className="block">
                  <span className="font-bold block mb-1">Session TTL (mins)</span>
                  <input
                    type="number"
                    min={15}
                    max={1440}
                    value={settings.session_ttl_minutes}
                    onChange={(e) =>
                      setSettings({ ...settings, session_ttl_minutes: Number(e.target.value) })
                    }
                    className="w-full px-2.5 py-1.5 font-mono-code bg-[#F1E6CF] border border-[#1F2A5A] rounded-[2px]"
                  />
                </label>
                <label className="block">
                  <span className="font-bold block mb-1">Lockout Failures</span>
                  <input
                    type="number"
                    min={3}
                    max={15}
                    value={settings.max_failed_login_attempts}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        max_failed_login_attempts: Number(e.target.value),
                      })
                    }
                    className="w-full px-2.5 py-1.5 font-mono-code bg-[#F1E6CF] border border-[#1F2A5A] rounded-[2px]"
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={savingSettings}
                className="w-full py-2 text-xs font-bold text-[#F8F2E4] bg-[#1F2A5A] border-2 border-[#1F2A5A] rounded-[2px] disabled:opacity-50"
              >
                {savingSettings ? 'Saving Settings...' : 'Save Security Policy'}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Row 2: Account & Role Governance Table */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink">
        <div className="px-4 py-3 border-b-2 border-[#1F2A5A] bg-[#F1E6CF] flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl text-[#1F2A5A]">
            Registered Accounts &amp; Role Assignments ({accounts.length})
          </h2>
          <span className="font-mono-code text-xs text-[#465078]">
            SELF-ROLE MODIFICATION BLOCKED SERVER-SIDE
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-[#1F2A5A] bg-[#F1E6CF]/70 font-mono-code">
                <th className="py-2.5 px-4">Account</th>
                <th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-4">Assigned Scope</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Admin Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F2A5A]/20">
              {accounts.map((acc) => {
                const isSelf = acc.id === currentUser.id;
                return (
                  <tr key={acc.id}>
                    <td className="py-2.5 px-4">
                      <div className="font-bold text-[#1F2A5A]">
                        {acc.full_name} {isSelf && <span className="text-[#C2552D]">(You)</span>}
                      </div>
                      <div className="font-mono-code text-[11px] text-[#465078]">
                        {acc.email} {acc.student_code ? `· ${acc.student_code}` : ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono-code font-bold">{acc.role}</td>
                    <td className="py-2.5 px-4 font-mono-code text-[#465078]">
                      {acc.role === 'WARDEN' || acc.role === 'MAINTENANCE_STAFF'
                        ? acc.assigned_block_ids.join(', ')
                        : acc.role === 'ADMIN'
                          ? 'ALL BLOCKS'
                          : 'SELF ONLY'}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`font-mono-code font-bold uppercase ${
                          acc.status === 'active' ? 'text-[#295234]' : 'text-[#B3261E]'
                        }`}
                      >
                        {acc.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      {isSelf ? (
                        <span className="font-mono-code text-[#465078]">Protected (self)</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              void handleUpdateAccount(acc.id, {
                                status: acc.status === 'active' ? 'inactive' : 'active',
                              })
                            }
                            className="px-2.5 py-1 font-bold bg-[#F1E6CF] border border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6]"
                          >
                            {acc.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                          {acc.role === 'WARDEN' && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleUpdateAccount(acc.id, {
                                  assigned_block_ids: blocks.map((b) => b.id),
                                })
                              }
                              className="px-2.5 py-1 font-bold bg-[#F1E6CF] border border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6]"
                            >
                              Assign All Blocks
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Row 3: Immutable Security & Role Audit Logs */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink">
        <div className="px-4 py-3 border-b-2 border-[#1F2A5A] bg-[#F1E6CF]">
          <h2 className="font-display text-2xl text-[#1F2A5A]">
            Security &amp; Role Governance Audit Log ({adminLogs.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-mono-code">
            <thead>
              <tr className="border-b-2 border-[#1F2A5A] bg-[#F1E6CF]/70">
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Actor</th>
                <th className="py-2.5 px-4">Event</th>
                <th className="py-2.5 px-4">Change Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F2A5A]/20">
              {adminLogs.map((log) => (
                <tr key={log.id}>
                  <td className="py-2.5 px-4 whitespace-nowrap text-[#465078]">
                    {new Date(log.timestamp).toLocaleString('en-IN')}
                  </td>
                  <td className="py-2.5 px-4">{log.actor_email}</td>
                  <td className="py-2.5 px-4 font-bold text-[#1F2A5A]">{log.action}</td>
                  <td className="py-2.5 px-4 text-[#465078] max-w-md truncate">
                    {JSON.stringify(log.new_value ?? log.previous_value ?? {})}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Row 4: Deployment Mode & Institutional Integration Readiness (Admin-Only) */}
      {envStatus && (
        <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink">
          <div className="px-4 py-3 border-b-2 border-[#1F2A5A] bg-[#F1E6CF] flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-2xl text-[#1F2A5A]">
                Deployment Mode &amp; Institutional Readiness
              </h2>
              <p className="text-xs text-[#465078]">
                Mock and sandbox providers are explicitly labeled and never presented as official university integrations.
              </p>
            </div>
            <Stamp
              label={`ENV: ${envStatus.environment.toUpperCase()}`}
              variant={envStatus.environment === 'production' ? 'green' : 'brick'}
              size="sm"
            />
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {envStatus.integrations.map((item) => (
              <div
                key={item.id}
                className="p-3 bg-[#F1E6CF]/70 border border-[#1F2A5A]/40 rounded-[2px] space-y-1"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-[#1F2A5A]">{item.name}</span>
                  <span
                    className={`font-mono-code text-[11px] font-bold uppercase ${
                      item.state === 'configured'
                        ? 'text-[#295234]'
                        : item.state === 'sandbox_mode'
                          ? 'text-[#C2552D]'
                          : 'text-[#B3261E]'
                    }`}
                  >
                    {item.state.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="text-xs text-[#465078] leading-snug">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

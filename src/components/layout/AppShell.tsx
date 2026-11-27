import React, { useState } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  BedDouble,
  Building2,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  HelpCircle,
  Home,
  IndianRupee,
  KeyRound,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  UserCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import type { AiStatusInfo, SessionUser } from '../../../lib/types';
import { ConfirmDialog } from '../ui/ConfirmDialog';

export interface AppShellProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  sessionUser: SessionUser | null;
  onLogout: () => Promise<void>;
  pendingSwapsCount: number;
  aiStatus: AiStatusInfo | null;
  children: React.ReactNode;
}

interface NavItem {
  path: string;
  code: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

function getNavItemsForUser(user: SessionUser | null, pendingSwapsCount: number): NavItem[] {
  if (!user) {
    return [
      { path: '/', code: '00', label: 'Notice Board', shortLabel: 'Board', icon: Home },
      { path: '/login', code: '01', label: 'Sign In', shortLabel: 'Sign In', icon: LogIn },
      { path: '/register', code: '02', label: 'Student Register', shortLabel: 'Register', icon: UserCheck },
    ];
  }

  if (user.role === 'STUDENT') {
    return [
      { path: '/', code: '00', label: 'Notice Board', shortLabel: 'Board', icon: Home },
      { path: '/student', code: '01', label: 'Student Desk', shortLabel: 'Desk', icon: LayoutDashboard },
      { path: '/student/verification', code: '02', label: 'ID & Vault', shortLabel: 'Verify', icon: FileCheck2 },
      { path: '/student/applications', code: '03', label: 'Apply & Offer', shortLabel: 'Apply', icon: ClipboardList },
      { path: '/student/operations', code: '04', label: 'Check-In & Passes', shortLabel: 'Ops', icon: KeyRound },
      { path: '/student/fees', code: '05', label: 'Fees & Notices', shortLabel: 'Fees', icon: IndianRupee },
      { path: '/student/profile', code: '06', label: 'Profile & Choices', shortLabel: 'Choices', icon: SlidersHorizontal },
      { path: '/student/allotment', code: '07', label: 'Allotment Slip', shortLabel: 'Allot', icon: ClipboardCheck },
      { path: '/hostels/inventory', code: '08', label: 'Bed Register', shortLabel: 'Beds', icon: BedDouble },
      { path: '/rooms', code: '09', label: 'Room Blueprint', shortLabel: 'Rooms', icon: Building2 },
      {
        path: '/swaps',
        code: '10',
        label: 'Swap Board',
        shortLabel: 'Swaps',
        icon: ArrowLeftRight,
        badge: pendingSwapsCount > 0 ? pendingSwapsCount : undefined,
      },
      { path: '/roommates', code: '11', label: 'Roommates', shortLabel: 'Mates', icon: Users },
      { path: '/assistant', code: '12', label: 'Info Desk', shortLabel: 'Rules', icon: HelpCircle },
    ];
  }

  if (user.role === 'WARDEN') {
    return [
      { path: '/', code: '00', label: 'Notice Board', shortLabel: 'Board', icon: Home },
      { path: '/warden', code: '01', label: 'Warden Desk', shortLabel: 'Warden', icon: Shield },
      { path: '/warden/operations', code: '02', label: 'Hostel Operations', shortLabel: 'Ops', icon: KeyRound },
      { path: '/warden/reports', code: '03', label: 'Reports & Fees', shortLabel: 'Reports', icon: BarChart3 },
      { path: '/warden/applications', code: '04', label: 'Applications', shortLabel: 'Apps', icon: ClipboardList },
      { path: '/warden/hostels', code: '05', label: 'Bed Inventory', shortLabel: 'Beds', icon: BedDouble },
      { path: '/admin/verification', code: '06', label: 'ID & Vault Queue', shortLabel: 'Verify', icon: FileCheck2 },
      { path: '/rooms', code: '07', label: 'Room Blueprint', shortLabel: 'Rooms', icon: Building2 },
      {
        path: '/swaps',
        code: '08',
        label: 'Swap Board',
        shortLabel: 'Swaps',
        icon: ArrowLeftRight,
        badge: pendingSwapsCount > 0 ? pendingSwapsCount : undefined,
      },
      { path: '/assistant', code: '09', label: 'Info Desk', shortLabel: 'Rules', icon: HelpCircle },
    ];
  }

  if (user.role === 'MAINTENANCE_STAFF') {
    return [
      { path: '/', code: '00', label: 'Notice Board', shortLabel: 'Board', icon: Home },
      { path: '/maintenance', code: '01', label: 'Work Orders', shortLabel: 'Tasks', icon: Wrench },
      { path: '/maintenance/history', code: '02', label: 'Completed Log', shortLabel: 'History', icon: ClipboardCheck },
      { path: '/assistant', code: '03', label: 'Info Desk', shortLabel: 'Rules', icon: HelpCircle },
    ];
  }

  // ADMIN
  return [
    { path: '/', code: '00', label: 'Notice Board', shortLabel: 'Board', icon: Home },
    { path: '/admin', code: '01', label: 'Admin Office', shortLabel: 'Admin', icon: Shield },
    { path: '/admin/operations', code: '02', label: 'Hostel Operations', shortLabel: 'Ops', icon: KeyRound },
    { path: '/admin/finance', code: '03', label: 'Finance & Reports', shortLabel: 'Finance', icon: IndianRupee },
    { path: '/admin/allotment', code: '04', label: 'Allotment Cycles', shortLabel: 'Cycles', icon: ClipboardList },
    { path: '/admin/hostels', code: '05', label: 'Bed Inventory', shortLabel: 'Beds', icon: BedDouble },
    { path: '/admin/verification', code: '06', label: 'Verification & Vault', shortLabel: 'Verify', icon: FileCheck2 },
    { path: '/admin/readiness', code: '07', label: 'Security & Readiness', shortLabel: 'Audit', icon: ShieldCheck },
    { path: '/rooms', code: '08', label: 'Room Blueprint', shortLabel: 'Rooms', icon: Building2 },
    {
      path: '/swaps',
      code: '09',
      label: 'Swap Board',
      shortLabel: 'Swaps',
      icon: ArrowLeftRight,
      badge: pendingSwapsCount > 0 ? pendingSwapsCount : undefined,
    },
    { path: '/assistant', code: '10', label: 'Info Desk', shortLabel: 'Rules', icon: HelpCircle },
  ];
}

export const AppShell: React.FC<AppShellProps> = ({
  currentPath,
  onNavigate,
  sessionUser,
  onLogout,
  pendingSwapsCount,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const navItems = getNavItemsForUser(sessionUser, pendingSwapsCount);
  const primaryMobileTabs = navItems.slice(0, 5);

  const handleLinkClick = (path: string) => {
    onNavigate(path);
    setMobileMenuOpen(false);
  };

  const roleBadgeClass =
    sessionUser?.role === 'ADMIN'
      ? 'bg-[#B3261E] text-[#F8F2E4]'
      : sessionUser?.role === 'WARDEN'
        ? 'bg-[#C2552D] text-[#F8F2E4]'
        : sessionUser?.role === 'MAINTENANCE_STAFF'
          ? 'bg-[#295234] text-[#F8F2E4]'
          : 'bg-[#1F2A5A] text-[#F8F2E4]';

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Desktop Vertical Hostel-Door Signage Rail */}
      <aside
        aria-label="Primary hostel navigation"
        className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen bg-[#F8F2E4] border-r-2 border-[#1F2A5A] justify-between overflow-y-auto"
      >
        <div>
          <button
            type="button"
            onClick={() => handleLinkClick('/')}
            className="w-full text-left px-5 py-5 border-b-2 border-[#1F2A5A] bg-[#1F2A5A] text-[#F1E6CF] hover:bg-[#273570] transition-colors"
          >
            <span className="block font-mono-code text-[11px] tracking-[0.18em] text-[#F2C94C]">
              VIDYAVIHAR UNIV.
            </span>
            <span className="block font-display text-3xl leading-none mt-1">
              HostelHub
            </span>
            <span className="block text-xs text-[#F1E6CF]/80 mt-1">
              Allotment &amp; Room Exchange
            </span>
          </button>

          <nav className="p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.path === '/' ? currentPath === '/' : currentPath === item.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => handleLinkClick(item.path)}
                  aria-current={isActive ? 'page' : undefined}
                  className={[
                    'w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm rounded-[2px] border transition-colors text-left',
                    isActive
                      ? 'bg-[#FBE9A6] border-[#1F2A5A] text-[#1F2A5A] font-bold shadow-ink-sm'
                      : 'bg-transparent border-transparent text-[#1F2A5A] hover:bg-[#F1E6CF] hover:border-[#1F2A5A]/40 font-medium',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono-code text-[11px] text-[#465078] shrink-0">
                      {item.code}
                    </span>
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="truncate whitespace-nowrap">{item.label}</span>
                  </span>
                  {item.badge !== undefined && (
                    <span
                      className="font-mono-code text-[11px] font-bold px-1.5 py-0.5 bg-[#C2552D] text-[#F8F2E4] rounded-[2px] shrink-0"
                      aria-label={`${item.badge} pending swap proposals`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Server-Verified Account Identity & Sign-Out (NO Role Switcher) */}
        <div className="p-4 border-t-2 border-[#1F2A5A] bg-[#F1E6CF] space-y-2.5">
          {sessionUser ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono-code text-[10px] font-bold text-[#465078] uppercase tracking-wider">
                  Verified Account
                </span>
                <span
                  className={`font-mono-code text-[10px] font-bold px-1.5 py-0.5 rounded-[2px] ${roleBadgeClass}`}
                >
                  {sessionUser.role}
                </span>
              </div>
              <div>
                <p className="text-sm font-bold text-[#1F2A5A] truncate">{sessionUser.name}</p>
                <p
                  className="text-[11px] font-mono-code text-[#465078] truncate"
                  title={sessionUser.email}
                >
                  {sessionUser.email}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLogoutConfirmOpen(true)}
                className="w-full px-3 py-1.5 text-xs font-bold text-[#1F2A5A] bg-[#F8F2E4] border border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6] inline-flex items-center justify-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                Sign Out
              </button>
            </>
          ) : (
            <>
              <p className="font-mono-code text-[11px] font-bold text-[#465078] uppercase tracking-wider">
                Not Signed In
              </p>
              <button
                type="button"
                onClick={() => handleLinkClick('/login')}
                className="w-full px-3 py-2 text-xs font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420] inline-flex items-center justify-center gap-1.5"
              >
                <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                Sign In to Portal
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Mobile Compact Header Strip */}
      <header className="lg:hidden sticky top-0 z-30 h-12 bg-[#1F2A5A] text-[#F1E6CF] border-b-2 border-[#1F2A5A] px-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => handleLinkClick('/')}
          className="font-display text-xl tracking-wide whitespace-nowrap shrink-0"
        >
          HostelHub
        </button>

        <div className="flex items-center gap-2">
          {sessionUser ? (
            <span className="px-2 py-0.5 text-[11px] font-mono-code font-bold bg-[#FBE9A6] text-[#1F2A5A] rounded-[2px]">
              {sessionUser.role}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => handleLinkClick('/login')}
              className="px-2.5 py-1 text-xs font-mono-code font-bold bg-[#C2552D] text-[#F8F2E4] rounded-[2px]"
            >
              Sign In
            </button>
          )}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open navigation menu'}
            className="p-1.5 text-[#F1E6CF] border border-[#F1E6CF]/40 rounded-[2px]"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Mobile Full Directory Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-x-0 top-12 bottom-14 z-40 bg-[#F8F2E4] border-b-2 border-[#1F2A5A] overflow-y-auto p-4 space-y-4">
          <div className="bg-[#F1E6CF] border border-[#1F2A5A] rounded-[2px] p-3 flex items-center justify-between gap-2">
            {sessionUser ? (
              <>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#1F2A5A] truncate">{sessionUser.name}</p>
                  <p className="font-mono-code text-[11px] text-[#465078] truncate">
                    {sessionUser.role} · {sessionUser.email}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setLogoutConfirmOpen(true);
                  }}
                  className="px-3 py-1.5 text-xs font-bold bg-[#F8F2E4] border border-[#1F2A5A] rounded-[2px] shrink-0"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => handleLinkClick('/login')}
                className="w-full py-2 text-xs font-bold text-[#F8F2E4] bg-[#C2552D] border border-[#1F2A5A] rounded-[2px]"
              >
                Sign In to HostelHub
              </button>
            )}
          </div>

          <nav className="grid grid-cols-1 gap-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPath === item.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => handleLinkClick(item.path)}
                  className={[
                    'flex items-center justify-between px-3 py-3 text-sm border rounded-[2px] text-left',
                    isActive
                      ? 'bg-[#FBE9A6] border-[#1F2A5A] font-bold'
                      : 'bg-[#F1E6CF]/60 border-[#1F2A5A]/30 font-medium',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-2.5">
                    <span className="font-mono-code text-xs text-[#465078]">{item.code}</span>
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </span>
                  {item.badge !== undefined && (
                    <span className="font-mono-code text-xs font-bold px-1.5 py-0.5 bg-[#C2552D] text-[#F8F2E4]">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      )}

      {/* Main Content Stage */}
      <main className="flex-1 min-w-0 pb-20 lg:pb-10">
        <div className="max-w-[1220px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Paper-Tab Navigation */}
      <nav
        aria-label="Mobile quick navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-14 bg-[#F8F2E4] border-t-2 border-[#1F2A5A] grid"
        style={{ gridTemplateColumns: `repeat(${primaryMobileTabs.length}, minmax(0, 1fr))` }}
      >
        {primaryMobileTabs.map((item) => {
          const Icon = item.icon;
          const isActive = currentPath === item.path;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => handleLinkClick(item.path)}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'relative flex flex-col items-center justify-center gap-0.5 text-[11px] border-r last:border-r-0 border-[#1F2A5A]/20 transition-colors',
                isActive ? 'bg-[#FBE9A6] text-[#1F2A5A] font-bold' : 'text-[#465078] font-medium',
              ].join(' ')}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span className="whitespace-nowrap">{item.shortLabel}</span>
              {item.badge !== undefined && (
                <span className="absolute top-1 right-2 font-mono-code text-[10px] font-bold px-1 bg-[#C2552D] text-[#F8F2E4] rounded-[2px]">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <ConfirmDialog
        open={logoutConfirmOpen}
        title="Sign Out of HostelHub?"
        description="Your server session will be immediately revoked and your browser cookie cleared. You will need to sign in again to access protected registers."
        confirmLabel="Sign Out"
        tone="primary"
        onCancel={() => setLogoutConfirmOpen(false)}
        onConfirm={async () => {
          setLogoutConfirmOpen(false);
          await onLogout();
        }}
      />
    </div>
  );
};

import React from 'react';
import { Lock, ShieldAlert } from 'lucide-react';
import type { SessionUser } from '../../lib/types';
import { ROLE_DASHBOARD_PATH } from '../../lib/auth/roles';
import { Stamp } from '../components/ui/Stamp';

interface UnauthorizedPageProps {
  sessionExpired?: boolean;
  onNavigate: (path: string) => void;
}

export const UnauthorizedPage: React.FC<UnauthorizedPageProps> = ({
  sessionExpired = false,
  onNavigate,
}) => {
  return (
    <div className="max-w-xl mx-auto my-12 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-8 space-y-5">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono-code text-xs font-bold text-[#B3261E] flex items-center gap-1.5">
          <Lock className="w-4 h-4" aria-hidden="true" />
          HTTP 401 · AUTHENTICATION REQUIRED
        </p>
        <Stamp label={sessionExpired ? 'EXPIRED' : 'SIGN IN'} variant="red" size="sm" />
      </div>
      <h1 className="font-display text-3xl text-[#1F2A5A]">
        {sessionExpired ? 'Your Session Has Expired' : 'Sign In Required'}
      </h1>
      <p className="text-sm text-[#465078] leading-relaxed">
        {sessionExpired
          ? 'For your security, your HostelHub session has expired or was invalidated. Please sign in again through your assigned portal.'
          : 'This HostelHub section requires a verified campus account. Select your assigned Student, Warden, or Admin login portal to continue.'}
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onNavigate('/login')}
          className="px-5 py-2.5 text-sm font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420]"
        >
          Go to Sign In
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="px-4 py-2.5 text-sm font-bold text-[#1F2A5A] bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6]"
        >
          Public Notice Board
        </button>
      </div>
    </div>
  );
};

interface AccessDeniedPageProps {
  sessionUser: SessionUser | null;
  attemptedPath?: string;
  onNavigate: (path: string) => void;
}

export const AccessDeniedPage: React.FC<AccessDeniedPageProps> = ({
  sessionUser,
  attemptedPath,
  onNavigate,
}) => {
  const safeDashboard = sessionUser ? ROLE_DASHBOARD_PATH[sessionUser.role] : '/login';

  return (
    <div className="max-w-xl mx-auto my-12 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-8 space-y-5">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono-code text-xs font-bold text-[#B3261E] flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4" aria-hidden="true" />
          HTTP 403 · ACCESS DENIED
        </p>
        <Stamp label="RESTRICTED" variant="red" size="sm" />
      </div>
      <h1 className="font-display text-3xl text-[#1F2A5A]">
        Insufficient Role Permissions
      </h1>
      <p className="text-sm text-[#465078] leading-relaxed">
        {sessionUser ? (
          <>
            Your verified server-side role is{' '}
            <strong className="font-mono-code text-[#1F2A5A]">{sessionUser.role}</strong>, which is
            not authorized to access{' '}
            <strong className="font-mono-code text-[#1F2A5A]">
              {attemptedPath ?? 'this route'}
            </strong>
            . Roles cannot be elevated from the browser and are strictly enforced by the server.
          </>
        ) : (
          'You do not have permission to access this resource.'
        )}
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onNavigate(safeDashboard)}
          className="px-5 py-2.5 text-sm font-bold text-[#F8F2E4] bg-[#1F2A5A] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#273570]"
        >
          Return to My {sessionUser?.role ?? ''} Dashboard
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="px-4 py-2.5 text-sm font-bold text-[#1F2A5A] bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6]"
        >
          Notice Board
        </button>
      </div>
    </div>
  );
};

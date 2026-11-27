import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './lib/api';
import type { AiStatusInfo, SessionUser, SwapProposal } from '../lib/types';
import { ROLE_DASHBOARD_PATH, type Role } from '../lib/auth/roles';
import { AppShell } from './components/layout/AppShell';
import { ToastContainer, type ToastMessage } from './components/layout/ToastContainer';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { AccessDeniedPage, UnauthorizedPage } from './pages/AuthErrorPages';
import { StudentDashboardPage } from './pages/StudentDashboardPage';
import { StudentProfilePage } from './pages/StudentProfilePage';
import { AllotmentPage } from './pages/AllotmentPage';
import { WardenDashboardPage } from './pages/WardenDashboardPage';
import { RoomsPage } from './pages/RoomsPage';
import { SwapsPage } from './pages/SwapsPage';
import { RoommatesPage } from './pages/RoommatesPage';
import { AssistantPage } from './pages/AssistantPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { MaintenanceDashboardPage } from './pages/MaintenanceDashboardPage';
import { StudentVerificationPage } from './pages/StudentVerificationPage';
import { InventoryExplorerPage } from './pages/InventoryExplorerPage';
import { StudentApplicationsPage } from './pages/StudentApplicationsPage';
import { AllotmentOperationsPage } from './pages/AllotmentOperationsPage';
import { StudentOperationsPage } from './pages/StudentOperationsPage';
import { StaffOperationsPage } from './pages/StaffOperationsPage';
import { StudentFinancePage } from './pages/StudentFinancePage';
import { FinanceAndReportsPage } from './pages/FinanceAndReportsPage';
import { ProductionReadinessPage } from './pages/ProductionReadinessPage';

interface AuthMeResponse {
  authenticated: boolean;
  user: SessionUser | null;
  sessionExpired: boolean;
  ai_status: AiStatusInfo;
}

const VALID_PATHS = new Set([
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/unauthorized',
  '/access-denied',
  '/student',
  '/student/dashboard',
  '/student/profile',
  '/student/allotment',
  '/student/verification',
  '/student/applications',
  '/student/operations',
  '/student/fees',
  '/warden',
  '/warden/dashboard',
  '/warden/hostels',
  '/warden/applications',
  '/warden/operations',
  '/warden/reports',
  '/maintenance',
  '/maintenance/dashboard',
  '/maintenance/tasks',
  '/maintenance/history',
  '/rooms',
  '/hostels/inventory',
  '/swaps',
  '/roommates',
  '/assistant',
  '/admin',
  '/admin/dashboard',
  '/admin/hostels',
  '/admin/verification',
  '/admin/allotment',
  '/admin/operations',
  '/admin/finance',
  '/admin/readiness',
]);

const PUBLIC_PATHS = new Set([
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/unauthorized',
  '/access-denied',
]);

const ROUTE_ALLOWED_ROLES: Record<string, Role[]> = {
  '/student': ['STUDENT'],
  '/student/dashboard': ['STUDENT'],
  '/student/profile': ['STUDENT'],
  '/student/allotment': ['STUDENT'],
  '/student/verification': ['STUDENT'],
  '/student/applications': ['STUDENT'],
  '/student/operations': ['STUDENT'],
  '/student/fees': ['STUDENT'],
  '/roommates': ['STUDENT'],
  '/warden': ['WARDEN'],
  '/warden/dashboard': ['WARDEN'],
  '/warden/hostels': ['WARDEN'],
  '/warden/applications': ['WARDEN'],
  '/warden/operations': ['WARDEN'],
  '/warden/reports': ['WARDEN'],
  '/maintenance': ['MAINTENANCE_STAFF'],
  '/maintenance/dashboard': ['MAINTENANCE_STAFF'],
  '/maintenance/tasks': ['MAINTENANCE_STAFF'],
  '/maintenance/history': ['MAINTENANCE_STAFF'],
  '/admin': ['ADMIN'],
  '/admin/dashboard': ['ADMIN'],
  '/admin/hostels': ['ADMIN'],
  '/admin/verification': ['ADMIN', 'WARDEN'],
  '/admin/allotment': ['ADMIN'],
  '/admin/operations': ['ADMIN'],
  '/admin/finance': ['ADMIN'],
  '/admin/readiness': ['ADMIN'],
  '/rooms': ['STUDENT', 'WARDEN', 'ADMIN'],
  '/hostels/inventory': ['STUDENT', 'WARDEN', 'ADMIN'],
  '/swaps': ['STUDENT', 'WARDEN', 'ADMIN'],
  '/assistant': ['STUDENT', 'WARDEN', 'MAINTENANCE_STAFF', 'ADMIN'],
};

function normalizePath(pathname: string): string {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return VALID_PATHS.has(clean) ? clean : '/';
}

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() =>
    normalizePath(window.location.pathname)
  );
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [sessionExpired, setSessionExpired] = useState<boolean>(false);
  const [aiStatus, setAiStatus] = useState<AiStatusInfo | null>(null);
  const [pendingSwapsCount, setPendingSwapsCount] = useState<number>(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((tone: ToastMessage['tone'], text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, tone, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const navigate = useCallback((path: string) => {
    const normalized = normalizePath(path);
    if (window.location.pathname !== normalized) {
      window.history.pushState({}, '', normalized);
    }
    setCurrentPath(normalized);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const refreshPendingSwaps = useCallback(async (user: SessionUser | null) => {
    if (!user || user.role === 'MAINTENANCE_STAFF') {
      setPendingSwapsCount(0);
      return;
    }
    try {
      const swapsRes = await apiFetch<{ proposals: SwapProposal[] }>('/api/swaps');
      const count = swapsRes.proposals.filter((p) => {
        if (p.status !== 'pending') return false;
        if (user.role === 'ADMIN' || user.role === 'WARDEN') return true;
        return Boolean(
          user.student_id &&
            p.cycle.some(
              (s) => s.student_id === user.student_id && !p.acceptances[user.student_id!]
            )
        );
      }).length;
      setPendingSwapsCount(count);
    } catch {
      setPendingSwapsCount(0);
    }
  }, []);

  const fetchVerifiedSession = useCallback(async () => {
    try {
      const res = await apiFetch<AuthMeResponse>('/api/auth/me');
      setSessionUser(res.authenticated ? res.user : null);
      setSessionExpired(res.sessionExpired);
      setAiStatus(res.ai_status);
      await refreshPendingSwaps(res.authenticated ? res.user : null);
    } catch {
      setSessionUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, [refreshPendingSwaps]);

  useEffect(() => {
    void fetchVerifiedSession();
  }, [fetchVerifiedSession]);

  useEffect(() => {
    const onPopState = () => {
      setCurrentPath(normalizePath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleLoginSuccess = useCallback(
    (user: SessionUser, redirectTo: string) => {
      setSessionUser(user);
      setSessionExpired(false);
      void refreshPendingSwaps(user);
      navigate(redirectTo || ROLE_DASHBOARD_PATH[user.role]);
    },
    [navigate, refreshPendingSwaps]
  );

  const handleLogout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear local UI state regardless
    }
    setSessionUser(null);
    setPendingSwapsCount(0);
    setSessionExpired(false);
    addToast('info', 'Signed out cleanly. Server session revoked.');
    navigate('/login');
  }, [addToast, navigate]);

  const renderPage = () => {
    if (authLoading && !PUBLIC_PATHS.has(currentPath)) {
      return (
        <div className="py-24 text-center font-mono-code text-sm text-[#465078]">
          Verifying campus session with server...
        </div>
      );
    }

    // Public routes
    if (currentPath === '/') {
      return <LandingPage sessionUser={sessionUser} onNavigate={navigate} />;
    }
    if (currentPath === '/login') {
      return (
        <LoginPage
          sessionExpired={sessionExpired}
          onLoginSuccess={handleLoginSuccess}
          onNavigate={navigate}
          onToast={addToast}
        />
      );
    }
    if (currentPath === '/register') {
      return <RegisterPage onNavigate={navigate} onToast={addToast} />;
    }
    if (currentPath === '/forgot-password') {
      return <ForgotPasswordPage mode="forgot" onNavigate={navigate} onToast={addToast} />;
    }
    if (currentPath === '/reset-password') {
      return <ForgotPasswordPage mode="reset" onNavigate={navigate} onToast={addToast} />;
    }
    if (currentPath === '/unauthorized') {
      return <UnauthorizedPage sessionExpired={sessionExpired} onNavigate={navigate} />;
    }
    if (currentPath === '/access-denied') {
      return <AccessDeniedPage sessionUser={sessionUser} onNavigate={navigate} />;
    }

    // Protected routes require a server-verified session
    if (!sessionUser) {
      return <UnauthorizedPage sessionExpired={sessionExpired} onNavigate={navigate} />;
    }

    // Frontend role-guard UX complement (server enforces strictly on every API endpoint)
    const allowedRoles = ROUTE_ALLOWED_ROLES[currentPath];
    if (allowedRoles && !allowedRoles.includes(sessionUser.role)) {
      return (
        <AccessDeniedPage
          sessionUser={sessionUser}
          attemptedPath={currentPath}
          onNavigate={navigate}
        />
      );
    }

    switch (currentPath) {
      case '/student':
      case '/student/dashboard':
        return (
          <StudentDashboardPage
            activeStudentId={sessionUser.student_id ?? ''}
            onNavigate={navigate}
            onToast={addToast}
          />
        );
      case '/student/profile':
        return (
          <StudentProfilePage
            activeStudentId={sessionUser.student_id ?? ''}
            onToast={addToast}
            onProfileSaved={() => void fetchVerifiedSession()}
          />
        );
      case '/student/allotment':
        return (
          <AllotmentPage
            activeStudentId={sessionUser.student_id ?? ''}
            onNavigate={navigate}
          />
        );
      case '/student/verification':
        return <StudentVerificationPage onToast={addToast} />;
      case '/student/applications':
        return <StudentApplicationsPage onToast={addToast} />;
      case '/student/operations':
        return <StudentOperationsPage onToast={addToast} />;
      case '/student/fees':
        return <StudentFinancePage onToast={addToast} />;
      case '/warden':
      case '/warden/dashboard':
        return <WardenDashboardPage onToast={addToast} />;
      case '/warden/applications':
      case '/admin/allotment':
        return <AllotmentOperationsPage sessionUser={sessionUser} onToast={addToast} />;
      case '/warden/operations':
      case '/admin/operations':
        return <StaffOperationsPage sessionUser={sessionUser} onToast={addToast} />;
      case '/warden/reports':
        return (
          <FinanceAndReportsPage
            sessionUser={sessionUser}
            initialTab="reports"
            onToast={addToast}
          />
        );
      case '/admin/finance':
        return (
          <FinanceAndReportsPage
            sessionUser={sessionUser}
            initialTab="finance"
            onToast={addToast}
          />
        );
      case '/admin/readiness':
        return <ProductionReadinessPage onToast={addToast} />;
      case '/warden/hostels':
      case '/admin/hostels':
      case '/hostels/inventory':
        return (
          <InventoryExplorerPage
            sessionUser={sessionUser}
            initialTab="inventory"
            onToast={addToast}
          />
        );
      case '/admin/verification':
        return (
          <InventoryExplorerPage
            sessionUser={sessionUser}
            initialTab="verification"
            onToast={addToast}
          />
        );
      case '/maintenance':
      case '/maintenance/dashboard':
      case '/maintenance/tasks':
        return (
          <MaintenanceDashboardPage
            sessionUser={sessionUser}
            initialFilter="active"
            onToast={addToast}
          />
        );
      case '/maintenance/history':
        return (
          <MaintenanceDashboardPage
            sessionUser={sessionUser}
            initialFilter="history"
            onToast={addToast}
          />
        );
      case '/rooms':
        return (
          <RoomsPage
            onNavigate={navigate}
            onToast={addToast}
            aiStatus={aiStatus}
            onAiStatusUpdate={setAiStatus}
          />
        );
      case '/swaps':
        return (
          <SwapsPage
            activeRole={sessionUser.role}
            activeStudentId={sessionUser.student_id}
            onToast={addToast}
            onSwapsChanged={() => void refreshPendingSwaps(sessionUser)}
          />
        );
      case '/roommates':
        return (
          <RoommatesPage
            activeStudentId={sessionUser.student_id ?? ''}
            onNavigate={navigate}
            onToast={addToast}
          />
        );
      case '/assistant':
        return (
          <AssistantPage
            aiStatus={aiStatus}
            onAiStatusUpdate={setAiStatus}
            onToast={addToast}
          />
        );
      case '/admin':
      case '/admin/dashboard':
        return (
          <AdminDashboardPage
            sessionUser={sessionUser}
            onSessionRefresh={() => void fetchVerifiedSession()}
            onToast={addToast}
          />
        );
      default:
        return <LandingPage sessionUser={sessionUser} onNavigate={navigate} />;
    }
  };

  return (
    <>
      <AppShell
        currentPath={currentPath}
        onNavigate={navigate}
        sessionUser={sessionUser}
        onLogout={handleLogout}
        pendingSwapsCount={pendingSwapsCount}
        aiStatus={aiStatus}
      >
        {renderPage()}
      </AppShell>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

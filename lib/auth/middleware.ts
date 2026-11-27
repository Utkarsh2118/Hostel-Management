import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { HostelAuthService } from './authService.ts';
import type { AuthUserProfile, Role } from './roles.ts';
import {
  canAccessBlock,
  canAccessHostel,
  hasAnyRole,
  hasPermission,
  type Permission,
} from './permissions.ts';

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUserProfile | null;
  sessionExpired?: boolean;
  correlationId?: string;
}

/**
 * Resolves the authenticated user strictly from the server-verified HttpOnly session cookie.
 * Never reads role or user ID from query params, request body, or client headers.
 */
export function attachServerSession(authService: HostelAuthService) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const incomingId = req.headers['x-correlation-id'];
    const correlationId =
      typeof incomingId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(incomingId)
        ? incomingId
        : `req-${crypto.randomUUID().slice(0, 12)}`;
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-Id', correlationId);

    const { session, expired } = authService.sessions.getSessionFromCookie(req.headers.cookie);
    req.sessionExpired = expired;

    if (!session) {
      req.authUser = null;
      next();
      return;
    }

    const profile = authService.getUserProfileById(session.userId);
    if (!profile || profile.status !== 'active') {
      authService.sessions.revokeSession(req.headers.cookie);
      req.authUser = null;
      req.sessionExpired = true;
      next();
      return;
    }

    req.authUser = profile;
    next();
  };
}

export function getCurrentUser(req: AuthenticatedRequest): AuthUserProfile | null {
  return req.authUser ?? null;
}

/**
 * CSRF protection for cookie-authenticated state-changing requests.
 * Requires either matching Origin host (against Host / X-Forwarded-Host) OR
 * explicit non-simple header `X-Requested-With: HostelHub`.
 */
export function requireCsrfProtection(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  // Machine-to-machine cryptographic endpoints ignore session cookies and enforce
  // timing-safe HMAC-SHA256 signatures or BACKGROUND_JOB_SECRET headers directly.
  if (req.path === '/webhooks/payments' || req.path === '/jobs/cron/run') {
    next();
    return;
  }

  const customHeader = req.headers['x-requested-with'];
  if (customHeader === 'HostelHub' || customHeader === 'XMLHttpRequest') {
    next();
    return;
  }

  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    .toString()
    .split(',')[0]
    .trim();

  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        next();
        return;
      }
    } catch {
      // Malformed origin rejected below
    }
  }

  res.status(403).json({
    error: 'Request rejected by CSRF protection. Reload the page and try again.',
  });
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const user = getCurrentUser(req);
  if (!user) {
    res.status(401).json({
      code: req.sessionExpired ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED',
      error: req.sessionExpired
        ? 'Your session has expired. Please sign in again.'
        : 'Authentication required. Please sign in to continue.',
    });
    return;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = getCurrentUser(req);
    if (!user) {
      res.status(401).json({
        code: req.sessionExpired ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED',
        error: 'Authentication required.',
      });
      return;
    }
    if (!hasAnyRole(user, roles)) {
      res.status(403).json({
        code: 'FORBIDDEN',
        error: 'Access denied. Your account does not have permission for this section.',
      });
      return;
    }
    next();
  };
}

export function requirePermission(permission: Permission) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = getCurrentUser(req);
    if (!user) {
      res.status(401).json({
        code: req.sessionExpired ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED',
        error: 'Authentication required.',
      });
      return;
    }
    if (!hasPermission(user, permission)) {
      res.status(403).json({
        code: 'FORBIDDEN',
        error: 'Access denied. Insufficient permissions for this operation.',
      });
      return;
    }
    next();
  };
}

export function requireAssignedBlock(
  resolveBlockId: (req: AuthenticatedRequest) => string | undefined | null
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = getCurrentUser(req);
    if (!user) {
      res.status(401).json({
        code: req.sessionExpired ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED',
        error: 'Authentication required.',
      });
      return;
    }
    const blockId = resolveBlockId(req);
    if (!blockId || !canAccessBlock(user, blockId)) {
      res.status(403).json({
        code: 'BLOCK_SCOPE_DENIED',
        error: 'Access denied. You are only authorized to access hostel blocks assigned to your account.',
      });
      return;
    }
    next();
  };
}

export function requireAssignedHostel(
  resolveHostelId: (req: AuthenticatedRequest) => string | undefined | null
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = getCurrentUser(req);
    if (!user) {
      res.status(401).json({
        code: req.sessionExpired ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED',
        error: 'Authentication required.',
      });
      return;
    }
    const hostelId = resolveHostelId(req);
    if (!hostelId || !canAccessHostel(user, hostelId)) {
      res.status(403).json({
        code: 'HOSTEL_SCOPE_DENIED',
        error: 'Access denied. You are only authorized to access hostels assigned to your account.',
      });
      return;
    }
    next();
  };
}

export function verifyBlockAccessOrRespond(
  user: AuthUserProfile,
  blockId: string,
  res: Response
): boolean {
  if (!canAccessBlock(user, blockId)) {
    res.status(403).json({
      code: 'BLOCK_SCOPE_DENIED',
      error: 'Access denied. You are only authorized to manage hostel blocks assigned to your account.',
    });
    return false;
  }
  return true;
}

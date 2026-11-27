import crypto from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * Server-Side Secure Session Manager
 * ==================================
 * - Issues opaque 256-bit random session IDs signed with an HMAC-SHA256 tag.
 * - Stores sessions strictly on the server (never trusts client-side claims or localStorage).
 * - Emits HttpOnly; Secure; SameSite=None; Partitioned cookies for iframe preview compatibility,
 *   plus clean expiration and instant invalidation on logout or password reset.
 */

export const SESSION_COOKIE_NAME = 'hostelhub_sid';

export interface ServerSessionRecord {
  sessionId: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  mfaVerified: boolean;
}

// Signing key read from process.env or generated once in memory (never written to files or logged)
const SESSION_SIGNING_SECRET =
  process.env.SESSION_SECRET?.trim() || crypto.randomBytes(32).toString('hex');

function signSessionId(sessionId: string): string {
  const mac = crypto
    .createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(sessionId)
    .digest('base64url');
  return `${sessionId}.${mac}`;
}

function verifySignedToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [sessionId, providedMac] = parts;
  if (!sessionId || !providedMac) return null;

  const expectedMac = crypto
    .createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(sessionId)
    .digest('base64url');

  const a = Buffer.from(providedMac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return sessionId;
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

export class SessionStore {
  private readonly sessions = new Map<string, ServerSessionRecord>();

  public createSession(
    userId: string,
    ttlMinutes: number,
    mfaVerified = true,
    nowMs = Date.now()
  ): { cookieValue: string; record: ServerSessionRecord } {
    const sessionId = crypto.randomBytes(32).toString('base64url');
    const record: ServerSessionRecord = {
      sessionId,
      userId,
      createdAt: nowMs,
      expiresAt: nowMs + ttlMinutes * 60 * 1000,
      lastSeenAt: nowMs,
      mfaVerified,
    };
    this.sessions.set(sessionId, record);
    return { cookieValue: signSessionId(sessionId), record };
  }

  public getSessionFromCookie(
    cookieHeader: string | undefined,
    nowMs = Date.now()
  ): { session: ServerSessionRecord | null; expired: boolean } {
    const cookies = parseCookies(cookieHeader);
    const rawToken = cookies[SESSION_COOKIE_NAME];
    if (!rawToken) {
      return { session: null, expired: false };
    }

    const sessionId = verifySignedToken(rawToken);
    if (!sessionId) {
      return { session: null, expired: false };
    }

    const record = this.sessions.get(sessionId);
    if (!record) {
      return { session: null, expired: true };
    }

    if (record.expiresAt <= nowMs) {
      this.sessions.delete(sessionId);
      return { session: null, expired: true };
    }

    record.lastSeenAt = nowMs;
    return { session: record, expired: false };
  }

  public revokeSession(cookieHeader: string | undefined): void {
    const cookies = parseCookies(cookieHeader);
    const rawToken = cookies[SESSION_COOKIE_NAME];
    if (!rawToken) return;
    const sessionId = verifySignedToken(rawToken);
    if (sessionId) {
      this.sessions.delete(sessionId);
    }
  }

  public revokeAllForUser(userId: string): void {
    for (const [sid, rec] of this.sessions.entries()) {
      if (rec.userId === userId) {
        this.sessions.delete(sid);
      }
    }
  }

  public purgeExpiredSessions(nowMs = Date.now()): number {
    let purged = 0;
    for (const [sid, rec] of this.sessions.entries()) {
      if (rec.expiresAt <= nowMs) {
        this.sessions.delete(sid);
        purged += 1;
      }
    }
    return purged;
  }

  public getActiveSessionCount(nowMs = Date.now()): number {
    let active = 0;
    for (const rec of this.sessions.values()) {
      if (rec.expiresAt > nowMs) active += 1;
    }
    return active;
  }

  public revokeAllExceptUserIds(keepUserIds: Set<string>): number {
    let revoked = 0;
    for (const [sid, rec] of this.sessions.entries()) {
      if (!keepUserIds.has(rec.userId)) {
        this.sessions.delete(sid);
        revoked += 1;
      }
    }
    return revoked;
  }
}

export function setSessionCookie(
  res: Response,
  cookieValue: string,
  maxAgeSeconds: number,
  req?: Request
): void {
  const isHttps =
    req?.secure ||
    req?.headers['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production';

  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(cookieValue)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.max(60, Math.floor(maxAgeSeconds))}`,
  ];

  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    // Allow HTTP localhost curls/tests while keeping HttpOnly strictness
    parts.push('SameSite=Lax');
  }

  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response, req?: Request): void {
  const isHttps =
    req?.secure ||
    req?.headers['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production';

  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
  ];

  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }

  res.setHeader('Set-Cookie', parts.join('; '));
}

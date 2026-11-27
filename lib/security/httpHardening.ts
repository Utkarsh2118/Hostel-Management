import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithId extends Request {
  requestId?: string;
}

/**
 * Phase 6 — Production HTTP Security Headers & Correlation Middleware
 * ===================================================================
 * - Strips server fingerprinting (paired with app.disable('x-powered-by')).
 * - Enforces MIME sniffing protection, strict referrer policy, and locked browser permissions.
 * - Sets HSTS automatically in production.
 * - Enforces Cache-Control: no-store on all /api/* responses so sensitive student/finance data
 *   is never cached by browsers or institutional proxies.
 */
export function securityHeadersMiddleware(
  req: RequestWithId,
  res: Response,
  next: NextFunction
): void {
  const incomingId = req.header('x-request-id');
  const requestId =
    incomingId && /^[A-Za-z0-9_-]{8,64}$/.test(incomingId)
      ? incomingId
      : `req-${crypto.randomUUID().slice(0, 12)}`;

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
  );
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  if (req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }

  next();
}

/**
 * Explicit JSON 404 catch-all for unknown /api/* routes so SPA fallback never masks API errors.
 */
export function apiNotFoundHandler(req: RequestWithId, res: Response): void {
  res.status(404).json({
    error: `API endpoint '${req.method} ${req.path}' not found.`,
    request_id: req.requestId ?? null,
  });
}

/**
 * Redacted global Express error handler.
 * Handles malformed JSON (400), oversized payloads (413), and unexpected exceptions (500)
 * without EVER exposing stack traces, internal file paths, or raw environment details.
 */
export function redactedErrorHandler(
  err: unknown,
  req: RequestWithId,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) return;

  const errorObj = err as { status?: number; statusCode?: number; type?: string } | null;
  const status = errorObj?.status ?? errorObj?.statusCode ?? 500;

  if (errorObj?.type === 'entity.parse.failed' || (err instanceof SyntaxError && status === 400)) {
    res.status(400).json({
      error: 'Malformed JSON request body.',
      request_id: req.requestId ?? null,
    });
    return;
  }

  if (errorObj?.type === 'entity.too.large' || status === 413) {
    res.status(413).json({
      error: 'Request payload exceeds institutional size limit.',
      request_id: req.requestId ?? null,
    });
    return;
  }

  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: 'An unexpected server error occurred. Reference the request ID when contacting IT support.',
    request_id: req.requestId ?? null,
  });
}

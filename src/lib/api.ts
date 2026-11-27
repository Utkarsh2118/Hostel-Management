/**
 * Cookie-authenticated API client for HostelHub.
 * - Never sends client-selected role headers or reads tokens from localStorage.
 * - Includes `credentials: 'include'` so server-verified HttpOnly session cookies are sent.
 * - Sends `X-Requested-With: HostelHub` to satisfy server CSRF protection on mutations.
 */

export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly mfaRequired?: boolean;
  public readonly locked?: boolean;

  constructor(
    message: string,
    status: number,
    meta?: { code?: string; mfaRequired?: boolean; locked?: boolean }
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = meta?.code;
    this.mfaRequired = meta?.mfaRequired;
    this.locked = meta?.locked;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  headers.set('X-Requested-With', 'HostelHub');
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? ((await response.json()) as Record<string, unknown>) : null;

  if (!response.ok) {
    const message =
      (data && typeof data.error === 'string' && data.error) ||
      `Request failed with status ${response.status}. Please try again.`;
    throw new ApiError(message, response.status, {
      code: typeof data?.code === 'string' ? data.code : undefined,
      mfaRequired: Boolean(data?.mfaRequired),
      locked: Boolean(data?.locked),
    });
  }

  return data as T;
}

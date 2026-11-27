import type { NextFunction, Request, Response } from 'express';

export interface RouteMetricSummary {
  route_key: string;
  count: number;
  error_count: number;
  avg_ms: number;
  max_ms: number;
}

export interface RecentErrorEvent {
  timestamp: string;
  request_id: string | null;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number;
}

export interface ObservabilitySnapshot {
  started_at: string;
  uptime_seconds: number;
  total_api_requests: number;
  status_2xx: number;
  status_3xx: number;
  status_4xx: number;
  status_5xx: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  sentry_configured: boolean;
  top_routes: RouteMetricSummary[];
  recent_errors: RecentErrorEvent[];
}

interface MutableRouteStat {
  count: number;
  error_count: number;
  total_ms: number;
  max_ms: number;
}

/**
 * Normalizes dynamic UUID/ID path segments to avoid high-cardinality metric explosions
 * and prevent student/document IDs from appearing in route telemetry keys.
 */
function normalizeRoutePath(rawPath: string): string {
  const withoutQuery = rawPath.split('?')[0] || '/';
  return withoutQuery
    .replace(/\/(stu|usr|blk|rm|bed|doc|app|cyc|inv|pay|cmp|gp|vis|mnt|swap|prop|ntc|notif)-[A-Za-z0-9_-]+/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/\d{2,}/g, '/:num');
}

/**
 * Phase 7 — In-Process Structured API Telemetry & Latency Tracker
 * ===============================================================
 * - Captures per-route request counts, HTTP status classes, p95 latency,
 *   and a secret-free recent error ring buffer for Admin incident triage.
 * - Never records request bodies, cookies, tokens, or stack traces.
 */
export class ApiObservabilityTracker {
  private readonly startedAt = new Date().toISOString();
  private readonly startedAtMs = Date.now();
  private totalRequests = 0;
  private status2xx = 0;
  private status3xx = 0;
  private status4xx = 0;
  private status5xx = 0;
  private readonly latencySamples: number[] = [];
  private readonly routeStats = new Map<string, MutableRouteStat>();
  private readonly recentErrors: RecentErrorEvent[] = [];

  public middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!req.path.startsWith('/api')) {
        next();
        return;
      }

      const startNs = process.hrtime.bigint();
      res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
        const roundedMs = Math.round(durationMs * 100) / 100;
        const status = res.statusCode;

        this.totalRequests += 1;
        if (status >= 200 && status < 300) this.status2xx += 1;
        else if (status >= 300 && status < 400) this.status3xx += 1;
        else if (status >= 400 && status < 500) this.status4xx += 1;
        else if (status >= 500) this.status5xx += 1;

        this.latencySamples.push(roundedMs);
        if (this.latencySamples.length > 500) {
          this.latencySamples.shift();
        }

        const routeKey = `${req.method.toUpperCase()} ${normalizeRoutePath(req.path)}`;
        const existing = this.routeStats.get(routeKey) ?? {
          count: 0,
          error_count: 0,
          total_ms: 0,
          max_ms: 0,
        };
        existing.count += 1;
        if (status >= 400) existing.error_count += 1;
        existing.total_ms += roundedMs;
        if (roundedMs > existing.max_ms) existing.max_ms = roundedMs;
        this.routeStats.set(routeKey, existing);

        if (status >= 400) {
          const reqIdHeader = res.getHeader('X-Request-Id');
          this.recentErrors.unshift({
            timestamp: new Date().toISOString(),
            request_id: typeof reqIdHeader === 'string' ? reqIdHeader : null,
            method: req.method.toUpperCase(),
            path: normalizeRoutePath(req.path),
            status_code: status,
            duration_ms: roundedMs,
          });
          if (this.recentErrors.length > 25) {
            this.recentErrors.pop();
          }
        }
      });

      next();
    };
  }

  public getSnapshot(env: NodeJS.ProcessEnv = process.env): ObservabilitySnapshot {
    const samples = [...this.latencySamples].sort((a, b) => a - b);
    const avgMs =
      samples.length > 0
        ? Math.round((samples.reduce((sum, v) => sum + v, 0) / samples.length) * 100) / 100
        : 0;
    const p95Idx = samples.length > 0 ? Math.min(samples.length - 1, Math.floor(samples.length * 0.95)) : 0;
    const p95Ms = samples.length > 0 ? samples[p95Idx] : 0;

    const topRoutes: RouteMetricSummary[] = Array.from(this.routeStats.entries())
      .map(([route_key, st]) => ({
        route_key,
        count: st.count,
        error_count: st.error_count,
        avg_ms: Math.round((st.total_ms / Math.max(1, st.count)) * 100) / 100,
        max_ms: st.max_ms,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const sentryRaw = env.SENTRY_DSN?.trim() ?? '';
    const sentryConfigured =
      sentryRaw.startsWith('https://') && !sentryRaw.includes('example');

    return {
      started_at: this.startedAt,
      uptime_seconds: Math.max(0, Math.floor((Date.now() - this.startedAtMs) / 1000)),
      total_api_requests: this.totalRequests,
      status_2xx: this.status2xx,
      status_3xx: this.status3xx,
      status_4xx: this.status4xx,
      status_5xx: this.status5xx,
      avg_latency_ms: avgMs,
      p95_latency_ms: p95Ms,
      sentry_configured: sentryConfigured,
      top_routes: topRoutes,
      recent_errors: this.recentErrors.map((e) => ({ ...e })),
    };
  }
}

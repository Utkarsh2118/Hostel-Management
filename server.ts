import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import type { IHostelRepository } from './lib/repo/interface.ts';
import { getHostelRepository } from './lib/repo/memoryRepo.ts';
import { getAuthService, type HostelAuthService } from './lib/auth/authService.ts';
import {
  attachServerSession,
  type AuthenticatedRequest,
  getCurrentUser,
  requireAuth,
  requireCsrfProtection,
  requirePermission,
  requireRole,
  verifyBlockAccessOrRespond,
} from './lib/auth/middleware.ts';
import { canAccessBlock } from './lib/auth/permissions.ts';
import { ROLE_DASHBOARD_PATH } from './lib/auth/roles.ts';
import { clearSessionCookie, setSessionCookie } from './lib/auth/session.ts';
import {
  AllotmentRulesSchema,
  ApplyFeeWaiverSchema,
  AssistantQuerySchema,
  CompleteCheckOutSchema,
  CreateApplicationCycleSchema,
  CreateComplaintSchema,
  CreateDisputeSchema,
  CreateFeeInvoiceSchema,
  CreateGatePassSchema,
  CreateMaintenanceTaskSchema,
  CreateNoticeSchema,
  CreateRoomSchema,
  CreateSwapRequestSchema,
  CreateVisitorSchema,
  EmergencySessionRevocationSchema,
  EscalateComplaintSchema,
  ExecuteCycleAllotmentSchema,
  ForgotPasswordSchema,
  ImportRosterSchema,
  InitialSetupSchema,
  LoginSchema,
  ManualAllotmentOverrideSchema,
  NaturalLanguageSearchRequestSchema,
  PaymentWebhookPayloadSchema,
  ProvisionStaffSchema,
  PublishInstitutionalNoticeSchema,
  RecordCheckInSchema,
  ReportExportDatasetSchema,
  RequestCheckOutSchema,
  ResetPasswordSchema,
  RespondAllotmentOfferSchema,
  ReviewApplicationSchema,
  ReviewDocumentSchema,
  ReviewGatePassSchema,
  ReviewVerificationSchema,
  RunAllotmentSchema,
  RunBackgroundJobSchema,
  StudentRegisterSchema,
  SubmitOfflinePaymentSchema,
  SubmitVerificationSchema,
  SwapProposalActionSchema,
  ToggleRoommateRequestSchema,
  UpdateAccountAccessSchema,
  UpdateBedStatusSchema,
  UpdateComplaintSchema,
  UpdateCycleStatusSchema,
  UpdateDisputeSchema,
  UpdateMaintenanceTaskSchema,
  UpdateRoomOperationalStatusSchema,
  UpdateRoomSchema,
  UpdateRulesMarkdownSchema,
  UpdateSecuritySettingsSchema,
  UpdateStudentProfileSchema,
  UpdateVisitorStatusSchema,
  UploadDocumentSchema,
  UpsertApplicationSchema,
  VerifyEmailSchema,
  VerifyMfaSchema,
  VerifyPaymentSchema,
} from './lib/validation/schemas.ts';
import { findTopRoommateMatches } from './lib/compatibility/engine.ts';
import { isGenderCompatibleWithBlock } from './lib/allotment/engine.ts';
import { getLlmClient } from './lib/ai/llmClient.ts';
import {
  readRulesMarkdown,
  retrieveMatchingRuleSections,
  writeRulesMarkdown,
} from './lib/ai/rulesRetriever.ts';
import { SlidingWindowRateLimiter } from './lib/utils/rateLimit.ts';
import { validateServerEnv } from './lib/config/env.ts';
import { getMaintenanceService, type MaintenanceTaskService } from './lib/maintenance/store.ts';
import {
  getVerificationService,
  type StudentVerificationService,
} from './lib/integrations/university/student-verification.ts';
import {
  getInventoryService,
  InstitutionalInventoryService,
  InventoryError,
} from './lib/inventory/service.ts';
import {
  DocumentVaultError,
  getDocumentVaultService,
  PrivateDocumentVaultService,
} from './lib/documents/service.ts';
import {
  ApplicationServiceError,
  type ApplicationStatus,
  getApplicationService,
  HostelApplicationService,
} from './lib/applications/service.ts';
import {
  getOperationsService,
  HostelOperationsService,
  OperationsError,
} from './lib/operations/service.ts';
import {
  getNotificationService,
  NotificationAndNoticeService,
  NotificationError,
} from './lib/notifications/service.ts';
import {
  FinanceError,
  getFinanceService,
  HostelFinanceService,
} from './lib/finance/service.ts';
import {
  getReportingService,
  InstitutionalReportingService,
  ReportingError,
} from './lib/reports/service.ts';
import {
  apiNotFoundHandler,
  redactedErrorHandler,
  securityHeadersMiddleware,
} from './lib/security/httpHardening.ts';
import { buildProductionReadinessReport } from './lib/security/readiness.ts';
import {
  getCommunicationsDispatcher,
  OutboundCommunicationsDispatcher,
} from './lib/communications/dispatcher.ts';
import { ApiObservabilityTracker } from './lib/observability/metrics.ts';
import {
  PaymentWebhookError,
  PaymentWebhookService,
} from './lib/finance/webhook.ts';
import {
  InstitutionalJobRunner,
  verifyBackgroundJobSecret,
} from './lib/jobs/runner.ts';
import type { Room, RoomTag } from './lib/types.ts';

interface RequestWithRawBody extends AuthenticatedRequest {
  rawBody?: string;
}

function resolveServerBinding(): { port: number; host: string } {
  let cliPort: number | undefined;
  let cliHost: string | undefined;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') {
      const next = Number(argv[i + 1]);
      if (Number.isFinite(next) && next > 0) cliPort = next;
      i += 1;
    } else if (arg.startsWith('--port=')) {
      const parsed = Number(arg.slice('--port='.length));
      if (Number.isFinite(parsed) && parsed > 0) cliPort = parsed;
    } else if (arg === '--host' || arg === '-H') {
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
        cliHost = argv[i + 1];
        i += 1;
      }
    } else if (arg.startsWith('--host=')) {
      cliHost = arg.slice('--host='.length);
    }
  }
  const envPort = Number(process.env.PORT);
  const port = cliPort ?? (Number.isFinite(envPort) && envPort > 0 ? envPort : 3000);
  const host = cliHost || process.env.HOST || '0.0.0.0';
  return { port, host };
}

const { port: PORT, host: HOST } = resolveServerBinding();

export interface CreateApiAppOptions {
  repo?: IHostelRepository;
  authService?: HostelAuthService;
  maintenanceService?: MaintenanceTaskService;
  verificationService?: StudentVerificationService;
  inventoryService?: InstitutionalInventoryService;
  documentService?: PrivateDocumentVaultService;
  applicationService?: HostelApplicationService;
  operationsService?: HostelOperationsService;
  notificationService?: NotificationAndNoticeService;
  financeService?: HostelFinanceService;
  reportingService?: InstitutionalReportingService;
  commsDispatcher?: OutboundCommunicationsDispatcher;
  observability?: ApiObservabilityTracker;
  backgroundJobSecret?: string;
  paymentWebhookSecret?: string;
}

export function createApiApp(options: CreateApiAppOptions = {}) {
  const app = express();
  const repo = options.repo ?? getHostelRepository();
  const authService = options.authService ?? getAuthService();
  const maintenanceService = options.maintenanceService ?? getMaintenanceService();
  const verificationService = options.verificationService ?? getVerificationService();
  const inventoryService =
    options.inventoryService ??
    (options.repo ? new InstitutionalInventoryService(repo) : getInventoryService(repo));
  const documentService =
    options.documentService ??
    (options.repo ? new PrivateDocumentVaultService(repo) : getDocumentVaultService(repo));
  const applicationService =
    options.applicationService ??
    (options.repo
      ? new HostelApplicationService(repo, verificationService, inventoryService)
      : getApplicationService(repo, verificationService, inventoryService));
  const operationsService =
    options.operationsService ??
    (options.repo
      ? new HostelOperationsService(repo, maintenanceService)
      : getOperationsService(repo, maintenanceService));
  const notificationService =
    options.notificationService ??
    (options.repo ? new NotificationAndNoticeService(repo) : getNotificationService(repo));
  const financeService =
    options.financeService ??
    (options.repo
      ? new HostelFinanceService(repo, notificationService)
      : getFinanceService(repo, notificationService));
  const reportingService =
    options.reportingService ??
    (options.repo
      ? new InstitutionalReportingService(repo, maintenanceService, operationsService, financeService)
      : getReportingService(repo, maintenanceService, operationsService, financeService));
  const commsDispatcher =
    options.commsDispatcher ??
    (options.repo ? new OutboundCommunicationsDispatcher() : getCommunicationsDispatcher());
  const observability = options.observability ?? new ApiObservabilityTracker();
  const paymentWebhookService = new PaymentWebhookService(
    financeService,
    repo,
    () => options.paymentWebhookSecret ?? process.env.PAYMENT_WEBHOOK_SECRET
  );
  const jobRunner = new InstitutionalJobRunner({
    repo,
    authService,
    financeService,
    operationsService,
    notificationService,
    commsDispatcher,
  });
  const llm = getLlmClient();

  const authRateLimiter = new SlidingWindowRateLimiter(25, 60_000);
  const aiRateLimiter = new SlidingWindowRateLimiter(20, 60_000);
  const writeRateLimiter = new SlidingWindowRateLimiter(50, 60_000);

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeadersMiddleware);
  app.use(observability.middleware());
  const largeJsonParser = express.json({ limit: '8mb' });
  const defaultJsonParser = express.json({
    limit: '512kb',
    verify: (req, _res, buf) => {
      (req as RequestWithRawBody).rawBody = buf.toString('utf8');
    },
  });
  app.use((req, res, next) => {
    if (
      req.path === '/api/documents' ||
      req.path === '/api/admin/verification/import'
    ) {
      largeJsonParser(req, res, next);
      return;
    }
    defaultJsonParser(req, res, next);
  });

  // Attach verified server-side session & CSRF protection on all /api routes
  app.use('/api', attachServerSession(authService));
  app.use('/api', requireCsrfProtection);

  const enforceRateLimit = (
    limiter: SlidingWindowRateLimiter,
    req: AuthenticatedRequest,
    res: Response
  ): boolean => {
    const key = req.authUser?.id ?? req.ip ?? 'anonymous';
    const check = limiter.check(key);
    if (!check.allowed) {
      res.status(429).json({
        error: `Too many requests. Please wait ${check.retryAfterSec}s before trying again.`,
      });
      return false;
    }
    return true;
  };

  // ===========================================================================
  // 1. PUBLIC HEALTH, AI STATUS & AUTHENTICATION ENDPOINTS
  // ===========================================================================

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'hostelhub', timestamp: new Date().toISOString() });
  });

  app.get('/api/ai/status', (_req: Request, res: Response) => {
    res.json(llm.getStatus());
  });

  app.get('/api/auth/setup-status', (_req: Request, res: Response) => {
    const settings = authService.getSecuritySettings();
    res.json({
      needsInitialSetup: authService.needsInitialSetup(),
      supabaseConfigured: authService.isSupabaseConfigured(),
      allowedEmailDomain: settings.allowed_email_domain,
    });
  });

  app.post('/api/auth/bootstrap', (req: AuthenticatedRequest, res: Response) => {
    if (!enforceRateLimit(authRateLimiter, req, res)) return;
    if (!authService.needsInitialSetup()) {
      res.status(409).json({
        error: 'Initial campus setup has already been completed and is permanently locked.',
      });
      return;
    }
    const parsed = InitialSetupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Please enter strong passwords meeting all requirements.',
      });
      return;
    }
    try {
      const result = authService.claimInitialSetup({
        adminPassword: parsed.data.admin_password,
        wardenPassword: parsed.data.warden_password,
        maintenancePassword: parsed.data.maintenance_password,
        studentPassword: parsed.data.student_password,
      });
      res.status(201).json({
        ...result,
        message:
          'Initial credentials configured and setup permanently locked. Sign in through the appropriate role portal.',
      });
    } catch (err) {
      res.status(409).json({
        error: err instanceof Error ? err.message : 'Unable to complete initial setup.',
      });
    }
  });

  app.post('/api/auth/login', async (req: AuthenticatedRequest, res: Response) => {
    if (!enforceRateLimit(authRateLimiter, req, res)) return;
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Please enter your credentials and select a login portal.',
      });
      return;
    }

    const result = await authService.login({
      identifier: parsed.data.identifier,
      password: parsed.data.password,
      loginPortalRole: parsed.data.login_portal_role,
      mfaCode: parsed.data.mfa_code,
      ip: req.ip ?? 'local',
    });

    if (!result.ok) {
      res.status(result.statusCode).json({
        error: result.error,
        mfaRequired: Boolean(result.mfaRequired),
        locked: Boolean(result.locked),
      });
      return;
    }

    setSessionCookie(res, result.cookieValue, result.maxAgeSeconds, req);
    const sessionUser = authService.toSessionUser(result.user);
    res.json({
      user: sessionUser,
      redirectTo: ROLE_DASHBOARD_PATH[result.user.role],
      message: `Signed in to ${result.user.role} portal.`,
    });
  });

  app.post('/api/auth/logout', (req: AuthenticatedRequest, res: Response) => {
    authService.sessions.revokeSession(req.headers.cookie);
    clearSessionCookie(res, req);
    res.json({ ok: true, message: 'Signed out cleanly. Session invalidated on server.' });
  });

  app.get('/api/auth/me', (req: AuthenticatedRequest, res: Response) => {
    const user = getCurrentUser(req);
    if (!user) {
      res.json({
        authenticated: false,
        user: null,
        sessionExpired: Boolean(req.sessionExpired),
        ai_status: llm.getStatus(),
      });
      return;
    }
    res.json({
      authenticated: true,
      user: authService.toSessionUser(user),
      sessionExpired: false,
      ai_status: llm.getStatus(),
    });
  });

  app.post('/api/auth/register', async (req: AuthenticatedRequest, res: Response) => {
    if (!enforceRateLimit(authRateLimiter, req, res)) return;
    const parsed = StudentRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Please review the registration fields.',
        issues: parsed.error.issues,
      });
      return;
    }
    try {
      const { profile, verificationToken } = await authService.registerStudent(
        {
          fullName: parsed.data.full_name,
          email: parsed.data.email,
          studentCode: parsed.data.student_code,
          password: parsed.data.password,
          year: parsed.data.year,
          branch: parsed.data.branch,
          gender: parsed.data.gender,
        },
        repo
      );

      res.status(201).json({
        message:
          'Student account created with role STUDENT. Complete email verification below before signing in.',
        email: profile.email,
        student_code: profile.student_code,
        role: profile.role,
        ...(process.env.NODE_ENV !== 'production'
          ? { devVerificationToken: verificationToken }
          : {}),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to register student account.',
      });
    }
  });

  app.post('/api/auth/verify-email', (req: AuthenticatedRequest, res: Response) => {
    if (!enforceRateLimit(authRateLimiter, req, res)) return;
    const parsed = VerifyEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A valid verification token is required.' });
      return;
    }
    try {
      const verified = authService.verifyEmailToken(parsed.data.token);
      res.json({
        verified: true,
        email: verified.email,
        message: 'University email verified. You may now sign in through Student Login.',
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Verification failed.',
      });
    }
  });

  app.post('/api/auth/forgot-password', (req: AuthenticatedRequest, res: Response) => {
    if (!enforceRateLimit(authRateLimiter, req, res)) return;
    const parsed = ForgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    const result = authService.requestPasswordReset(parsed.data.email);
    res.json(result);
  });

  app.post('/api/auth/reset-password', (req: AuthenticatedRequest, res: Response) => {
    if (!enforceRateLimit(authRateLimiter, req, res)) return;
    const parsed = ResetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid reset token or password.',
      });
      return;
    }
    try {
      authService.completePasswordReset(parsed.data.token, parsed.data.new_password);
      res.json({
        ok: true,
        message: 'Password updated and all prior sessions revoked. Sign in with your new password.',
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to reset password.',
      });
    }
  });

  // ===========================================================================
  // 2. PUBLIC NOTICE BOARD OVERVIEW & HOSTEL RULES (READ-ONLY)
  // ===========================================================================

  app.get('/api/overview', async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const [blocks, rooms, students, runs, swapRequests, swapProposals, announcements] =
        await Promise.all([
          repo.getBlocks(),
          repo.getRooms(),
          repo.getStudents(),
          repo.getAllotmentRuns(),
          repo.getSwapRequests(),
          repo.getSwapProposals(),
          repo.getAnnouncements(),
        ]);

      const activeRun = runs.find((r) => r.applied) ?? runs[0] ?? null;
      const totalCapacity = rooms.reduce((sum, r) => sum + r.capacity, 0);
      const totalOccupied = rooms.reduce((sum, r) => sum + r.occupants.length, 0);

      const blockSummaries = blocks.map((b) => {
        const blockRooms = rooms.filter((r) => r.block_id === b.id);
        const cap = blockRooms.reduce((s, r) => s + r.capacity, 0);
        const occ = blockRooms.reduce((s, r) => s + r.occupants.length, 0);
        const availableRooms = blockRooms.filter((r) => r.occupants.length < r.capacity).length;
        return {
          ...b,
          room_count: blockRooms.length,
          capacity: cap,
          occupied: occ,
          available_rooms: availableRooms,
        };
      });

      const roomMap = new Map(rooms.map((r) => [r.id, r]));
      const blockMap = new Map(blocks.map((b) => [b.id, b]));
      const studentMap = new Map(students.map((s) => [s.id, s]));

      const sampleSwaps = swapRequests
        .filter((r) => r.status === 'open' || r.status === 'matched')
        .slice(0, 4)
        .map((r) => {
          const st = studentMap.get(r.student_id);
          const rm = roomMap.get(r.current_room_id);
          const blk = rm ? blockMap.get(rm.block_id) : null;
          return {
            id: r.id,
            student_name: st?.name ?? 'Student',
            student_code: st?.student_code ?? '',
            current_room: rm && blk ? `${blk.code}-${rm.number}` : r.current_room_id,
            note: r.wanted_criteria.note ?? 'Seeking room swap matching listed criteria.',
            status: r.status,
            created_at: r.created_at,
          };
        });

      res.json({
        announcements,
        blocks: blockSummaries,
        totals: {
          students: students.length,
          rooms: rooms.length,
          capacity: totalCapacity,
          occupied: totalOccupied,
          vacant_beds: Math.max(0, totalCapacity - totalOccupied),
          open_swaps: swapRequests.filter((r) => r.status === 'open' || r.status === 'matched').length,
          pending_proposals: swapProposals.filter((p) => p.status === 'pending').length,
        },
        active_run: activeRun
          ? {
              id: activeRun.id,
              label: activeRun.label,
              seed: activeRun.seed,
              created_at: activeRun.created_at,
              stats: activeRun.stats,
            }
          : null,
        sample_allotments: activeRun ? activeRun.results.slice(0, 5) : [],
        sample_swaps: sampleSwaps,
        ai_status: llm.getStatus(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load HostelHub overview.',
      });
    }
  });

  app.get('/api/rules', (_req: Request, res: Response) => {
    res.json({ content: readRulesMarkdown() });
  });

  // ===========================================================================
  // 3. AUTHENTICATED CAMPUS INVENTORY & ASSISTANT ROUTES
  // ===========================================================================

  app.get('/api/blocks', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const [blocks, rooms] = await Promise.all([repo.getBlocks(), repo.getRooms()]);
      const enriched = blocks.map((b) => {
        const bRooms = rooms.filter((r) => r.block_id === b.id);
        return {
          ...b,
          room_count: bRooms.length,
          capacity: bRooms.reduce((s, r) => s + r.capacity, 0),
          occupied: bRooms.reduce((s, r) => s + r.occupants.length, 0),
          available_rooms: bRooms.filter((r) => r.occupants.length < r.capacity).length,
        };
      });
      res.json({ blocks: enriched });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load hostel blocks.',
      });
    }
  });

  app.get('/api/rooms', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const blockId =
        typeof req.query.block_id === 'string' && req.query.block_id
          ? req.query.block_id
          : undefined;
      const floor =
        typeof req.query.floor === 'string' && req.query.floor
          ? Number(req.query.floor)
          : undefined;
      const ac =
        req.query.ac === 'true' ? true : req.query.ac === 'false' ? false : undefined;
      const capacity =
        typeof req.query.capacity === 'string' && req.query.capacity
          ? Number(req.query.capacity)
          : undefined;
      const availableOnly = req.query.available_only === 'true';
      const rawTags =
        typeof req.query.tags === 'string' && req.query.tags
          ? (req.query.tags.split(',').filter(Boolean) as RoomTag[])
          : undefined;

      const [rooms, blocks, students] = await Promise.all([
        repo.getRooms({
          block_id: blockId,
          floor: Number.isFinite(floor) ? floor : undefined,
          ac,
          capacity: Number.isFinite(capacity) ? capacity : undefined,
          available_only: availableOnly,
          tags: rawTags,
        }),
        repo.getBlocks(),
        repo.getStudents(),
      ]);

      const blockMap = new Map(blocks.map((b) => [b.id, b]));
      const studentMap = new Map(students.map((s) => [s.id, s]));

      const enriched = rooms.map((room) => {
        const block = blockMap.get(room.block_id);
        return {
          ...room,
          block_name: block?.name ?? '',
          block_code: block?.code ?? '',
          gender_type: block?.gender_type ?? 'boys',
          occupant_details: room.occupants.map((oid) => {
            const st = studentMap.get(oid);
            return {
              id: oid,
              name: st?.name ?? 'Resident',
              year: st?.year ?? 1,
              branch: st?.branch ?? '',
            };
          }),
        };
      });

      res.json({ rooms: enriched, blocks });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to fetch room inventory.',
      });
    }
  });

  // Room creation & edits: ADMIN (any block) or WARDEN (strictly assigned blocks only)
  app.post(
    '/api/rooms',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = CreateRoomSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid room payload.',
          issues: parsed.error.issues,
        });
        return;
      }

      if (!verifyBlockAccessOrRespond(user, parsed.data.block_id, res)) return;

      try {
        const created = await (repo as IHostelRepository & {
          createRoom(input: typeof parsed.data, actor: string, actorRole?: typeof user.role): Promise<Room>;
        }).createRoom(parsed.data, user.email, user.role);
        res.status(201).json({ room: created });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to create room.',
        });
      }
    }
  );

  app.patch(
    '/api/rooms/:id',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const roomId = String(req.params.id);
      const existing = await repo.getRoomById(roomId);
      if (!existing) {
        res.status(404).json({ error: `Room '${roomId}' not found.` });
        return;
      }

      if (!verifyBlockAccessOrRespond(user, existing.block_id, res)) return;

      const parsed = UpdateRoomSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid room update payload.',
          issues: parsed.error.issues,
        });
        return;
      }
      try {
        const updated = await (repo as IHostelRepository & {
          updateRoom(id: string, input: typeof parsed.data, actor: string, actorRole?: typeof user.role): Promise<Room>;
        }).updateRoom(roomId, parsed.data, user.email, user.role);
        res.json({ room: updated });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to update room.',
        });
      }
    }
  );

  app.post('/api/rooms/search-nl', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (!enforceRateLimit(aiRateLimiter, req, res)) return;
    const user = getCurrentUser(req)!;
    const parsed = NaturalLanguageSearchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Please enter a valid room search query.',
      });
      return;
    }

    try {
      const { filter, provider, cached } = await llm.parseNaturalLanguageRoomSearch(
        parsed.data.query
      );

      const [allRooms, blocks, activeStudent] = await Promise.all([
        repo.getRooms(),
        repo.getBlocks(),
        user.student_id ? repo.getStudentById(user.student_id) : Promise.resolve(null),
      ]);

      const blockMap = new Map(blocks.map((b) => [b.id, b]));

      const eligibleRooms = allRooms.filter((room) => {
        const block = blockMap.get(room.block_id);
        if (!block) return false;
        if (activeStudent && !isGenderCompatibleWithBlock(activeStudent.gender, block)) {
          return false;
        }
        return true;
      });

      const matches = eligibleRooms
        .map((room) => {
          const block = blockMap.get(room.block_id)!;
          const reasons: string[] = [];
          let score = 0;

          if (filter.block) {
            const matchesBlock =
              block.name.toLowerCase().includes(filter.block.toLowerCase()) ||
              block.code.toLowerCase() === filter.block.toLowerCase();
            if (!matchesBlock) return null;
            score += 20;
            reasons.push(`in ${block.name}`);
          }

          if (filter.floor_min !== null && room.floor < filter.floor_min) return null;
          if (filter.floor_max !== null && room.floor > filter.floor_max) return null;
          if (filter.floor_min !== null || filter.floor_max !== null) {
            score += 15;
            reasons.push(`Floor ${room.floor}`);
          }

          if (filter.ac !== null && room.ac !== filter.ac) return null;
          if (filter.ac !== null) {
            score += 15;
            reasons.push(room.ac ? 'AC equipped' : 'Non-AC');
          }

          if (filter.capacity !== null && room.capacity !== filter.capacity) return null;
          if (filter.capacity !== null) {
            score += 12;
            reasons.push(`${room.capacity}-seater`);
          }

          if (filter.tags.length > 0) {
            const matchedTags = filter.tags.filter((t) => room.tags.includes(t));
            if (matchedTags.length === 0) return null;
            score += matchedTags.length * 14;
            reasons.push(`tags: ${matchedTags.join(', ')}`);
          }

          const hasVacancy = room.occupants.length < room.capacity;
          if (hasVacancy) {
            score += 10;
            reasons.push(`${room.capacity - room.occupants.length} open slot(s)`);
          }

          return {
            room: {
              ...room,
              block_name: block.name,
              block_code: block.code,
              gender_type: block.gender_type,
            },
            score,
            explanation:
              reasons.length > 0
                ? `Matched: ${reasons.join(' · ')}.`
                : `Eligible room in ${block.name}, Floor ${room.floor}.`,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => b.score - a.score || a.room.number.localeCompare(b.room.number))
        .slice(0, 24);

      res.json({
        query: parsed.data.query,
        extracted_filter: filter,
        provider,
        cached,
        ai_status: llm.getStatus(),
        matches,
      });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Room search encountered an issue. Try using the manual filters on the left.',
      });
    }
  });

  // ===========================================================================
  // 4. STUDENT-STRICT WORKSPACE ENDPOINTS
  // ===========================================================================

  app.get(
    '/api/students/me',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const user = getCurrentUser(req)!;
        if (!user.student_id) {
          res.status(404).json({ error: 'Student profile is not linked to this account.' });
          return;
        }
        const [
          student,
          allStudents,
          rooms,
          blocks,
          runs,
          swapRequests,
          swapProposals,
          announcements,
          disputes,
        ] = await Promise.all([
          repo.getStudentById(user.student_id),
          repo.getStudents(),
          repo.getRooms(),
          repo.getBlocks(),
          repo.getAllotmentRuns(),
          repo.getSwapRequests(),
          repo.getSwapProposals(),
          repo.getAnnouncements(),
          repo.getDisputes(),
        ]);

        if (!student) {
          res.status(404).json({ error: 'Student profile not found.' });
          return;
        }

        const blockMap = new Map(blocks.map((b) => [b.id, b]));
        const roomMap = new Map(rooms.map((r) => [r.id, r]));
        const studentMap = new Map(allStudents.map((s) => [s.id, s]));

        const allottedRoomRaw = student.allotted_room_id
          ? roomMap.get(student.allotted_room_id) ?? null
          : null;
        const allottedBlock = allottedRoomRaw ? blockMap.get(allottedRoomRaw.block_id) ?? null : null;

        const roommates = allottedRoomRaw
          ? allottedRoomRaw.occupants
              .filter((oid) => oid !== student.id)
              .map((oid) => studentMap.get(oid))
              .filter((s): s is NonNullable<typeof s> => Boolean(s))
              .map((s) => ({
                id: s.id,
                name: s.name,
                student_code: s.student_code,
                year: s.year,
                branch: s.branch,
                sleep_schedule: s.sleep_schedule,
                study_style: s.study_style,
                cleanliness: s.cleanliness,
              }))
          : [];

        const activeRun = runs.find((r) => r.applied) ?? runs[0] ?? null;
        const allotmentRecord =
          activeRun?.results.find((r) => r.student_id === student.id) ?? null;
        const unallottedRecord =
          activeRun?.unallotted.find((u) => u.student_id === student.id) ?? null;

        const mySwapRequests = swapRequests.filter((r) => r.student_id === student.id);
        const myProposals = swapProposals.filter((p) =>
          p.cycle.some((step) => step.student_id === student.id)
        );
        const topRoommates = findTopRoommateMatches(student, allStudents, 5);
        const myDisputes = disputes.filter((d) => d.student_id === student.id);

        const eligibleRooms: Array<Room & { block_name: string; block_code: string }> = rooms
          .filter((r) => {
            const blk = blockMap.get(r.block_id);
            return blk ? isGenderCompatibleWithBlock(student.gender, blk) : false;
          })
          .map((r) => {
            const blk = blockMap.get(r.block_id)!;
            return { ...r, block_name: blk.name, block_code: blk.code };
          });

        res.json({
          student,
          allotted_room:
            allottedRoomRaw && allottedBlock
              ? {
                  ...allottedRoomRaw,
                  block_name: allottedBlock.name,
                  block_code: allottedBlock.code,
                  warden_name: allottedBlock.warden_name,
                }
              : null,
          roommates,
          active_run: activeRun
            ? {
                id: activeRun.id,
                label: activeRun.label,
                seed: activeRun.seed,
                created_at: activeRun.created_at,
                stats: activeRun.stats,
              }
            : null,
          allotment_record: allotmentRecord,
          unallotted_record: unallottedRecord,
          swap_requests: mySwapRequests,
          swap_proposals: myProposals,
          top_roommates: topRoommates,
          announcements,
          disputes: myDisputes,
          eligible_rooms: eligibleRooms,
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Unable to load student workspace.',
        });
      }
    }
  );

  // Strict Zod validation automatically strips any unauthorized fields such as `role` or `allotted_room_id`
  app.put(
    '/api/students/me',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      if (!user.student_id) {
        res.status(404).json({ error: 'Student profile not found.' });
        return;
      }

      const parsed = UpdateStudentProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Please review the highlighted profile fields.',
          issues: parsed.error.issues,
        });
        return;
      }

      try {
        const updated = await repo.updateStudent(user.student_id, parsed.data, user.email);
        res.json({
          student: updated,
          message: 'Preferences successfully submitted.',
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to save student profile.',
        });
      }
    }
  );

  app.get(
    '/api/roommates/matches',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const user = getCurrentUser(req)!;
        if (!user.student_id) {
          res.status(404).json({ error: 'Student profile not found.' });
          return;
        }
        const [student, allStudents, rooms, blocks] = await Promise.all([
          repo.getStudentById(user.student_id),
          repo.getStudents(),
          repo.getRooms(),
          repo.getBlocks(),
        ]);
        if (!student) {
          res.status(404).json({ error: 'Student not found.' });
          return;
        }

        const roomMap = new Map(rooms.map((r) => [r.id, r]));
        const blockMap = new Map(blocks.map((b) => [b.id, b]));

        const matches = findTopRoommateMatches(student, allStudents, 5).map((m) => {
          const room = m.student.allotted_room_id ? roomMap.get(m.student.allotted_room_id) : null;
          const block = room ? blockMap.get(room.block_id) : null;
          return {
            ...m,
            room_label: room && block ? `${block.code}-${room.number}` : 'Unallotted',
          };
        });

        res.json({
          student_preferences: {
            sleep_schedule: student.sleep_schedule,
            study_style: student.study_style,
            cleanliness: student.cleanliness,
            about_me: student.about_me,
            roommate_requests: student.roommate_requests,
          },
          matches,
          disclaimer:
            'Compatibility percentages are deterministic rule-based estimates computed from sleep schedule, study style, cleanliness ratings, and optional bio keywords—not a guaranteed prediction.',
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Unable to compute roommate matches.',
        });
      }
    }
  );

  app.post(
    '/api/roommates/request',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      if (!user.student_id) {
        res.status(403).json({ error: 'Student account required.' });
        return;
      }
      const parsed = ToggleRoommateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Valid target student ID is required.' });
        return;
      }

      try {
        const updated = await repo.toggleRoommateRequest(
          user.student_id,
          parsed.data.target_student_id
        );
        const isAdded = updated.roommate_requests.includes(parsed.data.target_student_id);
        res.json({
          student: updated,
          message: isAdded
            ? 'Roommate request sent. If they also request you, the allotment engine will try to place you together.'
            : 'Roommate request withdrawn.',
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Could not update roommate request.',
        });
      }
    }
  );

  // ===========================================================================
  // 5. WARDEN-SCOPED DASHBOARD & OPERATIONS (STRICTLY ASSIGNED BLOCKS ONLY)
  // ===========================================================================

  app.get(
    '/api/warden/dashboard',
    requireRole('WARDEN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const user = getCurrentUser(req)!;
        const assignedSet = new Set(user.assigned_block_ids);

        const [blocks, rooms, students, swapRequests, swapProposals, disputes, announcements] =
          await Promise.all([
            repo.getBlocks(),
            repo.getRooms(),
            repo.getStudents(),
            repo.getSwapRequests(),
            repo.getSwapProposals(),
            repo.getDisputes(),
            repo.getAnnouncements(),
          ]);

        const assignedBlocks = blocks.filter((b) => assignedSet.has(b.id));
        const assignedRooms = rooms.filter((r) => assignedSet.has(r.block_id));
        const assignedRoomIds = new Set(assignedRooms.map((r) => r.id));
        const roomMap = new Map(rooms.map((r) => [r.id, r]));
        const blockMap = new Map(blocks.map((b) => [b.id, b]));
        const studentMap = new Map(students.map((s) => [s.id, s]));

        const blockSummaries = assignedBlocks.map((b) => {
          const bRooms = assignedRooms.filter((r) => r.block_id === b.id);
          return {
            ...b,
            room_count: bRooms.length,
            capacity: bRooms.reduce((s, r) => s + r.capacity, 0),
            occupied: bRooms.reduce((s, r) => s + r.occupants.length, 0),
            available_rooms: bRooms.filter((r) => r.occupants.length < r.capacity).length,
          };
        });

        const scopedStudents = students
          .filter((s) => s.allotted_room_id && assignedRoomIds.has(s.allotted_room_id))
          .map((s) => {
            const rm = roomMap.get(s.allotted_room_id!);
            const blk = rm ? blockMap.get(rm.block_id) : null;
            return {
              id: s.id,
              student_code: s.student_code,
              name: s.name,
              email: s.email,
              year: s.year,
              branch: s.branch,
              gender: s.gender,
              allotted_room_id: s.allotted_room_id,
              allotted_room_label: rm && blk ? `${blk.code}-${rm.number}` : null,
              block_id: rm?.block_id ?? null,
            };
          });

        const scopedStudentIds = new Set(scopedStudents.map((s) => s.id));

        const scopedSwaps = swapRequests
          .filter(
            (r) =>
              assignedRoomIds.has(r.current_room_id) ||
              (r.wanted_criteria.block_id && assignedSet.has(r.wanted_criteria.block_id))
          )
          .map((r) => {
            const st = studentMap.get(r.student_id);
            const rm = roomMap.get(r.current_room_id);
            const blk = rm ? blockMap.get(rm.block_id) : null;
            return {
              ...r,
              student_name: st?.name ?? 'Student',
              student_code: st?.student_code ?? '',
              current_room_label: rm && blk ? `${blk.code}-${rm.number}` : r.current_room_id,
              block_id: rm?.block_id ?? null,
            };
          });

        const scopedProposals = swapProposals.filter((p) =>
          p.cycle.some(
            (step) =>
              assignedRoomIds.has(step.from_room_id) || assignedRoomIds.has(step.to_room_id)
          )
        );

        const scopedDisputes = disputes.filter((d) => scopedStudentIds.has(d.student_id));
        const scopedAnnouncements = announcements.filter(
          (a) => !a.block_id || assignedSet.has(a.block_id)
        );

        res.json({
          warden: {
            id: user.id,
            name: user.full_name,
            email: user.email,
            assigned_block_ids: user.assigned_block_ids,
          },
          blocks: blockSummaries,
          rooms: assignedRooms.map((r) => {
            const blk = blockMap.get(r.block_id);
            return {
              ...r,
              block_name: blk?.name ?? '',
              block_code: blk?.code ?? '',
            };
          }),
          students: scopedStudents,
          swap_requests: scopedSwaps,
          swap_proposals: scopedProposals,
          disputes: scopedDisputes,
          announcements: scopedAnnouncements,
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Unable to load Warden dashboard.',
        });
      }
    }
  );

  // Notices: ADMIN can post global or block notice; WARDEN can post ONLY for assigned blocks
  app.post(
    '/api/notices',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = CreateNoticeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid hostel notice fields.',
        });
        return;
      }

      if (user.role === 'WARDEN') {
        if (!parsed.data.block_id) {
          res.status(403).json({
            code: 'BLOCK_SCOPE_DENIED',
            error: 'Wardens must select one of their assigned hostel blocks when issuing a notice.',
          });
          return;
        }
        if (!verifyBlockAccessOrRespond(user, parsed.data.block_id, res)) return;
      }

      try {
        const notice = await repo.createAnnouncement({
          title: parsed.data.title,
          body: parsed.data.body,
          issued_by: `${user.full_name} (${user.role === 'ADMIN' ? 'Chief Warden Office' : 'Block Warden'})`,
          block_id: parsed.data.block_id ?? null,
          priority: parsed.data.priority,
          actorRole: user.role,
        });
        res.status(201).json({ notice, message: 'Hostel notice pinned to the notice board.' });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to publish notice.',
        });
      }
    }
  );

  // ===========================================================================
  // 6. SWAPS, ALLOTMENTS, ASSISTANT & DISPUTES
  // ===========================================================================

  app.get(
    '/api/allotment/runs',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const runs = await repo.getAllotmentRuns();
      if (user.role === 'ADMIN') {
        res.json({ runs });
        return;
      }
      const appliedRun = runs.find((r) => r.applied) ?? runs[0];
      res.json({
        runs: appliedRun
          ? [
              {
                ...appliedRun,
                results: appliedRun.results.slice(0, 60),
              },
            ]
          : [],
      });
    }
  );

  app.get(
    '/api/swaps',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const [requests, proposals, students, rooms, blocks] = await Promise.all([
        repo.getSwapRequests(),
        repo.getSwapProposals(),
        repo.getStudents(),
        repo.getRooms(),
        repo.getBlocks(),
      ]);

      const studentMap = new Map(students.map((s) => [s.id, s]));
      const roomMap = new Map(rooms.map((r) => [r.id, r]));
      const blockMap = new Map(blocks.map((b) => [b.id, b]));

      const enrichedRequests = requests.map((reqItem) => {
        const st = studentMap.get(reqItem.student_id);
        const rm = roomMap.get(reqItem.current_room_id);
        const blk = rm ? blockMap.get(rm.block_id) : null;
        const wantedRoomLabels = (reqItem.wanted_criteria.preferred_room_ids ?? []).map((rid) => {
          const targetRoom = roomMap.get(rid);
          const targetBlock = targetRoom ? blockMap.get(targetRoom.block_id) : null;
          return targetRoom && targetBlock ? `${targetBlock.code}-${targetRoom.number}` : rid;
        });
        const wantedBlockName = reqItem.wanted_criteria.block_id
          ? blockMap.get(reqItem.wanted_criteria.block_id)?.name ?? null
          : null;

        return {
          ...reqItem,
          student_name: st?.name ?? 'Student',
          student_code: st?.student_code ?? '',
          student_gender: st?.gender ?? 'male',
          student_year: st?.year ?? 1,
          current_room_label: rm && blk ? `${blk.code}-${rm.number}` : reqItem.current_room_id,
          current_room_block_id: rm?.block_id ?? null,
          current_room_meta: rm
            ? {
                floor: rm.floor,
                capacity: rm.capacity,
                ac: rm.ac,
                tags: rm.tags,
                block_name: blk?.name ?? '',
              }
            : null,
          wanted_room_labels: wantedRoomLabels,
          wanted_block_name: wantedBlockName,
        };
      });

      res.json({ requests: enrichedRequests, proposals });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to load swap marketplace.',
      });
    }
  });

  app.post(
    '/api/swaps/requests',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      if (!user.student_id) {
        res.status(403).json({ error: 'Student account required to post a swap request.' });
        return;
      }

      const parsed = CreateSwapRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid swap request details.',
        });
        return;
      }

      try {
        const created = await repo.createSwapRequest(user.student_id, parsed.data.wanted_criteria);
        const newProposals = await repo.discoverAndCreateProposals(user.email);
        res.status(201).json({
          request: created,
          discovered_proposals: newProposals,
          message:
            newProposals.length > 0
              ? `Swap notice posted and matched into ${newProposals.length} feasible swap cycle(s)!`
              : 'Swap chit pinned to the notice board. You will be notified as soon as a 2-way, 3-way, or 4-way cycle matches.',
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Could not post swap request.',
        });
      }
    }
  );

  app.delete(
    '/api/swaps/requests/:id',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const requestId = String(req.params.id);

      const allRequests = await repo.getSwapRequests();
      const target = allRequests.find((r) => r.id === requestId);
      if (!target) {
        res.status(404).json({ error: `Swap request '${requestId}' not found.` });
        return;
      }

      if (user.role === 'STUDENT' && target.student_id !== user.student_id) {
        res.status(403).json({
          code: 'FORBIDDEN',
          error: 'You can only cancel your own swap request.',
        });
        return;
      }

      if (user.role === 'WARDEN') {
        const room = await repo.getRoomById(target.current_room_id);
        if (!room || !canAccessBlock(user, room.block_id)) {
          res.status(403).json({
            code: 'BLOCK_SCOPE_DENIED',
            error: 'Wardens can only moderate swap requests originating from their assigned blocks.',
          });
          return;
        }
      }

      try {
        const cancelled = await (repo as IHostelRepository & {
          cancelSwapRequest(
            requestId: string,
            studentId: string,
            isPrivileged: boolean,
            actorEmail?: string,
            actorRole?: typeof user.role
          ): Promise<unknown>;
        }).cancelSwapRequest(
          requestId,
          user.student_id ?? '',
          user.role === 'ADMIN' || user.role === 'WARDEN',
          user.email,
          user.role
        );
        res.json({ request: cancelled, message: 'Swap request removed from the board.' });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to cancel swap request.',
        });
      }
    }
  );

  app.post(
    '/api/swaps/discover',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
    if (!enforceRateLimit(writeRateLimiter, req, res)) return;
    const user = getCurrentUser(req)!;
    try {
      const created = await repo.discoverAndCreateProposals(user.email);
      res.json({
        created_proposals: created,
        message:
          created.length > 0
            ? `Discovered ${created.length} new feasible swap cycle(s). All participants must accept before execution.`
            : 'No new complete 2-way, 3-way, or 4-way cycles found among currently unmatched open notices.',
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Swap cycle discovery failed.',
      });
    }
  });

  app.post(
    '/api/swaps/proposals/:id/respond',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = SwapProposalActionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Action must be either "accept" or "reject".' });
        return;
      }
      if (!user.student_id) {
        res.status(403).json({
          error: 'Only a participating student can accept or reject a swap proposal.',
        });
        return;
      }

      try {
        const result = await repo.respondToSwapProposal({
          proposalId: String(req.params.id),
          studentId: user.student_id,
          action: parsed.data.action,
        });
        res.json(result);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to process swap proposal response.',
        });
      }
    }
  );

  app.post('/api/assistant/ask', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (!enforceRateLimit(aiRateLimiter, req, res)) return;
    const parsed = AssistantQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Please enter a hostel policy question.',
      });
      return;
    }

    try {
      const matched = retrieveMatchingRuleSections(parsed.data.question);
      const reply = await llm.answerGroundedPolicyQuestion({
        question: parsed.data.question,
        matchedExcerpts: matched.map((m) => ({
          heading: m.heading,
          content: m.content,
        })),
      });

      res.json({
        answer: reply.answer,
        grounded: reply.grounded,
        sources: matched.map((m) => m.heading),
        provider: reply.provider,
        cached: reply.cached,
        ai_status: llm.getStatus(),
      });
    } catch {
      res.status(503).json({
        error: 'Warden abhi busy hain. Thodi der baad try karo.',
      });
    }
  });

  app.get(
    '/api/disputes',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
    const user = getCurrentUser(req)!;
    const all = await repo.getDisputes();
    if (user.role === 'ADMIN') {
      res.json({ disputes: all });
      return;
    }
    if (user.role === 'WARDEN') {
      const [students, rooms] = await Promise.all([repo.getStudents(), repo.getRooms()]);
      const roomMap = new Map(rooms.map((r) => [r.id, r]));
      const studentMap = new Map(students.map((s) => [s.id, s]));
      const scoped = all.filter((d) => {
        const st = studentMap.get(d.student_id);
        const rm = st?.allotted_room_id ? roomMap.get(st.allotted_room_id) : null;
        return rm ? canAccessBlock(user, rm.block_id) : false;
      });
      res.json({ disputes: scoped });
      return;
    }
    res.json({
      disputes: all.filter((d) => d.student_id === user.student_id),
    });
  });

  app.post(
    '/api/disputes',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      if (!user.student_id) {
        res.status(403).json({ error: 'Student account required to submit a complaint.' });
        return;
      }
      const parsed = CreateDisputeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Please fill in subject and description.',
        });
        return;
      }
      try {
        const dispute = await repo.createDispute({
          studentId: user.student_id,
          ...parsed.data,
        });
        res.status(201).json({
          dispute,
          message: 'Dispute logged in the Warden Office register.',
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Failed to log dispute.',
        });
      }
    }
  );

  app.patch(
    '/api/disputes/:id',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const disputeId = String(req.params.id);

      const allDisputes = await repo.getDisputes();
      const targetDispute = allDisputes.find((d) => d.id === disputeId);
      if (!targetDispute) {
        res.status(404).json({ error: `Dispute '${disputeId}' not found.` });
        return;
      }

      if (user.role === 'WARDEN') {
        const student = await repo.getStudentById(targetDispute.student_id);
        const room = student?.allotted_room_id ? await repo.getRoomById(student.allotted_room_id) : null;
        if (!room || !canAccessBlock(user, room.block_id)) {
          res.status(403).json({
            code: 'BLOCK_SCOPE_DENIED',
            error: 'Wardens may only resolve complaints from students residing in their assigned blocks.',
          });
          return;
        }
      }

      const parsed = UpdateDisputeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid dispute status update.' });
        return;
      }
      try {
        const updated = await repo.updateDispute(
          disputeId,
          parsed.data.status,
          parsed.data.resolution_note,
          user.email,
          user.role
        );
        res.json({ dispute: updated, message: 'Dispute register entry updated.' });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Failed to update dispute.',
        });
      }
    }
  );

  // ===========================================================================
  // 7. STRICT ADMIN-ONLY ENDPOINTS (ALLOTMENT, ACCOUNTS, ROLES, MFA, SECURITY)
  // ===========================================================================

  app.get(
    '/api/students',
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const [students, rooms, blocks] = await Promise.all([
          repo.getStudents(),
          repo.getRooms(),
          repo.getBlocks(),
        ]);
        const roomMap = new Map(rooms.map((r) => [r.id, r]));
        const blockMap = new Map(blocks.map((b) => [b.id, b]));

        const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
        const filtered = search
          ? students.filter(
              (s) =>
                s.name.toLowerCase().includes(search) ||
                s.student_code.toLowerCase().includes(search) ||
                s.branch.toLowerCase().includes(search)
            )
          : students;

        res.json({
          students: filtered.map((s) => {
            const room = s.allotted_room_id ? roomMap.get(s.allotted_room_id) : null;
            const block = room ? blockMap.get(room.block_id) : null;
            return {
              ...s,
              allotted_room_label: room && block ? `${block.code}-${room.number}` : null,
            };
          }),
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to load student directory.',
        });
      }
    }
  );

  app.get(
    '/api/allotment/rules',
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      const rules = await repo.getAllotmentRules();
      res.json({ rules });
    }
  );

  app.put(
    '/api/allotment/rules',
    requirePermission('allotment:manage'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = AllotmentRulesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid allotment rule parameters.',
        });
        return;
      }
      const updated = await repo.updateAllotmentRules(parsed.data, user.email);
      res.json({ rules: updated, message: 'Allotment scoring weights saved.' });
    }
  );

  app.post(
    '/api/allotment/runs',
    requirePermission('allotment:manage'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = RunAllotmentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid allotment run configuration.',
        });
        return;
      }

      try {
        const run = await repo.executeAllotmentRun({
          ...parsed.data,
          actor: user.email,
        });
        res.status(201).json({
          run,
          message: parsed.data.apply_immediately
            ? `Allotment run "${run.label}" executed and published officially.`
            : `Simulation run "${run.label}" completed (${run.stats.runtime_ms}ms). Review and compare before applying.`,
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Allotment engine execution failed.',
        });
      }
    }
  );

  app.post(
    '/api/allotment/runs/:id/apply',
    requirePermission('allotment:manage'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      try {
        const applied = await repo.applyAllotmentRun(String(req.params.id), user.email);
        res.json({
          run: applied,
          message: `Run "${applied.label}" is now the official active hostel allotment.`,
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Could not apply allotment run.',
        });
      }
    }
  );

  app.put(
    '/api/rules',
    requirePermission('settings:manage'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = UpdateRulesMarkdownSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Rules markdown content is invalid.',
        });
        return;
      }
      try {
        writeRulesMarkdown(parsed.data.content);
        await repo.appendAuditLog(user.email, 'ADMIN', 'HOSTEL_RULES_UPDATED', {
          length: parsed.data.content.length,
        });
        res.json({ content: parsed.data.content, message: 'Official hostel rules manual updated.' });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Unable to save hostel rules.',
        });
      }
    }
  );

  app.get(
    '/api/audit-logs',
    requirePermission('audit:read'),
    async (_req: AuthenticatedRequest, res: Response) => {
      const logs = await repo.getAuditLogs(150);
      res.json({ logs });
    }
  );

  // Admin Account & Role Management
  app.get(
    '/api/admin/accounts',
    requirePermission('roles:manage'),
    (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const accounts = authService.listAllAccounts(user);
      res.json({ accounts });
    }
  );

  app.post(
    '/api/admin/accounts/provision',
    requirePermission('wardens:manage'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = ProvisionStaffSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid staff account provisioning details.',
        });
        return;
      }

      try {
        const blocks = await repo.getBlocks();
        const validBlockIds = new Set(blocks.map((b) => b.id));
        const { profile, activationToken } = authService.provisionStaffAccount(user, {
          fullName: parsed.data.full_name,
          email: parsed.data.email,
          role: parsed.data.role,
          assignedBlockIds: parsed.data.assigned_block_ids,
          validBlockIds,
          initialPassword: parsed.data.initial_password,
        });

        await repo.appendAuditLog(user.email, 'ADMIN', `PROVISIONED_${profile.role}_ACCOUNT`, {
          target_user_id: profile.id,
          email: profile.email,
          assigned_block_ids: profile.assigned_block_ids,
        });

        res.status(201).json({
          account: profile,
          message: parsed.data.initial_password
            ? `${profile.role} account provisioned and activated for ${profile.email}.`
            : `${profile.role} account provisioned. Share the one-time activation token so they can set their password.`,
          ...(process.env.NODE_ENV !== 'production' ? { devActivationToken: activationToken } : {}),
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to provision staff account.',
        });
      }
    }
  );

  app.patch(
    '/api/admin/accounts/:id',
    requirePermission('roles:manage'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const targetUserId = String(req.params.id);
      const parsed = UpdateAccountAccessSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid account update payload.',
        });
        return;
      }

      try {
        const blocks = await repo.getBlocks();
        const validBlockIds = new Set(blocks.map((b) => b.id));
        const updated = authService.updateAccountAccess(
          user,
          targetUserId,
          parsed.data,
          validBlockIds
        );

        await repo.appendAuditLog(user.email, 'ADMIN', 'ACCOUNT_ACCESS_UPDATED', {
          target_user_id: targetUserId,
          role: updated.role,
          status: updated.status,
          assigned_block_ids: updated.assigned_block_ids,
        });

        res.json({
          account: updated,
          message: `Account permissions updated for ${updated.email}.`,
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to update account access.',
        });
      }
    }
  );

  app.get(
    '/api/admin/audit-logs',
    requirePermission('audit:read'),
    (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const logs = authService.getAdminAuditLogs(user, 150);
      res.json({ logs });
    }
  );

  app.get(
    '/api/admin/security-settings',
    requirePermission('settings:manage'),
    (_req: AuthenticatedRequest, res: Response) => {
      res.json({ settings: authService.getSecuritySettings() });
    }
  );

  app.put(
    '/api/admin/security-settings',
    requirePermission('settings:manage'),
    (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = UpdateSecuritySettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid security settings payload.',
        });
        return;
      }
      try {
        const settings = authService.updateSecuritySettings(user, parsed.data);
        res.json({ settings, message: 'Global system security settings updated.' });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to update security settings.',
        });
      }
    }
  );

  // Admin TOTP MFA Enrollment & Management
  app.post(
    '/api/admin/mfa/setup',
    requireRole('ADMIN'),
    (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      try {
        const result = authService.beginAdminMfaSetup(user);
        res.json({
          ...result,
          message: 'Add this secret to your authenticator app and enter the 6-digit code to enable MFA.',
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to begin MFA setup.',
        });
      }
    }
  );

  app.post(
    '/api/admin/mfa/confirm',
    requireRole('ADMIN'),
    (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const parsed = VerifyMfaSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Enter a valid 6-digit verification code.' });
        return;
      }
      try {
        const updated = authService.confirmAdminMfaSetup(user, parsed.data.code);
        res.json({
          user: authService.toSessionUser(updated),
          message: 'Admin Multi-Factor Authentication (TOTP) is now active.',
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to verify MFA code.',
        });
      }
    }
  );

  app.post(
    '/api/admin/mfa/disable',
    requireRole('ADMIN'),
    (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      try {
        const updated = authService.disableAdminMfa(user);
        res.json({
          user: authService.toSessionUser(updated),
          message: 'Admin Multi-Factor Authentication disabled.',
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to disable MFA.',
        });
      }
    }
  );

  // Admin Environment & Institutional Integration Readiness (zero secret exposure)
  app.get(
    '/api/admin/environment',
    requirePermission('environment:read'),
    (_req: AuthenticatedRequest, res: Response) => {
      const summary = validateServerEnv();
      res.json(summary);
    }
  );

  // ===========================================================================
  // MAINTENANCE STAFF & WORK ORDER ROUTES (STRICTLY SCOPED — ZERO STUDENT PII)
  // ===========================================================================
  app.get(
    '/api/maintenance/tasks',
    requirePermission('maintenance:read_assigned'),
    (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const tasks = maintenanceService.listTasksForUser(user);
      res.json({ tasks });
    }
  );

  app.get(
    '/api/maintenance/tasks/:id',
    requirePermission('maintenance:read_assigned'),
    (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const task = maintenanceService.getTaskByIdForUser(user, String(req.params.id));
      if (!task) {
        res.status(404).json({
          error: 'Maintenance ticket not found or outside your authorized assignment scope.',
        });
        return;
      }
      res.json({ task });
    }
  );

  app.post(
    '/api/maintenance/tasks',
    requirePermission('maintenance:assign'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = CreateMaintenanceTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid maintenance ticket payload.',
        });
        return;
      }
      const blocks = await repo.getBlocks();
      const block = blocks.find((b) => b.id === parsed.data.block_id);
      if (!block) {
        res.status(404).json({ error: 'Hostel block not found.' });
        return;
      }
      if (!verifyBlockAccessOrRespond(user, block.id, res)) return;

      let assigneeName: string | null = null;
      if (parsed.data.assigned_to_id) {
        const assignee = authService.getUserProfileById(parsed.data.assigned_to_id);
        if (!assignee || assignee.role !== 'MAINTENANCE_STAFF' || assignee.status !== 'active') {
          res.status(400).json({ error: 'Assigned user must be an active Maintenance Staff account.' });
          return;
        }
        assigneeName = assignee.full_name;
      }

      try {
        const task = maintenanceService.createTask(user, {
          block_id: block.id,
          block_name: block.name,
          floor: parsed.data.floor,
          room_number: parsed.data.room_number,
          category: parsed.data.category,
          priority: parsed.data.priority,
          summary: parsed.data.summary,
          location_detail: parsed.data.location_detail,
          assigned_to_id: parsed.data.assigned_to_id ?? null,
          assigned_to_name: assigneeName,
        });
        await repo.appendAuditLog(user.email, user.role, 'MAINTENANCE_TASK_CREATED', {
          task_id: task.id,
          ticket_code: task.ticket_code,
          block_id: task.block_id,
          assigned_to_id: task.assigned_to_id,
          correlation_id: req.correlationId ?? null,
        });
        res.status(201).json({ task, message: `Maintenance work order ${task.ticket_code} created.` });
      } catch (err) {
        res.status(403).json({
          error: err instanceof Error ? err.message : 'Unable to create maintenance work order.',
        });
      }
    }
  );

  app.patch(
    '/api/maintenance/tasks/:id',
    requirePermission('maintenance:update_assigned'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const taskId = String(req.params.id);
      const parsed = UpdateMaintenanceTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid maintenance ticket update.',
        });
        return;
      }

      let assigneeName: string | null | undefined;
      if (parsed.data.assigned_to_id !== undefined) {
        if (parsed.data.assigned_to_id === null) {
          assigneeName = null;
        } else {
          const assignee = authService.getUserProfileById(parsed.data.assigned_to_id);
          if (!assignee || assignee.role !== 'MAINTENANCE_STAFF' || assignee.status !== 'active') {
            res.status(400).json({ error: 'Assignee must be an active Maintenance Staff account.' });
            return;
          }
          assigneeName = assignee.full_name;
        }
      }

      try {
        const updated = maintenanceService.updateTask(user, taskId, {
          status: parsed.data.status,
          work_note: parsed.data.work_note,
          parts_needed: parsed.data.parts_needed,
          evidence_reference: parsed.data.evidence_reference,
          assigned_to_id: parsed.data.assigned_to_id,
          assigned_to_name: assigneeName,
        });

        await repo.appendAuditLog(user.email, user.role, 'MAINTENANCE_TASK_UPDATED', {
          task_id: updated.id,
          ticket_code: updated.ticket_code,
          status: updated.status,
          parts_needed: updated.parts_needed,
          correlation_id: req.correlationId ?? null,
        });

        res.json({ task: updated, message: `Work order ${updated.ticket_code} updated.` });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to update maintenance work order.';
        const statusCode = message.toLowerCase().includes('not found') ? 404 : 403;
        res.status(statusCode).json({ error: message });
      }
    }
  );

  // ===========================================================================
  // 9. PHASE 2 — UNIVERSITY VERIFICATION, BED-LEVEL INVENTORY & PRIVATE VAULT
  // ===========================================================================

  app.get(
    '/api/verification/me',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      if (!user.student_id) {
        res.status(403).json({ error: 'Student account required.' });
        return;
      }
      const student = await repo.getStudentById(user.student_id);
      const record = verificationService.getRecordForStudent(
        user.student_id,
        student?.student_code ?? user.student_code ?? '',
        Boolean(student?.allotted_room_id)
      );
      res.json({
        record,
        provider: verificationService.getProviderSummary(),
      });
    }
  );

  app.post(
    '/api/verification/submit',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      if (!user.student_id) {
        res.status(403).json({ error: 'Student account required.' });
        return;
      }

      const parsed = SubmitVerificationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid verification request.',
        });
        return;
      }

      const student = await repo.getStudentById(user.student_id);
      if (!student) {
        res.status(404).json({ error: 'Student profile not found.' });
        return;
      }

      try {
        const record = await verificationService.submitVerification({
          studentId: student.id,
          universityStudentCode: parsed.data.university_student_code,
          universityEmail: student.email,
          fullName: student.name,
          academicYear: student.year,
          courseBranch: student.branch,
        });

        await repo.appendAuditLog(user.email, user.role, 'STUDENT_VERIFICATION_SUBMITTED', {
          student_id: student.id,
          university_student_id: record.university_student_id,
          status: record.status,
          provider_kind: record.provider_kind,
          is_mock_development_record: record.is_mock_development_record,
        });

        res.json({
          record,
          provider: verificationService.getProviderSummary(),
          message: record.is_mock_development_record
            ? 'Verification checked against Development Mock provider (not official university verification).'
            : `University verification status updated: ${record.status}.`,
        });
      } catch (err) {
        res.status(503).json({
          error: err instanceof Error ? err.message : 'Unable to execute student verification.',
        });
      }
    }
  );

  app.get(
    '/api/verification/records',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const allRecords = verificationService.listAllRecords();
      if (user.role === 'ADMIN') {
        res.json({
          records: allRecords,
          provider: verificationService.getProviderSummary(),
        });
        return;
      }

      // WARDEN: scope records to students in assigned blocks or unallotted applicants
      const [students, rooms] = await Promise.all([repo.getStudents(), repo.getRooms()]);
      const roomMap = new Map(rooms.map((r) => [r.id, r]));
      const studentMap = new Map(students.map((s) => [s.id, s]));
      const scoped = allRecords.filter((rec) => {
        const st = studentMap.get(rec.student_id);
        if (!st || !st.allotted_room_id) return true;
        const rm = roomMap.get(st.allotted_room_id);
        return rm ? canAccessBlock(user, rm.block_id) : false;
      });
      res.json({
        records: scoped,
        provider: verificationService.getProviderSummary(),
      });
    }
  );

  app.patch(
    '/api/verification/records/:studentId/review',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const studentId = String(req.params.studentId);
      const parsed = ReviewVerificationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid verification review payload.',
        });
        return;
      }

      const student = await repo.getStudentById(studentId);
      if (!student) {
        res.status(404).json({ error: `Student '${studentId}' not found.` });
        return;
      }

      if (user.role === 'WARDEN' && student.allotted_room_id) {
        const room = await repo.getRoomById(student.allotted_room_id);
        if (room && !verifyBlockAccessOrRespond(user, room.block_id, res)) return;
      }

      try {
        const record = verificationService.reviewVerificationException(user, {
          studentId,
          universityStudentCode: parsed.data.university_student_code,
          decision: parsed.data.decision,
          reason: parsed.data.reason,
        });
        await repo.appendAuditLog(user.email, user.role, 'STUDENT_VERIFICATION_REVIEWED', {
          student_id: studentId,
          decision: record.status,
          reason: parsed.data.reason,
        });
        res.json({
          record,
          message: `Verification exception recorded (${record.status}).`,
        });
      } catch (err) {
        res.status(403).json({
          error: err instanceof Error ? err.message : 'Unable to review verification exception.',
        });
      }
    }
  );

  app.post(
    '/api/admin/verification/import',
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = ImportRosterSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid university roster import payload.',
        });
        return;
      }

      try {
        const batch = verificationService.importInstitutionalRoster(user, {
          sourceLabel: parsed.data.source_label,
          entries: parsed.data.entries,
          expectedSha256: parsed.data.expected_sha256,
        });
        await repo.appendAuditLog(user.email, user.role, 'UNIVERSITY_ROSTER_IMPORTED', {
          batch_id: batch.batch_id,
          source_label: batch.source_label,
          record_count: batch.record_count,
          sha256_checksum: batch.sha256_checksum,
        });
        res.status(201).json({
          batch,
          provider: verificationService.getProviderSummary(),
          message: `Imported ${batch.record_count} institutional roster record(s) with verified SHA-256 digest.`,
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Roster import failed.',
        });
      }
    }
  );

  app.get(
    '/api/hostels/hierarchy',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      try {
        const hierarchy = await inventoryService.getHierarchy(user);
        res.json(hierarchy);
      } catch (err) {
        const code = err instanceof InventoryError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to load institutional hostel hierarchy.',
        });
      }
    }
  );

  app.get(
    '/api/hostels/rooms/:roomId/beds',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const roomId = String(req.params.roomId);
      try {
        const detail = await inventoryService.getRoomBeds(roomId, user);
        res.json(detail);
      } catch (err) {
        const code = err instanceof InventoryError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to load bed-level register.',
        });
      }
    }
  );

  app.patch(
    '/api/hostels/rooms/:roomId/status',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const roomId = String(req.params.roomId);
      const parsed = UpdateRoomOperationalStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid room status payload.',
        });
        return;
      }

      try {
        const result = await inventoryService.updateRoomOperationalStatus(user, {
          roomId,
          status: parsed.data.status,
          reason: parsed.data.reason,
        });
        res.json({
          ...result,
          message: `Room operational status updated to ${result.room.derived_status}.`,
        });
      } catch (err) {
        const code = err instanceof InventoryError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to update room status.',
        });
      }
    }
  );

  app.patch(
    '/api/hostels/beds/:bedId/status',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const bedId = String(req.params.bedId);
      const parsed = UpdateBedStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid bed status payload.',
        });
        return;
      }

      try {
        const result = await inventoryService.updateBedStatus(user, {
          bedId,
          status: parsed.data.status,
          reason: parsed.data.reason,
          notes: parsed.data.notes ?? null,
        });
        res.json({
          ...result,
          message: `Bed ${result.bed.bed_label} updated to ${result.bed.status}.`,
        });
      } catch (err) {
        const code = err instanceof InventoryError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to update bed status.',
        });
      }
    }
  );

  app.get(
    '/api/documents',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const filterStudentId =
        typeof req.query.student_id === 'string' && req.query.student_id.trim()
          ? req.query.student_id.trim()
          : undefined;
      try {
        const documents = await documentService.listDocuments(user, filterStudentId);
        res.json({ documents });
      } catch (err) {
        const code = err instanceof DocumentVaultError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to load private documents.',
        });
      }
    }
  );

  app.post(
    '/api/documents',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = UploadDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid document upload payload.',
        });
        return;
      }

      try {
        const document = await documentService.uploadStudentDocument(user, parsed.data);
        res.status(201).json({
          document,
          message: 'Document stored securely in the private institutional vault.',
        });
      } catch (err) {
        const code = err instanceof DocumentVaultError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Document upload failed.',
        });
      }
    }
  );

  app.post(
    '/api/documents/:id/signed-url',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const docId = String(req.params.id);
      try {
        const signed = await documentService.createSignedDownloadToken(user, docId);
        res.json(signed);
      } catch (err) {
        const code = err instanceof DocumentVaultError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to issue signed access link.',
        });
      }
    }
  );

  app.get(
    '/api/documents/download',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (!token) {
        res.status(400).json({ error: 'Signed document token is required.' });
        return;
      }
      try {
        const { document, content } = await documentService.redeemSignedDownloadToken(user, token);
        res.setHeader('Content-Type', document.mime_type);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${document.sanitized_filename}"`
        );
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(content);
      } catch (err) {
        const code = err instanceof DocumentVaultError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to download private document.',
        });
      }
    }
  );

  app.patch(
    '/api/documents/:id/review',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const docId = String(req.params.id);
      const parsed = ReviewDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid document review payload.',
        });
        return;
      }

      try {
        const document = await documentService.reviewDocument(user, {
          documentId: docId,
          status: parsed.data.status,
          note: parsed.data.note,
        });
        res.json({
          document,
          message: `Document marked ${document.review_status}.`,
        });
      } catch (err) {
        const code = err instanceof DocumentVaultError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to review document.',
        });
      }
    }
  );

  // ===========================================================================
  // 10. PHASE 3 — HOSTEL APPLICATIONS, ELIGIBILITY & DETERMINISTIC ALLOTMENT
  // ===========================================================================

  app.get(
    '/api/applications/cycles',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    (_req: AuthenticatedRequest, res: Response) => {
      res.json({ cycles: applicationService.listCycles() });
    }
  );

  app.post(
    '/api/applications/cycles',
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = CreateApplicationCycleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid allotment cycle payload.',
        });
        return;
      }
      try {
        const cycle = await applicationService.createCycle(user, parsed.data);
        res.status(201).json({ cycle, message: `Allotment cycle ${cycle.code} created.` });
      } catch (err) {
        const code = err instanceof ApplicationServiceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to create allotment cycle.',
        });
      }
    }
  );

  app.patch(
    '/api/applications/cycles/:cycleId/status',
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const cycleId = String(req.params.cycleId);
      const parsed = UpdateCycleStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid cycle status payload.',
        });
        return;
      }
      try {
        const cycle = await applicationService.updateCycleStatus(user, cycleId, parsed.data.status);
        res.json({ cycle, message: `Cycle ${cycle.code} status updated to ${cycle.status}.` });
      } catch (err) {
        const code = err instanceof ApplicationServiceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to update cycle status.',
        });
      }
    }
  );

  app.get(
    '/api/applications/me',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      try {
        const data = await applicationService.getMyApplications(user);
        res.json(data);
      } catch (err) {
        const code = err instanceof ApplicationServiceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to load your applications.',
        });
      }
    }
  );

  app.post(
    '/api/applications',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = UpsertApplicationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid hostel application fields.',
        });
        return;
      }
      try {
        const application = await applicationService.upsertStudentApplication(user, parsed.data);
        res.status(201).json({
          application,
          message: parsed.data.submit_now
            ? application.eligibility.eligible
              ? 'Application submitted and verified ELIGIBLE by policy engine.'
              : 'Application submitted (pending university verification before eligibility).'
            : 'Application draft saved.',
        });
      } catch (err) {
        const code = err instanceof ApplicationServiceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to save hostel application.',
        });
      }
    }
  );

  app.post(
    '/api/applications/:id/withdraw',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const appId = String(req.params.id);
      try {
        const application = await applicationService.withdrawApplication(user, appId);
        res.json({ application, message: 'Hostel application withdrawn.' });
      } catch (err) {
        const code = err instanceof ApplicationServiceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to withdraw application.',
        });
      }
    }
  );

  app.post(
    '/api/applications/:id/respond',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const appId = String(req.params.id);
      const parsed = RespondAllotmentOfferSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Action must be "accept" or "decline".' });
        return;
      }
      try {
        const application = await applicationService.respondToAllotmentOffer(
          user,
          appId,
          parsed.data.action
        );
        res.json({
          application,
          message:
            parsed.data.action === 'accept'
              ? 'Allotment offer accepted. Your bed assignment is now confirmed.'
              : 'Allotment offer declined and bed released back to institutional inventory.',
        });
      } catch (err) {
        const code = err instanceof ApplicationServiceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to respond to allotment offer.',
        });
      }
    }
  );

  app.get(
    '/api/applications/:id/slip',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const appId = String(req.params.id);
      try {
        const slip = await applicationService.getOfficialAllotmentSlip(user, appId);
        res.json({ slip });
      } catch (err) {
        const code = err instanceof ApplicationServiceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to generate allotment slip.',
        });
      }
    }
  );

  app.get(
    '/api/applications',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const cycleId =
        typeof req.query.cycle_id === 'string' && req.query.cycle_id.trim()
          ? req.query.cycle_id.trim()
          : undefined;
      const status =
        typeof req.query.status === 'string' && req.query.status.trim()
          ? (req.query.status.trim() as ApplicationStatus)
          : undefined;
      try {
        const data = await applicationService.listApplicationsForStaff(user, {
          cycle_id: cycleId,
          status,
        });
        res.json(data);
      } catch (err) {
        const code = err instanceof ApplicationServiceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to load applications register.',
        });
      }
    }
  );

  app.patch(
    '/api/applications/:id/review',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const appId = String(req.params.id);
      const parsed = ReviewApplicationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid application review payload.',
        });
        return;
      }
      try {
        const application = await applicationService.reviewApplication(user, appId, parsed.data);
        res.json({
          application,
          message: `Application updated to ${application.status}.`,
        });
      } catch (err) {
        const code = err instanceof ApplicationServiceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to review application.',
        });
      }
    }
  );

  app.post(
    '/api/applications/cycles/:cycleId/execute',
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const cycleId = String(req.params.cycleId);
      const parsed = ExecuteCycleAllotmentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid allotment execution parameters.',
        });
        return;
      }
      try {
        const summary = await applicationService.executeCycleAllotment(user, {
          cycle_id: cycleId,
          seed: parsed.data.seed,
          dry_run: parsed.data.dry_run,
        });
        res.json({
          run: summary,
          message: summary.dry_run
            ? `Dry-run simulation complete: ${summary.allotted_count} allotted, ${summary.waitlisted_count} waitlisted.`
            : `Committed deterministic allotment run ${summary.run_id}: ${summary.allotted_count} bed(s) assigned.`,
        });
      } catch (err) {
        const code = err instanceof ApplicationServiceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Allotment execution failed.',
        });
      }
    }
  );

  app.post(
    '/api/applications/:id/override',
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const appId = String(req.params.id);
      const parsed = ManualAllotmentOverrideSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid manual override payload.',
        });
        return;
      }
      try {
        const application = await applicationService.manualOverrideAllotment(user, {
          application_id: appId,
          target_room_id: parsed.data.target_room_id,
          justification: parsed.data.justification,
        });
        res.json({
          application,
          message: `Audited manual override committed: assigned ${application.allotment?.room_label} Bed ${application.allotment?.bed_label}.`,
        });
      } catch (err) {
        const code = err instanceof ApplicationServiceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Manual override failed.',
        });
      }
    }
  );

  // ===========================================================================
  // 11. PHASE 4 — OCCUPANCY CHECK-IN/OUT, COMPLAINTS, GATE PASSES & VISITORS
  // ===========================================================================

  app.get(
    '/api/operations/occupancy',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      try {
        const records = await operationsService.listOccupancyRecords(user);
        res.json({ records });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to load occupancy records.',
        });
      }
    }
  );

  app.post(
    '/api/operations/occupancy/checkin',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = RecordCheckInSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid check-in details.',
        });
        return;
      }
      try {
        const record = await operationsService.recordCheckIn(user, parsed.data);
        res.status(201).json({
          record,
          message: `Recorded check-in for ${record.student_name} (${record.room_label}, Key ${record.key_serial}).`,
        });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to record check-in.',
        });
      }
    }
  );

  app.post(
    '/api/operations/occupancy/checkout-request',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = RequestCheckOutSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid check-out request.',
        });
        return;
      }
      try {
        const record = await operationsService.requestCheckOut(user, parsed.data);
        res.status(201).json({
          record,
          message: 'Hostel check-out request submitted to your block warden.',
        });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to submit check-out request.',
        });
      }
    }
  );

  app.post(
    '/api/operations/occupancy/:studentId/checkout',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const studentId = String(req.params.studentId);
      const parsed = CompleteCheckOutSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid check-out completion payload.',
        });
        return;
      }
      try {
        const record = await operationsService.completeCheckOut(user, studentId, parsed.data);
        res.json({
          record,
          message: `Completed hostel check-out for ${record.student_name}.`,
        });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to complete check-out.',
        });
      }
    }
  );

  app.get(
    '/api/operations/complaints',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      try {
        const complaints = await operationsService.listComplaints(user);
        res.json({ complaints });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to load complaints.',
        });
      }
    }
  );

  app.post(
    '/api/operations/complaints',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = CreateComplaintSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid complaint details.',
        });
        return;
      }
      try {
        const complaint = await operationsService.createComplaint(user, parsed.data);
        res.status(201).json({
          complaint,
          message: `Complaint ${complaint.complaint_code} registered with your block warden.`,
        });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to submit complaint.',
        });
      }
    }
  );

  app.patch(
    '/api/operations/complaints/:id',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const complaintId = String(req.params.id);
      const parsed = UpdateComplaintSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid complaint update.',
        });
        return;
      }
      try {
        const complaint = await operationsService.updateComplaint(user, complaintId, parsed.data);
        res.json({
          complaint,
          message: `Complaint ${complaint.complaint_code} marked ${complaint.status}.`,
        });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to update complaint.',
        });
      }
    }
  );

  app.post(
    '/api/operations/complaints/:id/escalate',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const complaintId = String(req.params.id);
      const parsed = EscalateComplaintSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid maintenance escalation payload.',
        });
        return;
      }

      let assigneeName: string | null = null;
      if (parsed.data.assigned_to_id) {
        const assignee = authService.getUserProfileById(parsed.data.assigned_to_id);
        if (!assignee || assignee.role !== 'MAINTENANCE_STAFF' || assignee.status !== 'active') {
          res.status(400).json({ error: 'Assignee must be an active Maintenance Staff account.' });
          return;
        }
        assigneeName = assignee.full_name;
      }

      try {
        const result = await operationsService.escalateComplaintToMaintenance(user, complaintId, {
          sanitized_summary: parsed.data.sanitized_summary,
          location_detail: parsed.data.location_detail,
          assigned_to_id: parsed.data.assigned_to_id ?? null,
          assigned_to_name: assigneeName,
        });
        res.status(201).json({
          ...result,
          message: `Escalated to PII-stripped work order ${result.maintenance_task.ticket_code}.`,
        });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to escalate complaint.',
        });
      }
    }
  );

  app.get(
    '/api/operations/gate-passes',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      try {
        const gate_passes = await operationsService.listGatePasses(user);
        res.json({ gate_passes });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to load gate passes.',
        });
      }
    }
  );

  app.post(
    '/api/operations/gate-passes',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = CreateGatePassSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid gate pass application.',
        });
        return;
      }
      try {
        const gate_pass = await operationsService.createGatePass(user, parsed.data);
        res.status(201).json({
          gate_pass,
          message: 'Gate pass request submitted for warden approval.',
        });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to submit gate pass.',
        });
      }
    }
  );

  app.patch(
    '/api/operations/gate-passes/:id/review',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const passId = String(req.params.id);
      const parsed = ReviewGatePassSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid gate pass review payload.',
        });
        return;
      }
      try {
        const gate_pass = await operationsService.reviewGatePass(user, passId, parsed.data);
        res.json({
          gate_pass,
          message: `Gate pass updated to ${gate_pass.status}.`,
        });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to update gate pass.',
        });
      }
    }
  );

  app.post(
    '/api/operations/gate-passes/:id/cancel',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const passId = String(req.params.id);
      try {
        const gate_pass = await operationsService.cancelGatePass(user, passId);
        res.json({ gate_pass, message: 'Gate pass cancelled.' });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to cancel gate pass.',
        });
      }
    }
  );

  app.get(
    '/api/operations/visitors',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      try {
        const visitors = await operationsService.listVisitors(user);
        res.json({ visitors });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to load visitor register.',
        });
      }
    }
  );

  app.post(
    '/api/operations/visitors',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = CreateVisitorSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid visitor registration payload.',
        });
        return;
      }
      try {
        const visitor = await operationsService.registerVisitor(user, parsed.data);
        res.status(201).json({
          visitor,
          message: `Visitor ${visitor.visitor_name} registered (${visitor.visitor_code}).`,
        });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to register visitor.',
        });
      }
    }
  );

  app.patch(
    '/api/operations/visitors/:id/status',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const visitorId = String(req.params.id);
      const parsed = UpdateVisitorStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid visitor status update.',
        });
        return;
      }
      try {
        const visitor = await operationsService.updateVisitorStatus(
          user,
          visitorId,
          parsed.data.status
        );
        res.json({
          visitor,
          message: `Visitor ${visitor.visitor_code} marked ${visitor.status}.`,
        });
      } catch (err) {
        const code = err instanceof OperationsError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to update visitor status.',
        });
      }
    }
  );

  // ===========================================================================
  // 12. PHASE 5 — FEES & BILLING LEDGER, NOTIFICATIONS, NOTICES & REPORTING
  // ===========================================================================

  app.get(
    '/api/finance/invoices',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      try {
        const invoices = await financeService.listInvoices(user);
        res.json({
          invoices,
          gateway_readiness: financeService.getGatewayReadiness(),
        });
      } catch (err) {
        const code = err instanceof FinanceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to load fee ledger.',
        });
      }
    }
  );

  app.post(
    '/api/finance/invoices',
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = CreateFeeInvoiceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid fee invoice payload.',
        });
        return;
      }
      try {
        const invoice = await financeService.createInvoice(user, parsed.data);
        res.status(201).json({
          invoice,
          message: `Official fee invoice ${invoice.invoice_code} issued for ${invoice.student_name}.`,
        });
      } catch (err) {
        const code = err instanceof FinanceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to create fee invoice.',
        });
      }
    }
  );

  app.post(
    '/api/finance/invoices/:id/payments',
    requireRole('STUDENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const invoiceId = String(req.params.id);
      const parsed = SubmitOfflinePaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid offline payment reference payload.',
        });
        return;
      }
      try {
        const result = await financeService.submitOfflinePaymentReference(
          user,
          invoiceId,
          parsed.data
        );
        res.status(201).json({
          ...result,
          message: `Payment reference ${result.payment.reference_number} submitted for Finance Office verification.`,
        });
      } catch (err) {
        const code = err instanceof FinanceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to submit payment reference.',
        });
      }
    }
  );

  app.patch(
    '/api/finance/invoices/:id/payments/:paymentId/verify',
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const invoiceId = String(req.params.id);
      const paymentId = String(req.params.paymentId);
      const parsed = VerifyPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid payment verification payload.',
        });
        return;
      }
      try {
        const result = await financeService.verifyOrRejectPayment(
          user,
          invoiceId,
          paymentId,
          parsed.data
        );
        res.json({
          ...result,
          message:
            result.payment.status === 'VERIFIED_PAID'
              ? `Payment verified and Official Receipt ${result.payment.receipt_number} issued.`
              : `Payment reference ${result.payment.reference_number} marked REJECTED.`,
        });
      } catch (err) {
        const code = err instanceof FinanceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to verify payment.',
        });
      }
    }
  );

  app.post(
    '/api/finance/invoices/:id/waivers',
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const invoiceId = String(req.params.id);
      const parsed = ApplyFeeWaiverSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid fee waiver payload.',
        });
        return;
      }
      try {
        const invoice = await financeService.applyAuditedWaiver(user, invoiceId, parsed.data);
        res.json({
          invoice,
          message: `Audited waiver applied to ${invoice.invoice_code}. New balance: INR ${invoice.balance_due_inr.toLocaleString('en-IN')}.`,
        });
      } catch (err) {
        const code = err instanceof FinanceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to apply fee waiver.',
        });
      }
    }
  );

  app.get(
    '/api/finance/invoices/:id/payments/:paymentId/receipt',
    requireRole('STUDENT', 'WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const invoiceId = String(req.params.id);
      const paymentId = String(req.params.paymentId);
      try {
        const receipt = await financeService.getOfficialReceipt(user, invoiceId, paymentId);
        res.json({ receipt });
      } catch (err) {
        const code = err instanceof FinanceError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to load official fee receipt.',
        });
      }
    }
  );

  // Notifications (User-Isolated)
  app.get('/api/notifications', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = getCurrentUser(req)!;
    const notifications = notificationService.listMyNotifications(user);
    const unread_count = notifications.filter((n) => !n.read).length;
    res.json({ notifications, unread_count });
  });

  app.patch(
    '/api/notifications/:id/read',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      try {
        const notification = notificationService.markNotificationRead(user, String(req.params.id));
        res.json({ notification });
      } catch (err) {
        const code = err instanceof NotificationError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to mark notification read.',
        });
      }
    }
  );

  app.post(
    '/api/notifications/read-all',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const marked_count = notificationService.markAllRead(user);
      res.json({ marked_count, message: 'All unread notifications marked as read.' });
    }
  );

  // Institutional Notices (Role & Block Scoped)
  app.get(
    '/api/institutional-notices',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      try {
        const notices = await notificationService.listNotices(user);
        res.json({ notices });
      } catch (err) {
        const code = err instanceof NotificationError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to load institutional notices.',
        });
      }
    }
  );

  app.post(
    '/api/institutional-notices',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = PublishInstitutionalNoticeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid notice payload.',
        });
        return;
      }
      try {
        const notice = await notificationService.publishNotice(user, parsed.data);
        res.status(201).json({
          notice,
          message: `Official notice ${notice.notice_code} published to ${notice.block_name}.`,
        });
      } catch (err) {
        const code = err instanceof NotificationError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to publish notice.',
        });
      }
    }
  );

  // Institutional Reporting & Audited CSV Export
  app.get(
    '/api/reports/summary',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      try {
        const summary = await reportingService.getSummary(user);
        res.json({ summary });
      } catch (err) {
        const code = err instanceof ReportingError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to generate institutional report.',
        });
      }
    }
  );

  app.get(
    '/api/reports/export',
    requireRole('WARDEN', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const user = getCurrentUser(req)!;
      const parsedDataset = ReportExportDatasetSchema.safeParse(req.query.dataset);
      if (!parsedDataset.success) {
        res.status(400).json({
          error: 'Specify a valid export dataset: occupancy, fees, complaints, or gate_passes.',
        });
        return;
      }
      try {
        const exported = await reportingService.exportDatasetCsv(user, parsedDataset.data);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(exported.csv);
      } catch (err) {
        const code = err instanceof ReportingError ? err.statusCode : 500;
        res.status(code).json({
          error: err instanceof Error ? err.message : 'Unable to export CSV report.',
        });
      }
    }
  );

  // ===========================================================================
  // 13. PHASE 6 — PRODUCTION READINESS AUDIT & REDACTED ERROR HANDLING
  // ===========================================================================

  app.get(
    '/api/admin/readiness',
    requirePermission('environment:read'),
    (_req: AuthenticatedRequest, res: Response) => {
      const report = buildProductionReadinessReport();
      res.json({ report });
    }
  );

  // ===========================================================================
  // 14. PHASE 7 — BACKGROUND JOBS, SIGNED WEBHOOKS, OUTBOX & OBSERVABILITY
  // ===========================================================================

  app.get(
    '/api/admin/ops/overview',
    requireRole('ADMIN'),
    (_req: AuthenticatedRequest, res: Response) => {
      res.json({
        observability: observability.getSnapshot(),
        jobs: {
          cron_secret_configured:
            Boolean(options.backgroundJobSecret) || jobRunner.isCronSecretConfigured(),
          history: jobRunner.listHistory(40),
        },
        communications: {
          summary: commsDispatcher.getSummary(),
          queue: commsDispatcher.listQueue(40),
        },
        webhooks: {
          status: paymentWebhookService.getStatus(),
          events: paymentWebhookService.listEvents(40),
        },
        active_sessions: authService.sessions.getActiveSessionCount(),
      });
    }
  );

  app.post(
    '/api/admin/jobs/run',
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = RunBackgroundJobSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid background job request.',
        });
        return;
      }

      try {
        const runs = await jobRunner.runJob(parsed.data.job_name, {
          trigger_source: 'ADMIN_UI',
          triggered_by: user.email,
          actor_role: user.role,
          reference_date_iso: parsed.data.reference_date_iso,
        });
        res.json({
          runs,
          message: `Executed ${runs.length} background lifecycle job(s).`,
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Background job execution failed.',
        });
      }
    }
  );

  app.post(
    '/api/admin/incident/revoke-sessions',
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      if (!enforceRateLimit(writeRateLimiter, req, res)) return;
      const user = getCurrentUser(req)!;
      const parsed = EmergencySessionRevocationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Incident revocation reason is required.',
        });
        return;
      }

      try {
        const result = authService.revokeAllNonAdminSessions(user, parsed.data.reason);
        await repo.appendAuditLog(user.email, user.role, 'EMERGENCY_GLOBAL_SESSION_REVOCATION', {
          revoked_count: result.revoked_count,
          reason: parsed.data.reason,
        });
        res.json({
          ...result,
          message: `Emergency break-glass completed: ${result.revoked_count} non-admin session(s) revoked immediately.`,
        });
      } catch (err) {
        res.status(403).json({
          error: err instanceof Error ? err.message : 'Unable to revoke active sessions.',
        });
      }
    }
  );

  // Machine-to-machine scheduled cron trigger (timing-safe X-Job-Secret; never uses cookies)
  app.post('/api/jobs/cron/run', async (req: Request, res: Response) => {
    const authCheck = verifyBackgroundJobSecret(
      typeof req.headers['x-job-secret'] === 'string' ? req.headers['x-job-secret'] : undefined,
      options.backgroundJobSecret ?? process.env.BACKGROUND_JOB_SECRET
    );
    if (!authCheck.ok) {
      res.status(authCheck.statusCode).json({ error: authCheck.error });
      return;
    }

    const parsed = RunBackgroundJobSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid scheduled job payload.',
      });
      return;
    }

    try {
      const runs = await jobRunner.runJob(parsed.data.job_name, {
        trigger_source: 'CRON_ENDPOINT',
        triggered_by: 'cron-scheduler@hostelhub.internal',
        actor_role: 'system',
        reference_date_iso: parsed.data.reference_date_iso,
      });
      res.json({
        ok: true,
        runs,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Scheduled job execution failed.',
      });
    }
  });

  // Machine-to-machine payment gateway webhook receiver (fail-closed HMAC-SHA256 + replay window)
  app.post('/api/webhooks/payments', async (req: RequestWithRawBody, res: Response) => {
    const parsed = PaymentWebhookPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      // Check secret config first so unconfigured servers fail closed with 503 consistently
      if (!paymentWebhookService.getStatus().configured) {
        res.status(503).json({
          error:
            'Payment webhook receiver is disabled: PAYMENT_WEBHOOK_SECRET is not configured on the server.',
        });
        return;
      }
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid payment webhook payload.',
      });
      return;
    }

    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const signatureHeader =
      typeof req.headers['x-hostelhub-signature'] === 'string'
        ? req.headers['x-hostelhub-signature']
        : undefined;
    const timestampHeader =
      typeof req.headers['x-hostelhub-timestamp'] === 'string'
        ? req.headers['x-hostelhub-timestamp']
        : undefined;

    try {
      const result = await paymentWebhookService.verifyAndProcess({
        rawBody,
        signatureHeader,
        timestampHeader,
        payload: parsed.data,
      });
      res.json({
        received: true,
        duplicate: result.duplicate,
        event: result.event,
        ...(result.invoice ? { invoice_balance_due_inr: result.invoice.balance_due_inr } : {}),
        ...(result.payment?.receipt_number ? { receipt_number: result.payment.receipt_number } : {}),
      });
    } catch (err) {
      if (err instanceof PaymentWebhookError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      if (err instanceof FinanceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Unable to process payment gateway webhook.' });
    }
  });

  // Explicit JSON 404 catch-all for unknown /api/* routes and redacted error handler
  app.all('/api/*', apiNotFoundHandler);
  app.use(redactedErrorHandler);

  return app;
}

async function startServer() {
  const envCheck = validateServerEnv();
  console.log(
    `[HostelHub] Environment: ${envCheck.environment} | Valid: ${envCheck.valid} | Warnings: ${envCheck.warnings.length}`
  );
  if (!envCheck.valid) {
    console.error('[HostelHub] Environment validation errors:', envCheck.errors.join(' | '));
  }
  const app = createApiApp();
  const isProd = process.env.NODE_ENV === 'production';
  let vite: ViteDevServer | undefined;

  if (!isProd) {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: hmrDisabled ? false : undefined,
        ws: hmrDisabled ? false : undefined,
        watch: hmrDisabled ? null : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build artifacts not found. Run npm run build first.');
      }
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`HostelHub server running at http://${HOST}:${PORT}`);
  });

  const shutdown = () => {
    server.close(() => {
      if (vite) {
        void vite.close().finally(() => process.exit(0));
      } else {
        process.exit(0);
      }
    });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

// Start only when invoked directly as entrypoint (not when imported in tests)
const isTestEnv = Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';
const currentFilePath = path.resolve(fileURLToPath(import.meta.url));
const entryArgPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isDirectRun =
  !isTestEnv &&
  (entryArgPath === currentFilePath || path.basename(entryArgPath) === 'server.ts');

if (isDirectRun) {
  startServer().catch((err) => {
    console.error('Failed to start HostelHub server:', err);
    process.exit(1);
  });
}

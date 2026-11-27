import { z } from 'zod';

export type DeploymentEnvironment = 'development' | 'staging' | 'production';

export type IntegrationReadinessState =
  | 'configured'
  | 'sandbox_mode'
  | 'mock_dev_only'
  | 'unconfigured';

export interface IntegrationStatusItem {
  id: string;
  name: string;
  state: IntegrationReadinessState;
  detail: string;
  requiredForProduction: boolean;
}

export interface EnvironmentValidationResult {
  environment: DeploymentEnvironment;
  valid: boolean;
  errors: string[];
  warnings: string[];
  integrations: IntegrationStatusItem[];
}

const RawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  HOSTELHUB_ENV: z.enum(['development', 'staging', 'production']).optional(),
  APP_URL: z.string().optional(),
  ALLOWED_EMAIL_DOMAIN: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  UNIVERSITY_VERIFICATION_PROVIDER: z.string().optional(),
  UNIVERSITY_API_BASE_URL: z.string().optional(),
  UNIVERSITY_API_CLIENT_ID: z.string().optional(),
  UNIVERSITY_API_CLIENT_SECRET: z.string().optional(),
  UNIVERSITY_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  PAYMENT_PROVIDER_MODE: z.string().optional(),
  PAYMENT_PROVIDER_SECRET: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  BACKGROUND_JOB_SECRET: z.string().optional(),
});

function hasNonEmpty(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0 && !value.trim().startsWith('MY_'));
}

export function resolveDeploymentEnvironment(
  env: NodeJS.ProcessEnv = process.env
): DeploymentEnvironment {
  if (env.HOSTELHUB_ENV === 'production' || env.HOSTELHUB_ENV === 'staging' || env.HOSTELHUB_ENV === 'development') {
    return env.HOSTELHUB_ENV;
  }
  if (env.NODE_ENV === 'production') {
    return 'production';
  }
  return 'development';
}

/**
 * Validates runtime environment configuration without ever exposing or logging secret values.
 * Clearly distinguishes development mocks / sandboxes from official institutional integrations.
 */
export function validateServerEnv(
  env: NodeJS.ProcessEnv = process.env
): EnvironmentValidationResult {
  const parsed = RawEnvSchema.safeParse(env);
  const environment = resolveDeploymentEnvironment(env);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`Invalid environment variable ${issue.path.join('.')}: ${issue.message}`);
    }
  }

  const supabaseConfigured =
    hasNonEmpty(env.SUPABASE_URL) &&
    hasNonEmpty(env.SUPABASE_ANON_KEY) &&
    hasNonEmpty(env.SUPABASE_SERVICE_ROLE_KEY);

  const postgresConfigured = hasNonEmpty(env.DATABASE_URL) || supabaseConfigured;

  const universityApiConfigured =
    hasNonEmpty(env.UNIVERSITY_API_BASE_URL) &&
    (hasNonEmpty(env.UNIVERSITY_API_KEY) ||
      (hasNonEmpty(env.UNIVERSITY_API_CLIENT_ID) && hasNonEmpty(env.UNIVERSITY_API_CLIENT_SECRET)));

  const paymentConfigured =
    hasNonEmpty(env.PAYMENT_PROVIDER_SECRET) && hasNonEmpty(env.PAYMENT_WEBHOOK_SECRET);

  const emailConfigured = hasNonEmpty(env.RESEND_API_KEY);
  const geminiConfigured = hasNonEmpty(env.GEMINI_API_KEY);
  const groqConfigured = hasNonEmpty(env.GROQ_API_KEY);
  const sentryConfigured = hasNonEmpty(env.SENTRY_DSN);
  const sessionSecretConfigured = hasNonEmpty(env.SESSION_SECRET);

  if (environment === 'production') {
    if (!sessionSecretConfigured) {
      errors.push('SESSION_SECRET must be set to a high-entropy key in production.');
    }
    if (!postgresConfigured) {
      errors.push('DATABASE_URL or Supabase PostgreSQL credentials are required in production.');
    }
    if (!universityApiConfigured) {
      errors.push('Official university student verification credentials are required in production.');
    }
    if (!paymentConfigured) {
      warnings.push('Payment provider & webhook secrets are not configured; fee collection remains disabled.');
    }
    if (!emailConfigured) {
      warnings.push('RESEND_API_KEY is not set; email notifications cannot be dispatched.');
    }
    if (!sentryConfigured) {
      warnings.push('SENTRY_DSN is not set; external error monitoring is inactive.');
    }
  } else {
    if (!postgresConfigured) {
      warnings.push('Running with in-memory development repository. Configure Supabase PostgreSQL for persistence.');
    }
    if (!universityApiConfigured) {
      warnings.push('University verification provider is not connected (development mock mode only).');
    }
  }

  const integrations: IntegrationStatusItem[] = [
    {
      id: 'database',
      name: 'Supabase PostgreSQL & RLS',
      state: supabaseConfigured ? 'configured' : 'mock_dev_only',
      detail: supabaseConfigured
        ? 'Connected via server-side Supabase credentials.'
        : 'In-memory development store active; SQL migrations ready in /supabase/migrations.',
      requiredForProduction: true,
    },
    {
      id: 'university_verification',
      name: 'University Student Verification API',
      state: universityApiConfigured ? 'configured' : 'mock_dev_only',
      detail: universityApiConfigured
        ? 'Institutional verification endpoint configured.'
        : 'Awaiting university SIS credentials & API documentation (Dev Mock Only).',
      requiredForProduction: true,
    },
    {
      id: 'payments',
      name: 'Hostel Fee Payment Gateway',
      state: paymentConfigured
        ? env.PAYMENT_PROVIDER_MODE === 'live'
          ? 'configured'
          : 'sandbox_mode'
        : 'unconfigured',
      detail: paymentConfigured
        ? 'Provider & webhook signature secrets present (sandbox mode).'
        : 'Awaiting institutional payment gateway & webhook signing secret.',
      requiredForProduction: true,
    },
    {
      id: 'email',
      name: 'Institutional Email / Resend',
      state: emailConfigured ? 'configured' : 'unconfigured',
      detail: emailConfigured
        ? 'Transactional email provider configured.'
        : 'Unconfigured — verification & reset tokens remain in development preview only.',
      requiredForProduction: true,
    },
    {
      id: 'ai',
      name: 'AI Policy & Search Assistant (Gemini / Groq)',
      state: geminiConfigured || groqConfigured ? 'configured' : 'mock_dev_only',
      detail: geminiConfigured
        ? 'Gemini primary configured (advisory only; never authoritative).'
        : groqConfigured
          ? 'Groq secondary configured (advisory only; never authoritative).'
          : 'Deterministic offline fallback active (advisory only).',
      requiredForProduction: false,
    },
    {
      id: 'monitoring',
      name: 'Error Monitoring (Sentry)',
      state: sentryConfigured ? 'configured' : 'unconfigured',
      detail: sentryConfigured
        ? 'External error monitoring DSN configured.'
        : 'Local structured logging only; configure SENTRY_DSN for production.',
      requiredForProduction: true,
    },
  ];

  return {
    environment,
    valid: errors.length === 0,
    errors,
    warnings,
    integrations,
  };
}

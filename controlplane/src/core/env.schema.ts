import { z } from 'zod';

export const envVariables = z
  .object({
    /**
     * General
     */
    WEB_BASE_URL: z.string(),
    DEBUG_SQL: z
      .string()
      .transform((val) => val === 'true')
      .optional(),
    /**
     * Server
     */
    HOST: z.string().default('localhost'),
    ALLOWED_ORIGINS: z.string().transform((val) => val.split(',')),
    PORT: z
      .string()
      .default('3001')
      .transform((val) => Number.parseInt(val)),
    LOG_LEVEL: z.string().default('info'),
    /**
     * Redis
     */
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z
      .string()
      .default('6379')
      .transform((val) => Number.parseInt(val)),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_TLS_CERT: z.string().optional(),
    REDIS_TLS_CA: z.string().optional(),
    REDIS_TLS_KEY: z.string().optional(),
    /**
     * OPEN AI
     */
    OPENAI_API_KEY: z.string().optional(),
    /**
     * Auth
     */
    AUTH_JWT_SECRET: z.string().min(32).max(32),
    AUTH_REDIRECT_URI: z.string().url(),
    /**
     * Database
     */
    DB_URL: z.string(),
    DB_TLS_CERT: z.string().optional(),
    DB_TLS_CA: z.string().optional(),
    DB_TLS_KEY: z.string().optional(),
    /**
     * Keycloak
     */
    KC_REALM: z.string(),
    KC_LOGIN_REALM: z.string().default('master'),
    KC_CLIENT_ID: z.string(),
    KC_ADMIN_USER: z.string(),
    KC_ADMIN_PASSWORD: z.string(),
    KC_API_URL: z.string().url(),
    KC_FRONTEND_URL: z.string().url(),
    /**
     * Clickhouse
     */
    CLICKHOUSE_DSN: z.string(),

    /**
     * Webhooks
     */
    WEBHOOK_URL: z.string().optional(),
    WEBHOOK_SECRET: z.string().optional(),
    /**
     * GitHub Integration
     */
    GITHUB_APP_CLIENT_ID: z.string().optional(),
    GITHUB_APP_CLIENT_SECRET: z.string().optional(),
    GITHUB_APP_ID: z.string().optional(),
    GITHUB_APP_PRIVATE_KEY: z.string().optional(),
    GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
    /**
     * Slack
     */
    SLACK_APP_CLIENT_ID: z.string().optional(),
    SLACK_APP_CLIENT_SECRET: z.string().optional(),
    /**
     * S3 Storage e.g. for persistent operations
     */
    S3_STORAGE_URL: z.string(),
    /**
     * Email
     */
    SMTP_USERNAME: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    /**
     * Billing
     */
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    DEFAULT_PLAN: z.string().optional(), // e.g. developer@1
  })
  .refine((input) => {
    if (input.STRIPE_WEBHOOK_SECRET && !input.STRIPE_SECRET_KEY) {
      return false;
    }
    return true;
  }, 'STRIPE_WEBHOOK_SECRET requires STRIPE_SECRET_KEY');

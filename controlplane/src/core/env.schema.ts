import { z } from 'zod';

export const envVariables = z.object({
  DB_URL: z.string(),
  ALLOWED_ORIGINS: z.string().transform((val) => val.split(',')),
  HOST: z.string().default('localhost'),
  AUTH_JWT_SECRET: z.string().min(32).max(32),
  AUTH_REDIRECT_URI: z.string().url(),
  WEB_BASE_URL: z.string(),
  DB_CERT_PATH: z.string().optional(),
  DB_CA_PATH: z.string().optional(),
  DB_KEY_PATH: z.string().optional(),
  KC_REALM: z.string(),
  KC_LOGIN_REALM: z.string().default('master'),
  KC_CLIENT_ID: z.string(),
  KC_ADMIN_USER: z.string(),
  KC_ADMIN_PASSWORD: z.string(),
  KC_API_URL: z.string().url(),
  KC_FRONTEND_URL: z.string().url(),
  PORT: z
    .string()
    .default('3001')
    .transform((val) => Number.parseInt(val)),
  LOG_LEVEL: z.string().default('info'),
  CLICKHOUSE_DSN: z.string(),
  DEBUG_SQL: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
  WEBHOOK_URL: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  SLACK_APP_CLIENT_ID: z.string().optional(),
  SLACK_APP_CLIENT_SECRET: z.string().optional(),
  S3_STORAGE_URL: z.string(),
  SMTP_USERNAME: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /**
   * Billing
   */
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

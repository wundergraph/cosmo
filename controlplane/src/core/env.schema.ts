import { z } from 'zod';

export const envVariables = z
  .object({
    /**
     * General
     */
    WEB_BASE_URL: z.string().url(),
    /**
     * CDN
     */
    CDN_BASE_URL: z.string().url(),
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
     * Prometheus
     */
    PROMETHEUS_ENABLED: z
      .string()
      .transform((val) => val === 'true')
      .default('false'),
    PROMETHEUS_HTTP_PATH: z.string().default('/metrics'),
    PROMETHEUS_PORT: z
      .string()
      .default('8088')
      .transform((val) => Number.parseInt(val)),
    PROMETHEUS_HOST: z.string().default('localhost'),
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
     * S3 Storage e.g. for persistent operations.
     *
     * S3_STORAGE_URL: The blobStorage url containing username and password (e.g.: https://username:password@cosmo-controlplane-bucket.s3.amazonaws.com)
     * S3_REGION: The region to use for the S3 storage (e.g.: us-east-1, this fallbacks to auto and must be set when using aws)
     * S3_ENDPOINT: The aws endpoint to use for the S3 storage (e.g.: s3.amazonaws.com, this fallbacks to the origin of the S3_STORAGE_URL)
     *
     * Examples:
     * Minio Storage
     * S3_STORAGE_URL="http://minio:pass@minio:9000/cosmo"
     * S3_REGION="auto"                           # default
     * S3_ENDPOINT=S3_STORAGE_URL.origin          # default
     *
     * AWS S3 Storage
     * S3_STORAGE_URL="https://username:password@cosmo-controlplane-bucket.s3.amazonaws.com"
     * S3_REGION="us-east-1"                      # set this for amazon to your region
     * S3_ENDPOINT="s3.amazonaws.com"             # replaces the bucket from the S3_STORAGE_URL origin or set it manually to s3.amazonaws.com
     */
    S3_STORAGE_URL: z.string(),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    /**
     * Either use:
     *   https://username:password@cosmo-controlplane-bucket.s3.amazonaws.com
     * Or set: S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY
     */
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    /**
     * Enforces path style URLs handling, e.g.:
     *   https://username:password@virtualhost.r2.cloudflarestorage.com/cosmo-cdn
     *
     * S3_STORAGE_URL="https://username:password@virtualhost.r2.cloudflarestorage.com/cosmo-cdn"
     *
     * S3_REGION="auto"
     * S3_ENDPOINT="https://virtualhost.r2.cloudflarestorage.com"
     * S3_FORCE_PATH_STYLE="true"
     *
     * The bucket will be "cosmo-cdn" otherwise it would be "virtualhost"
     */
    S3_FORCE_PATH_STYLE: z
      .string()
      .transform((val) => val === 'true')
      .default('true'),
    /**
     * Whether to use individual deletes for S3 objects instead of bulking them.
     */
    S3_USE_INDIVIDUAL_DELETES: z
      .string()
      .transform((val) => val === 'true')
      .optional(),
    /**
     * Email
     */
    SMTP_ENABLED: z
      .string()
      .transform((val) => val === 'true')
      .default('false'),
    SMTP_USERNAME: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().optional(),
    SMTP_SECURE: z
      .string()
      .optional()
      .transform((val) => val === 'true'),
    SMTP_REQUIRE_TLS: z
      .string()
      .optional()
      .transform((val) => val === 'true'),
    /**
     * Billing
     */
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    DEFAULT_PLAN: z.string().optional(), // e.g. developer@1
    /**
     * Admission Webhook
     */
    AUTH_ADMISSION_JWT_SECRET: z.string(),

    /**
     * Sentry
     */
    SENTRY_ENABLED: z
      .string()
      .optional()
      .transform((val) => val === 'true')
      .default('false'),
    SENTRY_DSN: z.string().optional(),
    SENTRY_SEND_DEFAULT_PII: z
      .string()
      .optional()
      .transform((val) => val === 'true')
      .default('false'),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().optional().default(1),
    SENTRY_PROFILE_SESSION_SAMPLE_RATE: z.coerce.number().optional().default(1),
    SENTRY_EVENT_LOOP_BLOCK_THRESHOLD_MS: z.coerce.number().optional().default(100),
  })
  .refine((input) => {
    if (input.STRIPE_WEBHOOK_SECRET && !input.STRIPE_SECRET_KEY) {
      return false;
    }
    return true;
  }, 'STRIPE_WEBHOOK_SECRET requires STRIPE_SECRET_KEY');

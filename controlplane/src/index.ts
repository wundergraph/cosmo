import * as process from 'node:process';
import pino from 'pino';

import 'dotenv/config';

import build, { BuildConfig } from './core/build-server.js';
import { envVariables } from './core/env.schema.js';
import { SentryConfig } from './core/sentry.config.js';

const {
  LOG_LEVEL,
  PORT,
  HOST,
  ALLOWED_ORIGINS,
  PROMETHEUS_ENABLED,
  PROMETHEUS_HTTP_PATH,
  PROMETHEUS_PORT,
  PROMETHEUS_HOST,
  DB_URL,
  DB_TLS_CERT,
  DB_TLS_KEY,
  DB_TLS_CA,
  DEBUG_SQL,
  CLICKHOUSE_DSN,
  AUTH_REDIRECT_URI,
  WEB_BASE_URL,
  AUTH_JWT_SECRET,
  AUTH_SSO_COOKIE_DOMAIN,
  KC_REALM,
  KC_LOGIN_REALM,
  KC_CLIENT_ID,
  KC_ADMIN_PASSWORD,
  KC_API_URL,
  KC_FRONTEND_URL,
  KC_ADMIN_USER,
  WEBHOOK_URL,
  WEBHOOK_SECRET,
  GITHUB_APP_WEBHOOK_SECRET,
  GITHUB_APP_CLIENT_ID,
  GITHUB_APP_CLIENT_SECRET,
  GITHUB_APP_ID,
  GITHUB_APP_PRIVATE_KEY,
  SLACK_APP_CLIENT_ID,
  SLACK_APP_CLIENT_SECRET,
  S3_STORAGE_URL,
  S3_ENDPOINT,
  S3_REGION,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_FORCE_PATH_STYLE,
  S3_USE_INDIVIDUAL_DELETES,
  SMTP_ENABLED,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USERNAME,
  SMTP_PASSWORD,
  SMTP_SECURE,
  SMTP_REQUIRE_TLS,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  DEFAULT_PLAN,
  OPENAI_API_KEY,
  REDIS_HOST,
  REDIS_PORT,
  REDIS_TLS_CA,
  REDIS_TLS_CERT,
  REDIS_TLS_KEY,
  REDIS_PASSWORD,
  AUTH_ADMISSION_JWT_SECRET,
  CDN_BASE_URL,
  SENTRY_ENABLED,
  SENTRY_DSN,
  SENTRY_SEND_DEFAULT_PII,
  SENTRY_TRACES_SAMPLE_RATE,
  SENTRY_PROFILE_SESSION_SAMPLE_RATE,
  SENTRY_EVENT_LOOP_BLOCK_THRESHOLD_MS,
} = envVariables.parse(process.env);

const options: BuildConfig = {
  database: {
    url: DB_URL,
    tls: DB_TLS_CA || DB_TLS_CERT || DB_TLS_KEY ? { ca: DB_TLS_CA, cert: DB_TLS_CERT, key: DB_TLS_KEY } : undefined,
  },
  allowedOrigins: ALLOWED_ORIGINS,
  production: process.env.NODE_ENV === 'production',
  clickhouseDsn: CLICKHOUSE_DSN,
  prometheus: {
    enabled: PROMETHEUS_ENABLED,
    path: PROMETHEUS_HTTP_PATH,
    host: PROMETHEUS_HOST,
    port: PROMETHEUS_PORT,
  },
  logger: {
    enabled: true,
    level: LOG_LEVEL as pino.LevelWithSilent,
  },
  openaiAPIKey: OPENAI_API_KEY,
  keycloak: {
    realm: KC_REALM,
    loginRealm: KC_LOGIN_REALM,
    clientId: KC_CLIENT_ID,
    adminUser: KC_ADMIN_USER,
    adminPassword: KC_ADMIN_PASSWORD,
    apiUrl: KC_API_URL,
    frontendUrl: KC_FRONTEND_URL,
  },
  auth: {
    redirectUri: AUTH_REDIRECT_URI,
    secret: AUTH_JWT_SECRET,
    webBaseUrl: WEB_BASE_URL,
    webErrorPath: '/auth/error',
    ssoCookieDomain: AUTH_SSO_COOKIE_DOMAIN,
  },
  webhook: {
    url: WEBHOOK_URL,
    key: WEBHOOK_SECRET,
  },
  cdnBaseUrl: CDN_BASE_URL,
  admissionWebhook: {
    secret: AUTH_ADMISSION_JWT_SECRET,
  },
  githubApp: {
    webhookSecret: GITHUB_APP_WEBHOOK_SECRET,
    clientId: GITHUB_APP_CLIENT_ID,
    clientSecret: GITHUB_APP_CLIENT_SECRET,
    id: GITHUB_APP_ID,
    privateKey: GITHUB_APP_PRIVATE_KEY,
  },
  debugSQL: DEBUG_SQL,
  slack: {
    clientID: SLACK_APP_CLIENT_ID,
    clientSecret: SLACK_APP_CLIENT_SECRET,
  },
  s3Storage: {
    url: S3_STORAGE_URL,
    region: S3_REGION,
    endpoint: S3_ENDPOINT,
    username: S3_ACCESS_KEY_ID,
    password: S3_SECRET_ACCESS_KEY,
    forcePathStyle: S3_FORCE_PATH_STYLE,
    useIndividualDeletes: S3_USE_INDIVIDUAL_DELETES,
  },
  mailer: {
    smtpEnabled: SMTP_ENABLED,
    smtpHost: SMTP_HOST,
    smtpPort: SMTP_PORT,
    smtpUsername: SMTP_USERNAME,
    smtpPassword: SMTP_PASSWORD,
    smtpSecure: SMTP_SECURE,
    smtpRequireTls: SMTP_REQUIRE_TLS,
  },
  redis: {
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    tls:
      REDIS_TLS_CERT || REDIS_TLS_KEY || REDIS_TLS_CA
        ? {
            cert: REDIS_TLS_CERT,
            key: REDIS_TLS_KEY,
            ca: REDIS_TLS_CA,
          }
        : undefined,
  },
};

if (STRIPE_SECRET_KEY) {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not');
  }
  if (!DEFAULT_PLAN) {
    throw new Error('STRIPE_SECRET_KEY is set but DEFAULT_PLAN is not');
  }

  options.stripe = {
    secret: STRIPE_SECRET_KEY,
    webhookSecret: STRIPE_WEBHOOK_SECRET,
    defaultPlanId: DEFAULT_PLAN,
  };
}

if (SENTRY_ENABLED) {
  if (SENTRY_DSN) {
    const sentryConfig: SentryConfig = {
      sentry: {
        enabled: SENTRY_ENABLED,
        dsn: SENTRY_DSN,
        eventLoopBlockIntegrationThresholdMs: SENTRY_EVENT_LOOP_BLOCK_THRESHOLD_MS,
        profileSessionSampleRate: SENTRY_PROFILE_SESSION_SAMPLE_RATE,
        sendDefaultPii: SENTRY_SEND_DEFAULT_PII,
        tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
      },
    };
    await import('./core/sentry.config.js').then((sentry) => sentry.init(sentryConfig));
  } else {
    throw new Error('SENTRY_ENABLED is set but SENTRY_DSN is not');
  }
}

const app = await build(options);

await app.listen({
  host: HOST,
  port: PORT,
});

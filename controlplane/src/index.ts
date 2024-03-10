import * as process from 'node:process';
import pino from 'pino';

import 'dotenv/config';

import build, { BuildConfig } from './core/build-server.js';
import { envVariables } from './core/env.schema.js';

const {
  LOG_LEVEL,
  PORT,
  HOST,
  ALLOWED_ORIGINS,
  DB_URL,
  DB_TLS_CERT,
  DB_TLS_KEY,
  DB_TLS_CA,
  DEBUG_SQL,
  CLICKHOUSE_DSN,
  AUTH_REDIRECT_URI,
  WEB_BASE_URL,
  AUTH_JWT_SECRET,
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
} = envVariables.parse(process.env);

const options: BuildConfig = {
  database: {
    url: DB_URL,
    tls: DB_TLS_CA || DB_TLS_CERT || DB_TLS_KEY ? { ca: DB_TLS_CA, cert: DB_TLS_CERT, key: DB_TLS_KEY } : undefined,
  },
  allowedOrigins: ALLOWED_ORIGINS,
  production: process.env.NODE_ENV === 'production',
  clickhouseDsn: CLICKHOUSE_DSN,
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
  },
  webhook: {
    url: WEBHOOK_URL,
    key: WEBHOOK_SECRET,
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
  s3StorageUrl: S3_STORAGE_URL,
  mailer: {
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

const app = await build(options);

await app.listen({
  host: HOST,
  port: PORT,
});

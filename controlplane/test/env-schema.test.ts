import { expect, test } from 'vitest';
import { envVariables, sentryEnvVariables } from '../src/core/env.schema.js';

test('environment defaults and supplied flags produce booleans', () => {
  const required = {
    WEB_BASE_URL: 'http://localhost:3000',
    CDN_BASE_URL: 'http://localhost:3002',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    AUTH_JWT_SECRET: 'a'.repeat(32),
    AUTH_REDIRECT_URI: 'http://localhost:3000/callback',
    DB_URL: 'postgresql://localhost/controlplane',
    KC_REALM: 'cosmo',
    KC_CLIENT_ID: 'cosmo',
    KC_ADMIN_USER: 'admin',
    KC_ADMIN_PASSWORD: 'password',
    KC_API_URL: 'http://localhost:8080',
    KC_FRONTEND_URL: 'http://localhost:8080',
    CLICKHOUSE_DSN: 'http://localhost:8123',
    S3_STORAGE_URL: 'http://localhost:9000',
    AUTH_ADMISSION_JWT_SECRET: 'secret',
  };
  expect(envVariables.parse(required)).toMatchObject({
    SENTRY_ENABLED: false,
    SENTRY_SEND_DEFAULT_PII: false,
    SENTRY_ENABLE_LOGS: false,
    PROMETHEUS_ENABLED: false,
    SMTP_ENABLED: false,
    S3_FORCE_PATH_STYLE: true,
    PORT: 3001,
    REDIS_PORT: 6379,
  });
  expect(envVariables.parse({ ...required, SMTP_ENABLED: 'true', S3_FORCE_PATH_STYLE: 'false' })).toMatchObject({
    SMTP_ENABLED: true,
    S3_FORCE_PATH_STYLE: false,
  });
  expect(sentryEnvVariables.parse({ SENTRY_ENABLED: 'false' }).SENTRY_ENABLED).toBe(false);
  expect(sentryEnvVariables.parse({ SENTRY_ENABLED: 'true' }).SENTRY_ENABLED).toBe(true);
});

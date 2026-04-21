import { describe, expect, test } from 'vitest';
import { envVariables } from '../env.schema.js';

// The minimal set of env vars env.schema.ts requires to successfully parse.
// Anything unrelated to Redis is filled with placeholders — the tests here
// only care that REDIS_USERNAME is plumbed through as an optional field.
const requiredEnv = {
  WEB_BASE_URL: 'http://localhost:3000',
  CDN_BASE_URL: 'http://localhost:11000',
  ALLOWED_ORIGINS: 'http://localhost:3000',
  AUTH_JWT_SECRET: 'fkczyomvdprgvtmvkuhvprxuggkbgwld',
  AUTH_REDIRECT_URI: 'http://localhost:3001/v1/auth/callback',
  DB_URL: 'postgresql://postgres:changeme@localhost:5432/controlplane',
  KC_REALM: 'cosmo',
  KC_CLIENT_ID: 'studio',
  KC_ADMIN_USER: 'admin',
  KC_ADMIN_PASSWORD: 'changeme',
  KC_API_URL: 'http://localhost:8080',
  KC_FRONTEND_URL: 'http://localhost:8080',
  CLICKHOUSE_DSN: '',
  S3_STORAGE_URL: 'http://minio:changeme@localhost:10000/cosmo',
  AUTH_ADMISSION_JWT_SECRET: 'uXDxJLEvrw4aafPfrf3rRotCoBzRfPEW',
};

describe('env.schema REDIS_USERNAME', () => {
  test('REDIS_USERNAME is optional and defaults to undefined', () => {
    const parsed = envVariables.parse({ ...requiredEnv });
    expect(parsed.REDIS_USERNAME).toBeUndefined();
  });

  test('REDIS_USERNAME is passed through when set', () => {
    const parsed = envVariables.parse({
      ...requiredEnv,
      REDIS_USERNAME: 'cosmo-acl-user',
      REDIS_PASSWORD: 'secret',
    });
    expect(parsed.REDIS_USERNAME).toBe('cosmo-acl-user');
    expect(parsed.REDIS_PASSWORD).toBe('secret');
  });

  test('REDIS_USERNAME empty string is accepted (treated as empty string, not undefined)', () => {
    // Documents current behaviour: z.string().optional() does not coerce ''
    // to undefined, so an explicitly-empty env var reaches ioredis as ''.
    // ioredis treats '' username identically to undefined, so this is safe.
    const parsed = envVariables.parse({ ...requiredEnv, REDIS_USERNAME: '' });
    expect(parsed.REDIS_USERNAME).toBe('');
  });
});

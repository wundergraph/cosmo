import { ApiKeyGenerator } from '../core/services/ApiGenerator.js';

const getConfig = () => {
  return {
    realm: process.env.KC_REALM || 'cosmo',
    loginRealm: process.env.KC_LOGIN_REALM || 'master',
    adminUser: process.env.KC_ADMIN_USER || 'admin',
    adminPassword: process.env.KC_ADMIN_PASSWORD || 'changeme',
    clientId: process.env.KC_CLIENT_ID || 'studio',
    apiUrl: process.env.KC_API_URL || 'http://localhost:8080',

    apiKey: process.env.API_KEY || ApiKeyGenerator.generate(),

    userEmail: process.env.USER_EMAIL || 'foo@wundergraph.com',
    userPassword: process.env.USER_PASSWORD || 'wunder@123',
    userFirstName: process.env.USER_FIRST_NAME || 'foo',
    userLastName: process.env.USER_LAST_NAME || 'bar',

    organizationName: process.env.ORGANIZATION_NAME || 'wundergraph',
    organizationSlug: process.env.ORGANIZATION_SLUG || 'wundergraph',

    databaseConnectionUrl: process.env.DB_URL || 'postgresql://postgres:changeme@localhost:5432/controlplane',
    databaseTlsCa: process.env.DB_TLS_CA,
    databaseTlsCert: process.env.DB_TLS_CERT,
    databaseTlsKey: process.env.DB_TLS_KEY,

    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      tls:
        process.env.REDIS_TLS_CERT || process.env.REDIS_TLS_KEY || process.env.REDIS_TLS_CA
          ? {
              cert: process.env.REDIS_TLS_CERT,
              key: process.env.REDIS_TLS_KEY,
              ca: process.env.REDIS_TLS_CA,
            }
          : undefined,
    },

    webhookUrl: process.env.WEBHOOK_URL,
    webhookSecret: process.env.WEBHOOK_SECRET,
  };
};

export { getConfig };

import Fastify from 'fastify';
import { fastifyConnectPlugin } from '@bufbuild/connect-fastify';
import { cors } from '@bufbuild/connect';
import fastifyCors from '@fastify/cors';
import { PinoLoggerOptions } from 'fastify/types/logger.js';
import pino from 'pino';
import { compressionBrotli, compressionGzip } from '@bufbuild/connect-node';
import fastifyGracefulShutdown from 'fastify-graceful-shutdown';
import routes from './routes.js';
import fastifyHealth from './plugins/health.js';
import fastifyDatabase from './plugins/database.js';
import fastifyClickHouse from './plugins/clickhouse.js';
import AuthController from './controllers/auth.js';
import { pkceCodeVerifierCookieName, userSessionCookieName } from './crypto/jwt.js';
import ApiKeyAuthenticator from './services/ApiKeyAuthenticator.js';
import WebSessionAuthenticator from './services/WebSessionAuthenticator.js';
import { Authentication } from './services/Authentication.js';
import { OrganizationRepository } from './repositories/OrganizationRepository.js';
import GraphApiTokenAuthenticator from './services/GraphApiTokenAuthenticator.js';
import AuthUtils from './auth-utils.js';
import Keycloak from './services/Keycloak.js';

export interface BuildConfig {
  logger: PinoLoggerOptions;
  database: {
    url: string;
    ssl?: {
      certPath?: string; // e.g. '/path/to/my/client-cert.pem'
      caPath?: string; // e.g., '/path/to/my/server-ca.pem'
      keyPath?: string; // e.g. '/path/to/my/client-key.pem'
    };
  };
  allowedOrigins?: string[];
  debugSQL?: boolean;
  production?: boolean;
  clickhouseDsn?: string;
  keycloak: {
    loginRealm: string;
    realm: string;
    clientId: string;
    adminUser: string;
    adminPassword: string;
    apiUrl: string;
    frontendUrl: string;
  };
  auth: {
    webBaseUrl: string;
    secureCookie?: boolean;
    webErrorPath: string;
    secret: string;
    redirectUri: string;
  };
}

const developmentLoggerOpts: PinoLoggerOptions = {
  transport: {
    target: 'pino-pretty',
    options: {
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  },
};

export default async function build(opts: BuildConfig) {
  opts.logger = {
    formatters: {
      level: (label) => {
        return {
          level: label,
        };
      },
    },
    ...opts.logger,
  };

  const fastify = Fastify({
    logger: opts.production ? opts.logger : { ...developmentLoggerOpts, ...opts.logger },
  });

  /**
   * Plugin registration
   */

  await fastify.register(fastifyHealth);

  await fastify.register(fastifyDatabase, {
    databaseConnectionUrl: opts.database.url,
    ssl: opts.database.ssl,
    debugSQL: opts.debugSQL,
  });

  await fastify.register(fastifyCors, {
    // Produce an error if allowedOrigins is undefined
    origin: opts.allowedOrigins || [],
    methods: [...cors.allowedMethods],
    allowedHeaders: [...cors.allowedHeaders, 'cosmo-org-slug'],
    exposedHeaders: [...cors.exposedHeaders, 'Trailer-Response-Id'],
    credentials: true,
    // Let browsers cache CORS information to reduce the number of
    // preflight requests. Modern Chrome caps the value at 2h.
    maxAge: 2 * 60 * 60,
  });

  if (opts.clickhouseDsn) {
    await fastify.register(fastifyClickHouse, {
      dsn: opts.clickhouseDsn,
      logger: fastify.log,
    });
  } else {
    fastify.log.warn('ClickHouse connection not configured');
  }

  const authUtils = new AuthUtils(fastify.db, {
    jwtSecret: opts.auth.secret,
    session: {
      cookieName: userSessionCookieName,
    },
    oauth: {
      clientID: opts.keycloak.clientId,
      redirectUri: opts.auth.redirectUri,
      openIdApiBaseUrl: opts.keycloak.apiUrl + '/realms/' + opts.keycloak.realm,
      openIdFrontendUrl: opts.keycloak.frontendUrl + '/realms/' + opts.keycloak.realm,
      logoutRedirectUri: opts.auth.webBaseUrl + '/login',
    },
    pkce: {
      cookieName: pkceCodeVerifierCookieName,
    },
    webBaseUrl: opts.auth.webBaseUrl,
    webErrorPath: opts.auth.webErrorPath,
  });

  const apiKeyAuth = new ApiKeyAuthenticator(fastify.db);
  const webAuth = new WebSessionAuthenticator(opts.auth.secret);
  const graphKeyAuth = new GraphApiTokenAuthenticator(opts.auth.secret);
  const organizationRepository = new OrganizationRepository(fastify.db);
  const authenticator = new Authentication(webAuth, apiKeyAuth, graphKeyAuth, organizationRepository);

  const keycloakClient = new Keycloak({
    apiUrl: opts.keycloak.apiUrl,
    realm: opts.keycloak.loginRealm,
    clientId: opts.keycloak.clientId,
    adminUser: opts.keycloak.adminUser,
    adminPassword: opts.keycloak.adminPassword,
  });

  /**
   * Controllers registration
   */

  await fastify.register(AuthController, {
    organizationRepository,
    webAuth,
    authUtils,
    prefix: '/v1/auth',
    db: fastify.db,
    jwtSecret: opts.auth.secret,
    session: {
      cookieName: userSessionCookieName,
    },
    pkce: {
      cookieName: pkceCodeVerifierCookieName,
    },
    webBaseUrl: opts.auth.webBaseUrl,
  });

  // Must be registered after custom fastify routes
  // Because it registers an all-catch route for connect handlers

  await fastify.register(fastifyConnectPlugin, {
    routes: routes({
      db: fastify.db,
      logger: fastify.log as pino.Logger,
      jwtSecret: opts.auth.secret,
      keycloakRealm: opts.keycloak.realm,
      chClient: fastify.ch,
      authenticator,
      keycloakClient,
    }),
    logLevel: opts.logger.level as pino.LevelWithSilent,
    // Avoid compression for small requests
    compressMinBytes: 1024,
    // The default limit is the maximum supported value of ~4GiB
    // We go with 32MiB to avoid allocating too much memory for large requests
    writeMaxBytes: 32 * 1024 * 1024,
    acceptCompression: [compressionBrotli, compressionGzip],
  });

  await fastify.register(fastifyGracefulShutdown, {});

  return fastify;
}

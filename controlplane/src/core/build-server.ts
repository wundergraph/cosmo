import Fastify from 'fastify';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { cors } from '@connectrpc/connect';
import fastifyCors from '@fastify/cors';
import { pino, stdTimeFunctions, LoggerOptions } from 'pino';
import { compressionBrotli, compressionGzip } from '@connectrpc/connect-node';
import fastifyGracefulShutdown from 'fastify-graceful-shutdown';
import { App } from 'octokit';
import routes from './routes.js';
import fastifyHealth from './plugins/health.js';
import fastifyDatabase from './plugins/database.js';
import fastifyClickHouse from './plugins/clickhouse.js';
import AuthController from './controllers/auth.js';
import GitHubWebhookController from './controllers/github.js';
import { pkceCodeVerifierCookieName, userSessionCookieName } from './crypto/jwt.js';
import ApiKeyAuthenticator from './services/ApiKeyAuthenticator.js';
import WebSessionAuthenticator from './services/WebSessionAuthenticator.js';
import { Authentication } from './services/Authentication.js';
import { OrganizationRepository } from './repositories/OrganizationRepository.js';
import GraphApiTokenAuthenticator from './services/GraphApiTokenAuthenticator.js';
import AuthUtils from './auth-utils.js';
import Keycloak from './services/Keycloak.js';
import { PlatformWebhookService } from './webhooks/PlatformWebhookService.js';
import AccessTokenAuthenticator from './services/AccessTokenAuthenticator.js';
import { GitHubRepository } from './repositories/GitHubRepository.js';

export interface BuildConfig {
  logger: LoggerOptions;
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
  webhook?: {
    url?: string;
    key?: string;
  };
  githubApp?: {
    webhookSecret?: string;
    clientId?: string;
    clientSecret?: string;
    id?: string;
    privateKey?: string;
  };
  slack: { clientID?: string; clientSecret?: string };
}

const developmentLoggerOpts: LoggerOptions = {
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
    timestamp: stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => {
        return {
          level: label,
        };
      },
    },
    ...opts.logger,
  };

  const log = pino(opts.production ? opts.logger : { ...developmentLoggerOpts, ...opts.logger });

  const fastify = Fastify({
    logger: log,
    // The maximum amount of time in *milliseconds* in which a plugin can load
    pluginTimeout: 10_000, // 10s
  });

  /**
   * Plugin registration
   */

  await fastify.register(fastifyHealth);

  await fastify.register(fastifyDatabase, {
    databaseConnectionUrl: opts.database.url,
    gracefulTimeoutSec: 15,
    ssl: opts.database.ssl,
    debugSQL: opts.debugSQL,
  });

  // await fastify.register(fastifyPgBoss, {
  //   databaseConnectionUrl: opts.database.url,
  // });

  // PgBoss Workers

  // Example
  // const tw = new TrafficAnalyzerWorker(fastify.pgboss);
  // await tw.register({ graphId: 'test' });
  // await tw.subscribe();

  await fastify.register(fastifyCors, {
    // Produce an error if allowedOrigins is undefined
    origin: opts.allowedOrigins || [],
    methods: [...cors.allowedMethods],
    allowedHeaders: [...cors.allowedHeaders, 'cosmo-org-slug', 'user-agent'],
    exposedHeaders: [...cors.exposedHeaders, 'Trailer-Response-Id'],
    credentials: true,
    // Let browsers cache CORS information to reduce the number of
    // preflight requests. Modern Chrome caps the value at 2h.
    maxAge: 2 * 60 * 60,
  });

  if (opts.clickhouseDsn) {
    await fastify.register(fastifyClickHouse, {
      dsn: opts.clickhouseDsn,
      logger: log,
    });
  } else {
    log.warn('ClickHouse connection not configured');
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

  const organizationRepository = new OrganizationRepository(fastify.db);
  const apiKeyAuth = new ApiKeyAuthenticator(fastify.db, organizationRepository);
  const webAuth = new WebSessionAuthenticator(opts.auth.secret);
  const graphKeyAuth = new GraphApiTokenAuthenticator(opts.auth.secret);
  const accessTokenAuth = new AccessTokenAuthenticator(organizationRepository, authUtils);
  const authenticator = new Authentication(webAuth, apiKeyAuth, accessTokenAuth, graphKeyAuth, organizationRepository);

  const keycloakClient = new Keycloak({
    apiUrl: opts.keycloak.apiUrl,
    realm: opts.keycloak.loginRealm,
    clientId: opts.keycloak.clientId,
    adminUser: opts.keycloak.adminUser,
    adminPassword: opts.keycloak.adminPassword,
  });

  let githubApp: App | undefined;
  if (opts.githubApp?.clientId) {
    githubApp = new App({
      appId: opts.githubApp?.id ?? '',
      privateKey: Buffer.from(opts.githubApp?.privateKey ?? '', 'base64').toString(),
      oauth: {
        clientId: opts.githubApp?.clientId ?? '',
        clientSecret: opts.githubApp?.clientSecret ?? '',
      },
    });

    const githubRepository = new GitHubRepository(fastify.db, githubApp);

    await fastify.register(GitHubWebhookController, {
      prefix: '/webhook/github',
      githubRepository,
      webhookSecret: opts.githubApp?.webhookSecret ?? '',
      logger: log,
    });
  }

  /**
   * Controllers registration
   */

  const platformWebhooks = new PlatformWebhookService(opts.webhook?.url, opts.webhook?.key, log);

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
    keycloakClient,
    keycloakRealm: opts.keycloak.realm,
    platformWebhooks,
  });

  // Must be registered after custom fastify routes
  // Because it registers an all-catch route for connect handlers

  await fastify.register(fastifyConnectPlugin, {
    routes: routes({
      db: fastify.db,
      logger: log,
      jwtSecret: opts.auth.secret,
      keycloakRealm: opts.keycloak.realm,
      keycloakApiUrl: opts.keycloak.apiUrl,
      chClient: fastify.ch,
      authenticator,
      keycloakClient,
      platformWebhooks,
      githubApp,
      webBaseUrl: opts.auth.webBaseUrl,
      slack: opts.slack,
    }),
    logLevel: opts.logger.level as pino.LevelWithSilent,
    // Avoid compression for small requests
    compressMinBytes: 1024,
    // The default limit is the maximum supported value of ~4GiB
    // We go with 32MiB to avoid allocating too much memory for large requests
    writeMaxBytes: 32 * 1024 * 1024,
    acceptCompression: [compressionBrotli, compressionGzip],
  });

  await fastify.register(fastifyGracefulShutdown, {
    timeout: 60_000,
  });

  return fastify;
}

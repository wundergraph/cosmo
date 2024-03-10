import Fastify, { FastifyBaseLogger } from 'fastify';
import { S3Client } from '@aws-sdk/client-s3';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { cors, createContextValues } from '@connectrpc/connect';
import fastifyCors from '@fastify/cors';
import { pino, stdTimeFunctions, LoggerOptions } from 'pino';
import { compressionBrotli, compressionGzip } from '@connectrpc/connect-node';
import fastifyGracefulShutdown from 'fastify-graceful-shutdown';
import { App } from 'octokit';
import { Worker } from 'bullmq';
import { MailerParams } from '../types/index.js';
import routes from './routes.js';
import fastifyHealth from './plugins/health.js';
import fastifyDatabase from './plugins/database.js';
import fastifyClickHouse from './plugins/clickhouse.js';
import fastifyRedis from './plugins/redis.js';
import AuthController from './controllers/auth.js';
import GitHubWebhookController from './controllers/github.js';
import StripeWebhookController from './controllers/stripe.js';
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
import { S3BlobStorage } from './blobstorage/index.js';
import Mailer from './services/Mailer.js';
import { OrganizationInvitationRepository } from './repositories/OrganizationInvitationRepository.js';
import { Authorization } from './services/Authorization.js';
import { BillingRepository } from './repositories/BillingRepository.js';
import { BillingService } from './services/BillingService.js';
import { UserRepository } from './repositories/UserRepository.js';
import { AIGraphReadmeQueue, createAIGraphReadmeWorker } from './workers/AIGraphReadmeWorker.js';
import { fastifyLoggerId } from './util.js';

export interface BuildConfig {
  logger: LoggerOptions;
  database: {
    url: string;
    tls?: {
      cert?: string; // e.g. string or '/path/to/my/client-cert.pem'
      ca?: string; // e.g. string or '/path/to/my/server-ca.pem'
      key?: string; // e.g. string or '/path/to/my/client-key.pem'
    };
  };
  openaiAPIKey?: string;
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
  s3StorageUrl: string;
  mailer: {
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure: boolean;
    smtpRequireTls: boolean;
    smtpUsername?: string;
    smtpPassword?: string;
  };
  stripe?: {
    secret?: string;
    webhookSecret?: string;
    defaultPlanId?: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    tls?: {
      cert?: string; // e.g. string or '/path/to/my/client-cert.pem'
      ca?: string; // e.g. string or '/path/to/my/server-ca.pem'
      key?: string; // e.g. string or '/path/to/my/client-key.pem'
    };
  };
}

const developmentLoggerOpts: LoggerOptions = {
  transport: {
    target: 'pino-pretty',
    options: {
      singleLine: true,
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

  await fastify.register(fastifyGracefulShutdown, {
    timeout: 60_000,
  });

  await fastify.register(fastifyHealth);

  await fastify.register(fastifyDatabase, {
    databaseConnectionUrl: opts.database.url,
    gracefulTimeoutSec: 15,
    tls: opts.database.tls,
    debugSQL: opts.debugSQL,
  });

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

  const organizationRepository = new OrganizationRepository(fastify.db, opts.stripe?.defaultPlanId);
  const orgInvitationRepository = new OrganizationInvitationRepository(fastify.db, opts.stripe?.defaultPlanId);
  const apiKeyAuth = new ApiKeyAuthenticator(fastify.db, organizationRepository);
  const userRepo = new UserRepository(fastify.db);
  const webAuth = new WebSessionAuthenticator(opts.auth.secret, userRepo);
  const graphKeyAuth = new GraphApiTokenAuthenticator(opts.auth.secret);
  const accessTokenAuth = new AccessTokenAuthenticator(organizationRepository, authUtils);
  const authenticator = new Authentication(webAuth, apiKeyAuth, accessTokenAuth, graphKeyAuth, organizationRepository);
  const authorizer = new Authorization(opts.stripe?.defaultPlanId);

  const keycloakClient = new Keycloak({
    apiUrl: opts.keycloak.apiUrl,
    realm: opts.keycloak.loginRealm,
    clientId: opts.keycloak.clientId,
    adminUser: opts.keycloak.adminUser,
    adminPassword: opts.keycloak.adminPassword,
  });

  let mailerClient: Mailer | undefined;
  if (opts.mailer.smtpUsername && opts.mailer.smtpPassword) {
    mailerClient = new Mailer(opts.mailer as MailerParams);
    try {
      const verified = await mailerClient.verifyConnection();
      if (verified) {
        log.info('Email client ready to send emails');
      } else {
        log.error('Email client failed to verify connection');
      }
    } catch (error) {
      log.error(error, 'Email client could not verify connection');
    }
  }

  const bullWorkers: Worker[] = [];

  await fastify.register(fastifyRedis, {
    host: opts.redis.host,
    port: opts.redis.port,
    password: opts.redis.password,
    tls: opts.redis.tls,
  });

  const readmeQueue = new AIGraphReadmeQueue(log, fastify.redisForQueue);

  if (opts.openaiAPIKey) {
    bullWorkers.push(
      createAIGraphReadmeWorker({
        redisConnection: fastify.redisForWorker,
        db: fastify.db,
        log,
        openAiApiKey: opts.openaiAPIKey,
      }),
    );
  }

  fastify.gracefulShutdown((signal, next) => {
    fastify.log.debug('Shutting down bull workers');
    for (const worker of bullWorkers) {
      worker.close();
    }
    fastify.log.debug('Bull workers shut down');
    next();
  });

  // required to verify webhook payloads
  await fastify.register(import('fastify-raw-body'), {
    field: 'rawBody',
    global: false,
    encoding: 'utf8',
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

  if (opts.stripe?.secret && opts.stripe?.webhookSecret) {
    const billingRepo = new BillingRepository(fastify.db);
    const billingService = new BillingService(fastify.db, billingRepo);
    await fastify.register(StripeWebhookController, {
      prefix: '/webhook/stripe',
      billingService,
      webhookSecret: opts.stripe.webhookSecret,
      logger: log,
    });
  }

  if (!opts.s3StorageUrl) {
    throw new Error('S3 storage URL is required');
  }

  const url = new URL(opts.s3StorageUrl);
  const s3Client = new S3Client({
    // For AWS S3, the region can be set via the endpoint
    region: 'auto',
    endpoint: url.origin,
    credentials: {
      accessKeyId: url.username ?? '',
      secretAccessKey: url.password ?? '',
    },
    forcePathStyle: true,
  });
  const bucketName = url.pathname.slice(1);
  const blobStorage = new S3BlobStorage(s3Client, bucketName);

  /**
   * Controllers registration
   */

  const platformWebhooks = new PlatformWebhookService(opts.webhook?.url, opts.webhook?.key, log);

  await fastify.register(AuthController, {
    organizationRepository,
    orgInvitationRepository,
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
    defaultBillingPlanId: opts.stripe?.defaultPlanId,
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
      authorizer,
      keycloakClient,
      platformWebhooks,
      githubApp,
      webBaseUrl: opts.auth.webBaseUrl,
      slack: opts.slack,
      blobStorage,
      mailerClient,
      billingDefaultPlanId: opts.stripe?.defaultPlanId,
      openaiApiKey: opts.openaiAPIKey,
      readmeQueue,
      stripeSecretKey: opts.stripe?.secret,
    }),
    contextValues(req) {
      return createContextValues().set<FastifyBaseLogger>({ id: fastifyLoggerId, defaultValue: req.log }, req.log);
    },
    logLevel: opts.logger.level as pino.LevelWithSilent,
    // Avoid compression for small requests
    compressMinBytes: 1024,
    maxTimeoutMs: 120_000,
    shutdownTimeoutMs: 30_000,
    // The default limit is the maximum supported value of ~4GiB
    // We go with 32MiB to avoid allocating too much memory for large requests
    writeMaxBytes: 32 * 1024 * 1024,
    acceptCompression: [compressionBrotli, compressionGzip],
  });

  return fastify;
}

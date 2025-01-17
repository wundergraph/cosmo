import { JWTVerifyResult, jwtVerify } from 'jose';
import { Context, Env, Hono, Next, Schema } from 'hono';
import { stream } from 'hono/streaming';

export const signatureSha256Header = 'X-Signature-SHA256';

export interface BlobObject {
  metadata?: Partial<Record<'version' | 'signature-sha256', string>>;
  stream: ReadableStream;
}

export interface BlobStorage {
  getObject({
    context,
    key,
    cacheControl,
  }: {
    context: Context;
    abortSignal?: AbortSignal;
    key: string;
    cacheControl?: string;
  }): Promise<BlobObject>;

  headObject({
    context,
    key,
    schemaVersionId,
  }: {
    context: Context;
    abortSignal?: AbortSignal;
    key: string;
    schemaVersionId: string;
  }): Promise<boolean>;
}

export class BlobNotFoundError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    Object.setPrototypeOf(this, BlobNotFoundError.prototype);
  }
}

interface CdnOptions {
  authJwtSecret: string | ((c: Context) => string);
  authAdmissionJwtSecret: string | ((c: Context) => string);
  blobStorage: BlobStorage;
}

declare module 'hono' {
  interface ContextVariableMap {
    authenticatedOrganizationId: string;
    authenticatedFederatedGraphId: string;
  }
}

const jwtMiddleware = (secret: string | ((c: Context) => string)) => {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    const queryToken = c.req.query('token');
    if (!authHeader && !queryToken) {
      return c.text('Unauthorized - No token provided', 401);
    }

    let jwt = '';
    if (queryToken) {
      jwt = queryToken;
    } else if (authHeader) {
      const [type, token] = authHeader.split(' ');
      if (type !== 'Bearer' || !token) {
        return c.text('Unauthorized - Invalid token scheme', 401);
      }
      jwt = token;
    } else {
      return c.text('Unauthorized - No token provided', 401);
    }

    let result: JWTVerifyResult;
    const secretKey = new TextEncoder().encode(typeof secret === 'function' ? secret(c) : secret);
    try {
      result = await jwtVerify(jwt, secretKey);
    } catch (e: any) {
      if (
        e instanceof Error &&
        (e.name === 'JWSSignatureVerificationFailed' || e.name === 'JWSInvalid' || e.name === 'JWTExpired')
      ) {
        return c.text('Unauthorized - Invalid token', 401);
      }
      throw e;
    }

    const organizationId = result.payload.organization_id;
    const federatedGraphId = result.payload.federated_graph_id;
    if (!organizationId || !federatedGraphId) {
      return c.text('Unauthorized - Malformed token', 403);
    }
    c.set('authenticatedOrganizationId', organizationId as string);
    c.set('authenticatedFederatedGraphId', federatedGraphId as string);

    await next();
  };
};

const persistedOperation = (storage: BlobStorage) => {
  return async (c: Context) => {
    const organizationId = c.get('authenticatedOrganizationId');
    const federatedGraphId = c.get('authenticatedFederatedGraphId');

    if (organizationId !== c.req.param('organization_id') || federatedGraphId !== c.req.param('federated_graph_id')) {
      return c.text('Bad Request', 400);
    }

    const clientId = c.req.param('client_id');
    const operation = c.req.param('operation');
    if (!operation.endsWith('.json')) {
      return c.notFound();
    }

    const key = `${organizationId}/${federatedGraphId}/operations/${clientId}/${operation}`;
    let blobObject: BlobObject;

    try {
      blobObject = await storage.getObject({ context: c, key });
    } catch (e: any) {
      if (e instanceof BlobNotFoundError) {
        return c.notFound();
      }
      throw e;
    }

    return stream(c, async (stream) => {
      await stream.pipe(blobObject.stream);
    });
  };
};

const latestValidRouterConfig = (storage: BlobStorage) => {
  return async (c: Context) => {
    const organizationId = c.get('authenticatedOrganizationId');
    const federatedGraphId = c.get('authenticatedFederatedGraphId');

    if (organizationId !== c.req.param('organization_id') || federatedGraphId !== c.req.param('federated_graph_id')) {
      return c.text('Bad Request', 400);
    }

    const key = `${organizationId}/${federatedGraphId}/routerconfigs/latest.json`;
    const body = await c.req.json();

    let isModified = true;

    // Only check if version is specified otherwise we assume the router
    // starts for the first time, and we need to return a config anyway.
    if (body?.version) {
      try {
        isModified = await storage.headObject({ context: c, key, schemaVersionId: body.version });
      } catch (e: any) {
        if (e instanceof BlobNotFoundError) {
          return c.notFound();
        }
        throw e;
      }
    }

    if (!isModified) {
      return c.body(null, 304);
    }

    let blobObject: BlobObject;

    try {
      blobObject = await storage.getObject({ context: c, key, cacheControl: 'no-cache' });

      if (blobObject.metadata && blobObject.metadata['signature-sha256']) {
        c.header(signatureSha256Header, blobObject.metadata['signature-sha256']);
      }
    } catch (e: any) {
      if (e instanceof BlobNotFoundError) {
        return c.notFound();
      }
      throw e;
    }

    c.header('Content-Type', 'application/json; charset=UTF-8');

    return stream(c, async (stream) => {
      await stream.pipe(blobObject.stream);
    });
  };
};

const draftRouterConfig = (storage: BlobStorage) => {
  return async (c: Context) => {
    const organizationId = c.get('authenticatedOrganizationId');
    const federatedGraphId = c.get('authenticatedFederatedGraphId');

    if (organizationId !== c.req.param('organization_id') || federatedGraphId !== c.req.param('federated_graph_id')) {
      return c.text('Bad Request', 400);
    }

    const key = `${organizationId}/${federatedGraphId}/routerconfigs/draft.json`;

    let blobObject: BlobObject;

    try {
      blobObject = await storage.getObject({ context: c, key, cacheControl: 'no-cache' });
    } catch (e: any) {
      if (e instanceof BlobNotFoundError) {
        return c.notFound();
      }
      throw e;
    }

    c.header('Content-Type', 'application/json; charset=UTF-8');
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');

    return stream(c, async (stream) => {
      await stream.pipe(blobObject.stream);
    });
  };
};

const cacheOperations = (storage: BlobStorage) => {
  return async (c: Context) => {
    const organizationId = c.get('authenticatedOrganizationId');
    const federatedGraphId = c.get('authenticatedFederatedGraphId');

    if (organizationId !== c.req.param('organization_id') || federatedGraphId !== c.req.param('federated_graph_id')) {
      return c.text('Bad Request', 400);
    }

    const key = `${organizationId}/${federatedGraphId}/cache_warmup/operations.json`;
    let blobObject: BlobObject;

    try {
      blobObject = await storage.getObject({ context: c, key, cacheControl: 'no-cache' });
    } catch (e: any) {
      if (e instanceof BlobNotFoundError) {
        return c.notFound();
      }
      throw e;
    }

    c.header('Content-Type', 'application/json; charset=UTF-8');
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');

    return stream(c, async (stream) => {
      await stream.pipe(blobObject.stream);
    });
  };
};

// eslint-disable-next-line @typescript-eslint/ban-types
export const cdn = <E extends Env, S extends Schema = {}, BasePath extends string = '/'>(
  hono: Hono<E, S, BasePath>,
  opts: CdnOptions,
) => {
  const operations = '/:organization_id/:federated_graph_id/operations/:client_id/:operation{.+\\.json$}';
  const latestValidRouterConfigs = '/:organization_id/:federated_graph_id/routerconfigs/latest.json';
  hono.use(operations, jwtMiddleware(opts.authJwtSecret)).get(operations, persistedOperation(opts.blobStorage));

  hono
    .use(latestValidRouterConfigs, jwtMiddleware(opts.authJwtSecret))
    .post(latestValidRouterConfigs, latestValidRouterConfig(opts.blobStorage));

  const draftRouterConfigs = '/:organization_id/:federated_graph_id/routerconfigs/draft.json';
  hono
    .use(draftRouterConfigs, jwtMiddleware(opts.authAdmissionJwtSecret))
    .get(draftRouterConfigs, draftRouterConfig(opts.blobStorage));

  const cacheOperationsPath = '/:organization_id/:federated_graph_id/cache_warmup/operations.json';
  hono
    .use(cacheOperationsPath, jwtMiddleware(opts.authJwtSecret))
    .get(cacheOperationsPath, cacheOperations(opts.blobStorage));
};

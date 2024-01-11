import { JWTVerifyResult, jwtVerify } from 'jose';
import { Context, Env, Hono, Next, Schema } from 'hono';
import { streamToJSON } from './utils';

export interface BlobStorage {
  getObject({
    context,
    key,
    cacheControl,
  }: {
    context: Context;
    key: string;
    cacheControl?: string;
  }): Promise<ReadableStream>;
}

export class BlobNotFoundError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    Object.setPrototypeOf(this, BlobNotFoundError.prototype);
  }
}

interface CdnOptions {
  authJwtSecret: string | ((c: Context) => string);
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
    if (!authHeader) {
      return c.text('Unauthorized', 401);
    }
    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token) {
      return c.text('Unauthorized', 401);
    }
    let result: JWTVerifyResult;
    const secretKey = new TextEncoder().encode(typeof secret === 'function' ? secret(c) : secret);
    try {
      result = await jwtVerify(token, secretKey);
    } catch (e: any) {
      if (e instanceof Error && (e.name === 'JWSSignatureVerificationFailed' || e.name === 'JWSInvalid')) {
        return c.text('Unauthorized', 401);
      }
      throw e;
    }
    const organizationId = result.payload.organization_id;
    const federatedGraphId = result.payload.federated_graph_id;
    if (!organizationId || !federatedGraphId) {
      return c.text('Forbidden', 403);
    }
    c.set('authenticatedOrganizationId', organizationId);
    c.set('authenticatedFederatedGraphId', federatedGraphId);
    await next();
  };
};

const persistedOperation = (storage: BlobStorage) => {
  return async (c: Context) => {
    const organizationId = c.req.param('organization_id');
    const federatedGraphId = c.req.param('federated_graph_id');
    // Check authentication
    if (
      organizationId !== c.get('authenticatedOrganizationId') ||
      federatedGraphId !== c.get('authenticatedFederatedGraphId')
    ) {
      return c.text('Bad Request', 400);
    }
    const clientId = c.req.param('client_id');
    const operation = c.req.param('operation');
    if (!operation.endsWith('.json')) {
      return c.notFound();
    }
    const key = `${organizationId}/${federatedGraphId}/operations/${clientId}/${operation}`;
    let operationStream: ReadableStream;
    try {
      operationStream = await storage.getObject({ context: c, key });
    } catch (e: any) {
      if (e instanceof Error && e.constructor.name === 'BlobNotFoundError') {
        return c.notFound();
      }
      throw e;
    }
    return c.stream(async (stream) => {
      await stream.pipe(operationStream);
      await stream.close();
    });
  };
};

const routerConfig = (storage: BlobStorage) => {
  return async (c: Context) => {
    const organizationId = c.req.param('organization_id');
    const federatedGraphId = c.req.param('federated_graph_id');
    // Check authentication
    if (
      organizationId !== c.get('authenticatedOrganizationId') ||
      federatedGraphId !== c.get('authenticatedFederatedGraphId')
    ) {
      return c.text('Bad Request', 400);
    }
    const key = `${organizationId}/${federatedGraphId}/routerconfigs/latest.json`;
    let configStream: ReadableStream;
    try {
      configStream = await storage.getObject({ context: c, key, cacheControl: 'no-cache' });
    } catch (e: any) {
      if (e instanceof Error && e.constructor.name === 'BlobNotFoundError') {
        return c.notFound();
      }
      throw e;
    }

    // Because we work with a fixed path of /routerconfigs/latest.json
    // we need to enforce no-cache headers here.
    c.header('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
    c.header('Content-Type', 'application/json; charset=utf-8');

    const teedStream = configStream.tee();

    const routerConfig = await streamToJSON(teedStream[0]);
    const body = await c.req.json();

    if (body?.version === undefined || null) {
      return c.text('Bad Request', 400);
    }

    if (routerConfig?.version && body.version === routerConfig.version) {
      return c.body(null, 204);
    }

    return c.stream(async (stream) => {
      await stream.pipe(teedStream[1]);
      await stream.close();
    });
  };
};

// eslint-disable-next-line @typescript-eslint/ban-types
export const cdn = <E extends Env, S extends Schema = {}, BasePath extends string = '/'>(
  hono: Hono<E, S, BasePath>,
  opts: CdnOptions,
) => {
  const operations = '/:organization_id/:federated_graph_id/operations/:client_id/:operation{.+\\.json$}';
  hono.use(operations, jwtMiddleware(opts.authJwtSecret));
  hono.get(operations, persistedOperation(opts.blobStorage));

  const routerConfigs = '/:organization_id/:federated_graph_id/routerconfigs/latest.json';
  hono.use(routerConfigs, jwtMiddleware(opts.authJwtSecret));
  hono.post(routerConfigs, routerConfig(opts.blobStorage));
};

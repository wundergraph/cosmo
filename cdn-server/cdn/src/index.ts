import { JWTVerifyResult, jwtVerify } from 'jose';
import { Context, Env, Hono, Next, Schema } from 'hono';

export interface BlobStorage {
  getObject(context: Context, key: string): Promise<ReadableStream>;
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
        return c.text('Forbidden', 403);
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
      return c.text('Forbidden', 403);
    }
    const clientId = c.req.param('client_id');
    const operation = c.req.param('operation');
    if (!operation.endsWith('.json')) {
      return c.notFound();
    }
    const key = `${organizationId}/${federatedGraphId}/operations/${clientId}/${operation}`;
    let operationStream: ReadableStream;
    try {
      operationStream = await storage.getObject(c, key);
    } catch (e: any) {
      if (e instanceof BlobNotFoundError) {
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

// eslint-disable-next-line @typescript-eslint/ban-types
export const cdn = <E extends Env, S extends Schema = {}, BasePath extends string = '/'>(
  hono: Hono<E, S, BasePath>,
  opts: CdnOptions,
) => {
  const operations = '/:organization_id/:federated_graph_id/operations/:client_id/:operation{.+\\.json$}';
  hono.use(operations, jwtMiddleware(opts.authJwtSecret));

  hono.get(operations, persistedOperation(opts.blobStorage));
};

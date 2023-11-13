import { JWTVerifyResult, jwtVerify } from 'jose';
import { Context, Hono, Next } from 'hono';

export interface BlobStorage {
  getObject(key: string): Promise<ReadableStream>;
}

interface CdnOptions {
  authJwtSecret: string;
  blobStorage: BlobStorage;
}

declare module 'hono' {
  interface ContextVariableMap {
    authenticatedOrganizationId: string;
    authenticatedFederatedGraphId: string;
  }
}

const jwtMiddleware = (secret: string) => {
  const secretKey = new TextEncoder().encode(secret);
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.text('Unauthorized', 401);
    }
    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer') {
      return c.text('Unauthorized', 401);
    }
    let result: JWTVerifyResult;
    try {
      result = await jwtVerify(token, secretKey);
    } catch (e: any) {
      if (e instanceof Error && e.name === 'JWSSignatureVerificationFailed') {
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
    const operationStream = await storage.getObject(key);
    return c.stream(async (stream) => {
      await stream.pipe(operationStream);
      await stream.close();
    });
  };
};

export const cdn = (hono: Hono, opts: CdnOptions) => {
  const operations = '/:organization_id/:federated_graph_id/operations/:client_id/:operation{.+\\.json$}';
  hono.use(operations, jwtMiddleware(opts.authJwtSecret));

  hono.get(operations, persistedOperation(opts.blobStorage));
};

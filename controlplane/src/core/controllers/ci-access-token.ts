import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import * as schema from '../../db/schema.js';
import { AuthenticationError } from '../errors/errors.js';
import { AuditLogRepository } from '../repositories/AuditLogRepository.js';
import { NamespaceRepository } from '../repositories/NamespaceRepository.js';
import { Authenticator } from '../services/Authentication.js';
import CiAccessTokenAuthenticator, { ciAccessTokenPrefix } from '../services/CiAccessTokenAuthenticator.js';

export type CiAccessTokenControllerOptions = {
  db: PostgresJsDatabase<typeof schema>;
  authenticator: Authenticator;
  ciAccessTokenAuth: CiAccessTokenAuthenticator;
};

const issueRequest = z.object({
  namespace: z.string().min(1),
  /** The repository whose CI job gets the token, with its host, e.g. `github.com/acme/shop`. */
  repository: z.string().regex(/^[^\s/]+(\/[^\s/]+)+$/, 'Expected host/owner/repository'),
});

/**
 * `POST /v1/ci-access-tokens` issues a CI access token that lets one CI job manage the subgraphs of one namespace for
 * ten minutes. Hub calls it with the credential it holds for the namespace once it has verified the job's identity.
 */
const plugin: FastifyPluginCallback<CiAccessTokenControllerOptions> = function CiAccessToken(fastify, opts, done) {
  fastify.post('/v1/ci-access-tokens', async (req, res) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers.set(name, value);
      }
    }
    // A token that could issue tokens would renew itself forever.
    if (
      headers
        .get('authorization')
        ?.replace(/^bearer\s+/i, '')
        .startsWith(ciAccessTokenPrefix)
    ) {
      return res.code(403).send({ error: 'A CI access token cannot issue CI access tokens' });
    }

    let authContext: Awaited<ReturnType<Authenticator['authenticate']>>;
    try {
      authContext = await opts.authenticator.authenticate(headers);
    } catch (error: unknown) {
      if (error instanceof AuthenticationError) {
        return res.code(401).send({ error: error.message });
      }
      throw error;
    }
    if (authContext.organizationDeactivated) {
      return res.code(403).send({ error: 'The organization is deactivated' });
    }

    const body = issueRequest.safeParse(req.body);
    if (!body.success) {
      return res.code(400).send({ error: body.error.issues.map((issue) => issue.message).join('; ') });
    }

    const namespace = await new NamespaceRepository(opts.db, authContext.organizationId).byName(body.data.namespace);
    if (!namespace) {
      return res.code(404).send({ error: `Namespace ${body.data.namespace} not found` });
    }
    if (!authContext.rbac.canCreateSubGraph(namespace)) {
      return res
        .code(403)
        .send({ error: `The credential may not manage the subgraphs of namespace ${body.data.namespace}` });
    }

    const issued = await opts.ciAccessTokenAuth.issue({
      organizationId: authContext.organizationId,
      namespaceId: namespace.id,
      repository: body.data.repository,
      createdById: authContext.userId,
      createdByName: authContext.userDisplayName,
    });

    await new AuditLogRepository(opts.db).addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'ci_access_token.created',
      action: 'created',
      actorId: authContext.userId,
      auditableType: 'ci_access_token',
      auditableDisplayName: body.data.repository,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.auth === 'api_key' ? authContext.apiKeyName : undefined,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: namespace.id,
      targetNamespaceDisplayName: namespace.name,
    });

    return res.code(201).send({
      token: issued.token,
      expiresAt: issued.expiresAt.toISOString(),
      namespace: namespace.name,
    });
  });

  done();
};

export default fp(plugin, {
  encapsulate: true,
});

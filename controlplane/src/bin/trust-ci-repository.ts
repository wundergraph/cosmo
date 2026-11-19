import process from 'node:process';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { pino } from 'pino';
import { z } from 'zod';
import * as schema from '../db/schema.js';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import { CiTrustedRepositoryRepository } from '../core/repositories/CiTrustedRepositoryRepository.js';
import { OrganizationGroupRepository } from '../core/repositories/OrganizationGroupRepository.js';
import { OrganizationRepository } from '../core/repositories/OrganizationRepository.js';
import { UserRepository } from '../core/repositories/UserRepository.js';
import { githubActionsIssuer, gitlabComIssuer } from '../core/services/CiOidcAuthenticator.js';
import { getConfig } from './get-config.js';

/**
 * Lets the CI jobs of a repository call the platform API with their OIDC token instead of an API key.
 *
 *   ORGANIZATION_SLUG=wundergraph USER_EMAIL=foo@wundergraph.com \
 *   CI_PROVIDER=github CI_REPOSITORY=acme/shop CI_GROUP=developer CI_REF_FILTER='refs/heads/main' \
 *   tsx src/bin/trust-ci-repository.ts
 */
const input = z
  .object({
    CI_PROVIDER: z.enum(['github', 'gitlab']),
    CI_REPOSITORY: z.string().regex(/^[^\s/]+(\/[^\s/]+)+$/, 'Expected owner/repository'),
    CI_GROUP: z.string().min(1).default('developer'),
    CI_REF_FILTER: z.string().min(1).optional(),
    // Only for a self-hosted GitLab. It must also be listed in the control plane's CI_OIDC_GITLAB_ISSUERS.
    CI_ISSUER: z.string().url().optional(),
  })
  .parse(process.env);

const { organizationSlug, userEmail, databaseConnectionUrl, databaseTlsCa, databaseTlsCert, databaseTlsKey } =
  getConfig();

const connectionConfig = await buildDatabaseConnectionConfig({
  tls:
    databaseTlsCa || databaseTlsCert || databaseTlsKey
      ? { ca: databaseTlsCa, cert: databaseTlsCert, key: databaseTlsKey }
      : undefined,
});
const queryConnection = postgres(databaseConnectionUrl, { ...connectionConfig, max: 1 });

try {
  const db = drizzle(queryConnection, { schema: { ...schema } });
  const logger = pino();

  const organization = await new OrganizationRepository(logger, db).bySlug(organizationSlug);
  if (!organization) {
    throw new Error(`Organization ${organizationSlug} not found`);
  }

  const user = await new UserRepository(logger, db).byEmail(userEmail);
  if (!user) {
    throw new Error(`User ${userEmail} not found`);
  }

  const group = await new OrganizationGroupRepository(db).byName({
    organizationId: organization.id,
    name: input.CI_GROUP,
  });
  if (!group) {
    throw new Error(`Group ${input.CI_GROUP} not found in organization ${organizationSlug}`);
  }

  const defaultIssuer = input.CI_PROVIDER === 'github' ? githubActionsIssuer : gitlabComIssuer;
  const issuer = (input.CI_ISSUER ?? defaultIssuer).replace(/\/+$/, '');

  await new CiTrustedRepositoryRepository(db).trust({
    organizationId: organization.id,
    provider: input.CI_PROVIDER,
    issuer,
    repository: input.CI_REPOSITORY,
    refFilter: input.CI_REF_FILTER,
    groupId: group.groupId,
    createdById: user.id,
  });

  console.log(
    `CI jobs of ${input.CI_REPOSITORY} (${issuer}) on ${input.CI_REF_FILTER ?? 'any ref'} now act in ` +
      `${organizationSlug} with the permissions of group ${input.CI_GROUP}.`,
  );
} finally {
  await queryConnection.end({ timeout: 1 });
}

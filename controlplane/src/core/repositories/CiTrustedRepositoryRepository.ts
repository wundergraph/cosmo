import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { traced } from '../tracing.js';

export type CiProvider = (typeof schema.ciProviderEnum.enumValues)[number];

export interface CiTrustedRepositoryDTO {
  id: string;
  organizationId: string;
  organizationSlug: string;
  provider: CiProvider;
  issuer: string;
  repository: string;
  refFilter?: string;
  groupId: string;
  createdById: string;
  createdByEmail: string;
}

@traced
export class CiTrustedRepositoryRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  /**
   * Trusts the repository for the organization. Trusting it again replaces its group and ref filter.
   */
  public async trust(input: {
    organizationId: string;
    provider: CiProvider;
    issuer: string;
    repository: string;
    refFilter?: string;
    groupId: string;
    createdById: string;
  }): Promise<{ id: string }> {
    const [trusted] = await this.db
      .insert(schema.ciTrustedRepositories)
      .values({
        organizationId: input.organizationId,
        provider: input.provider,
        issuer: input.issuer,
        repository: input.repository.toLowerCase(),
        refFilter: input.refFilter ?? null,
        groupId: input.groupId,
        createdById: input.createdById,
      })
      .onConflictDoUpdate({
        target: [
          schema.ciTrustedRepositories.organizationId,
          schema.ciTrustedRepositories.issuer,
          schema.ciTrustedRepositories.repository,
        ],
        set: {
          refFilter: input.refFilter ?? null,
          groupId: input.groupId,
          createdById: input.createdById,
        },
      })
      .returning({ id: schema.ciTrustedRepositories.id });

    return trusted;
  }

  /**
   * Every organization's trust of the repository. Several organizations may trust the same repository.
   */
  public async byRepository(input: { issuer: string; repository: string }): Promise<CiTrustedRepositoryDTO[]> {
    const trusted = await this.db
      .select({
        id: schema.ciTrustedRepositories.id,
        organizationId: schema.ciTrustedRepositories.organizationId,
        organizationSlug: schema.organizations.slug,
        provider: schema.ciTrustedRepositories.provider,
        issuer: schema.ciTrustedRepositories.issuer,
        repository: schema.ciTrustedRepositories.repository,
        refFilter: schema.ciTrustedRepositories.refFilter,
        groupId: schema.ciTrustedRepositories.groupId,
        createdById: schema.ciTrustedRepositories.createdById,
        createdByEmail: schema.users.email,
      })
      .from(schema.ciTrustedRepositories)
      .innerJoin(schema.organizations, eq(schema.ciTrustedRepositories.organizationId, schema.organizations.id))
      .innerJoin(schema.users, eq(schema.ciTrustedRepositories.createdById, schema.users.id))
      .where(
        and(
          eq(schema.ciTrustedRepositories.issuer, input.issuer),
          eq(schema.ciTrustedRepositories.repository, input.repository.toLowerCase()),
        ),
      );

    return trusted.map((row) => ({ ...row, refFilter: row.refFilter ?? undefined }));
  }

  /**
   * Whether the WunderGraph GitHub app is installed on the GitHub account with the given numeric id.
   */
  public async isGithubAppInstalledOn(accountId: number): Promise<boolean> {
    const installation = await this.db.query.gitInstallations.findFirst({
      where: and(
        eq(schema.gitInstallations.providerName, 'github'),
        eq(schema.gitInstallations.providerAccountId, accountId),
      ),
      columns: { id: true },
    });

    return installation !== undefined;
  }
}

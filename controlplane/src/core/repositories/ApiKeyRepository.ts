import { ExpiresAt } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { and, asc, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { apiKeyPermissions, apiKeyResources, apiKeys, users } from '../../db/schema.js';
import { APIKeyDTO } from '../../types/index.js';

/**
 * Repository for organization related operations.
 */
export class ApiKeyRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public addAPIKey(input: {
    key: string;
    name: string;
    organizationID: string;
    userID: string;
    expiresAt: ExpiresAt;
    groupId: string;
    permissions: string[];
  }) {
    let expiresAtDate: Date | undefined;
    const present = new Date();
    switch (input.expiresAt) {
      case ExpiresAt.NEVER: {
        expiresAtDate = undefined;
        break;
      }
      case ExpiresAt.THIRTY_DAYS: {
        expiresAtDate = new Date(new Date().setDate(present.getDate() + 30));
        break;
      }
      case ExpiresAt.SIX_MONTHS: {
        expiresAtDate = new Date(new Date().setMonth(present.getMonth() + 6));
        break;
      }
      case ExpiresAt.ONE_YEAR: {
        expiresAtDate = new Date(new Date().setFullYear(present.getFullYear() + 1));
        break;
      }
      default: {
        throw new Error('ExpiresAt value does not exist');
      }
    }
    return this.db.transaction(async (tx) => {
      const apiKeyRepo = new ApiKeyRepository(tx);

      const apiKey = await tx
        .insert(apiKeys)
        .values({
          key: input.key,
          name: input.name,
          organizationId: input.organizationID,
          userId: input.userID,
          groupId: input.groupId,
          expiresAt: expiresAtDate,
        })
        .returning()
        .execute();

      if (input.permissions.length > 0) {
        await apiKeyRepo.addAPIKeyPermissions({
          permissions: input.permissions.map((p) => ({
            apiKeyId: apiKey[0].id,
            permission: p,
          })),
        });
      }
    });
  }

  public async removeAPIKey(input: { name: string; organizationID: string }) {
    await this.db
      .delete(apiKeys)
      .where(and(eq(apiKeys.organizationId, input.organizationID), eq(apiKeys.name, input.name)))
      .execute();
  }

  public async getAPIKeyByName(input: { organizationID: string; name: string }): Promise<APIKeyDTO | undefined> {
    const key = await this.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdBy: users.email,
        creatorUserID: users.id,
      })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.userId))
      .where(and(eq(apiKeys.organizationId, input.organizationID), eq(apiKeys.name, input.name)))
      .execute();

    if (key.length === 0) {
      return undefined;
    }

    return {
      id: key[0].id,
      name: key[0].name,
      createdAt: key[0].createdAt.toISOString(),
      lastUsedAt: key[0].lastUsedAt?.toISOString() ?? '',
      expiresAt: key[0].expiresAt?.toISOString() ?? '',
      createdBy: key[0].createdBy,
      creatorUserID: key[0].creatorUserID,
    } as APIKeyDTO;
  }

  public async getAPIKeys(input: { organizationID: string }): Promise<APIKeyDTO[]> {
    const keys = await this.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdBy: users.email,
        groupId: schema.organizationGroups.id,
        groupName: schema.organizationGroups.name,
        creatorUserID: users.id,
      })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.userId))
      .leftJoin(schema.organizationGroups, eq(schema.organizationGroups.id, apiKeys.groupId))
      .where(eq(apiKeys.organizationId, input.organizationID))
      .orderBy(asc(apiKeys.createdAt))
      .execute();

    return keys.map(
      ({ groupId, groupName, ...key }) =>
        ({
          id: key.id,
          name: key.name,
          createdAt: key.createdAt.toISOString(),
          lastUsedAt: key.lastUsedAt?.toISOString() ?? '',
          expiresAt: key.expiresAt?.toISOString() ?? '',
          group: groupId ? { id: groupId, name: groupName } : undefined,
          createdBy: key.createdBy,
          creatorUserID: key.creatorUserID,
        }) as APIKeyDTO,
    );
  }

  public updateAPIKeyGroup(input: { apiKeyId: string; groupId: string }) {
    return this.db
      .update(schema.apiKeys)
      .set({ groupId: input.groupId })
      .where(eq(apiKeys.id, input.apiKeyId))
      .execute();
  }

  public async addAPIKeyResources({ resources }: { resources: { apiKeyId: string; targetId: string }[] }) {
    if (resources.length === 0) {
      return;
    }
    await this.db
      .insert(apiKeyResources)
      .values(resources.map((r) => ({ apiKeyId: r.apiKeyId, targetId: r.targetId })))
      .execute();
  }

  public async addAPIKeyPermissions({ permissions }: { permissions: { apiKeyId: string; permission: string }[] }) {
    if (permissions.length === 0) {
      return;
    }
    await this.db
      .insert(apiKeyPermissions)
      .values(permissions.map((p) => ({ apiKeyId: p.apiKeyId, permission: p.permission })))
      .execute();
  }

  public async verifyAPIKeyResources({
    apiKey,
    // accessedTargetId is the target id of the graph on which the user is trying to perform an action on.
    accessedTargetId,
  }: {
    apiKey: string;
    accessedTargetId: string;
  }): Promise<boolean> {
    const resources = await this.db
      .select({
        targetId: apiKeyResources.targetId,
      })
      .from(apiKeys)
      .innerJoin(apiKeyResources, eq(apiKeyResources.apiKeyId, apiKeys.id))
      .where(eq(apiKeys.key, apiKey));

    if (resources.length === 0) {
      // if no resources, it means that the api key has access to all the resources of the organization.
      return true;
    }

    const targetIds = resources.map((r) => r.targetId);

    if (targetIds.includes(accessedTargetId)) {
      return true;
    }

    return false;
  }

  public async verifyAPIKeyPermissions({
    apiKey,
    permission,
  }: {
    apiKey: string;
    permission: string;
  }): Promise<boolean> {
    const dbPermissions = await this.db
      .select({
        permission: apiKeyPermissions.permission,
      })
      .from(apiKeys)
      .innerJoin(apiKeyPermissions, eq(apiKeyPermissions.apiKeyId, apiKeys.id))
      .where(eq(apiKeys.key, apiKey));

    if (dbPermissions.length === 0) {
      return false;
    }

    const permissions = dbPermissions.map((p) => p.permission);

    if (permissions.includes(permission)) {
      return true;
    }

    return false;
  }
}

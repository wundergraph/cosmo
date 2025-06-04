import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../db/schema.js';
import { users } from '../../db/schema.js';
import { UserDTO } from '../../types/index.js';
import { BlobStorage } from '../blobstorage/index.js';
import Keycloak from '../services/Keycloak.js';
import OidcProvider from '../services/OidcProvider.js';
import { DeleteOrganizationAuditLogsQueue } from '../workers/DeleteOrganizationAuditLogsWorker.js';
import { BillingRepository } from './BillingRepository.js';
import { OidcRepository } from './OidcRepository.js';
import { OrganizationRepository } from './OrganizationRepository.js';

/**
 * Repository for user related operations.
 */
export class UserRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  public async byEmail(email: string): Promise<UserDTO | null> {
    const user = await this.db
      .select({
        email: users.email,
        id: users.id,
      })
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1)
      .execute();

    if (user.length === 0) {
      return null;
    }

    return user[0];
  }

  public async byId(id: string): Promise<UserDTO | null> {
    const user = await this.db
      .select({
        email: users.email,
        id: users.id,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
      .execute();

    if (user.length === 0) {
      return null;
    }

    return user[0];
  }

  public async addUser(input: { id: string; email: string }) {
    await this.db
      .insert(users)
      .values({
        id: input.id,
        email: input.email.toLowerCase(),
      })
      .execute();
  }

  public async deleteUser(
    input: { id: string; keycloakClient: Keycloak; keycloakRealm: string },
    blobStorage: BlobStorage,
    deleteOrganizationAuditLogsQueue: DeleteOrganizationAuditLogsQueue,
  ) {
    const orgRepo = new OrganizationRepository(this.logger, this.db);
    const oidcRepo = new OidcRepository(this.db);

    // get all memberships
    const orgMemberships = await orgRepo.adminMemberships({ userId: input.id });

    // get all providers
    const oidcProviders: { alias: string; orgSlug: string }[] = [];
    for (const org of orgMemberships.soloAdminSoloMemberOrgs) {
      const provider = await oidcRepo.getOidcProvider({ organizationId: org.id });
      if (provider) {
        oidcProviders.push({ ...provider, orgSlug: org.slug });
      }
    }

    // Perform DB deletions
    await this.db.transaction(async (tx) => {
      const orgRepo = new OrganizationRepository(this.logger, tx);
      const billingRepo = new BillingRepository(tx);

      // Cancel subscriptions and remove oidc providers
      for (const org of orgMemberships.soloAdminSoloMemberOrgs) {
        await billingRepo.cancelSubscription(org.id);
      }

      // Delete all solo organizations of the user
      const deleteOrgs: Promise<void>[] = [];
      for (const org of orgMemberships.soloAdminSoloMemberOrgs) {
        deleteOrgs.push(orgRepo.deleteOrganization(org.id, blobStorage, deleteOrganizationAuditLogsQueue));
      }
      await Promise.all(deleteOrgs);

      // Delete from db
      await tx.delete(users).where(eq(users.id, input.id)).execute();

      // Perform Keycloak deletions.
      await this.deleteUserFromKeycloak({ ...input, oidcProviders, orgMemberships });
    });
  }

  private async deleteUserFromKeycloak(input: {
    id: string;
    oidcProviders: { alias: string; orgSlug: string }[];
    orgMemberships: {
      memberships: { slug: string; kcGroupId: string | undefined }[];
      soloAdminSoloMemberOrgs: { slug: string; kcGroupId: string | undefined }[];
    };
    keycloakClient: Keycloak;
    keycloakRealm: string;
  }) {
    try {
      const oidcProvider = new OidcProvider();

      // Remove OIDC providers
      for (const provider of input.oidcProviders) {
        await oidcProvider.deleteOidcProvider({
          kcClient: input.keycloakClient,
          kcRealm: input.keycloakRealm,
          organizationSlug: provider.orgSlug,
          alias: provider.alias,
        });
      }

      // Remove keycloak user from all org groups
      for (const org of input.orgMemberships.memberships) {
        if (!org.kcGroupId) {
          continue;
        }

        await input.keycloakClient.removeUserFromOrganization({
          realm: input.keycloakRealm,
          groupId: org.kcGroupId,
          userID: input.id,
        });
      }

      // Delete keycloak organization groups
      for (const org of input.orgMemberships.soloAdminSoloMemberOrgs) {
        if (!org.kcGroupId) {
          continue;
        }

        await input.keycloakClient.deleteGroupById({ realm: input.keycloakRealm, groupId: org.kcGroupId });
      }

      // Delete user from keycloak
      await input.keycloakClient.client.users.del({
        id: input.id,
        realm: input.keycloakRealm,
      });
    } catch (e: any) {
      this.logger.error(
        {
          userId: input.id,
          error: e.message,
          oidcProviders: input.oidcProviders,
          ...input.orgMemberships,
        },
        'Error deleting user details from keycloak.',
      );
      throw e;
    }
  }

  // only to update the active attribute
  public async updateUser(input: { id: string; active: boolean }) {
    await this.db
      .update(users)
      .set({ active: input.active, updatedAt: new Date() })
      .where(eq(users.id, input.id))
      .execute();
  }
}

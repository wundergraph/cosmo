import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../db/schema.js';
import { users } from '../../db/schema.js';
import { UserDTO } from '../../types/index.js';
import Keycloak from '../services/Keycloak.js';
import OidcProvider from '../services/OidcProvider.js';
import { OrganizationRepository } from './OrganizationRepository.js';
import { BillingRepository } from './BillingRepository.js';
import { OidcRepository } from './OidcRepository.js';

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

  public async deleteUser(input: { id: string; keycloakClient: Keycloak; keycloakRealm: string }) {
    const orgRepo = new OrganizationRepository(this.logger, this.db);
    const billingRepo = new BillingRepository(this.db);

    const { soloAdminSoloMemberOrgs, memberships } = await orgRepo.adminMemberships({ userId: input.id });

    // Cancel subscriptions and remove oidc providers
    for (const org of soloAdminSoloMemberOrgs) {
      await billingRepo.cancelSubscription(org.id);

      const oidcRepo = new OidcRepository(this.db);
      const oidcProvider = new OidcProvider();

      const provider = await oidcRepo.getOidcProvider({ organizationId: org.id });
      if (provider) {
        await oidcProvider.deleteOidcProvider({
          kcClient: input.keycloakClient,
          kcRealm: input.keycloakRealm,
          organizationSlug: org.slug,
          alias: provider.alias,
        });
      }
    }

    // Remove keycloak user from all org groups
    for (const org of memberships) {
      const orgMember = await orgRepo.getOrganizationMember({
        organizationID: org.id,
        userID: input.id,
      });

      if (!orgMember) {
        throw new Error('Organization member not found');
      }

      await input.keycloakClient.removeUserFromOrganization({
        realm: input.keycloakRealm,
        userID: input.id,
        groupName: org.slug,
        roles: orgMember.roles,
      });
    }

    await this.db.transaction(async (tx) => {
      const orgRepo = new OrganizationRepository(this.logger, tx);

      // Delete all solo organizations of the user
      const deleteOrgs: Promise<void>[] = [];
      for (const org of soloAdminSoloMemberOrgs) {
        deleteOrgs.push(orgRepo.deleteOrganization(org.id));
      }
      await Promise.all(deleteOrgs);

      // Delete from db
      await tx.delete(users).where(eq(users.id, input.id)).execute();
    });

    for (const org of soloAdminSoloMemberOrgs) {
      await input.keycloakClient.deleteOrganizationGroup({
        realm: input.keycloakRealm,
        organizationSlug: org.slug,
      });
    }

    // Delete user from keycloak
    await input.keycloakClient.client.users.del({
      id: input.id,
      realm: input.keycloakRealm,
    });
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

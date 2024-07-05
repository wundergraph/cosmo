import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../db/schema.js';
import { users } from '../../db/schema.js';
import { UserDTO } from '../../types/index.js';
import Keycloak from '../services/Keycloak.js';
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

  public deleteUser(input: { id: string; keycloakClient: Keycloak; keycloakRealm: string }) {
    return this.db.transaction(async (tx) => {
      const orgRepo = new OrganizationRepository(this.logger, tx);

      const { soloAdminSoloMemberOrgs, memberships } = await orgRepo.adminMemberships({ userId: input.id });

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

      // Delete all solo organizations of the user
      const deleteOrgs: Promise<void>[] = [];
      for (const org of soloAdminSoloMemberOrgs) {
        deleteOrgs.push(
          orgRepo.deleteOrganization(org.id, org.slug, {
            keycloakClient: input.keycloakClient,
            keycloakRealm: input.keycloakRealm,
          }),
        );
      }
      await Promise.all(deleteOrgs);

      // Delete from db
      await tx.delete(users).where(eq(users.id, input.id)).execute();

      // Delete user from keycloak
      await input.keycloakClient.authenticateClient();
      await input.keycloakClient.client.users.del({
        id: input.id,
        realm: input.keycloakRealm,
      });
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

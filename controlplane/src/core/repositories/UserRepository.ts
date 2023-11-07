import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { MemberRole } from 'src/db/models.js';
import * as schema from '../../db/schema.js';
import { users } from '../../db/schema.js';
import { UserDTO } from '../../types/index.js';
import { OrganizationRepository } from './OrganizationRepository.js';

/**
 * Repository for user related operations.
 */
export class UserRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async byEmail(email: string): Promise<UserDTO | null> {
    const user = await this.db
      .select({
        email: users.email,
        id: users.id,
      })
      .from(users)
      .where(eq(users.email, email))
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
        email: input.email,
      })
      .execute();
  }

  public async deleteUser(input: { id: string }) {
    await this.db.delete(users).where(eq(users.id, input.id)).execute();
  }

  public async inviteUser(input: {
    email: string;
    keycloakUserID: string;
    organizationID: string;
    dbUser: UserDTO | null;
  }) {
    await this.db.transaction(async (db) => {
      const userRepo = new UserRepository(db);
      const orgRepo = new OrganizationRepository(db);

      if (!input.dbUser) {
        await userRepo.addUser({
          id: input.keycloakUserID,
          email: input.email,
        });
      }

      const insertedMember = await orgRepo.addOrganizationMember({
        userID: input.keycloakUserID,
        organizationID: input.organizationID,
        acceptedInvite: false,
      });

      await orgRepo.addOrganizationMemberRoles({ memberID: insertedMember.id, roles: ['developer'] });
    });
  }
}

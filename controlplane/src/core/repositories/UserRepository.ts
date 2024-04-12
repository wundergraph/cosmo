import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { users } from '../../db/schema.js';
import { UserDTO } from '../../types/index.js';

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
        email: input.email,
      })
      .execute();
  }

  public async deleteUser(input: { id: string }) {
    await this.db.delete(users).where(eq(users.id, input.id)).execute();
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

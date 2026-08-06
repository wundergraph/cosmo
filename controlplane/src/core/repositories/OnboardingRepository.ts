import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';

export class OnboardingRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public async createOrUpdate({ userId }: { userId: string }) {
    const values = {
      userId,
      organizationId: this.organizationId,
    };

    const result = await this.db
      .insert(schema.onboarding)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.onboarding.userId, schema.onboarding.organizationId, schema.onboarding.version],
        set: {
          finishedAt: null,
        },
      })
      .returning();

    return result[0];
  }

  public async finish(userId: string) {
    const result = await this.db
      .update(schema.onboarding)
      .set({ finishedAt: new Date() })
      .where(and(eq(schema.onboarding.organizationId, this.organizationId), eq(schema.onboarding.userId, userId)))
      .returning();

    return result[0];
  }

  public async getByUserId(userId: string) {
    const result = await this.db.query.onboarding.findFirst({
      where: and(eq(schema.onboarding.organizationId, this.organizationId), eq(schema.onboarding.userId, userId)),
    });

    return result ?? undefined;
  }
}

import { and, asc, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';

export class PlaygroundScriptsRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public list(type: string) {
    return this.db
      .select()
      .from(schema.playgroundScripts)
      .where(
        and(
          eq(schema.playgroundScripts.organizationId, this.organizationId),
          eq(schema.playgroundScripts.type, type as (typeof schema.playgroundScriptTypeEnum.enumValues)[number]),
        ),
      )
      .orderBy(asc(schema.playgroundScripts.createdAt));
  }

  public create(data: { title: string; content: string; createdBy: string; type: string }) {
    if (data.type !== 'pre-flight' && data.type !== 'pre-operation' && data.type !== 'post-operation') {
      throw new Error('Invalid type');
    }

    return this.db
      .insert(schema.playgroundScripts)
      .values({
        title: data.title,
        type: data.type,
        content: data.content,
        organizationId: this.organizationId,
        createdById: data.createdBy,
      })
      .returning();
  }

  public delete(id: string) {
    return this.db
      .delete(schema.playgroundScripts)
      .where(and(eq(schema.playgroundScripts.id, id), eq(schema.playgroundScripts.organizationId, this.organizationId)))
      .returning();
  }

  public update(data: { id: string; title: string; content: string }) {
    return this.db
      .update(schema.playgroundScripts)
      .set({
        title: data.title,
        content: data.content,
      })
      .where(
        and(eq(schema.playgroundScripts.id, data.id), eq(schema.playgroundScripts.organizationId, this.organizationId)),
      )
      .returning();
  }
}

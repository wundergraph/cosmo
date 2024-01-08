import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { SQL, and, asc, desc, eq, inArray } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { DiscussionDTO } from 'src/types/index.js';

export class DiscussionRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public async canAccessTarget(targetId: string): Promise<boolean> {
    const resp = await this.db.query.targets.findFirst({
      where: and(eq(schema.targets.id, targetId), eq(schema.targets.organizationId, this.organizationId)),
    });

    return !!resp;
  }

  public async exists(discussionId: string): Promise<boolean> {
    const discussion = await this.db.query.discussions.findFirst({
      where: eq(schema.discussions.id, discussionId),
    });

    return !!discussion;
  }

  public async canAccessDiscussion(discussionId: string): Promise<boolean> {
    const discussion = await this.db.query.discussions.findFirst({
      where: eq(schema.discussions.id, discussionId),
    });

    if (!discussion) {
      return false;
    }

    return await this.canAccessTarget(discussion.targetId);
  }

  public async createDiscussion(input: {
    targetId: string;
    schemaVersionId: string;
    referenceLine: number;
    contentMarkdown: string;
    contentJson: string;
    createdById: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const discussion = (
        await tx
          .insert(schema.discussions)
          .values({
            targetId: input.targetId,
            schemaVersionId: input.schemaVersionId,
            referenceLine: input.referenceLine,
          })
          .returning()
      )[0];

      await tx.insert(schema.discussionThread).values({
        discussionId: discussion.id,
        contentMarkdown: input.contentMarkdown,
        contentJson: JSON.parse(input.contentJson),
        createdById: input.createdById,
      });
    });
  }

  public async replyToDiscussion(input: {
    discussionId: string;
    contentMarkdown: string;
    contentJson: string;
    createdById: string;
  }): Promise<void> {
    await this.db.insert(schema.discussionThread).values({
      discussionId: input.discussionId,
      contentMarkdown: input.contentMarkdown,
      contentJson: JSON.parse(input.contentJson),
      createdById: input.createdById,
    });
  }

  public async getAllDiscussions(input: { targetId: string; schemaVersionId?: string }): Promise<DiscussionDTO> {
    let conditions: SQL<unknown> | undefined = eq(schema.discussions.targetId, input.targetId);

    if (input.schemaVersionId) {
      conditions = and(conditions, eq(schema.discussions.schemaVersionId, input.schemaVersionId));
    }

    const graphDiscussions = await this.db.query.discussions.findMany({
      where: conditions,
      with: {
        thread: {
          limit: 1,
          orderBy: asc(schema.discussionThread.createdAt),
        },
      },
      orderBy: desc(schema.discussions.createdAt),
    });

    if (graphDiscussions.length > 0) {
      const schemaVersions = await this.db.query.schemaVersion.findMany({
        where: inArray(
          schema.schemaVersion.id,
          graphDiscussions.map((gd) => gd.schemaVersionId),
        ),
        columns: {
          id: true,
          createdAt: true,
        },
      });

      graphDiscussions.sort((a, b) => {
        const createdAtA = schemaVersions.find((sv) => sv.id === a.schemaVersionId)?.createdAt || new Date(0);
        const createdAtB = schemaVersions.find((sv) => sv.id === b.schemaVersionId)?.createdAt || new Date(0);

        return createdAtB.getTime() - createdAtA.getTime();
      });
    }

    return graphDiscussions;
  }

  public async updateComment(input: {
    commentId: string;
    contentMarkdown: string;
    contentJson: string;
    createdById: string;
  }) {
    return await this.db
      .update(schema.discussionThread)
      .set({
        contentMarkdown: input.contentMarkdown,
        contentJson: JSON.parse(input.contentJson),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.discussionThread.id, input.commentId),
          eq(schema.discussionThread.createdById, input.createdById),
        ),
      )
      .returning();
  }

  public async deleteComment(input: { discussionId: string; commentId: string }): Promise<{ success: boolean }> {
    const discussion = await this.db.query.discussions.findFirst({
      where: eq(schema.discussions.id, input.discussionId),
      with: {
        thread: {
          limit: 1,
          orderBy: asc(schema.discussionThread.createdAt),
        },
      },
    });

    if (!discussion) {
      return { success: false };
    }

    // We delete the discussion itself if it is the opening comment or else we only delete the comment
    const isOpeningComment = discussion.thread[0].id === input.commentId;

    await this.db.transaction(async (tx) => {
      if (isOpeningComment) {
        await tx.delete(schema.discussions).where(eq(schema.discussions.id, input.discussionId));
      } else {
        await tx.delete(schema.discussionThread).where(eq(schema.discussionThread.id, input.commentId));
      }
    });

    return { success: true };
  }

  public async byId(discussionId: string) {
    return await this.db.query.discussions.findFirst({
      where: eq(schema.discussions.id, discussionId),
      with: {
        thread: {
          orderBy: asc(schema.discussionThread.createdAt),
        },
      },
    });
  }

  public async getSchemas(input: { targetId: string; schemaVersionId: string }) {
    const referenceResult = await this.db.query.schemaVersion.findFirst({
      where: eq(schema.schemaVersion.id, input.schemaVersionId),
    });

    const latestResult = await this.db.query.schemaVersion.findFirst({
      where: eq(schema.schemaVersion.targetId, input.targetId),
      orderBy: desc(schema.schemaVersion.createdAt),
    });

    return { referenceResult, latestResult };
  }

  public async setResolution(input: { discussionId: string; isResolved: boolean }) {
    await this.db
      .update(schema.discussions)
      .set({
        isResolved: input.isResolved,
      })
      .where(eq(schema.discussions.id, input.discussionId));
  }
}

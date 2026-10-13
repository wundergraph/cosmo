import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { PlaygroundHeaderEntry, playgroundDefaultHeaders } from '../../db/schema.js';
import { traced } from '../tracing.js';

@traced
export class PlaygroundDefaultHeadersRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  /**
   * Returns both levels for a graph in one query: the organization-shared row
   * (user_id IS NULL) and the calling user's personal row.
   */
  public async getByFederatedGraphId(
    federatedGraphId: string,
    userId: string,
  ): Promise<{ graphHeaders: PlaygroundHeaderEntry[]; personalHeaders: PlaygroundHeaderEntry[] }> {
    const rows = await this.db
      .select({
        userId: playgroundDefaultHeaders.userId,
        headers: playgroundDefaultHeaders.headers,
      })
      .from(playgroundDefaultHeaders)
      .where(
        and(
          eq(playgroundDefaultHeaders.organizationId, this.organizationId),
          eq(playgroundDefaultHeaders.federatedGraphId, federatedGraphId),
          or(isNull(playgroundDefaultHeaders.userId), eq(playgroundDefaultHeaders.userId, userId)),
        ),
      );

    return {
      graphHeaders: rows.find((r) => r.userId === null)?.headers ?? [],
      personalHeaders: rows.find((r) => r.userId === userId)?.headers ?? [],
    };
  }

  public async update(data: {
    federatedGraphId: string;
    userId: string;
    graphHeaders?: PlaygroundHeaderEntry[];
    personalHeaders?: PlaygroundHeaderEntry[];
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (data.graphHeaders) {
        await this.upsertHeaders(tx, {
          federatedGraphId: data.federatedGraphId,
          userId: null,
          headers: data.graphHeaders,
        });
      }

      if (data.personalHeaders) {
        await this.upsertHeaders(tx, {
          federatedGraphId: data.federatedGraphId,
          userId: data.userId,
          headers: data.personalHeaders,
        });
      }
    });
  }

  /**
   * Upserts one scope's row on the supplied transaction handle, so that its
   * stored headers match `headers` exactly. The list replaces whatever was there
   * rather than merging with it, and an empty list DELETES the row instead of
   * storing an empty array, so "no defaults" has exactly one representation.
   */
  private async upsertHeaders(
    tx: PostgresJsDatabase<typeof schema>,
    data: {
      federatedGraphId: string;
      userId: string | null;
      headers: PlaygroundHeaderEntry[];
    },
  ): Promise<void> {
    const { federatedGraphId, userId, headers } = data;
    const isGraphScope = userId === null;
    const scopeCondition = isGraphScope
      ? isNull(playgroundDefaultHeaders.userId)
      : eq(playgroundDefaultHeaders.userId, userId);

    if (headers.length === 0) {
      await tx
        .delete(playgroundDefaultHeaders)
        .where(
          and(
            eq(playgroundDefaultHeaders.organizationId, this.organizationId),
            eq(playgroundDefaultHeaders.federatedGraphId, federatedGraphId),
            scopeCondition,
          ),
        );
      return;
    }

    await tx
      .insert(playgroundDefaultHeaders)
      .values({
        organizationId: this.organizationId,
        federatedGraphId,
        userId,
        headers,
      })
      // Each scope has its own PARTIAL unique index (pdh_unique_graph_level /
      // pdh_unique_personal_level), so both the target and its predicate must match
      // this scope's index exactly - otherwise Postgres cannot infer an arbiter.
      .onConflictDoUpdate({
        target: isGraphScope
          ? [playgroundDefaultHeaders.federatedGraphId]
          : [playgroundDefaultHeaders.federatedGraphId, playgroundDefaultHeaders.userId],
        targetWhere: isGraphScope
          ? isNull(playgroundDefaultHeaders.userId)
          : isNotNull(playgroundDefaultHeaders.userId),
        set: {
          headers,
          updatedAt: new Date(),
        },
      });
  }
}

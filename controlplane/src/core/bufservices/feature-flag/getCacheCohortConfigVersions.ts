import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetCacheCohortConfigVersionsRequest,
  GetCacheCohortConfigVersionsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  federatedGraphs,
  federatedGraphsToFeatureFlagSchemaVersions,
  graphCompositions,
  schemaVersion,
} from '../../../db/schema.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getCacheCohortConfigVersions(
  opts: RouterOptions,
  req: GetCacheCohortConfigVersionsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetCacheCohortConfigVersionsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetCacheCohortConfigVersionsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const latestCreatedAt = sql<Date>`max(${graphCompositions.createdAt})`.as('latest_created_at');

    // Two structurally different paths because the data lives in two places:
    //
    //   main cohort  → `graph_compositions` JOIN `schema_versions` JOIN
    //                  `federated_graphs` on `target_id`. Every base/main
    //                  composition lands here, including the active one
    //                  (`federated_graphs.composed_schema_version_id`) and all
    //                  historical predecessors.
    //
    //   flag cohort  → `federated_graphs_to_feature_flag_schema_versions`
    //                  filtered by `feature_flag_id`. That table is populated
    //                  exclusively when a feature flag is composed; its
    //                  `feature_flag_id IS NULL` rows are deletion-set-NULL
    //                  orphans from torn-down flags, never main compositions.
    //                  The mirror `is_feature_flag_composition = true` join is
    //                  defensive: it makes the cohort symmetric and guards
    //                  against any future row whose flag-id was nulled while
    //                  the composition record (correctly) keeps the boolean.
    //
    // GROUP BY de-duplicates compositions that participate in multiple
    // (base, composed) tuples and orders by their most recent creation time.

    if (req.featureFlagId) {
      const rows = await opts.db
        .select({
          composedSchemaVersionId: federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId,
          latestCreatedAt,
        })
        .from(federatedGraphsToFeatureFlagSchemaVersions)
        .innerJoin(
          graphCompositions,
          eq(graphCompositions.schemaVersionId, federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId),
        )
        .where(
          and(
            eq(federatedGraphsToFeatureFlagSchemaVersions.federatedGraphId, req.federatedGraphId),
            eq(federatedGraphsToFeatureFlagSchemaVersions.featureFlagId, req.featureFlagId),
            eq(graphCompositions.isFeatureFlagComposition, true),
          ),
        )
        .groupBy(federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId)
        .orderBy(desc(latestCreatedAt))
        .execute();

      return {
        response: { code: EnumStatusCode.OK },
        configVersions: rows.map((r) => r.composedSchemaVersionId),
      };
    }

    const rows = await opts.db
      .select({
        composedSchemaVersionId: graphCompositions.schemaVersionId,
        latestCreatedAt,
      })
      .from(graphCompositions)
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .innerJoin(federatedGraphs, eq(federatedGraphs.targetId, schemaVersion.targetId))
      .where(
        and(eq(federatedGraphs.id, req.federatedGraphId), eq(graphCompositions.isFeatureFlagComposition, false)),
      )
      .groupBy(graphCompositions.schemaVersionId)
      .orderBy(desc(latestCreatedAt))
      .execute();

    return {
      response: { code: EnumStatusCode.OK },
      configVersions: rows.map((r) => r.composedSchemaVersionId),
    };
  });
}

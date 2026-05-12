import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetCacheCohortConfigVersionsRequest,
  GetCacheCohortConfigVersionsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { federatedGraphsToFeatureFlagSchemaVersions, graphCompositions } from '../../../db/schema.js';
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

    const featureFlagFilter = req.featureFlagId
      ? eq(federatedGraphsToFeatureFlagSchemaVersions.featureFlagId, req.featureFlagId)
      : isNull(federatedGraphsToFeatureFlagSchemaVersions.featureFlagId);

    // Composed schema version IDs minted for the
    // (federated_graph_id, feature_flag_id) cohort, ordered by the most
    // recent graph_compositions.created_at. GROUP BY de-duplicates rows
    // that share a composed_schema_version_id (multiple base rows in the
    // join would otherwise repeat it).
    const latestCreatedAt = sql<Date>`max(${graphCompositions.createdAt})`.as('latest_created_at');
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
          featureFlagFilter,
        ),
      )
      .groupBy(federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId)
      .orderBy(desc(latestCreatedAt))
      .execute();

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      configVersions: rows.map((r) => r.composedSchemaVersionId),
    };
  });
}

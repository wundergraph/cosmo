import type { AnalyticsToolContext } from '../context.js';
import { graphInput, registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { absoluteWindow, windowInput } from '../window.js';

const PAGE = 100;

export function registerGetChangeTimelineTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'get_change_timeline',
    {
      title: 'Get change timeline',
      description:
        'What changed on a graph and when, newest first: every composition (publish or check-free recomposition, including feature-flag compositions, whether it composed, who triggered it) and the schema changes it brought. Pair with compare_periods or query_analytics (dimension composition) to see whether a release changed latency or errors. Defaults to the last 7 days.',
      inputSchema: { ...graphInput, ...windowInput },
    },
    async (input, headers) => {
      const { start, end } = absoluteWindow(input, '7d', ctx.now());

      const [compositions, changelog] = await Promise.all([
        ctx.client.getCompositions(
          {
            fedGraphName: input.graph,
            namespace: input.namespace,
            startDate: start,
            endDate: end,
            limit: PAGE,
            offset: 0,
          },
          { headers },
        ),
        ctx.client.getFederatedGraphChangelog(
          {
            name: input.graph,
            namespace: input.namespace,
            pagination: { limit: PAGE, offset: 0 },
            dateRange: { start, end },
          },
          { headers },
        ),
      ]);
      const error = checkResponse(compositions, 'Compositions') ?? checkResponse(changelog, 'Changelog');
      if (error) {
        return fail(error);
      }

      const changesBySchemaVersion = new Map(
        changelog.federatedGraphChangelogOutput.map((entry) => [entry.schemaVersionId, entry.changelogs]),
      );
      const events = compositions.compositions.map((composition) => ({
        time: composition.createdAt,
        compositionId: composition.id,
        schemaVersionId: composition.schemaVersionId,
        composed: composition.isComposable,
        isLatestValid: composition.isLatestValid,
        featureFlag: composition.isFeatureFlagComposition ? (composition.featureFlagName ?? '') : '',
        triggeredBy: composition.createdBy ?? '',
        triggeredBySubgraph: composition.triggeredBySubgraphName ?? '',
        errors: composition.compositionErrors ?? '',
        schemaChanges: (changesBySchemaVersion.get(composition.schemaVersionId) ?? []).map((change) => ({
          type: change.changeType,
          path: change.path,
          message: change.changeMessage,
        })),
      }));

      return ok(
        { events },
        {
          graphs: [{ name: input.graph, namespace: input.namespace }],
          completeness: 'complete',
          window: { dateRange: { start, end } },
          now: ctx.now().toISOString(),
          truncated: compositions.compositions.length === PAGE || changelog.hasNextPage,
          warnings: [],
        },
      );
    },
  );
}

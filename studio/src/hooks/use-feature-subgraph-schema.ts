import { useQuery } from '@connectrpc/connect-query';
import { getSdlBySchemaVersion } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import {
  FeatureSubgraphInFlagComposition,
  GetFeatureFlagsInLatestCompositionByFederatedGraphResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { useMemo } from 'react';

/**
 * A feature subgraph can belong to more than one flag, so it is addressed by flag plus its own
 * name or id. Pages that read the subgraph from the URL use the name; the playground, whose URL
 * carries ids, uses the id.
 */
export interface FeatureSubgraphSelection {
  featureFlagName: string;
  subgraphId?: string;
  subgraphName?: string;
}

export interface FeatureSubgraphSchema {
  /** Undefined when the selection does not resolve, such as a renamed flag or a stale link. */
  featureSubgraph?: FeatureSubgraphInFlagComposition;
  sdl?: string;
  isLoading: boolean;
}

/**
 * The feature subgraph a selection resolves to, and the schema its flag's composition pinned.
 * Feature subgraphs are not in the base composition, so getSubgraphSDLFromLatestComposition
 * cannot resolve them; the composition records a schema version instead.
 */
export const useFeatureSubgraphSchema = (
  compositionFlags: GetFeatureFlagsInLatestCompositionByFederatedGraphResponse | undefined,
  selection: FeatureSubgraphSelection | undefined,
): FeatureSubgraphSchema => {
  const { featureFlagName, subgraphId, subgraphName } = selection ?? {};

  const featureSubgraph = useMemo(() => {
    const featureFlag = compositionFlags?.featureFlags.find((flag) => flag.name === featureFlagName);
    if (!featureFlag) {
      return undefined;
    }

    return compositionFlags?.featureSubgraphs.find(
      (featureSubgraph) =>
        featureSubgraph.featureFlagId === featureFlag.id &&
        (subgraphId ? featureSubgraph.id === subgraphId : featureSubgraph.name === subgraphName),
    );
  }, [compositionFlags, featureFlagName, subgraphId, subgraphName]);

  const { data, isLoading } = useQuery(
    getSdlBySchemaVersion,
    {
      schemaVersionId: featureSubgraph?.schemaVersionId,
      targetId: featureSubgraph?.targetId,
    },
    {
      enabled: !!featureSubgraph,
    },
  );

  return { featureSubgraph, sdl: data?.sdl, isLoading };
};

/** Feature subgraphs grouped by the flag that contains them, for rendering them nested under it. */
export const groupFeatureSubgraphsByFlag = (
  featureSubgraphs: FeatureSubgraphInFlagComposition[],
): Partial<Record<string, FeatureSubgraphInFlagComposition[]>> =>
  Object.groupBy(featureSubgraphs, ({ featureFlagId }) => featureFlagId);

import { GraphContext } from '@/components/layout/graph-layout';
import { useQuery } from '@connectrpc/connect-query';
import { getGraphCollections } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useContext } from 'react';
import { CollectionSort, collectionSortParam } from '@/lib/graph-collections';

/**
 * Loads every collection the current user can see for the graph on screen.
 * Metadata only - a body is fetched when its operation is opened.
 */
export const useGraphCollections = ({ sort = 'name' }: { sort?: CollectionSort } = {}) => {
  const graphContext = useContext(GraphContext);
  const federatedGraphName = graphContext?.graph?.name ?? '';
  const namespace = graphContext?.graph?.namespace ?? '';
  // Sent with every by-id call so the server scopes the lookup to this graph.
  // It narrows the query only, never widens what the caller may see.
  const federatedGraphId = graphContext?.graph?.id ?? '';

  const { data, isPending, isError, refetch } = useQuery(
    getGraphCollections,
    { federatedGraphName, namespace, sortBy: collectionSortParam[sort] },
    { enabled: !!federatedGraphName },
  );

  return {
    collections: data?.collections ?? [],
    canCreateTeamCollection: data?.canCreateTeamCollection ?? false,
    isLoading: isPending,
    isError,
    refetch,
    federatedGraphName,
    namespace,
    federatedGraphId,
  };
};

import { GraphContext } from '@/components/layout/graph-layout';
import { useQuery } from '@connectrpc/connect-query';
import { getGraphCollections } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useContext } from 'react';

/**
 * Loads every collection the current user can see for the graph on screen.
 *
 * Operation bodies are deliberately absent, the list carries metadata only,
 * and a body is fetched when an operation is opened.
 */
export const useGraphCollections = () => {
  const graphContext = useContext(GraphContext);
  const federatedGraphName = graphContext?.graph?.name ?? '';
  const namespace = graphContext?.graph?.namespace ?? '';
  // Sent with every by-id call so the server can scope the lookup to this
  // graph. It narrows the query only, and never widens what the caller may see.
  const federatedGraphId = graphContext?.graph?.id ?? '';

  const { data, isPending, isError, refetch } = useQuery(
    getGraphCollections,
    { federatedGraphName, namespace },
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

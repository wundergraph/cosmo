import { useQuery } from "@connectrpc/connect-query";
import {
  getFederatedGraphs,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { createContext, useEffect, useMemo, useState } from "react";
import { FederatedGraph, SubgraphMinimal } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useRouter } from "next/router";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useLocalStorage } from "@/hooks/use-local-storage";

type WorkspaceFederatedGraph = {
  graph: FederatedGraph;
  subgraphs: SubgraphMinimal[];
};

export interface WorkspaceContextType {
  namespace: string;
  setNamespace(namespace: string, applyParams?: boolean): void;
  isLoading: boolean;
  graphs: Map<string, WorkspaceFederatedGraph[]>;
}

export const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function WorkspaceProvider({ children }: React.PropsWithChildren) {
  const router = useRouter();
  const applyParams = useApplyParams();
  const { data, isLoading } = useQuery(getFederatedGraphs, { includeSubgraphs: true });

  // Initialize the namespace
  const namespaceParam = router.query.namespace as string;
  const [storedNamespace, setStoredNamespace] = useLocalStorage("wg-namespace", "default");
  const [namespace, setNamespace] = useState(namespaceParam || storedNamespace || "default");
  const [namespaces, setNamespaces] = useState(["default"]);

  // Correct namespace
  useEffect(() => {
    if (!data || data.graphs.length === 0) {
      return;
    }

    const currentNamespaces = data.graphs
      .map((g) => g.namespace)
      .filter((value, index, array) => array.indexOf(value) === index);

    if (!currentNamespaces.some((ns) => ns.toLowerCase() === namespace.toLowerCase())) {
      // The authenticated user doesn't have access to the namespace, pick between the `default` or the
      // first available namespace if the user doesn't have access to the `default` namespace
      const ns = currentNamespaces.find((n) => n === "default") || currentNamespaces[0];
      if (ns) {
        // Only apply the namespace parameter when we found a valid namespace
        setNamespace(ns);
        setStoredNamespace(ns);
        applyParams({
          namespace: ns,
        });
      }
    } else if (!namespaceParam) {
      applyParams({ namespace });
    }

    setNamespaces(currentNamespaces);
  }, [applyParams, data, namespace, namespaceParam, setStoredNamespace]);

  // Transform the returned graphs to something we can use
  const contextGraphs = useMemo<WorkspaceContextType['graphs']>(() => {
    if (!data?.graphs || isLoading) {
      return new Map<string, WorkspaceFederatedGraph[]>();
    }

    const graphs = new Map<string, WorkspaceFederatedGraph[]>();
    const fedGraphsGroupedByNamespace = Object.groupBy(data.graphs, (g) => g.namespace);
    for (const [namespace, groupedGraphs] of Object.entries(fedGraphsGroupedByNamespace)) {
      if (!namespace || !groupedGraphs || !groupedGraphs.length) {
        continue;
      }

      graphs.set(
        namespace!,
        groupedGraphs.map((graph) => ({
          graph,
          subgraphs: data.subgraphs.filter((sg) => sg.fedGraphId === graph.id),
        })),
      );
    }

    return graphs;
  }, [data, isLoading]);

  const context = useMemo<WorkspaceContextType>(() => {
    return {
      namespace,
      setNamespace(ns: string, applyRouteParams = true) {
        if (!ns || namespace === ns || !namespaces.some((ns) => ns.toLowerCase() === ns.toLowerCase())) {
          return;
        }

        setNamespace(ns);
        setStoredNamespace(ns);
        if (applyRouteParams) {
          applyParams({namespace: ns});
        }
      },
      isLoading,
      graphs: contextGraphs,
    };
  }, [namespace, isLoading, contextGraphs, namespaces, setStoredNamespace, applyParams]);

  return (
    <WorkspaceContext.Provider value={context}>
      {children}
    </WorkspaceContext.Provider>
  );
}
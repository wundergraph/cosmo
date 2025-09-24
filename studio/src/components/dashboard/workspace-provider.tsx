import { useQuery } from "@connectrpc/connect-query";
import {
  getWorkspace,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { WorkspaceNamespace } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useRouter } from "next/router";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";

const DEFAULT_NAMESPACE_NAME = 'default';

export interface WorkspaceContextType {
  isLoading: boolean;
  namespace: WorkspaceNamespace;
  namespaceByName: ReadonlyMap<string, WorkspaceNamespace>;
  setNamespace(namespace: string, applyParams: boolean): void;
}

export const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function WorkspaceProvider({ children }: React.PropsWithChildren) {
  const router = useRouter();
  const applyParams = useApplyParams();
  const { data, isLoading } = useQuery(getWorkspace, {});

  // Initialize the namespace
  const namespaceParam = router.query.namespace as string;
  const [storedNamespace, setStoredNamespace] = useLocalStorage("wg-namespace", DEFAULT_NAMESPACE_NAME);
  const [namespace, setNamespace] = useState(namespaceParam || storedNamespace || DEFAULT_NAMESPACE_NAME);
  const [namespaces, setNamespaces] = useState([DEFAULT_NAMESPACE_NAME]);

  // Correct namespace
  useEffect(() => {
    if (!data || data.response?.code == EnumStatusCode.OK || !data.namespaces?.length) {
      return;
    }

    const currentNamespaces = data.namespaces.map((wns) => wns.name);
    if (!currentNamespaces.some((ns) => ns.toLowerCase() === namespace.toLowerCase())) {
      // The authenticated user doesn't have access to the namespace, pick between the `default` or the
      // first available namespace if the user doesn't have access to the `default` namespace
      const ns = currentNamespaces.find((n) => n === DEFAULT_NAMESPACE_NAME) || currentNamespaces[0];
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

  // Memoize context components
  const currentNamespace= useMemo(
    () => isLoading
      ? new WorkspaceNamespace({ id: '', name: namespace, graphs: [] })
      : data?.namespaces.find((wns) => wns.name === namespace) ?? new WorkspaceNamespace({
        id: '',
        name: DEFAULT_NAMESPACE_NAME,
        graphs: [],
      }),
    [isLoading, data?.namespaces, namespace],
  );

  const namespaceByName = useMemo(
    () => data?.namespaces.reduce(
      (acc, wns) => {
        acc.set(wns.name, wns);
        return acc;
      },
      new Map<string, WorkspaceNamespace>(),
    ) ?? new Map<string, WorkspaceNamespace>(),
    [data?.namespaces],
  );

  const setNamespaceCallback = useCallback((ns: string, applyRouteParams: boolean) => {
    if (!ns || namespace === ns || !namespaces.some((ns) => ns.toLowerCase() === ns.toLowerCase())) {
      return;
    }

    setNamespace(ns);
    setStoredNamespace(ns);
    if (applyRouteParams) {
      applyParams({namespace: ns});
    }
  }, [namespace, namespaces, setStoredNamespace, applyParams]);

  // Finally, render :)
  return (
    <WorkspaceContext.Provider
      value={{
        isLoading,
        namespace: currentNamespace,
        namespaceByName,
        setNamespace: setNamespaceCallback,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
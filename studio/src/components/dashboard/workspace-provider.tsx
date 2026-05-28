import { useQuery } from '@connectrpc/connect-query';
import { getWorkspace } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { WorkspaceNamespace } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { useRouter } from 'next/router';
import { useApplyParams } from '@/components/analytics/use-apply-params';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { useOnboardingNavigation } from '@/hooks/use-onboarding-navigation';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';

const DEFAULT_NAMESPACE_NAME = 'default';

export interface WorkspaceContextType {
  isLoading: boolean;
  namespace: WorkspaceNamespace;
  namespaceByName: ReadonlyMap<string, WorkspaceNamespace>;
  setNamespace(namespace: string, applyParams: boolean): void;
}

export const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function WorkspaceProvider({
  children,
  isNewUser,
  hasPendingInvitations,
  hasMultipleOrganizations,
}: React.PropsWithChildren<{
  isNewUser?: boolean;
  hasPendingInvitations?: boolean;
  hasMultipleOrganizations?: boolean;
}>) {
  const router = useRouter();
  const applyParams = useApplyParams();
  const { data, isLoading } = useQuery(getWorkspace, {});

  // Initialize the namespace
  const namespaceParam = router.query.namespace as string;
  const [storedNamespace, setStoredNamespace] = useLocalStorage('wg-namespace', DEFAULT_NAMESPACE_NAME);
  const [namespace, setNamespace] = useState(namespaceParam || storedNamespace || DEFAULT_NAMESPACE_NAME);
  const [namespaces, setNamespaces] = useState([DEFAULT_NAMESPACE_NAME]);

  // Correct namespace
  useEffect(() => {
    if (data?.response?.code !== EnumStatusCode.OK || !data?.namespaces?.length) {
      return;
    }

    const actualNamespace = (router.query.namespace as string) || namespace;
    const currentNamespaces = data.namespaces.map((wns) => wns.name);
    if (!currentNamespaces.some((ns) => ns.toLowerCase() === actualNamespace.toLowerCase())) {
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
    } else if (actualNamespace.toLowerCase() !== namespace.toLowerCase()) {
      setNamespace(actualNamespace);
      setStoredNamespace(actualNamespace);
    }

    setNamespaces(currentNamespaces);
  }, [
    applyParams,
    data?.response?.code,
    data?.namespaces,
    router.query.namespace,
    namespace,
    namespaceParam,
    setStoredNamespace,
  ]);

  // Memoize context components
  const currentNamespace = useMemo(
    () =>
      isLoading
        ? new WorkspaceNamespace({ id: '', name: namespace, graphs: [] })
        : (data?.namespaces.find((wns) => wns.name.toLowerCase() === namespace.toLowerCase()) ??
          new WorkspaceNamespace({
            id: '',
            name: DEFAULT_NAMESPACE_NAME,
            graphs: [],
          })),
    [isLoading, data?.namespaces, namespace],
  );

  const namespaceByName = useMemo(
    () =>
      data?.namespaces.reduce((acc, wns) => {
        acc.set(wns.name, wns);
        return acc;
      }, new Map<string, WorkspaceNamespace>()) ?? new Map<string, WorkspaceNamespace>(),
    [data?.namespaces],
  );

  const setNamespaceCallback = useCallback(
    (newNs: string, applyRouteParams: boolean) => {
      if (!newNs || namespace === newNs || !namespaces.some((ns) => ns.toLowerCase() === newNs.toLowerCase())) {
        return;
      }

      setNamespace(newNs);
      setStoredNamespace(newNs);
      if (applyRouteParams) {
        applyParams({ namespace: newNs });
      }
    },
    [namespace, namespaces, setStoredNamespace, applyParams],
  );

  const postSignupSkip = router.query['post-signup-skip'] === 'true';
  // `hasPendingInvitations` is tri-state: undefined while the session is loading or
  // mid-reset, true with pending invites, false only when the session has resolved
  // to an empty invitations list. Treat undefined as "still pending" so we don't
  // race the session query against getOnboarding during transport setup.
  // `isNewUser && hasMultipleOrganizations` catches the post-signup Accept flow:
  // a freshly signed-up user who already belongs to more than one org just accepted
  // an invitation, so we should send them to that org's dashboard rather than the
  // onboarding wizard. Existing users (isNewUser=false) with multiple orgs still
  // get onboarding gated only by the standard invitations check.
  const justAcceptedFreshUser = Boolean(isNewUser) && Boolean(hasMultipleOrganizations);
  const onboardingDisabled = justAcceptedFreshUser || (hasPendingInvitations !== false && !postSignupSkip);

  useOnboardingNavigation({
    disabled: onboardingDisabled,
  });

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

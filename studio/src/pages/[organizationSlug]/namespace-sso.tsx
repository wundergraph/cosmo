import { EmptyState } from '@/components/empty-state';
import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader } from '@/components/ui/loader';
import { useToast } from '@/components/ui/use-toast';
import { useFeature } from '@/hooks/use-feature';
import { useIsAdmin } from '@/hooks/use-is-admin';
import { docsBaseURL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { NextPageWithLayout } from '@/lib/page';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import { ExclamationTriangleIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  getNamespaceSSOMapping,
  getWorkspace,
  listOIDCProviders,
  updateNamespaceSSOMapping,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';

interface NamespaceLite {
  id: string;
  name: string;
}

interface DetailPaneProps {
  organizationSlug: string;
  namespace: NamespaceLite;
  providers: { id: string; name: string; alias: string }[];
  isAdmin: boolean;
  onDirtyChange: (dirty: boolean) => void;
  // Bump to force a refetch of the active mapping (e.g. after save).
  refetchTrigger: number;
  // Imperative save hook: when bumped, child saves current form state.
  saveTrigger: number;
}

// Detail pane is its own component so that switching the selected namespace
// remounts the form and re-fetches a fresh mapping cleanly.
function NamespaceSSODetail({
  organizationSlug,
  namespace,
  providers,
  isAdmin,
  onDirtyChange,
  refetchTrigger,
}: Omit<DetailPaneProps, 'saveTrigger'>) {
  const { toast } = useToast();

  const {
    data: mappingData,
    isLoading,
    error,
    refetch,
  } = useQuery(getNamespaceSSOMapping, { namespaceId: namespace.id }, { enabled: Boolean(namespace.id) });

  const { mutate, isPending } = useMutation(updateNamespaceSSOMapping);

  const [allowPasswordLogin, setAllowPasswordLogin] = useState(false);
  const [allowedProviderIds, setAllowedProviderIds] = useState<string[]>([]);
  // Server-side snapshot to compute dirty state.
  const [serverAllowPassword, setServerAllowPassword] = useState(false);
  const [serverAllowed, setServerAllowed] = useState<string[]>([]);

  useEffect(() => {
    if (!mappingData?.mapping) return;
    setAllowPasswordLogin(mappingData.mapping.allowPasswordLogin);
    setAllowedProviderIds([...mappingData.mapping.allowedSsoProviderIds]);
    setServerAllowPassword(mappingData.mapping.allowPasswordLogin);
    setServerAllowed([...mappingData.mapping.allowedSsoProviderIds]);
  }, [mappingData]);

  // Refetch when the parent bumps the trigger (e.g. after save).
  useEffect(() => {
    if (refetchTrigger > 0) {
      refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchTrigger]);

  const isDirty = useMemo(() => {
    if (allowPasswordLogin !== serverAllowPassword) return true;
    if (allowedProviderIds.length !== serverAllowed.length) return true;
    const a = new Set(allowedProviderIds);
    for (const id of serverAllowed) {
      if (!a.has(id)) return true;
    }
    return false;
  }, [allowPasswordLogin, allowedProviderIds, serverAllowPassword, serverAllowed]);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const isDefaultOpen = !allowPasswordLogin && allowedProviderIds.length === 0;

  const toggleProvider = (providerId: string, checked: boolean) => {
    setAllowedProviderIds((prev) => {
      if (checked) return prev.includes(providerId) ? prev : [...prev, providerId];
      return prev.filter((id) => id !== providerId);
    });
  };

  const onSave = () => {
    if (!namespace.id) return;
    mutate(
      {
        namespaceId: namespace.id,
        allowedSsoProviderIds: allowedProviderIds,
        allowPasswordLogin,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            toast({
              description: 'Namespace SSO mapping updated successfully.',
              duration: 3000,
            });
            refetch();
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 4000 });
          }
        },
        onError: () => {
          toast({
            description: 'Could not update the namespace SSO mapping. Please try again.',
            duration: 3000,
          });
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-full min-h-[20rem] items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (error || !mappingData || mappingData.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not load the namespace SSO mapping"
        description={mappingData?.response?.details || error?.message || 'Please try again'}
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  return (
    <Card className="border-0 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-x-2">
          <span>Login methods</span>
        </CardTitle>
        <CardDescription>
          Restrict this namespace to specific login methods. Leave everything unchecked to allow all login methods
          (default-open).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-y-6">
        <div className="flex flex-col gap-y-3">
          <div className="text-sm font-semibold">Password login</div>
          <label className="flex items-start gap-x-3">
            <Checkbox
              id="allow-password-login"
              checked={allowPasswordLogin}
              disabled={!isAdmin}
              onCheckedChange={(checked) => setAllowPasswordLogin(checked === true)}
            />
            <div className="flex flex-col">
              <span className="text-sm">Allow password login</span>
              <span className="text-xs text-muted-foreground">
                Members can sign in with their email and password to access this namespace.
              </span>
            </div>
          </label>
        </div>

        <div className="flex flex-col gap-y-3">
          <div className="text-sm font-semibold">SSO apps</div>
          <div className="flex flex-col gap-y-3">
            {providers.map((provider) => {
              const checked = allowedProviderIds.includes(provider.id);
              return (
                <label key={provider.id} className="flex items-start gap-x-3">
                  <Checkbox
                    id={`sso-${provider.id}`}
                    checked={checked}
                    disabled={!isAdmin}
                    onCheckedChange={(value) => toggleProvider(provider.id, value === true)}
                  />
                  <div className="flex flex-col">
                    <span className="text-sm">{provider.name || 'OIDC provider'}</span>
                    {provider.alias ? (
                      <span className="font-mono text-xs text-muted-foreground">{provider.alias}</span>
                    ) : null}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {isDefaultOpen && (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            This namespace is open to everyone with permission (default-open). Any login method (password or SSO) can
            be used to access it.
          </div>
        )}

        {isAdmin ? (
          <div className="flex justify-end">
            <Button type="button" isLoading={isPending} disabled={!isDirty} onClick={onSave}>
              Save
            </Button>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            You need organization admin access to change the namespace login methods.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const NamespaceSSOMappingPage: NextPageWithLayout = () => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const isAdmin = useIsAdmin();
  const oidc = useFeature('oidc');

  const {
    data: workspaceData,
    isLoading: isLoadingWorkspace,
    error: workspaceError,
    refetch: refetchWorkspace,
  } = useQuery(getWorkspace, {});

  const {
    data: providersData,
    isLoading: isLoadingProviders,
    error: providersError,
    refetch: refetchProviders,
  } = useQuery(listOIDCProviders, {});

  const namespaces = useMemo<NamespaceLite[]>(() => {
    const list = workspaceData?.namespaces ?? [];
    return list.map((wns) => ({ id: wns.id, name: wns.name }));
  }, [workspaceData?.namespaces]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  // Used to remount the detail pane when a namespace switch happens, ensuring a clean form state.
  const [detailKey, setDetailKey] = useState(0);
  const [refetchTrigger] = useState(0);

  // Seed selection from ?namespace=<name> query param or fall back to first namespace.
  useEffect(() => {
    if (selectedId || namespaces.length === 0) return;
    const queryNs = router.query.namespace as string | undefined;
    if (queryNs) {
      const match = namespaces.find((n) => n.name.toLowerCase() === queryNs.toLowerCase());
      if (match) {
        setSelectedId(match.id);
        return;
      }
    }
    setSelectedId(namespaces[0].id);
  }, [namespaces, router.query.namespace, selectedId]);

  // Keep URL query in sync with the selected namespace so the page is deep-linkable.
  useEffect(() => {
    if (!selectedId || !router.isReady) return;
    const selected = namespaces.find((n) => n.id === selectedId);
    if (!selected) return;
    if ((router.query.namespace as string | undefined) === selected.name) return;
    router.replace(
      {
        pathname: router.pathname,
        query: { ...router.query, namespace: selected.name },
      },
      undefined,
      { shallow: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, namespaces]);

  const requestSelect = (id: string) => {
    if (id === selectedId) return;
    if (isDirty) {
      setPendingSwitchId(id);
      setConfirmOpen(true);
      return;
    }
    setSelectedId(id);
    setDetailKey((k) => k + 1);
  };

  const confirmDiscard = () => {
    if (pendingSwitchId) {
      setSelectedId(pendingSwitchId);
      setDetailKey((k) => k + 1);
      setIsDirty(false);
    }
    setPendingSwitchId(null);
    setConfirmOpen(false);
  };

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Namespace SSO</CardTitle>
          <CardDescription>You need organization admin access to view this page.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!oidc) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-x-2">
            <span>Namespace SSO mapping</span>
            <Badge variant="outline">Enterprise feature</Badge>
          </CardTitle>
          <CardDescription>
            Restrict namespaces to specific login methods. This feature is part of the SSO add-on.{' '}
            <Link href={docsBaseURL + '/studio/sso'} className="text-sm text-primary" target="_blank" rel="noreferrer">
              Learn more
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoadingWorkspace || isLoadingProviders) {
    return <Loader fullscreen />;
  }

  if (
    workspaceError ||
    providersError ||
    !workspaceData ||
    !providersData ||
    workspaceData.response?.code !== EnumStatusCode.OK ||
    providersData.response?.code !== EnumStatusCode.OK
  ) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not load namespaces"
        description={
          workspaceData?.response?.details ||
          providersData?.response?.details ||
          workspaceError?.message ||
          providersError?.message ||
          'Please try again'
        }
        actions={
          <Button
            onClick={() => {
              refetchWorkspace();
              refetchProviders();
            }}
          >
            Retry
          </Button>
        }
      />
    );
  }

  const providers = providersData.providers ?? [];
  const selected = namespaces.find((n) => n.id === selectedId) ?? null;

  if (providers.length === 0) {
    return (
      <EmptyState
        icon={<LockClosedIcon />}
        title="No SSO apps configured"
        description="Connect at least one OIDC provider before you can restrict namespace access by login method."
        actions={
          <Button asChild>
            <Link href={`/${organizationSlug}/settings`}>Connect an SSO app</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-1 md:grid-cols-[16rem_1fr]">
          {/* Left pane: list of namespaces */}
          <aside className="border-b md:border-b-0 md:border-r">
            <div className="border-b px-4 py-3 text-sm font-semibold">Namespaces</div>
            {namespaces.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No namespaces found in this organization.</div>
            ) : (
              <ul className="max-h-[70vh] overflow-y-auto">
                {namespaces.map((ns) => {
                  const active = ns.id === selectedId;
                  return (
                    <li key={ns.id}>
                      <button
                        type="button"
                        onClick={() => requestSelect(ns.id)}
                        className={cn(
                          'flex w-full items-center justify-between gap-x-2 px-4 py-2 text-left text-sm transition-colors',
                          active
                            ? 'bg-primary/15 font-medium text-primary'
                            : 'text-foreground hover:bg-muted',
                        )}
                      >
                        <span className="truncate">{ns.name}</span>
                        {active && isDirty && (
                          <span className="text-xs text-muted-foreground">unsaved</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* Right pane: details for the selected namespace */}
          <section className="min-h-[20rem]">
            {!selected ? (
              <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
                Select a namespace from the left to configure its login methods.
              </div>
            ) : (
              <NamespaceSSODetail
                key={`${selected.id}-${detailKey}`}
                organizationSlug={organizationSlug}
                namespace={selected}
                providers={providers}
                isAdmin={isAdmin}
                onDirtyChange={setIsDirty}
                refetchTrigger={refetchTrigger}
              />
            )}
          </section>
        </div>
      </Card>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(v) => {
          setConfirmOpen(v);
          if (!v) setPendingSwitchId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to the current namespace&apos;s login methods. Switching namespaces will discard
              them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard}>Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

NamespaceSSOMappingPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    'Namespace SSO',
    'Restrict which login methods can access each namespace in your organization.',
  );
};

export default NamespaceSSOMappingPage;

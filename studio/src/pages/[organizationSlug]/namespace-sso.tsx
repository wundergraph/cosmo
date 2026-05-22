import { EmptyState } from '@/components/empty-state';
import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import { MappingRow, NamespaceLite, NamespaceMappingRows } from '@/components/namespace-sso/namespace-mapping-rows';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader } from '@/components/ui/loader';
import { MultiSelectOption } from '@/components/ui/multi-select';
import { useToast } from '@/components/ui/use-toast';
import { useFeature } from '@/hooks/use-feature';
import { useIsAdmin } from '@/hooks/use-is-admin';
import { docsBaseURL } from '@/lib/constants';
import { NextPageWithLayout } from '@/lib/page';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import { ExclamationTriangleIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  getWorkspace,
  listNamespaceSSOMappings,
  listOIDCProviders,
  updateNamespaceSSOMapping,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';

// Sentinel value representing password login, which is not an SSO provider id.
const PASSWORD_VALUE = '__password__';

// Stable key describing a namespace's allowed methods, for dirty-state and diffing.
const methodsKey = (values: string[]) => [...values].sort().join(',');

const NamespaceSSOMappingPage: NextPageWithLayout = () => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const isAdmin = useIsAdmin();
  const oidc = useFeature('oidc');
  const { toast } = useToast();

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

  const {
    data: mappingsData,
    isLoading: isLoadingMappings,
    error: mappingsError,
    refetch: refetchMappings,
  } = useQuery(listNamespaceSSOMappings, {});

  const { mutateAsync, isPending } = useMutation(updateNamespaceSSOMapping);

  const namespaces = useMemo<NamespaceLite[]>(
    () => (workspaceData?.namespaces ?? []).map((wns) => ({ id: wns.id, name: wns.name })),
    [workspaceData?.namespaces],
  );

  const providers = useMemo(() => providersData?.providers ?? [], [providersData?.providers]);

  const methodOptions = useMemo<MultiSelectOption[]>(
    () => [
      { value: PASSWORD_VALUE, label: 'Password login', description: 'Email and password sign-in', group: 'Password' },
      ...providers.map((p) => ({
        value: p.id,
        label: p.name || p.alias || 'OIDC provider',
        description: p.alias || undefined,
        group: 'SSO apps',
      })),
    ],
    [providers],
  );

  const [rows, setRows] = useState<MappingRow[]>([]);
  // Server snapshot keyed by namespace id, for dirty-state and save diffing.
  const [serverByNamespace, setServerByNamespace] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (!mappingsData?.mappings) return;
    const seeded: MappingRow[] = mappingsData.mappings.map((m, index) => {
      const methodValues = [...m.allowedSsoProviderIds];
      if (m.allowPasswordLogin) {
        methodValues.unshift(PASSWORD_VALUE);
      }
      return { id: index, namespaceId: m.namespaceId, methodValues };
    });
    setRows(seeded);
    setServerByNamespace(new Map(seeded.map((r) => [r.namespaceId, r.methodValues])));
  }, [mappingsData]);

  // Desired state from the current rows: only complete rows (namespace + ≥1 method).
  const desiredByNamespace = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of rows) {
      if (row.namespaceId && row.methodValues.length > 0) {
        map.set(row.namespaceId, row.methodValues);
      }
    }
    return map;
  }, [rows]);

  const isDirty = useMemo(() => {
    if (desiredByNamespace.size !== serverByNamespace.size) return true;
    return Array.from(desiredByNamespace.entries()).some(([namespaceId, values]) => {
      const server = serverByNamespace.get(namespaceId);
      return !server || methodsKey(server) !== methodsKey(values);
    });
  }, [desiredByNamespace, serverByNamespace]);

  const onSave = async () => {
    // Build the minimal set of updates: changed/added namespaces get their new
    // methods; namespaces removed from the list are reset to default-open.
    const updates: { namespaceId: string; allowedSsoProviderIds: string[]; allowPasswordLogin: boolean }[] = [];

    for (const [namespaceId, values] of Array.from(desiredByNamespace.entries())) {
      const server = serverByNamespace.get(namespaceId);
      if (!server || methodsKey(server) !== methodsKey(values)) {
        updates.push({
          namespaceId,
          allowedSsoProviderIds: values.filter((v) => v !== PASSWORD_VALUE),
          allowPasswordLogin: values.includes(PASSWORD_VALUE),
        });
      }
    }

    for (const namespaceId of Array.from(serverByNamespace.keys())) {
      if (!desiredByNamespace.has(namespaceId)) {
        updates.push({ namespaceId, allowedSsoProviderIds: [], allowPasswordLogin: false });
      }
    }

    try {
      const results = await Promise.all(updates.map((u) => mutateAsync(u)));
      const failed = results.find((r) => r.response?.code !== EnumStatusCode.OK);
      if (failed) {
        toast({ description: failed.response?.details || 'Could not update some namespaces.', duration: 4000 });
      } else {
        toast({ description: 'Namespace login methods updated successfully.', duration: 3000 });
      }
    } catch {
      toast({ description: 'Could not update the namespace login methods. Please try again.', duration: 3000 });
    } finally {
      refetchMappings();
    }
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

  if (isLoadingWorkspace || isLoadingProviders || isLoadingMappings) {
    return <Loader fullscreen />;
  }

  if (
    workspaceError ||
    providersError ||
    mappingsError ||
    !workspaceData ||
    !providersData ||
    !mappingsData ||
    workspaceData.response?.code !== EnumStatusCode.OK ||
    providersData.response?.code !== EnumStatusCode.OK ||
    mappingsData.response?.code !== EnumStatusCode.OK
  ) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not load namespace SSO mappings"
        description={
          workspaceData?.response?.details ||
          providersData?.response?.details ||
          mappingsData?.response?.details ||
          workspaceError?.message ||
          providersError?.message ||
          mappingsError?.message ||
          'Please try again'
        }
        actions={
          <Button
            onClick={() => {
              refetchWorkspace();
              refetchProviders();
              refetchMappings();
            }}
          >
            Retry
          </Button>
        }
      />
    );
  }

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
    <Card>
      <CardHeader>
        <CardTitle>Namespace login methods</CardTitle>
        <CardDescription>
          Restrict which login methods can access each namespace. Namespaces that aren&apos;t listed are open to all
          login methods (default-open).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-y-6">
        <NamespaceMappingRows
          namespaces={namespaces}
          methodOptions={methodOptions}
          rows={rows}
          updateRows={setRows}
          disabled={!isAdmin}
        />

        <div className="flex justify-end">
          <Button type="button" isLoading={isPending} disabled={!isDirty} onClick={onSave}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
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

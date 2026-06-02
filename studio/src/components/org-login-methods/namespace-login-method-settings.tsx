import { EmptyState } from '@/components/empty-state';
import {
  MappingRow,
  NamespaceLite,
  NamespaceMappingRows,
} from '@/components/namespace-login-methods/namespace-mapping-rows';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader } from '@/components/ui/loader';
import { MultiSelectOption } from '@/components/ui/multi-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { useWorkspace } from '@/hooks/use-workspace';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { docsBaseURL } from '@/lib/constants';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import { ExclamationTriangleIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OIDCProvider, OrganizationLoginMethods } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import {
  listNamespaceLoginMethods,
  updateNamespaceLoginMethods,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

// Sentinel values representing built-in methods, which are not SSO provider ids.
const PASSWORD_VALUE = '__password__';
const GOOGLE_VALUE = '__google__';
const GITHUB_VALUE = '__github__';

// Stable key describing a namespace's allowed methods, for dirty-state and diffing.
const methodsKey = (values: string[]) => [...values].sort().join(',');

const SectionCard = ({ children }: { children: React.ReactNode }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Namespaces</CardTitle>
        <CardDescription>
          Restrict which login methods can access each namespace. Namespaces that aren&apos;t listed are open to all
          login methods (default-open).{' '}
          <Link
            href={docsBaseURL + '/studio/namespace-login-methods'}
            className="text-primary"
            target="_blank"
            rel="noreferrer"
          >
            Learn more
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
};

export function NamespaceLoginMethodSettings({
  orgLoginMethods,
  providers,
}: {
  // The org's current allow-list, fetched and entitlement-gated by the page.
  // Used to limit the per-namespace options to methods the org allows.
  orgLoginMethods: OrganizationLoginMethods | undefined;
  // Connected OIDC providers, fetched by the page (used as SSO-app options).
  providers: OIDCProvider[];
}) {
  const organizationSlug = useCurrentOrganization()?.slug;
  const { toast } = useToast();

  // Namespaces come from the app-wide workspace context (already fetched by the
  // dashboard layout) instead of a duplicate getWorkspace query.
  const { namespaceByName, isLoading: isLoadingWorkspace } = useWorkspace();

  const {
    data: mappingsData,
    isLoading: isLoadingMappings,
    error: mappingsError,
    refetch: refetchMappings,
  } = useQuery(listNamespaceLoginMethods, {});

  const { mutate, isPending } = useMutation(updateNamespaceLoginMethods);

  const namespaces = useMemo<NamespaceLite[]>(
    () => Array.from(namespaceByName.values()).map((ns) => ({ id: ns.id, name: ns.name })),
    [namespaceByName],
  );

  const orgIsRestricted = orgLoginMethods?.isRestricted ?? false;

  const methodOptions = useMemo<MultiSelectOption[]>(() => {
    const allOptions: MultiSelectOption[] = [
      { value: PASSWORD_VALUE, label: 'Password login', description: 'Email and password sign-in', group: 'Password' },
      { value: GOOGLE_VALUE, label: 'Google', description: 'Sign in with Google', group: 'Social login' },
      { value: GITHUB_VALUE, label: 'GitHub', description: 'Sign in with GitHub', group: 'Social login' },
      ...providers.map((p) => ({
        value: p.id,
        label: p.name || p.alias || 'OIDC provider',
        description: p.alias || undefined,
        group: 'SSO apps',
      })),
    ];
    if (!orgIsRestricted || !orgLoginMethods) return allOptions;
    // Filter to only org-allowed methods
    const allowedSsoIds = new Set(orgLoginMethods.allowedSsoProviderIds);
    return allOptions.filter((opt) => {
      if (opt.value === PASSWORD_VALUE) return orgLoginMethods.allowPasswordLogin;
      if (opt.value === GOOGLE_VALUE) return orgLoginMethods.allowGoogleLogin;
      if (opt.value === GITHUB_VALUE) return orgLoginMethods.allowGithubLogin;
      return allowedSsoIds.has(opt.value);
    });
  }, [providers, orgIsRestricted, orgLoginMethods]);

  // Count of allowed methods when org restriction is active
  const orgAllowedCount = useMemo(() => {
    if (!orgIsRestricted || !orgLoginMethods) return null;
    let count = 0;
    if (orgLoginMethods.allowPasswordLogin) count++;
    if (orgLoginMethods.allowGoogleLogin) count++;
    if (orgLoginMethods.allowGithubLogin) count++;
    count += orgLoginMethods.allowedSsoProviderIds.length;
    return count;
  }, [orgIsRestricted, orgLoginMethods]);

  const [rows, setRows] = useState<MappingRow[]>([]);
  // Server snapshot keyed by namespace id, for dirty-state and save diffing.
  const [serverByNamespace, setServerByNamespace] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (!mappingsData?.mappings) return;
    const seeded: MappingRow[] = mappingsData.mappings.map((m, index) => {
      const methodValues: string[] = [];
      if (m.allowPasswordLogin) {
        methodValues.push(PASSWORD_VALUE);
      }
      if (m.allowGoogleLogin) {
        methodValues.push(GOOGLE_VALUE);
      }
      if (m.allowGithubLogin) {
        methodValues.push(GITHUB_VALUE);
      }
      methodValues.push(...m.allowedSsoProviderIds);
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

  const onSave = () => {
    // Send the complete desired set in one call; the backend replaces the org's
    // mappings, so any namespace dropped from the list becomes default-open.
    const builtinMethodValues = new Set([PASSWORD_VALUE, GOOGLE_VALUE, GITHUB_VALUE]);
    const mappings = Array.from(desiredByNamespace.entries()).map(([namespaceId, values]) => ({
      namespaceId,
      allowedSsoProviderIds: values.filter((v) => !builtinMethodValues.has(v)),
      allowPasswordLogin: values.includes(PASSWORD_VALUE),
      allowGoogleLogin: values.includes(GOOGLE_VALUE),
      allowGithubLogin: values.includes(GITHUB_VALUE),
    }));

    mutate(
      { mappings },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            toast({ description: 'Namespace login methods updated successfully.', duration: 3000 });
            refetchMappings();
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 4000 });
          }
        },
        onError: () => {
          toast({ description: 'Could not update the namespace login methods. Please try again.', duration: 3000 });
        },
      },
    );
  };

  if (isLoadingWorkspace || isLoadingMappings) {
    return (
      <SectionCard>
        <Loader />
      </SectionCard>
    );
  }

  if (mappingsError || !mappingsData || mappingsData.response?.code !== EnumStatusCode.OK) {
    return (
      <SectionCard>
        <EmptyState
          className="h-auto py-10"
          icon={<ExclamationTriangleIcon />}
          title="Could not load namespace login methods"
          description={mappingsData?.response?.details || mappingsError?.message || 'Please try again'}
          actions={
            <Button
              onClick={() => {
                refetchMappings();
              }}
            >
              Retry
            </Button>
          }
        />
      </SectionCard>
    );
  }

  if (providers.length === 0) {
    return (
      <SectionCard>
        <EmptyState
          className="h-auto py-10"
          icon={<LockClosedIcon />}
          title="No SSO apps configured"
          description="Connect at least one OIDC provider before you can restrict namespace access by login method."
          actions={
            <Button asChild>
              <Link href={`/${organizationSlug}/settings`}>Connect an SSO app</Link>
            </Button>
          }
        />
      </SectionCard>
    );
  }

  // If org is restricted to a single method, namespace-level gating has no effect.
  if (orgIsRestricted && orgAllowedCount !== null && orgAllowedCount <= 1) {
    return (
      <SectionCard>
        <Alert>
          <AlertDescription>
            Your organization allows a single login method, so namespace-level login methods have no effect. Allow more
            methods in the Organization section above to gate namespaces.
          </AlertDescription>
        </Alert>
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <div className="flex flex-col gap-y-6">
        <NamespaceMappingRows namespaces={namespaces} methodOptions={methodOptions} rows={rows} updateRows={setRows} />

        <div className="flex justify-end">
          <Button type="button" isLoading={isPending} disabled={!isDirty} onClick={onSave}>
            Save
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

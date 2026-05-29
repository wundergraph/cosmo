import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import { EmptyState } from '@/components/empty-state';
import { OrganizationLoginMethodSettings } from '@/components/org-login-methods/organization-login-method-settings';
import { NamespaceLoginMethodSettings } from '@/components/org-login-methods/namespace-login-method-settings';
import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { useIsAdmin } from '@/hooks/use-is-admin';
import { NextPageWithLayout } from '@/lib/page';
import { useQuery } from '@connectrpc/connect-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  getOrganizationLoginMethods,
  listOIDCProviders,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { ExclamationTriangleIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import { useRouter } from 'next/router';

const LoginMethodsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const isAdmin = useIsAdmin();
  // Both shared queries are owned here and passed to the sections. The login
  // methods query is also the entitlement source of truth: a non-entitled org
  // gets ERR_UPGRADE_PLAN, surfaced as the upgrade screen below.
  const { data, isLoading, error, refetch } = useQuery(getOrganizationLoginMethods, {});
  const {
    data: providersData,
    isLoading: isLoadingProviders,
    error: providersError,
    refetch: refetchProviders,
  } = useQuery(listOIDCProviders, {});

  if (!isAdmin) {
    return (
      <EmptyState
        icon={<InfoCircledIcon className="h-12 w-12" />}
        title="You don't have access"
        description="You need organization admin access to manage login methods."
      />
    );
  }

  if (isLoading || isLoadingProviders) {
    return <Loader fullscreen />;
  }

  if (
    data?.response?.code === EnumStatusCode.ERR_UPGRADE_PLAN ||
    providersData?.response?.code === EnumStatusCode.ERR_UPGRADE_PLAN
  ) {
    return (
      <EmptyState
        icon={<InfoCircledIcon className="h-12 w-12" />}
        title="Login method restrictions are not available"
        description="Upgrade to the Enterprise plan to restrict which login methods can access your organization and its namespaces."
        actions={<Button onClick={() => router.push(`/${organizationSlug}/billing`)}>Upgrade</Button>}
      />
    );
  }

  if (
    error ||
    providersError ||
    !data ||
    !providersData ||
    data.response?.code !== EnumStatusCode.OK ||
    providersData.response?.code !== EnumStatusCode.OK
  ) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon className="h-12 w-12" />}
        title="Could not load login methods"
        description={
          data?.response?.details ||
          providersData?.response?.details ||
          error?.message ||
          providersError?.message ||
          'Please try again'
        }
        actions={
          <Button
            onClick={() => {
              refetch();
              refetchProviders();
            }}
          >
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-y-6">
      <OrganizationLoginMethodSettings
        loginMethods={data.loginMethods}
        providers={providersData.providers}
        refetchLoginMethods={refetch}
      />
      <NamespaceLoginMethodSettings orgLoginMethods={data.loginMethods} providers={providersData.providers} />
    </div>
  );
};

LoginMethodsPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    'Login Methods',
    'Control which login methods can access this organization and each of its namespaces.',
  );
};

export default LoginMethodsPage;

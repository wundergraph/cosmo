import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import { EmptyState } from '@/components/empty-state';
import { OrganizationLoginMethodSettings } from '@/components/org-login-methods/organization-login-method-settings';
import { NamespaceLoginMethodSettings } from '@/components/org-login-methods/namespace-login-method-settings';
import { Button } from '@/components/ui/button';
import { useFeature } from '@/hooks/use-feature';
import { useIsAdmin } from '@/hooks/use-is-admin';
import { useUser } from '@/hooks/use-user';
import { NextPageWithLayout } from '@/lib/page';
import { InfoCircledIcon } from '@radix-ui/react-icons';
import { useRouter } from 'next/router';

const LoginMethodsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const user = useUser();
  const isAdmin = useIsAdmin();
  const isFeatureEnabled = !!useFeature('login-method-restrictions')?.enabled;

  if (!isAdmin) {
    return (
      <EmptyState
        icon={<InfoCircledIcon className="h-12 w-12" />}
        title="You don't have access"
        description="You need organization admin access to manage login methods."
      />
    );
  }

  if (!isFeatureEnabled) {
    return (
      <EmptyState
        icon={<InfoCircledIcon className="h-12 w-12" />}
        title="Login method restrictions are not available"
        description="Upgrade to the Enterprise plan to restrict which login methods can access your organization and its namespaces."
        actions={<Button onClick={() => router.push(`/${user?.currentOrganization.slug}/billing`)}>Upgrade</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-y-6">
      <OrganizationLoginMethodSettings />
      <NamespaceLoginMethodSettings />
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

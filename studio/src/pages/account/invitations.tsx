import { EmptyState } from '@/components/empty-state';
import { InvitationCard } from '@/components/invitations/invitation-card';
import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { NextPageWithLayout } from '@/lib/page';
import { ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { useQuery } from '@connectrpc/connect-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { getInvitations } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';

const InvitationsPage: NextPageWithLayout = () => {
  const { data, isLoading, error, refetch } = useQuery(getInvitations);

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve invitations"
        description={data?.response?.details || error?.message || 'Please try again'}
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  if (data.invitations.length === 0) {
    return (
      <EmptyState
        icon={<InformationCircleIcon />}
        title="No invitations"
        description="You have no invitations to other organizations."
        className="pt-16"
      />
    );
  }

  return (
    <div className="flex flex-col gap-y-4 pt-2">
      {data.invitations.map(({ id, name, slug, invitedBy }) => {
        return <InvitationCard key={id} name={name} id={id} slug={slug} invitedBy={invitedBy} />;
      })}
    </div>
  );
};

InvitationsPage.getLayout = (page) => {
  return getDashboardLayout(page, 'Invitations', 'Invitations to other organizations');
};

export default InvitationsPage;

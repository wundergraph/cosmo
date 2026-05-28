import { InvitationCard } from '@/components/invitations/invitation-card';
import { FullscreenLayout } from '@/components/layout/fullscreen-layout';
import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { useUser } from '@/hooks/use-user';
import { NextPageWithLayout } from '@/lib/page';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useQuery } from '@connectrpc/connect-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { getInvitations } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { EmptyState } from '@/components/empty-state';

const JoinInvitationsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const user = useUser();
  const { data, isLoading, error, refetch } = useQuery(getInvitations);

  const personalOrgSlug = user?.currentOrganization?.slug;
  const invitationCount = data?.invitations?.length ?? 0;
  const invitationsResolved = !isLoading && !error && data?.response?.code === EnumStatusCode.OK;

  useEffect(() => {
    if (invitationsResolved && invitationCount === 0 && personalOrgSlug) {
      router.replace(`/${personalOrgSlug}`);
    }
  }, [invitationsResolved, invitationCount, personalOrgSlug, router]);

  if (isLoading || !user) {
    return <Loader fullscreen />;
  }

  if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <div className="mx-auto max-w-screen-md px-4 py-16">
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve invitations"
          description={data?.response?.details || error?.message || 'Please try again'}
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </div>
    );
  }

  if (invitationCount === 0 && isLoading) {
    return <Loader fullscreen />;
  }

  return (
    <div className="mx-auto max-w-screen-md px-4 py-16">
      <div className="mb-8 space-y-2">
        <h1 className="text-2xl font-semibold">You have pending invitations</h1>
        <p className="text-sm text-muted-foreground">
          Accept an invitation to join an existing organization, or skip to continue to your own.
        </p>
      </div>
      <div className="flex flex-col gap-y-4">
        {data.invitations.map(({ id, name, slug, invitedBy }) => (
          <InvitationCard
            key={id}
            id={id}
            name={name}
            slug={slug}
            invitedBy={invitedBy}
            onAcceptSuccess={(acceptedSlug) => router.push(`/${acceptedSlug}`)}
          />
        ))}
      </div>
      <div className="mt-8 flex justify-end">
        <Button
          variant="ghost"
          onClick={() => {
            if (personalOrgSlug) {
              router.push(`/${personalOrgSlug}`);
            }
          }}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
};

JoinInvitationsPage.getLayout = (page) => {
  return <FullscreenLayout>{page}</FullscreenLayout>;
};

export default JoinInvitationsPage;

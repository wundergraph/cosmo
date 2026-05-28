import { InfoCircledIcon } from '@radix-ui/react-icons';
import { useRouter } from 'next/router';
import { InvitationCard } from '@/components/invitations/invitation-card';
import { FullscreenLayout } from '@/components/layout/fullscreen-layout';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { useUser } from '@/hooks/use-user';
import { NextPageWithLayout } from '@/lib/page';

type Invitation = {
  id: string;
  name: string;
  slug: string;
  invitedBy: string;
};

const InvitationList = ({
  invitations,
  onAcceptButtonClick,
}: {
  invitations: Invitation[];
  onAcceptButtonClick: (slug: string) => void;
}) => (
  <>
    {invitations.map(({ id, name, slug, invitedBy }) => (
      <InvitationCard
        key={id}
        id={id}
        name={name}
        slug={slug}
        invitedBy={invitedBy}
        onAcceptSuccess={onAcceptButtonClick}
      />
    ))}
  </>
);

const JoinInvitationsPage: NextPageWithLayout<{
  invitations: Invitation[];
  isLoading: boolean;
}> = ({ invitations, isLoading }) => {
  const router = useRouter();
  const user = useUser();

  const personalOrgSlug = user?.currentOrganization?.slug;
  const invitationCount = invitations?.length ?? 0;

  if (isLoading || !user) {
    return <Loader fullscreen />;
  }

  const handleInvitationAcceptButtonClick = (slug: string) => router.push(`/${slug}`);
  const handleSkipButtonClick = () => router.push(`/${personalOrgSlug}`);

  return (
    <div className="relative min-h-screen px-4 py-16">
      <div className="absolute left-6 top-6">
        <Logo />
      </div>
      <div className="mx-auto max-w-screen-md">
        <div className="mb-8 space-y-2 pb-8">
          <h1 className="mb-4 text-2xl font-semibold">You&apos;ve been invited to collaborate</h1>
          {invitationCount > 0 && (
            <p className="text-sm text-muted-foreground">
              You&apos;ve been invited to join an organization. Select an invitation below:
            </p>
          )}
        </div>
        <div className="flex flex-col gap-y-4">
          {invitationCount < 1 ? (
            <p className="text-sm text-muted-foreground">No invitations found. Continue to your account.</p>
          ) : (
            <InvitationList invitations={invitations} onAcceptButtonClick={handleInvitationAcceptButtonClick} />
          )}
        </div>
        <div className="mt-10 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex min-w-0 sm:mr-2">
            <InfoCircledIcon className="mr-1 shrink-0" />
            <span className="text-xs text-muted-foreground">
              You can manage these invitations from your account page.
            </span>
          </div>
          <Button
            className="self-end sm:self-auto"
            variant="ghost"
            onClick={personalOrgSlug ? handleSkipButtonClick : undefined}
          >
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  );
};

JoinInvitationsPage.getLayout = (page) => {
  return <FullscreenLayout>{page}</FullscreenLayout>;
};

export default JoinInvitationsPage;

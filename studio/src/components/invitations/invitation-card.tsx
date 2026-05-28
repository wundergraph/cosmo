import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import {
  acceptOrDeclineInvitation,
  getInvitations,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useRouter } from 'next/router';
import { useContext, useState } from 'react';
import { SessionClientContext } from '@/components/app-provider';

export interface InvitationCardProps {
  id: string;
  name: string;
  slug: string;
  invitedBy?: string;
  onAcceptSuccess?: (slug: string) => void;
}

export const InvitationCard = ({ id, name, slug, invitedBy, onAcceptSuccess }: InvitationCardProps) => {
  const router = useRouter();
  const { mutate, isPending } = useMutation(acceptOrDeclineInvitation);
  const { refetch } = useQuery(getInvitations);
  const { toast } = useToast();
  const sessionQueryClient = useContext(SessionClientContext);
  const [accepted, setAccepted] = useState<boolean | undefined>();

  const onSubmit = (accept: boolean) => {
    mutate(
      { organizationId: id, accept },
      {
        onSuccess: () => {
          toast({
            description: accept ? 'Accepted the invite successfully.' : 'Declined the invite successfully. ',
            duration: 3000,
          });
          refetch();
          sessionQueryClient.invalidateQueries({
            queryKey: ['user', router.asPath],
          });
          setAccepted(undefined);
          if (accept) {
            onAcceptSuccess?.(slug);
          }
        },
        onError: () => {
          setAccepted(undefined);
          toast({
            description: accept
              ? 'Could not accept the invite. Please try again.'
              : 'Could not decline the invite. Please try again.',
            duration: 3000,
          });
        },
      },
    );
  };

  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
      {invitedBy ? (
        <span className="min-w-0 break-words">
          <span className="font-semibold">{invitedBy}</span> invites you to the{' '}
          <span className="font-semibold">{name}</span> organization.
        </span>
      ) : (
        <span className="min-w-0 break-words">
          You have been invited to the <span className="font-semibold capitalize">{name}</span> organization.
        </span>
      )}
      <div className="flex shrink-0 justify-end gap-x-3 self-end sm:self-auto">
        <Button
          type="submit"
          variant="default"
          onClick={() => {
            setAccepted(true);
            onSubmit(true);
          }}
          disabled={isPending}
          isLoading={accepted === true && isPending}
        >
          Accept
        </Button>
        <Button
          type="submit"
          variant="outline"
          onClick={() => {
            setAccepted(false);
            onSubmit(false);
          }}
          disabled={isPending}
          isLoading={accepted === false && isPending}
        >
          Decline
        </Button>
      </div>
    </Card>
  );
};

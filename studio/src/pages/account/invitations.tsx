import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import { useToast } from "@/components/ui/use-toast";
import { NextPageWithLayout } from "@/lib/page";
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery, useMutation } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  acceptOrDeclineInvitation,
  getInvitations,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useState } from "react";

const InvitationCard = ({
  id,
  name,
  invitedBy,
}: {
  id: string;
  name: string;
  invitedBy?: string;
}) => {
  const router = useRouter();
  const { mutate, isPending } = useMutation(acceptOrDeclineInvitation);
  const { refetch } = useQuery(getInvitations);
  const { toast } = useToast();
  const client = useQueryClient();
  const [accepted, setAccepted] = useState<boolean | undefined>();

  const onSubmit = (accept: boolean) => {
    mutate(
      { organizationId: id, accept },
      {
        onSuccess: () => {
          toast({
            description: accept
              ? "Accepted the invite successfully."
              : "Declined the invite successfully. ",
            duration: 3000,
          });
          refetch();
          client.invalidateQueries({
            queryKey: ["user", router.asPath],
          });
          setAccepted(undefined);
        },
        onError: () => {
          setAccepted(undefined);
          toast({
            description: accept
              ? "Could not accept the invite. Please try again."
              : "Could not decline the invite. Please try again.",
            duration: 3000,
          });
        },
      },
    );
  };

  return (
    <Card className="flex items-center justify-between p-4">
      {invitedBy ? (
        <span>
          <span className="font-semibold">{invitedBy}</span> invites you to the{" "}
          <span className="font-semibold">{name}</span> organization.
        </span>
      ) : (
        <span>
          You have been invited to the{" "}
          <span className="font-semibold capitalize">{name}</span> organization.
        </span>
      )}
      <div className="flex gap-x-3">
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

const InvitationsPage: NextPageWithLayout = () => {
  const { data, isLoading, error, refetch } = useQuery(getInvitations);

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve invitations"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
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
      {data.invitations.map(({ id, name, invitedBy }) => {
        return (
          <InvitationCard key={id} name={name} id={id} invitedBy={invitedBy} />
        );
      })}
    </div>
  );
};

InvitationsPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Invitations",
    "Invitations to other organizations",
  );
};

export default InvitationsPage;

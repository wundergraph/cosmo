import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { useToast } from "@/components/ui/use-toast";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useMutation, useQuery } from "@tanstack/react-query";
import { sentenceCase } from "change-case";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common_pb";
import {
  getOrganizationMembers,
  inviteUser,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { z } from "zod";

const emailInputSchema = z.object({
  email: z.string().email(),
});

type EmailInput = z.infer<typeof emailInputSchema>;

const InviteForm = ({ refresh }: { refresh: () => void }) => {
  const {
    register,
    formState: { isValid, errors },
    reset,
    handleSubmit,
  } = useZodForm<EmailInput>({
    mode: "onChange",
    schema: emailInputSchema,
  });

  const { mutate, isLoading } = useMutation(inviteUser.useMutation());

  const { toast, dismiss } = useToast();

  const sendToast = (description: string) => {
    const { id } = toast({ description });

    const t = setTimeout(() => {
      dismiss(id);
    }, 3000);

    return () => clearTimeout(t);
  };

  const onSubmit: SubmitHandler<EmailInput> = (data) => {
    mutate(
      { email: data.email },
      {
        onSuccess: (d) => {
          sendToast(d.response?.details || "Invited member successfully.");
          refresh();
          reset();
        },
        onError: (error) => {
          sendToast("Could not invite the member. Please try again.");
        },
      }
    );
  };

  return (
    <form className="flex gap-x-4" onSubmit={handleSubmit(onSubmit)}>
      <div className="flex-1">
        <Input
          placeholder="janedoe@example.com"
          className="w-full"
          type="text"
          {...register("email")}
        />
        {errors.email && (
          <span className="mt-2 text-sm text-destructive">
            {errors.email.message}
          </span>
        )}
      </div>
      <Button
        type="submit"
        disabled={!isValid}
        variant="default"
        isLoading={isLoading}
      >
        Invite
      </Button>
    </form>
  );
};

const MemberCard = ({
  email,
  role,
  acceptedInvite,
}: {
  email: string;
  role: string;
  acceptedInvite: boolean;
}) => {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <div className="flex gap-x-2">
        <span>{email}</span>
      </div>
      <div className="flex items-center gap-x-4 text-muted-foreground">
        {acceptedInvite ? (
          <span className="text-sm">{sentenceCase(role)}</span>
        ) : (
          <span className="text-sm text-gray-800 dark:text-gray-400">
            Pending...
          </span>
        )}
      </div>
    </div>
  );
};

const MembersPage: NextPageWithLayout = () => {
  const { data, isLoading, error, refetch } = useQuery(
    getOrganizationMembers.useQuery()
  );

  if (isLoading) return <Loader fullscreen />;

  if (error || data.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve federated graphs"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  if (!data?.members) return null;

  return (
    <div className="mt-4 flex flex-col gap-y-6">
      <InviteForm refresh={() => refetch()} />
      <div className="flex flex-col divide-y rounded-md border">
        {data.members?.map((member) => {
          return (
            <MemberCard
              key={member.id}
              email={member.email}
              role={member.roles[0]}
              acceptedInvite={member.acceptedInvite}
            />
          );
        })}
      </div>
    </div>
  );
};

MembersPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Members",
    "Manage all the members of your organization"
  );
};

export default MembersPage;

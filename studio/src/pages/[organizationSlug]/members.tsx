import { UserContext } from "@/components/app-provider";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { useToast } from "@/components/ui/use-toast";
import { useFeature } from "@/hooks/use-feature";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { useUser } from "@/hooks/use-user";
import { NextPageWithLayout } from "@/lib/page";
import { cn, getHighestPriorityRole } from "@/lib/utils";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getOrganizationMembers,
  inviteUser,
  removeInvitation,
  removeOrganizationMember,
  updateOrgMemberRole,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { sentenceCase } from "change-case";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext } from "react";
import { HiOutlineDotsVertical } from "react-icons/hi";
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

  const { mutate, isPending } = useMutation(inviteUser.useMutation());

  const { toast } = useToast();

  const sendToast = (description: string) => {
    const { id } = toast({ description, duration: 3000 });
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
      },
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
        isLoading={isPending}
      >
        Invite
      </Button>
    </form>
  );
};

const MemberCard = ({
  email,
  role,
  memberUserID,
  acceptedInvite,
  isAdmin,
  isCurrentUser,
  active,
  refresh,
}: {
  email: string;
  role?: string;
  memberUserID: string;
  acceptedInvite: boolean;
  isAdmin: boolean;
  isCurrentUser: boolean;
  active?: boolean;
  refresh: () => void;
}) => {
  const user = useContext(UserContext);

  const { mutate: resendInvitation } = useMutation(inviteUser.useMutation());
  const { mutate: revokeInvitation } = useMutation(
    removeInvitation.useMutation(),
  );
  const { mutate: removeMember } = useMutation(
    removeOrganizationMember.useMutation(),
  );
  const { mutate: updateUserRole } = useMutation(
    updateOrgMemberRole.useMutation(),
  );

  const { toast, update } = useToast();

  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <div className="flex gap-x-2">
        <span>{email}</span>
      </div>
      <div className="flex items-center gap-x-4 text-muted-foreground">
        {active === false && <Badge variant="destructive">Disabled</Badge>}
        <div className={cn({ "pr-[14px]": isAdmin && isCurrentUser })}>
          {acceptedInvite && role ? (
            <span className="text-sm">{sentenceCase(role)}</span>
          ) : (
            <span className="text-sm text-gray-800 dark:text-gray-400">
              Pending
            </span>
          )}
        </div>

        <div>
          {isAdmin && !isCurrentUser && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div className="cursor-pointer">
                  <HiOutlineDotsVertical />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[180px]">
                {!acceptedInvite && (
                  <DropdownMenuItem
                    onClick={() => {
                      const { id } = toast({
                        description: "Inviting member...",
                      });
                      resendInvitation(
                        { email },
                        {
                          onSuccess: (d) => {
                            update({
                              description:
                                d.response?.details ||
                                "Invited member successfully.",
                              duration: 2000,
                              id: id,
                            });
                          },
                          onError: (error) => {
                            update({
                              description:
                                "Could not invite the member. Please try again.",
                              duration: 3000,
                              id: id,
                            });
                          },
                        },
                      );
                    }}
                  >
                    Resend invitation
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    if (acceptedInvite) {
                      removeMember(
                        { email },
                        {
                          onSuccess: (d) => {
                            toast({
                              description:
                                d.response?.details ||
                                "Removed member successfully.",
                              duration: 3000,
                            });
                            refresh();
                          },
                          onError: (error) => {
                            toast({
                              description:
                                "Could not remove member. Please try again.",
                              duration: 3000,
                            });
                          },
                        },
                      );
                    } else {
                      revokeInvitation(
                        { email },
                        {
                          onSuccess: (d) => {
                            toast({
                              description:
                                d.response?.details ||
                                "Removed invitation successfully.",
                              duration: 3000,
                            });
                            refresh();
                          },
                          onError: (error) => {
                            toast({
                              description:
                                "Could not remove invitation. Please try again.",
                              duration: 3000,
                            });
                          },
                        },
                      );
                    }
                  }}
                >
                  {acceptedInvite ? "Remove member" : "Remove invitation"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    updateUserRole(
                      {
                        userID: user?.id,
                        orgMemberUserID: memberUserID,
                        role: role === "admin" ? "developer" : "admin",
                      },
                      {
                        onSuccess: (d) => {
                          toast({
                            description:
                              d.response?.details ||
                              (role === "admin"
                                ? "Demoted member successfully."
                                : "Promoted member successfully."),
                            duration: 3000,
                          });
                          refresh();
                        },
                        onError: (error) => {
                          toast({
                            description:
                              role === "admin"
                                ? "Could not demote member. Please try again."
                                : "Could not promote member. Please try again.",
                            duration: 3000,
                          });
                        },
                      },
                    );
                  }}
                >
                  {role === "admin"
                    ? "Demote to developer"
                    : "Promote to admin"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  );
};

const MembersPage: NextPageWithLayout = () => {
  const user = useUser();
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;

  const usersFeature = useFeature("users");

  const { data, isLoading, error, refetch } = useQuery({
    ...getOrganizationMembers.useQuery(),
    queryKey: [
      user?.currentOrganization.slug || "",
      "GetOrganizationMembers",
      {},
    ],
  });

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK || !user)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve the members of this organization."
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  if (!data?.members) return null;

  const currentUser = data.members.find(
    (member) => member.email === user.email,
  );
  const isAdmin = currentUser?.roles.includes("admin");

  const limitReached =
    usersFeature?.limit &&
    usersFeature?.limit > 0 &&
    data.members.length >= usersFeature?.limit;

  return (
    <div className="flex flex-col gap-y-6">
      {!limitReached && isAdmin && <InviteForm refresh={() => refetch()} />}
      {limitReached && isAdmin && (
        <Alert className="flex flex-row">
          <div className="flex-1">
            <AlertTitle>User limit reached</AlertTitle>
            <AlertDescription>
              You&apos;ve added {data.members.length} of {usersFeature?.limit}{" "}
              users, please upgrade your account to increase your limits.
            </AlertDescription>
          </div>
          <Button variant="outline" asChild>
            <Link href={`/${organizationSlug}/billing`}>View plans</Link>
          </Button>
        </Alert>
      )}
      <div className="flex flex-col divide-y rounded-md border">
        {data.members?.map((member) => {
          return (
            <MemberCard
              key={member.userID}
              email={member.email}
              role={getHighestPriorityRole({ userRoles: member.roles })}
              memberUserID={member.userID}
              acceptedInvite={true}
              isAdmin={isAdmin || false}
              isCurrentUser={member.email === user.email}
              active={member.active}
              refresh={() => refetch()}
            />
          );
        })}
        {data.pendingInvitations?.map((member) => {
          return (
            <MemberCard
              key={member.userID}
              email={member.email}
              memberUserID={member.userID}
              acceptedInvite={false}
              isAdmin={isAdmin || false}
              isCurrentUser={member.email === user.email}
              refresh={() => refetch()}
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
    "Manage all the members of your organization",
  );
};

export default MembersPage;

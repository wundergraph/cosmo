import { useUser } from "@/hooks/use-user";
import { docsBaseURL } from "@/lib/constants";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  addSubgraphMember,
  getOrganizationMembers,
  getSubgraphMembers,
  removeSubgraphMember,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  FederatedGraph,
  Subgraph,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useEffect, useState } from "react";
import { IoPersonAdd } from "react-icons/io5";
import { EmptyState } from "./empty-state";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { CLISteps } from "./ui/cli";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { useToast } from "./ui/use-toast";
import { cn } from "@/lib/utils";

export const Empty = ({ graph }: { graph?: FederatedGraph }) => {
  let label = "team=A";
  if (graph?.labelMatchers && graph.labelMatchers.length > 0) {
    label = graph.labelMatchers[0].split(",")[0];
  }
  return (
    <EmptyState
      icon={<CommandLineIcon />}
      title="Create subgraph using CLI"
      description={
        <>
          No subgraphs found. Use the CLI tool to create one.{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={docsBaseURL + "/cli/subgraphs/create"}
            className="text-primary"
          >
            Learn more.
          </a>
        </>
      }
      actions={
        <CLISteps
          steps={[
            {
              description:
                "Publish a subgraph. If the subgraph does not exist, it will be created.",
              command: `npx wgc subgraph publish users --schema users.graphql --label ${label} --routing-url http://localhost:4003/graphql`,
            },
          ]}
        />
      }
    />
  );
};

const InviteUsers = ({ subgraphName }: { subgraphName: string }) => {
  const [open, setOpen] = useState(false);
  const user = useUser();
  const isAdmin = user?.currentOrganization.roles.includes("admin");
  const { data } = useQuery(getOrganizationMembers.useQuery());

  const { data: subgraphMembersData, refetch: refetchSubgraphMembers } =
    useQuery(
      getSubgraphMembers.useQuery({
        subgraphName,
      }),
    );

  const { mutate: addMember, isPending: addingMember } = useMutation(
    addSubgraphMember.useMutation(),
  );
  const { mutate: removeMember, isPending: removingMember } = useMutation(
    removeSubgraphMember.useMutation(),
  );

  const { toast } = useToast();

  const sendToast = (description: string) => {
    toast({ description, duration: 3000 });
  };

  const subgraphMembers = subgraphMembersData?.members || [];

  const [inviteOptions, setInviteOptions] = useState<string[]>([]);
  const [inviteeEmail, setInviteeEmail] = useState("");

  useEffect(() => {
    if (!data || !subgraphMembersData) return;
    const orgMemberEmails = data.members.map((m) => m.email);
    const subgraphMemberEmails = subgraphMembersData.members.map(
      (m) => m.email,
    );

    const options = orgMemberEmails.filter(
      (x) => !subgraphMemberEmails.includes(x),
    );
    setInviteOptions(options);
    setInviteeEmail(options?.[0] || "");
  }, [data, subgraphMembersData]);

  const onSubmit = () => {
    if (inviteeEmail === "") return;
    addMember(
      { userEmail: inviteeEmail, subgraphName },
      {
        onSuccess: (d) => {
          sendToast(d.response?.details || "Added member successfully.");
          setOpen(false);
          // refetchSubgraphMembers();
        },
        onError: (error) => {
          sendToast("Could not add the member. Please try again.");
        },
      },
    );
  };

  return (
    <div className="flex items-center justify-end px-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          disabled={!isAdmin}
          className={cn({ "!cursor-not-allowed": !isAdmin })}
        >
          <Button variant="ghost" size="icon-sm" disabled={!isAdmin}>
            <IoPersonAdd className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Invite users to <span className="italic">{subgraphName}</span>{" "}
              subgraph
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-y-6">
            {inviteOptions.length > 0 ? (
              <form className="flex gap-x-4" onSubmit={onSubmit}>
                <div className="flex-1">
                  <Select
                    value={inviteeEmail}
                    onValueChange={(value) => setInviteeEmail(value)}
                  >
                    <SelectTrigger
                      value={inviteeEmail}
                      className="w-[200px] lg:w-full"
                    >
                      <SelectValue aria-label={inviteeEmail}>
                        {inviteeEmail}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {inviteOptions.map((option) => {
                        return (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="submit"
                  disabled={inviteOptions.length === 0}
                  variant="default"
                  isLoading={addingMember}
                >
                  Invite
                </Button>
              </form>
            ) : (
              <span className="text-sm text-muted-foreground">
                All the organization members are a part of this subgraph
              </span>
            )}
            {subgraphMembers.length > 0 && (
              <Table>
                <TableBody>
                  {subgraphMembers.map(
                    ({ email, userId, subgraphMemberId }) => {
                      return (
                        <TableRow key={userId} className="h-12 py-1">
                          <TableCell className="px-4 font-medium">
                            {email}
                          </TableCell>
                          <TableCell className="flex h-12 items-center justify-end px-4">
                            <Button
                              variant="ghost"
                              className="text-primary"
                              onClick={() => {
                                removeMember(
                                  { subgraphMemberId, subgraphName },
                                  {
                                    onSuccess: (d) => {
                                      sendToast(
                                        d.response?.details ||
                                          "Removed member successfully.",
                                      );
                                      refetchSubgraphMembers();
                                    },
                                    onError: (error) => {
                                      sendToast(
                                        "Could not remove the member. Please try again.",
                                      );
                                    },
                                  },
                                );
                              }}
                            >
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    },
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const SubgraphsTable = ({
  graph,
  subgraphs,
}: {
  graph?: FederatedGraph;
  subgraphs: Subgraph[];
}) => {
  const user = useUser();

  if (!subgraphs || subgraphs.length === 0) return <Empty graph={graph} />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="px-4">Name</TableHead>
          <TableHead className="w-4/12 px-4">Url</TableHead>
          <TableHead className="w-4/12 px-4">Labels</TableHead>
          <TableHead className="w-2/12 px-4 text-right">
            Last Published
          </TableHead>
          {user?.currentOrganization.isRBACEnabled && (
            <TableHead className="w-1/12"></TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {subgraphs.map(({ name, routingURL, lastUpdatedAt, labels }) => {
          return (
            <TableRow
              key={name}
              className="group py-1 even:bg-secondary/20 hover:bg-secondary/40"
            >
              <TableCell className="px-4 font-medium">{name}</TableCell>
              <TableCell className="px-4 text-muted-foreground hover:text-current">
                <Link target="_blank" rel="noreferrer" href={routingURL}>
                  {routingURL}
                </Link>
              </TableCell>
              <TableCell className="px-4">
                <div className="flex space-x-2">
                  {labels.map(({ key, value }) => {
                    return (
                      <Badge variant="secondary" key={key + value}>
                        {key}={value}
                      </Badge>
                    );
                  })}
                </div>
              </TableCell>
              <TableCell className="px-4 text-right text-muted-foreground">
                {lastUpdatedAt
                  ? formatDistanceToNow(new Date(lastUpdatedAt), {
                      addSuffix: true,
                    })
                  : "Never"}
              </TableCell>
              {user?.currentOrganization.isRBACEnabled && (
                <TableCell>
                  <InviteUsers subgraphName={name} />
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

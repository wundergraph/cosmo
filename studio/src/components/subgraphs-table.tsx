import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useFeature } from "@/hooks/use-feature";
import { useUser } from "@/hooks/use-user";
import { docsBaseURL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ChartBarIcon, CommandLineIcon } from "@heroicons/react/24/outline";
import { InfoCircledIcon } from "@radix-ui/react-icons";
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
  SubgraphMember,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { Dispatch, SetStateAction, useEffect, useState } from "react";
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
  TableWrapper,
} from "./ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useToast } from "./ui/use-toast";

export const Empty = ({ graph }: { graph?: FederatedGraph }) => {
  const router = useRouter();

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
              command: `npx wgc subgraph publish users --namespace ${router.query.namespace} --schema users.graphql --label ${label} --routing-url http://localhost:4003/graphql`,
            },
          ]}
        />
      }
    />
  );
};

export const AddSubgraphUsersContent = ({
  subgraphName,
  namespace,
  setOpen,
  inviteOptions,
  subgraphMembers,
  creatorUserId,
  refetchSubgraphMembers,
}: {
  subgraphName: string;
  namespace: string;
  setOpen?: Dispatch<SetStateAction<boolean>>;
  inviteOptions: string[];
  subgraphMembers: SubgraphMember[];
  creatorUserId: string | undefined;
  refetchSubgraphMembers: () => void;
}) => {
  const user = useUser();
  const rbac = useFeature("rbac");
  const isAdmin = user?.currentOrganization.roles.includes("admin");
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

  const [inviteeEmail, setInviteeEmail] = useState(
    inviteOptions?.[0] || "Select the member",
  );

  const onSubmit = () => {
    if (inviteeEmail === "Select the member" || inviteeEmail === "") return;
    addMember(
      { userEmail: inviteeEmail, subgraphName, namespace },
      {
        onSuccess: (d) => {
          sendToast(d.response?.details || "Added member successfully.");
          setOpen?.(false);
          refetchSubgraphMembers();
        },
        onError: (error) => {
          sendToast("Could not add the member. Please try again.");
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-y-6">
      {!rbac?.enabled ? (
        <Alert>
          <InfoCircledIcon className="h-5 w-5" />
          <AlertTitle>Attention!</AlertTitle>
          <AlertDescription>
            Enable RBAC in the settings to add subgraph members.
          </AlertDescription>
        </Alert>
      ) : (
        inviteOptions.length === 0 && (
          <Alert>
            <InfoCircledIcon className="h-4 w-4" />
            <AlertTitle>Heads up!</AlertTitle>
            <AlertDescription>
              All organization members are already a part of this subgraph.
            </AlertDescription>
          </Alert>
        )
      )}
      <form
        className={cn(
          "flex gap-x-4",
          rbac?.enabled && inviteOptions.length === 0 && "hidden",
        )}
        onSubmit={onSubmit}
      >
        <div className="flex-1">
          <Select
            value={inviteeEmail}
            onValueChange={(value) => setInviteeEmail(value)}
            disabled={
              inviteOptions.length === 0 ||
              !rbac?.enabled ||
              (!isAdmin && !(creatorUserId && creatorUserId === user?.id))
            }
          >
            <SelectTrigger
              value={inviteeEmail}
              className="w-[200px] lg:w-full"
              onClick={(e) => e.stopPropagation()}
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
          disabled={
            inviteOptions.length === 0 ||
            inviteeEmail === "Select the member" ||
            !rbac?.enabled ||
            (!isAdmin && !(creatorUserId && creatorUserId === user?.id))
          }
          variant="default"
          isLoading={addingMember}
        >
          Add
        </Button>
      </form>
      {subgraphMembers.length > 0 && (
        <TableWrapper>
          <Table>
            <TableBody>
              {subgraphMembers.map(({ email, userId, subgraphMemberId }) => {
                return (
                  <TableRow key={userId} className="h-12 py-1">
                    <TableCell className="px-4 font-medium">{email}</TableCell>
                    {(isAdmin ||
                      (creatorUserId && creatorUserId === user?.id)) &&
                      rbac?.enabled && (
                        <TableCell className="flex h-12 items-center justify-end px-4">
                          <Button
                            variant="ghost"
                            className="text-primary"
                            isLoading={removingMember}
                            onClick={() => {
                              removeMember(
                                { subgraphMemberId, subgraphName, namespace },
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
                      )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableWrapper>
      )}
    </div>
  );
};

const AddSubgraphUsers = ({
  subgraphName,
  namespace,
  creatorUserId,
}: {
  subgraphName: string;
  namespace: string;
  creatorUserId?: string;
}) => {
  const [open, setOpen] = useState(false);
  const user = useUser();
  const isAdmin = user?.currentOrganization.roles.includes("admin");
  const { data } = useQuery(getOrganizationMembers.useQuery());

  const { data: subgraphMembersData, refetch } = useQuery({
    ...getSubgraphMembers.useQuery({
      subgraphName,
      namespace,
    }),
    enabled: open,
  });

  const [inviteOptions, setInviteOptions] = useState<string[]>([]);

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
  }, [data, subgraphMembersData]);

  return (
    <div className="flex items-center justify-end px-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          asChild
          disabled={!isAdmin && !(creatorUserId && creatorUserId === user?.id)}
        >
          <div>
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={
                    !isAdmin && !(creatorUserId && creatorUserId === user?.id)
                  }
                >
                  <IoPersonAdd className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isAdmin || (creatorUserId && creatorUserId === user?.id)
                  ? "Add users"
                  : "Only admins or the creator of the subgraph can add users."}
              </TooltipContent>
            </Tooltip>
          </div>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add users to <span className="italic">{subgraphName}</span>{" "}
              subgraph
            </DialogTitle>
          </DialogHeader>
          <AddSubgraphUsersContent
            subgraphName={subgraphName}
            namespace={namespace}
            setOpen={setOpen}
            inviteOptions={inviteOptions}
            subgraphMembers={subgraphMembersData?.members || []}
            refetchSubgraphMembers={refetch}
            creatorUserId={creatorUserId}
          />
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
  const rbac = useFeature("rbac");
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug;

  if (!subgraphs || subgraphs.length === 0) return <Empty graph={graph} />;

  return (
    <TableWrapper>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-4">Name</TableHead>
            <TableHead className="w-4/12 px-4">Url</TableHead>
            <TableHead className="w-4/12 px-4">Labels</TableHead>
            <TableHead className="w-2/12 px-4">Last Published</TableHead>
            {rbac?.enabled && <TableHead className="w-1/12"></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {subgraphs.map(
            ({
              name,
              routingURL,
              lastUpdatedAt,
              labels,
              creatorUserId,
              namespace,
            }) => {
              const path = `/${organizationSlug}/${namespace}/subgraph/${name}`;
              let analyticsPath = `${path}/analytics`;
              if (router.asPath.split("/")[3] === "graph") {
                const query = [
                  {
                    id: "federatedGraphId",
                    value: [
                      JSON.stringify({
                        label: graph?.name,
                        operator: 0,
                        value: graph?.id,
                      }),
                    ],
                  },
                ];
                analyticsPath += `?filterState=${encodeURIComponent(
                  JSON.stringify(query),
                )}`;
              }
              return (
                <TableRow
                  key={name}
                  className=" group cursor-pointer py-1 hover:bg-secondary/30"
                  onClick={() => router.push(path)}
                >
                  <TableCell className="px-4 font-medium">{name}</TableCell>
                  <TableCell className="px-4 text-muted-foreground">
                    {routingURL}
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="flex space-x-2">
                      {labels.length === 0 && (
                        <Tooltip delayDuration={200}>
                          <TooltipTrigger>-</TooltipTrigger>
                          <TooltipContent>
                            Only graphs with empty label matchers will compose
                            this subgraph
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {labels.map(({ key, value }) => {
                        return (
                          <Badge variant="secondary" key={key + value}>
                            {key}={value}
                          </Badge>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 text-muted-foreground">
                    {lastUpdatedAt
                      ? formatDistanceToNow(new Date(lastUpdatedAt), {
                          addSuffix: true,
                        })
                      : "Never"}
                  </TableCell>
                  <TableCell className="flex justify-end gap-2">
                    {rbac?.enabled && (
                      <AddSubgraphUsers
                        subgraphName={name}
                        namespace={namespace}
                        creatorUserId={creatorUserId}
                      />
                    )}
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        <Button
                          asChild
                          variant="ghost"
                          size="icon-sm"
                          className="table-action"
                        >
                          <Link
                            onClick={(e) => e.stopPropagation()}
                            href={analyticsPath}
                          >
                            <ChartBarIcon className="h-4 w-4" />
                          </Link>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Analytics</TooltipContent>
                    </Tooltip>
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="table-action"
                    >
                      <Link href={path}>View</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            },
          )}
        </TableBody>
      </Table>
    </TableWrapper>
  );
};

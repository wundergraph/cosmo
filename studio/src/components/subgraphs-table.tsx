import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useFeature } from "@/hooks/use-feature";
import { useUser } from "@/hooks/use-user";
import { docsBaseURL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useQuery } from "@connectrpc/connect-query";
import { ChartBarIcon, CommandLineIcon } from "@heroicons/react/24/outline";
import {
  Component1Icon,
  Component2Icon,
  InfoCircledIcon,
} from "@radix-ui/react-icons";
import {
  getOrganizationMembers,
  getSubgraphMembers,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  FederatedGraph,
  Subgraph,
  SubgraphMember,
  SubgraphType,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
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
import { Pagination } from "./ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "./ui/table";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useWorkspace } from "@/hooks/use-workspace";

export const Empty = ({
  graph,
  tab,
}: {
  graph?: FederatedGraph;
  tab: "subgraphs" | "featureSubgraphs";
}) => {
  const { namespace: { name: namespace } } = useWorkspace();

  let label = "team=A";
  if (graph?.labelMatchers && graph.labelMatchers.length > 0) {
    label = graph.labelMatchers[0].split(",")[0];
  }

  if (tab === "featureSubgraphs") {
    return (
      <EmptyState
        icon={<CommandLineIcon />}
        title="Create a feature subgraph using CLI"
        description={
          <>
            No feature subgraphs found. Use the CLI tool to create one.{" "}
            <a
              target="_blank"
              rel="noreferrer"
              href={
                docsBaseURL + "/cli/feature-subgraph/create-feature-subgraph"
              }
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
                  "Create a feature subgraph using the below command.",
                command: `npx wgc feature-subgraph create <feature-subgraph-name> --namespace ${namespace} -r <routing-url> --subgraph <base-subgraph-name>`,
              },
              {
                description:
                  "Update your feature subgraphs of this feature flag.",
                command: `npx wgc feature-flag update <feature-flag-name> --namespace ${namespace} --feature-subgraphs <featureSubgraphs...>`,
              },
            ]}
          />
        }
      />
    );
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
            href={docsBaseURL + "/cli/subgraph/create"}
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
              command: `npx wgc subgraph publish users --namespace ${namespace} --schema users.graphql --label ${label} --routing-url http://localhost:4003/graphql`,
            },
          ]}
        />
      }
    />
  );
};

export const AddSubgraphUsersContent = ({
  subgraphMembers,
}: {
  subgraphMembers: SubgraphMember[];
}) => {
  return (
    <div className="flex flex-col gap-y-6">
      <Alert>
        <InfoCircledIcon className="h-5 w-5" />
        <AlertTitle>Attention!</AlertTitle>
        <AlertDescription>
          Adding members directly to the subgraph have been deprecated. Use the{" "}
          groups instead.
        </AlertDescription>
      </Alert>
      {subgraphMembers.length > 0 && (
        <TableWrapper>
          <Table>
            <TableBody>
              {subgraphMembers.map(({ email, userId, subgraphMemberId }) => {
                return (
                  <TableRow key={userId} className="h-12 py-1">
                    <TableCell className="px-4 font-medium">{email}</TableCell>
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
  const isAdmin = useIsAdmin();
  const { data } = useQuery(getOrganizationMembers);

  const { data: subgraphMembersData, refetch } = useQuery(
    getSubgraphMembers,
    {
      subgraphName,
      namespace,
    },
    {
      enabled: open,
    },
  );

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
            subgraphMembers={subgraphMembersData?.members || []}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const SubgraphPageTabs = () => {
  const router = useRouter();
  const tab = router.query.tab as string;

  return (
    <Tabs value={tab ?? "subgraphs"} className="flex min-h-0 flex-col">
      <div className="flex flex-row">
        <TabsList>
          <TabsTrigger
            value="subgraphs"
            className="flex items-center gap-x-2"
            asChild
          >
            <Link
              href={{ query: { ...router.query, tab: "subgraphs", page: 1 } }}
            >
              <Component2Icon className="h-4 w-4" />
              Subgraphs
            </Link>
          </TabsTrigger>
          <TabsTrigger
            value="featureSubgraphs"
            className="flex items-center gap-x-2"
            asChild
          >
            <Link
              href={{
                query: { ...router.query, tab: "featureSubgraphs", page: 1 },
              }}
            >
              <Component1Icon className="h-4 w-4" />
              Feature Subgraphs
            </Link>
          </TabsTrigger>
        </TabsList>
      </div>
    </Tabs>
  );
};

export const SubgraphsTable = ({
  graph,
  subgraphs,
  totalCount,
  tab,
}: {
  graph?: FederatedGraph;
  subgraphs: Subgraph[];
  totalCount: number;
  tab: "subgraphs" | "featureSubgraphs";
}) => {
  const user = useUser();
  const rbac = useFeature("rbac");
  const router = useRouter();
  const organizationSlug = user?.currentOrganization.slug;

  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;
  const limit = Number.parseInt((router.query.pageSize as string) || "10");
  const noOfPages = Math.ceil(totalCount / limit);

  if (!subgraphs || subgraphs.length === 0)
    return <Empty graph={graph} tab={tab} />;

  return (
    <>
      <TableWrapper className="mb-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">ID</TableHead>
              <TableHead className="px-4">Name</TableHead>
              <TableHead className="w-4/12 px-4">Url</TableHead>
              <TableHead
                className={cn("px-4", {
                  "w-3/12": tab === "featureSubgraphs",
                  "w-4/12": tab !== "featureSubgraphs",
                })}
              >
                {tab === "featureSubgraphs" ? "Base Subgraph Name" : "Labels"}
              </TableHead>
              <TableHead className="w-2/12 px-4">Type</TableHead>
              <TableHead className="w-2/12 px-4">Last Published</TableHead>
              {rbac?.enabled && <TableHead className="w-1/12"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {subgraphs.map(
              ({
                id,
                name,
                routingURL,
                lastUpdatedAt,
                labels,
                namespace,
                baseSubgraphName,
                type,
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
                    <TableCell className="px-4 font-medium">
                      <Tooltip delayDuration={200}>
                        <TooltipTrigger>{id.slice(0, 8)}</TooltipTrigger>
                        <TooltipContent>{id}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="px-4 font-medium">{name}</TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {routingURL || "-"}
                    </TableCell>
                    <TableCell className="px-4">
                      {tab !== "featureSubgraphs" ? (
                        <div className="flex flex-wrap gap-2">
                          {labels.length === 0 && (
                            <Tooltip delayDuration={200}>
                              <TooltipTrigger>-</TooltipTrigger>
                              <TooltipContent>
                                Only graphs with empty label matchers will
                                compose this subgraph
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
                      ) : (
                        <>{baseSubgraphName}</>
                      )}
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground ">
                      {type === SubgraphType.GRPC_PLUGIN ? (
                        <Badge variant="outline">GRPC_Plugin</Badge>
                      ) : type === SubgraphType.GRPC_SERVICE ? (
                        <Badge variant="outline">GRPC_Service</Badge>
                      ) : (
                        <Badge variant="outline">Standard</Badge>
                      )}
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {lastUpdatedAt
                        ? formatDistanceToNow(new Date(lastUpdatedAt), {
                            addSuffix: true,
                          })
                        : "Never"}
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
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
      <Pagination limit={limit} noOfPages={noOfPages} pageNumber={pageNumber} />
    </>
  );
};

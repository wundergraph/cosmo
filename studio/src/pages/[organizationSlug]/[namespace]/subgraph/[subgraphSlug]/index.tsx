import { EmptyState } from "@/components/empty-state";
import {
  SubgraphPageLayout,
  getSubgraphLayout,
} from "@/components/layout/subgraph-layout";
import { AddSubgraphUsersContent } from "@/components/subgraphs-table";
import { Badge } from "@/components/ui/badge";
import { CLI } from "@/components/ui/cli";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSubgraph } from "@/hooks/use-subgraph";
import { docsBaseURL } from "@/lib/constants";
import { formatDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { useQuery } from "@connectrpc/connect-query";
import {
  CommandLineIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";
import {
  getOrganizationMembers,
  getSubgraphMembers,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { SubgraphType } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

export const Empty = ({ subgraphName }: { subgraphName: string }) => {
  const router = useRouter();

  return (
    <EmptyState
      icon={<CommandLineIcon />}
      title="Add subgraph README using CLI"
      description={
        <>
          No subgraph readme found. Use the CLI tool to add the readme.{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={docsBaseURL + "/studio/graph-documentation"}
            className="text-primary"
          >
            Learn more.
          </a>
        </>
      }
      actions={
        <CLI
          command={`npx wgc subgraph update ${subgraphName} --namespace ${router.query.namespace} --readme <path-to-readme>`}
        />
      }
    />
  );
};

const SubgraphOverviewPage = () => {
  const router = useRouter();
  const graph = useSubgraph();
  const { data } = useQuery(getOrganizationMembers);

  const { data: subgraphMembersData, refetch } = useQuery(
    getSubgraphMembers,
    {
      subgraphName: graph?.subgraph?.name,
      namespace: graph?.subgraph?.namespace,
    },
    {
      enabled: !!graph,
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

  if (!graph || !graph.subgraph) return null;

  const { subgraph, linkedSubgraph } = graph;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 overflow-x-auto border-b scrollbar-thin">
        <dl className="flex w-full flex-col flex-wrap gap-x-8 gap-y-4 px-4 py-4 text-sm xl:flex-row">
          <div className="flex-start flex min-w-[240px] flex-col gap-2">
            <dt className="text-sm text-muted-foreground">ID</dt>
            <dd className="text-sm">{subgraph.id}</dd>
          </div>
          {subgraph.routingURL && (
            <div className="flex-start flex min-w-[220px] flex-col gap-px">
              <dt className="text-sm text-muted-foreground">Routing URL</dt>
              <dd className="flex items-center text-sm">
                <Tooltip delayDuration={100}>
                  <TooltipTrigger className="w-full truncate text-start text-sm">
                    {subgraph.routingURL}
                  </TooltipTrigger>
                  <TooltipContent>{subgraph.routingURL}</TooltipContent>
                </Tooltip>
                <CopyButton tooltip="Copy URL" value={subgraph.routingURL} />
              </dd>
            </div>
          )}

          <div className="flex-start flex min-w-[150px] flex-col gap-2">
            <dt className="text-sm text-muted-foreground">Labels</dt>
            <dd className="flex gap-x-2">
              <div
                className={cn("flex flex-shrink-0 gap-x-2", {
                  "ml-4": subgraph.labels.length === 0,
                })}
              >
                {subgraph.labels.length > 0
                  ? subgraph.labels.map(({ key, value }) => {
                      return (
                        <Badge variant="secondary" key={key + value}>
                          {key}={value}
                        </Badge>
                      );
                    })
                  : "-"}
              </div>
            </dd>
          </div>

          <div className="flex-start flex min-w-[150px] flex-col gap-2">
            <dt className="text-sm text-muted-foreground">Type</dt>
            <dd className="flex gap-x-2">
              <div className="flex flex-shrink-0 gap-x-2">
                {subgraph.type === SubgraphType.GRPC_PLUGIN ? (
                  <Badge variant="outline">GRPC_Plugin</Badge>
                ) : subgraph.type === SubgraphType.GRPC_SERVICE ? (
                  <Badge variant="outline">GRPC_Service</Badge>
                ) : (
                  <Badge variant="outline">Standard</Badge>
                )}
              </div>
            </dd>
          </div>

          {linkedSubgraph && (
            <div className="flex-start flex min-w-[150px] flex-col gap-2">
              <dt className="text-sm text-muted-foreground">Linked Subgraph</dt>
              <dd className="flex gap-x-2">
                <Link
                  href={`/${router.query.organizationSlug}/${linkedSubgraph.namespace}/subgraph/${linkedSubgraph.name}`}
                  className="flex items-center gap-1 hover:underline"
                >
                  {`${linkedSubgraph.namespace}/${linkedSubgraph.name}`}
                  <ArrowTopRightOnSquareIcon className="h-[14px] w-[14px]" />
                </Link>
              </dd>
            </div>
          )}

          {subgraph.type === SubgraphType.GRPC_PLUGIN &&
            subgraph.pluginData && (
              <>
                <div className="flex-start flex min-w-[60px] flex-col gap-2">
                  <dt className="text-sm text-muted-foreground">Version</dt>
                  <dd className="flex gap-x-2">
                    <p className="text-sm">{subgraph.pluginData.version}</p>
                  </dd>
                </div>
                <div className="flex-start flex min-w-[100px] flex-col gap-2">
                  <dt className="text-sm text-muted-foreground">Platforms</dt>
                  <dd className="flex gap-x-1">
                    {subgraph.pluginData.platforms.map((platform) => (
                      <Badge variant="secondary" key={platform}>
                        {platform}
                      </Badge>
                    ))}
                  </dd>
                </div>
              </>
            )}

          <div className="flex-start flex flex-col gap-2 ">
            <dt className="text-sm text-muted-foreground">Last Published</dt>
            <dd className="whitespace-nowrap text-sm">
              {subgraph.lastUpdatedAt ? (
                <Tooltip>
                  <TooltipTrigger>
                    {formatDistanceToNow(new Date(subgraph.lastUpdatedAt), {
                      addSuffix: true,
                    })}
                  </TooltipTrigger>
                  <TooltipContent>
                    {formatDateTime(new Date(subgraph.lastUpdatedAt))}
                  </TooltipContent>
                </Tooltip>
              ) : (
                "Never"
              )}
            </dd>
          </div>

          {subgraph.subscriptionUrl && (
            <>
              <div className="flex-start flex min-w-[150px] flex-col gap-2">
                <dt className="text-sm text-muted-foreground">
                  Subscription URL
                </dt>
                <dd>
                  <p
                    className={cn("text-sm", {
                      "ml-12": subgraph.subscriptionUrl === "",
                    })}
                  >
                    {subgraph.subscriptionUrl !== "" ? (
                      <Tooltip delayDuration={100}>
                        <TooltipTrigger className="w-full truncate text-start text-sm">
                          {subgraph.subscriptionUrl}
                        </TooltipTrigger>
                        <TooltipContent>
                          {subgraph.subscriptionUrl}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      "-"
                    )}
                  </p>
                </dd>
              </div>
              <div className="flex-start flex min-w-[200px] flex-col gap-2">
                <dt className="text-sm text-muted-foreground">
                  Subscription Protocol
                </dt>
                <dd>
                  <p
                    className={cn("text-sm", {
                      "ml-16": subgraph.subscriptionUrl === "",
                    })}
                  >
                    {subgraph.subscriptionUrl !== ""
                      ? subgraph.subscriptionProtocol
                      : "-"}
                  </p>
                </dd>
              </div>
              <div className="flex-start flex min-w-[250px] flex-col gap-2">
                <dt className="text-sm text-muted-foreground">
                  Subscription WS Subprotocol
                </dt>
                <dd>
                  <p
                    className={cn("text-sm", {
                      "ml-[90px]": subgraph.subscriptionUrl === "",
                    })}
                  >
                    {subgraph.subscriptionUrl !== ""
                      ? subgraph.websocketSubprotocol
                      : "-"}
                  </p>
                </dd>
              </div>
            </>
          )}
        </dl>
      </div>
      <div className="flex min-h-0 flex-1 grid-cols-3 flex-col gap-4 p-4 lg:grid lg:px-6">
        <div className="col-span-2 flex flex-col rounded-md border">
          <h3 className="border-b px-4 py-2 font-semibold tracking-tight">
            README
          </h3>
          {subgraph.readme ? (
            <div className="flex h-full w-full px-6 py-4">
              <div className="scrollbar-custom prose-pre:scrollbar-custom prose mx-auto h-full w-full max-w-none overflow-auto overflow-y-auto dark:prose-invert prose-code:bg-secondary prose-pre:!bg-secondary/50">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                >
                  {subgraph.readme}
                </Markdown>
              </div>
            </div>
          ) : (
            <Empty subgraphName={subgraph.name} />
          )}
        </div>
        <div className="scrollbar-custom col-span-1 flex flex-col rounded-md border">
          <h3 className="border-b px-4 py-2 font-semibold">Subgraph Members</h3>
          <div className="px-4 py-4">
            <AddSubgraphUsersContent
              subgraphMembers={subgraphMembersData?.members || []}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

SubgraphOverviewPage.getLayout = (page: React.ReactNode) => {
  return getSubgraphLayout(
    <SubgraphPageLayout
      title="Subgraph Overview"
      subtitle="An overview of your subgraph"
      noPadding
    >
      {page}
    </SubgraphPageLayout>,
    {
      title: "Subgraph Overview",
    },
  );
};

export default SubgraphOverviewPage;

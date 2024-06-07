import { EmptyState } from "@/components/empty-state";
import {
  SubgraphPageLayout,
  getSubgraphLayout,
} from "@/components/layout/subgraph-layout";
import { AddSubgraphUsersContent } from "@/components/subgraphs-table";
import { Badge } from "@/components/ui/badge";
import { CLI } from "@/components/ui/cli";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSubgraph } from "@/hooks/use-subgraph";
import { docsBaseURL } from "@/lib/constants";
import { formatDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@connectrpc/connect-query";
import {
  getOrganizationMembers,
  getSubgraphMembers,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { formatDistanceToNow } from "date-fns";
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

  const { subgraph } = graph;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 overflow-x-auto border-b scrollbar-thin">
        <dl className="flex w-full flex-row gap-y-2 space-x-4 px-4 py-4 text-sm lg:px-8">
          <div className="flex-start flex max-w-[300px] flex-1 flex-col gap-1">
            <dt className="text-sm text-muted-foreground">Routing URL</dt>
            <dd>
              <Tooltip delayDuration={100}>
                <TooltipTrigger className="w-full truncate text-start text-sm">
                  {subgraph.routingURL}
                </TooltipTrigger>
                <TooltipContent>{subgraph.routingURL}</TooltipContent>
              </Tooltip>
            </dd>
          </div>

          <div className="flex-start flex max-w-[300px] flex-1 flex-col gap-2 ">
            <dt className="text-sm text-muted-foreground">Labels</dt>
            <dd className="flex gap-x-2">
              <div className="flex space-x-2">
                {subgraph.labels.map(({ key, value }) => {
                  return (
                    <Badge variant="secondary" key={key + value}>
                      {key}={value}
                    </Badge>
                  );
                })}
              </div>
            </dd>
          </div>

          <div
            className={cn("flex-start flex flex-1 flex-col gap-2", {
              "max-w-[250px]": subgraph.subscriptionUrl === "",
              "max-w-[300px]": subgraph.subscriptionUrl !== "",
            })}
          >
            <dt className="text-sm text-muted-foreground">Subscription URL</dt>
            <dd>
              <p
                className={cn("text-sm", {
                  "ml-12": subgraph.subscriptionUrl === "",
                })}
              >
                {subgraph.subscriptionUrl !== ""
                  ? subgraph.subscriptionUrl
                  : "-"}
              </p>
            </dd>
          </div>

          <div className="flex-start flex max-w-[200px] flex-1 flex-col gap-2 ">
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
              subgraphName={subgraph.name}
              namespace={subgraph.namespace}
              inviteOptions={inviteOptions}
              subgraphMembers={subgraphMembersData?.members || []}
              refetchSubgraphMembers={refetch}
              creatorUserId={subgraph.creatorUserId}
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

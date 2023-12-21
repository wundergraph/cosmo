import { CodeViewer, CodeViewerActions } from "@/components/code-viewer";
import { EmptyState } from "@/components/empty-state";
import {
  SubgraphPageLayout,
  getSubgraphLayout,
} from "@/components/layout/subgraph-layout";
import { Button } from "@/components/ui/button";
import { CLI } from "@/components/ui/cli";
import { Loader } from "@/components/ui/loader";
import { Toolbar } from "@/components/ui/toolbar";
import { useSubgraph } from "@/hooks/use-subgraph";
import { docsBaseURL } from "@/lib/constants";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getLatestSubgraphSDLByName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";

const SubgraphSchemaPage: NextPageWithLayout = () => {
  const graph = useSubgraph();
  const { data, error, refetch, isLoading } = useQuery({
    ...getLatestSubgraphSDLByName.useQuery({
      name: graph?.subgraph?.name,
    }),
    enabled: !!graph && !!graph.subgraph,
  });

  if (isLoading) {
    return <Loader fullscreen />;
  }

  if (!graph || !graph.subgraph) return null;

  if (error || !data || data.response?.code !== EnumStatusCode.OK) {
    return (
      <SubgraphPageLayout
        title="Schema"
        subtitle="View the SDL of your subgraph"
        noPadding
      >
        <EmptyState
          icon={<ExclamationTriangleIcon className="h-10 w-10" />}
          title="Could not retrieve the sdl of the subgraph"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </SubgraphPageLayout>
    );
  }

  const { routingURL, name } = graph.subgraph;

  return (
    <SubgraphPageLayout
      title="Schema"
      subtitle="View the SDL of your subgraph"
      noPadding
      toolbar={
        data.sdl !== "" && (
          <Toolbar>
            <div className="flex w-full flex-col items-end justify-between gap-y-3 md:flex-row">
              <div>
                <p className="flex text-sm text-muted-foreground">
                  The below schema is the latest published schema of this
                  subgraph.
                </p>
              </div>
              <CodeViewerActions
                className="md:ml-0"
                code={data.sdl ?? ""}
                subgraphName={name}
              />
            </div>
          </Toolbar>
        )
      }
    >
      {data.sdl === "" ? (
        <EmptyState
          icon={<CommandLineIcon />}
          title="Publish schema using the CLI"
          description={
            <>
              No schema found. Use the CLI tool to publish.{" "}
              <a
                target="_blank"
                rel="noreferrer"
                href={docsBaseURL + "/cli/subgraphs/publish"}
                className="text-primary"
              >
                Learn more.
              </a>
            </>
          }
          actions={
            <CLI
              command={`npx wgc subgraph publish ${graph.subgraph.name} --schema ${graph.subgraph.name}.graphql`}
            />
          }
        />
      ) : (
        <div className="flex h-full min-h-[65vh] flex-col-reverse md:flex-col">
          <div
            id="schema-container"
            className="scrollbar-custom flex-1 overflow-auto"
          >
            <CodeViewer className="h-0 w-0" code={data.sdl ?? ""} />
          </div>
          <div className="flex w-full flex-col items-center justify-end gap-x-8 gap-y-1 border-t bg-card p-2 text-xs md:flex-row">
            <p className="flex items-center gap-x-1">
              Routing URL :
              <Link
                className="hover:underline"
                target="_blank"
                rel="noreferrer"
                href={routingURL}
              >
                {routingURL}
              </Link>
            </p>
            {graph.subgraph.lastUpdatedAt && (
              <p className="flex items-center gap-x-1">
                Last updated :
                <span>
                  {formatDateTime(new Date(graph.subgraph.lastUpdatedAt))}
                </span>
              </p>
            )}
          </div>
        </div>
      )}
    </SubgraphPageLayout>
  );
};

SubgraphSchemaPage.getLayout = (page: React.ReactNode) => {
  return getSubgraphLayout(page, {
    title: "Schema",
  });
};

export default SubgraphSchemaPage;

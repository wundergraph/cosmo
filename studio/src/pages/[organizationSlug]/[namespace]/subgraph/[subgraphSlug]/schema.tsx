import { EmptyState } from "@/components/empty-state";
import {
  SubgraphPageLayout,
  getSubgraphLayout,
} from "@/components/layout/subgraph-layout";
import { SDLViewer, SDLViewerActions } from "@/components/schema/sdl-viewer";
import { Button } from "@/components/ui/button";
import { CLI } from "@/components/ui/cli";
import { Loader } from "@/components/ui/loader";
import { Toolbar } from "@/components/ui/toolbar";
import { useSubgraph } from "@/hooks/use-subgraph";
import { docsBaseURL } from "@/lib/constants";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import {
  CommandLineIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getLatestSubgraphSDL } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";

const SubgraphSchemaPage: NextPageWithLayout = () => {
  const graph = useSubgraph();
  const { data, error, refetch, isLoading } = useQuery(
    getLatestSubgraphSDL,
    {
      name: graph?.subgraph?.name,
      namespace: graph?.subgraph?.namespace,
    },
    {
      enabled: !!graph && !!graph.subgraph,
    },
  );

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
          icon={<ExclamationTriangleIcon />}
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
        <Toolbar className="w-auto flex-nowrap py-0">
          <div className="mr-auto" />
          <SDLViewerActions
            sdl={data?.sdl ?? ""}
            size="icon-sm"
            targetName={name}
          />
        </Toolbar>
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
              command={`npx wgc subgraph publish ${graph.subgraph.name} --namespace ${graph.subgraph.namespace} --schema ${graph.subgraph.name}.graphql`}
            />
          }
        />
      ) : (
        <div className="flex h-full flex-col-reverse md:flex-col">
          <SDLViewer sdl={data.sdl ?? ""} />
          <div className="flex w-full flex-col items-center gap-x-8 gap-y-1 border-t bg-card p-2 text-xs lg:flex-row">
            <p className="text-center">
              Displaying the latest published schema of this subgraph
            </p>
            <p className="flex items-center gap-x-1 lg:ml-auto">
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

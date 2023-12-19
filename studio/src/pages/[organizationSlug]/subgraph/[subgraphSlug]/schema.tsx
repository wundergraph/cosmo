import { CodeViewer, CodeViewerActions } from "@/components/code-viewer";
import { EmptyState } from "@/components/empty-state";
import {
  SubgraphPageLayout,
  getSubgraphLayout,
} from "@/components/layout/subgraph-layout";
import { Button } from "@/components/ui/button";
import { useSubgraph } from "@/hooks/use-subgraph";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getLatestSubgraphSDLByName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";

const SubgraphSchemaPage: NextPageWithLayout = () => {
  const graph = useSubgraph();
  const { data, error, refetch } = useQuery({
    ...getLatestSubgraphSDLByName.useQuery({
      name: graph?.subgraph?.name,
    }),
    enabled: !!graph && !!graph.subgraph,
  });

  if (!graph || !graph.subgraph) return null;

  if (error || !data || data.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon className="h-10 w-10" />}
        title="Could not retrieve the sdl of the subgraph"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  const { routingURL, name } = graph.subgraph;

  return (
    <div className="relative flex h-full min-h-[60vh] flex-col-reverse md:flex-col">
      <div className="absolute right-4 top-4">
        <CodeViewerActions
          className="md:ml-0"
          code={data.sdl ?? ""}
          subgraphName={name}
        />
      </div>
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
  );
};

SubgraphSchemaPage.getLayout = (page: React.ReactNode) => {
  return getSubgraphLayout(
    <SubgraphPageLayout
      title="Schema"
      subtitle="View the SDL of your subgraph"
      noPadding
    >
      {page}
    </SubgraphPageLayout>,
    {
      title: "Schema",
    },
  );
};

export default SubgraphSchemaPage;

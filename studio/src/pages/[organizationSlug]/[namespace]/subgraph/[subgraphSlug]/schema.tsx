import { EmptyState } from "@/components/empty-state";
import {
  SubgraphPageLayout,
  getSubgraphLayout,
} from "@/components/layout/subgraph-layout";
import { SDLViewer, SDLViewerActions } from "@/components/schema/sdl-viewer";
import { Button } from "@/components/ui/button";
import { CLI } from "@/components/ui/cli";
import { Loader } from "@/components/ui/loader";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toolbar } from "@/components/ui/toolbar";
import { useSubgraph } from "@/hooks/use-subgraph";
import { docsBaseURL } from "@/lib/constants";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import {
  CommandLineIcon,
  ExclamationTriangleIcon,
  PuzzlePieceIcon,
} from "@heroicons/react/24/outline";
import { FileTextIcon } from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getLatestSubgraphSDL } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { SubgraphType } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import Link from "next/link";
import { useRouter } from "next/router";

const SubgraphSchemaPage: NextPageWithLayout = () => {
  const router = useRouter();
  const graph = useSubgraph();

  // Get the current tab from URL, default to "schema"
  const currentTab = (router.query.tab as string) || "schema";
  const activeTab = currentTab === "proto" ? "proto" : "schema";

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

  const handleTabChange = (tab: "schema" | "proto") => {
    router.push(
      {
        pathname: router.pathname,
        query: { ...router.query, tab },
      },
      undefined,
      { shallow: true },
    );
  };

  // Helper function to properly unescape proto schema string
  const unescapeProtoSchema = (protoSchema: string): string => {
    if (!protoSchema) return "";

    try {
      // Handle common escape sequences manually
      // The proto schema contains literal \n, \", etc. sequences that need to be unescaped
      return protoSchema
        .replace(/\\n/g, "\n") // Convert \n to actual newlines
        .replace(/\\r/g, "\r") // Convert \r to carriage returns
        .replace(/\\t/g, "\t") // Convert \t to tabs
        .replace(/\\"/g, '"') // Convert \" to quotes
        .replace(/\\\\/g, "\\"); // Convert \\ to single backslash (do this last)
    } catch (error) {
      console.warn("Failed to unescape proto schema:", error);
      return protoSchema; // Return original if all else fails
    }
  };

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

  const { routingURL, name, type } = graph.subgraph;
  const isPlugin = type === SubgraphType.PLUGIN;
  const isGrpcSubgraph = type === SubgraphType.GRPC_SUBGRAPH;
  const showTabs = isPlugin || isGrpcSubgraph;

  // Schema content component
  const SchemaContent = () => (
    <>
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
                href={docsBaseURL + "/cli/subgraph/publish"}
                className="text-primary"
              >
                Learn more.
              </a>
            </>
          }
          actions={
            <CLI
              command={`npx wgc subgraph publish ${graph.subgraph?.name} --namespace ${graph.subgraph?.namespace} --schema ${graph.subgraph?.name}.graphql`}
            />
          }
        />
      ) : (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1 ">
            <SDLViewer sdl={data.sdl ?? ""} className="h-full" />
          </div>
          <div className="flex w-full flex-shrink-0 flex-col items-center gap-x-8 gap-y-1 border-t bg-card p-2 text-xs lg:flex-row lg:justify-between">
            <p className="text-center">
              Displaying the latest published schema of this subgraph
            </p>
            <div className="flex flex-col gap-x-4 gap-y-1 lg:flex-row">
              {routingURL && (
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
              )}

              {graph.subgraph?.lastUpdatedAt && (
                <p className="flex items-center gap-x-1">
                  Last updated :
                  <span>
                    {formatDateTime(new Date(graph.subgraph.lastUpdatedAt))}
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Proto content component
  const ProtoContent = () => {
    return (
      <>
        {!data.protoSchema ? (
          <EmptyState
            icon={<CommandLineIcon />}
            title="Proto schema coming soon"
            description="Proto schema viewing for Plugin and gRPC subgraphs is not yet implemented. The infrastructure is in place but requires additional API integration."
          />
        ) : (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 overflow-hidden">
              <SDLViewer
                sdl={unescapeProtoSchema(data.protoSchema)}
                language="protobuf"
                className="h-full"
              />
            </div>
            <div className="flex w-full flex-shrink-0 flex-col items-center gap-x-8 gap-y-1 border-t bg-card p-2 text-xs lg:flex-row lg:justify-between">
              <p className="text-center">
                Displaying the proto schema of this subgraph
              </p>
              <div className="flex flex-col gap-x-4 gap-y-1 lg:flex-row">
                {routingURL && (
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
                )}

                {graph.subgraph?.lastUpdatedAt && (
                  <p className="flex items-center gap-x-1">
                    Last updated :
                    <span>
                      {formatDateTime(new Date(graph.subgraph.lastUpdatedAt))}
                    </span>
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <SubgraphPageLayout
      title="Schema"
      subtitle="View the SDL of your subgraph"
      noPadding
      toolbar={
        showTabs ? (
          <Toolbar>
            <Tabs value={activeTab} className="w-full md:w-auto">
              <TabsList>
                <TabsTrigger
                  value="schema"
                  className="flex items-center gap-x-2"
                  onClick={() => handleTabChange("schema")}
                >
                  <FileTextIcon className="h-4 w-4" />
                  Schema
                </TabsTrigger>
                <TabsTrigger
                  value="proto"
                  className="flex items-center gap-x-2"
                  onClick={() => handleTabChange("proto")}
                >
                  <PuzzlePieceIcon className="h-4 w-4" />
                  Proto
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="mr-auto" />
            <SDLViewerActions
              sdl={
                activeTab === "schema"
                  ? data?.sdl ?? ""
                  : data?.protoSchema ?? ""
              }
              size="icon-sm"
              targetName={name}
              language={activeTab === "schema" ? "graphql" : "protobuf"}
            />
          </Toolbar>
        ) : (
          <Toolbar className="w-auto flex-nowrap py-0">
            <div className="mr-auto" />
            <SDLViewerActions
              sdl={data?.sdl ?? ""}
              size="icon-sm"
              targetName={name}
            />
          </Toolbar>
        )
      }
    >
      {showTabs ? (
        activeTab === "schema" ? (
          <SchemaContent />
        ) : (
          <ProtoContent />
        )
      ) : (
        <SchemaContent />
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

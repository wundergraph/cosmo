import { CompositionErrorsBanner } from "@/components/composition-errors-banner";
import { ThreadSheet } from "@/components/discussions/thread";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { EmptySchema } from "@/components/schema/empty-schema-state";
import {
  SDLViewer,
  SDLViewerActions,
  SchemaSettings,
} from "@/components/schema/sdl-viewer";
import { SchemaToolbar } from "@/components/schema/toolbar";
import { Loader } from "@/components/ui/loader";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { Component2Icon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getFederatedGraphSDLByName,
  getSubgraphSDLFromLatestComposition,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext } from "react";
import { PiGraphLight } from "react-icons/pi";

const SDLPage: NextPageWithLayout = () => {
  const router = useRouter();
  const activeSubgraph = router.query.subgraph as string;
  const namespace = router.query.namespace as string;
  const graphName = router.query.slug as string;

  const fullPath = router.asPath;
  const pathWithHash = fullPath.split("?")[0];
  const pathname = pathWithHash.split("#")[0];

  const { data: federatedGraphSdl, isLoading: loadingGraphSDL } = useQuery(
    getFederatedGraphSDLByName.useQuery({
      name: graphName,
      namespace,
    }),
  );

  const graphData = useContext(GraphContext);

  let validGraph =
    graphData?.graph?.isComposable && !!graphData?.graph?.lastUpdatedAt;

  const { data: subgraphSdl, isLoading: loadingSubgraphSDL } = useQuery({
    ...getSubgraphSDLFromLatestComposition.useQuery({
      name: activeSubgraph,
      fedGraphName: graphName,
      namespace,
    }),
    enabled: !!graphData?.subgraphs && !!activeSubgraph,
  });

  const subgraphs =
    graphData?.subgraphs.map((each) => {
      return {
        name: each.name,
        query: `?subgraph=${each.name}`,
      };
    }) ?? [];

  // useScrollIntoView(hash);

  const activeSubgraphObject = graphData?.subgraphs.find((each) => {
    return each.name === activeSubgraph;
  });

  const activeGraphWithSDL = activeSubgraph
    ? {
        title: activeSubgraphObject?.name ?? "",
        targetId: activeSubgraphObject?.targetId ?? "",
        routingUrl: activeSubgraphObject?.routingURL ?? "",
        sdl: subgraphSdl?.sdl ?? "",
        versionId: subgraphSdl?.versionId,
        time: "",
      }
    : {
        title: graphName,
        targetId: graphData?.graph?.targetId ?? "",
        routingUrl: graphData?.graph?.routingURL ?? "",
        sdl: federatedGraphSdl?.sdl ?? "",
        time: graphData?.graph?.lastUpdatedAt,
        versionId: federatedGraphSdl?.versionId,
      };

  const isLoading = loadingGraphSDL || loadingSubgraphSDL;

  let content: React.ReactNode;

  if (isLoading) {
    content = <Loader fullscreen />;
  } else if (
    activeSubgraph &&
    subgraphSdl?.response &&
    subgraphSdl.response?.code === EnumStatusCode.ERR_NOT_FOUND
  ) {
    content = <EmptySchema subgraphName={activeSubgraph} />;
  } else if (
    federatedGraphSdl?.response &&
    federatedGraphSdl.response?.code === EnumStatusCode.ERR_NOT_FOUND
  ) {
    validGraph = true;
    content = (
      <EmptySchema
        subgraphName={graphData?.subgraphs?.[0]?.name || undefined}
      />
    );
  } else {
    content = (
      <div className="flex h-full flex-col-reverse md:flex-col">
        <SDLViewer
          sdl={activeGraphWithSDL.sdl ?? ""}
          targetId={activeGraphWithSDL?.targetId}
          versionId={activeGraphWithSDL.versionId ?? ""}
        />
        <div className="flex w-full flex-col items-center justify-end gap-x-8 gap-y-1 border-t bg-card p-2 text-xs md:flex-row">
          <p className="flex items-center gap-x-1">
            Routing URL :
            <Link
              className="hover:underline"
              target="_blank"
              rel="noreferrer"
              href={activeGraphWithSDL.routingUrl}
            >
              {activeGraphWithSDL.routingUrl}
            </Link>
          </p>
          {activeGraphWithSDL.time && (
            <p className="flex items-center gap-x-1">
              Last updated :
              <span>{formatDateTime(new Date(activeGraphWithSDL.time))}</span>
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <PageHeader title="SDL | Studio">
      <GraphPageLayout
        title="SDL"
        subtitle="View the SDL of your federated graph and subgraphs"
        noPadding
        toolbar={
          <SchemaToolbar tab="sdl">
            <div className="mt-2 flex flex-1 flex-row flex-wrap gap-2 md:mt-0">
              <Select onValueChange={(query) => router.push(pathname + query)}>
                <SelectTrigger
                  value={activeGraphWithSDL.title}
                  className="w-full md:ml-auto md:w-[200px]"
                >
                  <SelectValue aria-label={activeGraphWithSDL.title}>
                    {graphData?.graph?.supportsFederation
                      ? activeGraphWithSDL.title
                      : activeSubgraph
                      ? "Published SDL"
                      : "Router SDL"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {graphData?.graph?.supportsFederation ? (
                    <>
                      <SelectGroup>
                        <SelectLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                          <PiGraphLight className="h-3 w-3" /> Graph
                        </SelectLabel>
                        <SelectItem value="">{graphName}</SelectItem>
                      </SelectGroup>
                      <Separator className="my-2" />
                      <SelectGroup>
                        <SelectLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                          <Component2Icon className="h-3 w-3" /> Subgraphs
                        </SelectLabel>
                        {subgraphs.map(({ name, query }) => {
                          return (
                            <SelectItem key={name} value={query}>
                              {name}
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>
                    </>
                  ) : (
                    <>
                      <SelectItem value="">Router SDL</SelectItem>
                      {subgraphs.map(({ name, query }) => {
                        return (
                          <SelectItem key={name} value={query}>
                            Published SDL
                          </SelectItem>
                        );
                      })}
                    </>
                  )}
                </SelectContent>
              </Select>
              <SDLViewerActions
                className="w-auto"
                sdl={activeGraphWithSDL.sdl ?? ""}
                targetName={
                  activeGraphWithSDL.title !== ""
                    ? activeGraphWithSDL.title
                    : undefined
                }
              />
              <SchemaSettings />
            </div>
          </SchemaToolbar>
        }
      >
        {!validGraph && (
          <CompositionErrorsBanner
            errors={graphData?.graph?.compositionErrors}
            className="mx-4 mt-4"
          />
        )}
        {content}
        <ThreadSheet schemaVersionId={activeGraphWithSDL.versionId ?? ""} />
      </GraphPageLayout>
    </PageHeader>
  );
};

SDLPage.getLayout = (page) => getGraphLayout(page);

export default SDLPage;

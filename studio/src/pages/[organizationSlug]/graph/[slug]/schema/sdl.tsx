import { useApplyParams } from "@/components/analytics/use-apply-params";
import { CodeViewerActions } from "@/components/code-viewer";
import { CompositionErrorsBanner } from "@/components/composition-errors-banner";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import {
  SDLViewer,
  SDLViewerActions,
  SchemaSettings,
} from "@/components/schema/sdl-viewer";
import { ThreadSheet } from "@/components/schema/thread";
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
import useWindowSize from "@/hooks/use-window-size";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { Component2Icon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import {
  getFederatedGraphSDLByName,
  getLatestValidSubgraphSDLByName,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext, useEffect, useState } from "react";
import { PiGraphLight } from "react-icons/pi";

const useScrollIntoView = (lineNo: string) => {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!isMounted && lineNo) {
        const targetLine = document.querySelector(`#id-${lineNo}`);
        const container = document.getElementById("schema-container");

        if (targetLine && container) {
          const rect = targetLine.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const y = rect.top - containerRect.height;

          container.scrollTo({
            top: y,
          });
        }
        setIsMounted(true);
      }
    }, 500);
    return () => {
      clearTimeout(t);
    };
  }, [isMounted, lineNo]);
};

const SDLPage: NextPageWithLayout = () => {
  const router = useRouter();
  const activeSubgraph = router.query.subgraph as string;
  const graphName = router.query.slug as string;
  const discussionId = router.query.discussionId as string;

  const fullPath = router.asPath;
  const pathWithHash = fullPath.split("?")[0];
  const pathname = pathWithHash.split("#")[0];
  const hash = pathWithHash.split("#")?.[1];

  const { data: federatedGraphSdl, isLoading: loadingGraphSDL } = useQuery(
    getFederatedGraphSDLByName.useQuery({
      name: graphName,
    }),
  );

  const graphData = useContext(GraphContext);

  const validGraph =
    graphData?.graph?.isComposable && !!graphData?.graph?.lastUpdatedAt;

  const { data: subgraphSdl, isLoading: loadingSubgraphSDL } = useQuery({
    ...getLatestValidSubgraphSDLByName.useQuery({
      name: activeSubgraph,
      fedGraphName: graphName,
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

  useScrollIntoView(hash);

  const applyParams = useApplyParams();

  const activeSubgraphObject = graphData?.subgraphs.find((each) => {
    return each.name === activeSubgraph;
  });

  const { isTablet } = useWindowSize();

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
                    {activeGraphWithSDL.title}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
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
                </SelectContent>
              </Select>
              <SDLViewerActions sdl={activeGraphWithSDL.sdl ?? ""} />
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
        {isLoading && <Loader fullscreen />}
        {!isLoading && (
          <div className="relative flex h-full min-h-[60vh] flex-col-reverse  md:flex-col">
            <div
              id="schema-container"
              className="scrollbar-custom h-full flex-1 overflow-auto"
            >
              <SDLViewer
                className="h-0 w-0"
                sdl={activeGraphWithSDL.sdl ?? ""}
                targetId={activeGraphWithSDL?.targetId}
                versionId={activeGraphWithSDL.versionId ?? ""}
              />
            </div>
            <ThreadSheet schemaVersionId={activeGraphWithSDL.versionId ?? ""} />
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
                  <span>
                    {formatDateTime(new Date(activeGraphWithSDL.time))}
                  </span>
                </p>
              )}
            </div>
          </div>
        )}
      </GraphPageLayout>
    </PageHeader>
  );
};

SDLPage.getLayout = (page) => getGraphLayout(page);

export default SDLPage;

import { CompositionErrorsBanner } from "@/components/composition-errors-banner";
import { GraphContext, getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { SchemaViewer, SchemaViewerActions } from "@/components/schema-viewer";
import { SchemaToolbar } from "@/components/schema/toolbar";
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

  const fullPath = router.asPath;
  const pathWithHash = fullPath.split("?")[0];
  const pathname = pathWithHash.split("#")[0];
  const hash = pathWithHash.split("#")?.[1];

  const { data: federatedGraphSdl } = useQuery(
    getFederatedGraphSDLByName.useQuery({
      name: graphName,
    }),
  );

  const graphData = useContext(GraphContext);

  const validGraph =
    graphData?.graph?.isComposable && !!graphData?.graph?.lastUpdatedAt;

  const { data: subGraphSdl } = useQuery({
    ...getLatestValidSubgraphSDLByName.useQuery({
      name: activeSubgraph,
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

  const activeSubgraphObject = graphData?.subgraphs.find((each) => {
    return each.name === activeSubgraph;
  });

  const activeGraphWithSDL = activeSubgraph
    ? {
        title: activeSubgraphObject?.name ?? "",
        routingUrl: activeSubgraphObject?.routingURL ?? "",
        sdl: subGraphSdl?.sdl ?? "",
        time: "",
      }
    : {
        title: graphName,
        routingUrl: graphData?.graph?.routingURL ?? "",
        sdl: federatedGraphSdl?.sdl ?? "",
        time: graphData?.graph?.lastUpdatedAt,
      };

  return (
    <PageHeader title="Studio | SDL">
      <TitleLayout
        title="SDL"
        subtitle="View the SDL of your federated graph and subgraphs"
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
              <SchemaViewerActions
                className="md:ml-0"
                sdl={activeGraphWithSDL.sdl ?? ""}
                subgraphName={activeGraphWithSDL.title}
              />
            </div>
          </SchemaToolbar>
        }
      >
        {!validGraph && (
          <CompositionErrorsBanner
            errors={graphData?.graph?.compositionErrors}
          />
        )}
        <div className="relative flex h-full min-h-[60vh] flex-col-reverse gap-y-4 md:flex-col">
          <div
            id="schema-container"
            className="scrollbar-custom flex-1 overflow-auto rounded border"
          >
            <SchemaViewer
              className="h-0 w-0"
              sdl={activeGraphWithSDL.sdl ?? ""}
            />
          </div>
          <div className="flex w-full flex-col items-center justify-end gap-x-8 gap-y-1 rounded border bg-card p-2 text-xs md:flex-row md:border-none md:bg-transparent md:p-0">
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
      </TitleLayout>
    </PageHeader>
  );
};

SDLPage.getLayout = (page) => getGraphLayout(page);

export default SDLPage;

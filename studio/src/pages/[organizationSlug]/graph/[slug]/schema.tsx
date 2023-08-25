import { GraphContext, getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { SchemaViewer, SchemaViewerActions } from "@/components/schema-viewer";
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
import { useToast } from "@/components/ui/use-toast";
import { NextPageWithLayout } from "@/lib/page";
import { Component2Icon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  getFederatedGraphSDLByName,
  getFederatedSubgraphSDLByName,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
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

const SchemaPage: NextPageWithLayout = () => {
  const router = useRouter();
  const activeSubgraph = router.query.subgraph as string;
  const graphName = router.query.slug as string;

  const fullPath = router.asPath;
  const pathWithHash = fullPath.split("?")[0];
  const pathname = pathWithHash.split("#")[0];
  const hash = pathWithHash.split("#")?.[1];

  const { toast, dismiss } = useToast();

  const { data: federatedGraphSdl } = useQuery(
    getFederatedGraphSDLByName.useQuery({
      name: graphName,
    })
  );

  const graphData = useContext(GraphContext);

  const { data: subGraphSdl } = useQuery({
    ...getFederatedSubgraphSDLByName.useQuery({
      name: activeSubgraph,
    }),
    enabled: !!graphData?.subgraphs,
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
    <div className="relative flex flex-col gap-y-6">
      <div className="order-1 flex flex-row flex-wrap gap-y-4">
        <Select onValueChange={(query) => router.push(pathname + query)}>
          <SelectTrigger
            value={activeGraphWithSDL.title}
            className="w-full md:w-[200px]"
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
          sdl={activeGraphWithSDL.sdl ?? ""}
          subgraphName={activeGraphWithSDL.title}
        />
      </div>

      <div
        id="schema-container"
        className="scrollbar-custom absolute left-0 right-0 top-48 order-3 h-[70vh] overflow-auto rounded border md:top-24 md:order-2"
      >
        <SchemaViewer sdl={activeGraphWithSDL.sdl ?? ""} />
      </div>
      <div className="order-2 flex w-full flex-col items-center justify-end gap-x-8 gap-y-1 rounded border bg-card p-2 text-xs md:order-3 md:flex-row md:border-none md:bg-transparent md:p-0">
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
              {format(new Date(activeGraphWithSDL.time), "dd MMMM yyyy HH:mm")}
            </span>
          </p>
        )}
      </div>
    </div>
  );
};

SchemaPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Studio | Schema">
      <TitleLayout
        title="Schema"
        subtitle="View the SDL of your federated graph and subgraphs"
      >
        {page}
      </TitleLayout>
    </PageHeader>
  );

export default SchemaPage;

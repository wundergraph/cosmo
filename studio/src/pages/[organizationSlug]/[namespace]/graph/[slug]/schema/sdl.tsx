import { CompositionErrorsBanner } from "@/components/composition-errors-banner";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { EmptySchema } from "@/components/schema/empty-schema-state";
import { SDLViewerActions } from "@/components/schema/sdl-viewer";
import { SDLViewerMonaco } from "@/components/schema/sdl-viewer-monaco";
import { SchemaToolbar } from "@/components/schema/toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader } from "@/components/ui/loader";
import { Separator } from "@/components/ui/separator";
import useHash from "@/hooks/use-hash";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import { ChevronUpDownIcon } from "@heroicons/react/24/outline";
import { Component2Icon } from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getFederatedGraphSDLByName,
  getSubgraphSDLFromLatestComposition,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext } from "react";
import { MdOutlineFeaturedPlayList } from "react-icons/md";
import { PiGraphLight } from "react-icons/pi";
import { useWorkspace } from "@/hooks/use-workspace";

const SDLPage: NextPageWithLayout = () => {
  const router = useRouter();
  const activeSubgraph = router.query.subgraph as string;
  const activeFeatureFlag = router.query.featureFlag as string;
  const { namespace: { name: namespace } } = useWorkspace();
  const graphName = router.query.slug as string;
  const schemaType = router.query.schemaType as string;

  const fullPath = router.asPath;
  const pathWithHash = fullPath.split("?")[0];
  const pathname = pathWithHash.split("#")[0];

  const hash = useHash();

  const graphData = useContext(GraphContext);

  const { data: federatedGraphSdl, isLoading: loadingGraphSDL } = useQuery(
    getFederatedGraphSDLByName,
    {
      name: graphName,
      namespace,
      featureFlagName: activeFeatureFlag,
    },
  );

  let validGraph =
    graphData?.graph?.isComposable && !!graphData?.graph?.lastUpdatedAt;

  const { data: subgraphSdl, isLoading: loadingSubgraphSDL } = useQuery(
    getSubgraphSDLFromLatestComposition,
    {
      name: activeSubgraph,
      fedGraphName: graphName,
      namespace,
    },
    {
      enabled: !!graphData?.subgraphs && !!activeSubgraph,
    },
  );

  const subgraphs =
    graphData?.subgraphs.map((each) => {
      return {
        name: each.name,
        query: `?subgraph=${each.name}`,
      };
    }) ?? [];

  const featureFlags =
    graphData?.featureFlagsInLatestValidComposition.map((each) => {
      return {
        name: each.name,
        query: `?featureFlag=${each.name}`,
      };
    }) ?? [];

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
        title: activeFeatureFlag || graphName,
        targetId: graphData?.graph?.targetId ?? "",
        routingUrl: graphData?.graph?.routingURL ?? "",
        sdl:
          schemaType === "router"
            ? federatedGraphSdl?.sdl ?? ""
            : federatedGraphSdl?.clientSchema || federatedGraphSdl?.sdl,
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
        <SDLViewerMonaco
          schema={activeGraphWithSDL.sdl ?? ""}
          line={hash ? Number(hash.slice(1)) : 0}
          enableLinking
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
              <DropdownMenu>
                <DropdownMenuTrigger
                  value={activeGraphWithSDL.title}
                  className="w-full md:ml-auto md:w-max md:min-w-[200px]"
                  asChild
                >
                  <div className="flex items-center justify-center">
                    <Button
                      className="flex w-[220px] text-sm"
                      variant="outline"
                      asChild
                    >
                      <div className="flex justify-between">
                        <div className="flex">
                          <p className="max-w-[120px] truncate">
                            {graphData?.graph?.supportsFederation
                              ? activeGraphWithSDL.title
                              : activeSubgraph
                              ? "Published SDL"
                              : "Router SDL"}
                          </p>
                          {!activeSubgraph && (
                            <Badge variant="secondary" className="ml-2">
                              {schemaType === "router" ? "router" : "client"}
                            </Badge>
                          )}
                        </div>
                        <ChevronUpDownIcon className="h-4 w-4" />
                      </div>
                    </Button>
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="min-w-[220px]">
                  {graphData?.graph?.supportsFederation ? (
                    <>
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                          <PiGraphLight className="h-3 w-3" /> Graph
                        </DropdownMenuLabel>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            {graphData.graph.name}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuPortal>
                            <DropdownMenuSubContent>
                              <DropdownMenuRadioGroup
                                onValueChange={(query) =>
                                  router.push(pathname + query)
                                }
                                value={`${
                                  !activeFeatureFlag
                                    ? `?schemaType=${schemaType}`
                                    : undefined
                                }`}
                              >
                                <DropdownMenuRadioItem
                                  className="w-[150px] items-center justify-between pl-2"
                                  value="?schemaType=client"
                                >
                                  Client Schema
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem
                                  className="w-[150px] items-center justify-between pl-2"
                                  value="?schemaType=router"
                                >
                                  Router Schema
                                </DropdownMenuRadioItem>
                              </DropdownMenuRadioGroup>
                            </DropdownMenuSubContent>
                          </DropdownMenuPortal>
                        </DropdownMenuSub>
                      </DropdownMenuGroup>

                      {featureFlags.length > 0 && (
                        <>
                          <Separator className="my-2" />

                          <DropdownMenuGroup>
                            <DropdownMenuLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                              <MdOutlineFeaturedPlayList className="h-3 w-3" />{" "}
                              Feature Flags
                            </DropdownMenuLabel>
                            {featureFlags.map(({ name, query }) => {
                              return (
                                <>
                                  <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                      {name}
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuPortal>
                                      <DropdownMenuSubContent>
                                        <DropdownMenuRadioGroup
                                          value={`?featureFlag=${activeFeatureFlag}&schemaType=${schemaType}`}
                                          onValueChange={(query) =>
                                            router.push(pathname + query)
                                          }
                                        >
                                          <DropdownMenuRadioItem
                                            className="w-[150px] items-center justify-between pl-2"
                                            value={`${query}&schemaType=client`}
                                          >
                                            Client Schema
                                          </DropdownMenuRadioItem>
                                          <DropdownMenuRadioItem
                                            className="w-[150px] items-center justify-between pl-2"
                                            value={`${query}&schemaType=router`}
                                          >
                                            Router Schema
                                          </DropdownMenuRadioItem>
                                        </DropdownMenuRadioGroup>
                                      </DropdownMenuSubContent>
                                    </DropdownMenuPortal>
                                  </DropdownMenuSub>
                                </>
                              );
                            })}
                          </DropdownMenuGroup>
                        </>
                      )}

                      <Separator className="my-2" />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                          <Component2Icon className="h-3 w-3" /> Subgraphs
                        </DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          onValueChange={(query) =>
                            router.push(pathname + query)
                          }
                          value={`?subgraph=${activeSubgraph}`}
                        >
                          {subgraphs.map(({ name, query }) => {
                            return (
                              <DropdownMenuRadioItem
                                className="items-center justify-between pl-2"
                                key={name}
                                value={query}
                              >
                                {name}
                              </DropdownMenuRadioItem>
                            );
                          })}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuGroup>
                    </>
                  ) : (
                    <>
                      <DropdownMenuRadioGroup
                        onValueChange={(query) => router.push(pathname + query)}
                      >
                        <DropdownMenuRadioItem
                          className="w-[150px] items-center justify-between pl-2"
                          value=""
                        >
                          Router SDL
                        </DropdownMenuRadioItem>
                        {subgraphs.map(({ name, query }) => {
                          return (
                            <DropdownMenuRadioItem
                              className="w-[150px] items-center justify-between pl-2"
                              key={name}
                              value={query}
                            >
                              Published SDL
                            </DropdownMenuRadioItem>
                          );
                        })}
                      </DropdownMenuRadioGroup>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <SDLViewerActions
                className="w-auto"
                sdl={activeGraphWithSDL.sdl ?? ""}
                targetName={
                  activeGraphWithSDL.title !== ""
                    ? activeGraphWithSDL.title
                    : undefined
                }
              />
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
      </GraphPageLayout>
    </PageHeader>
  );
};

SDLPage.getLayout = (page) => getGraphLayout(page);

export default SDLPage;

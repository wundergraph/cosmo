import { CompositionErrorsBanner } from '@/components/composition-errors-banner';
import { GraphContext, GraphPageLayout, getGraphLayout } from '@/components/layout/graph-layout';
import { PageHeader } from '@/components/layout/head';
import { EmptySchema } from '@/components/schema/empty-schema-state';
import { SDLViewerActions } from '@/components/schema/sdl-viewer';
import { SDLViewerMonaco } from '@/components/schema/sdl-viewer-monaco';
import { SchemaToolbar } from '@/components/schema/toolbar';
import { StaleCompositionIcon } from '@/components/schema/stale-composition-warning';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Loader } from '@/components/ui/loader';
import { Separator } from '@/components/ui/separator';
import useHash from '@/hooks/use-hash';
import { buildUrl } from '@/lib/build-url';
import { formatDateTime } from '@/lib/format-date';
import { NextPageWithLayout } from '@/lib/page';
import { useQuery } from '@connectrpc/connect-query';
import { ChevronUpDownIcon } from '@heroicons/react/24/outline';
import { Component2Icon } from '@radix-ui/react-icons';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  getFederatedGraphSDLByName,
  getFeatureFlagsInLatestCompositionByFederatedGraph,
  getSdlBySchemaVersion,
  getSubgraphSDLFromLatestComposition,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useContext } from 'react';
import { MdOutlineFeaturedPlayList } from 'react-icons/md';
import { RxComponentInstance } from 'react-icons/rx';
import { PiGraphLight } from 'react-icons/pi';
import { useWorkspace } from '@/hooks/use-workspace';
import { useApplyParams } from '@/components/analytics/use-apply-params';

const SDLPage: NextPageWithLayout = () => {
  const router = useRouter();
  const activeSubgraph = router.query.subgraph as string;
  const activeFeatureFlag = router.query.featureFlag as string;
  const {
    namespace: { name: namespace },
  } = useWorkspace();
  const graphName = router.query.slug as string;
  const organizationSlug = router.query.organizationSlug as string;
  const schemaType = router.query.schemaType as string;

  const hash = useHash();

  const graphData = useContext(GraphContext);
  const applyParams = useApplyParams();

  const { data: compositionFlagsData, isLoading: loadingCompositionFlags } = useQuery(
    getFeatureFlagsInLatestCompositionByFederatedGraph,
    {
      federatedGraphName: graphData?.graph?.name,
      namespace,
    },
    {
      enabled: !!graphData?.graph?.name,
    },
  );

  const featureFlags = compositionFlagsData?.featureFlags ?? [];

  const featureSubgraphsOfFlag = (featureFlagId: string) =>
    compositionFlagsData?.featureSubgraphs.filter(
      (featureSubgraph) => featureSubgraph.featureFlagId === featureFlagId,
    ) ?? [];

  // `?featureFlag=X&subgraph=Y` addresses a feature subgraph, `?subgraph=Y` alone a base subgraph.
  const isFeatureSubgraphSelected = !!activeFeatureFlag && !!activeSubgraph;

  const activeFeatureSubgraph = isFeatureSubgraphSelected
    ? featureSubgraphsOfFlag(featureFlags.find((flag) => flag.name === activeFeatureFlag)?.id ?? '').find(
        (featureSubgraph) => featureSubgraph.name === activeSubgraph,
      )
    : undefined;

  const activeSchemaType = schemaType === 'router' ? 'router' : 'client';

  /** Only one schema source can be selected, so every selection clears the other two params. */
  const selectSchemaSource = (source: { featureFlag?: string; subgraph?: string; schemaType?: string }) =>
    applyParams({
      featureFlag: source.featureFlag ?? null,
      subgraph: source.subgraph ?? null,
      schemaType: source.schemaType ?? null,
    });

  const { data: federatedGraphSdl, isLoading: loadingGraphSDL } = useQuery(
    getFederatedGraphSDLByName,
    {
      name: graphName,
      namespace,
      featureFlagName: activeFeatureFlag,
    },
    {
      enabled: !activeSubgraph,
    },
  );

  let validGraph = graphData?.graph?.isComposable && !!graphData?.graph?.lastUpdatedAt;

  const { data: subgraphSdl, isLoading: loadingSubgraphSDL } = useQuery(
    getSubgraphSDLFromLatestComposition,
    {
      name: activeSubgraph,
      fedGraphName: graphName,
      namespace,
    },
    {
      enabled: !!graphData?.subgraphs && !!activeSubgraph && !isFeatureSubgraphSelected,
    },
  );

  // Feature subgraphs are not in the base composition, so getSubgraphSDLFromLatestComposition
  // cannot resolve them.
  const { data: featureSubgraphSdl, isLoading: loadingFeatureSubgraphSDL } = useQuery(
    getSdlBySchemaVersion,
    {
      schemaVersionId: activeFeatureSubgraph?.schemaVersionId,
      targetId: activeFeatureSubgraph?.targetId,
    },
    {
      enabled: !!activeFeatureSubgraph,
    },
  );

  const subgraphs = graphData?.subgraphs ?? [];

  // The active flag is identified by name in the URL, so resolve staleness by name for the banner
  const activeFeatureFlagIsStale = featureFlags.some(
    (flag) => flag.name === activeFeatureFlag && flag.hasFailedLatestComposition,
  );

  const activeSubgraphObject = graphData?.subgraphs.find((each) => {
    return each.name === activeSubgraph;
  });

  // downloadName becomes a filename, so it cannot contain a slash.
  const activeGraphWithSDL = isFeatureSubgraphSelected
    ? {
        title: `${activeFeatureFlag} / ${activeSubgraph}`,
        downloadName: `${activeFeatureFlag}-${activeSubgraph}`,
        routingUrl: activeFeatureSubgraph?.routingUrl ?? '',
        sdl: featureSubgraphSdl?.sdl ?? '',
        time: '',
      }
    : activeSubgraph
      ? {
          title: activeSubgraphObject?.name ?? '',
          downloadName: activeSubgraphObject?.name ?? '',
          routingUrl: activeSubgraphObject?.routingURL ?? '',
          sdl: subgraphSdl?.sdl ?? '',
          time: '',
        }
      : {
          title: activeFeatureFlag || graphName,
          downloadName: activeFeatureFlag || graphName,
          routingUrl: graphData?.graph?.routingURL ?? '',
          sdl:
            activeSchemaType === 'router'
              ? (federatedGraphSdl?.sdl ?? '')
              : federatedGraphSdl?.clientSchema || federatedGraphSdl?.sdl,
          time: graphData?.graph?.lastUpdatedAt ?? '',
        };

  const isLoading =
    loadingGraphSDL ||
    loadingSubgraphSDL ||
    loadingFeatureSubgraphSDL ||
    // Which SDL to fetch is unknown until the flag list has loaded.
    (isFeatureSubgraphSelected && loadingCompositionFlags);

  let content: React.ReactNode;

  if (isLoading) {
    content = <Loader fullscreen />;
  } else if (isFeatureSubgraphSelected && !featureSubgraphSdl?.sdl) {
    content = <EmptySchema subgraphName={activeSubgraph} />;
  } else if (
    activeSubgraph &&
    !isFeatureSubgraphSelected &&
    subgraphSdl?.response &&
    subgraphSdl.response?.code === EnumStatusCode.ERR_NOT_FOUND
  ) {
    content = <EmptySchema subgraphName={activeSubgraph} />;
  } else if (
    !activeSubgraph &&
    federatedGraphSdl?.response &&
    federatedGraphSdl.response?.code === EnumStatusCode.ERR_NOT_FOUND
  ) {
    validGraph = true;
    content = <EmptySchema subgraphName={graphData?.subgraphs?.[0]?.name || undefined} />;
  } else {
    content = (
      <div className="flex h-full flex-col-reverse md:flex-col">
        <SDLViewerMonaco schema={activeGraphWithSDL.sdl ?? ''} line={hash ? Number(hash.slice(1)) : 0} enableLinking />
        <div className="flex w-full flex-col items-center justify-end gap-x-8 gap-y-1 border-t bg-card p-2 text-xs md:flex-row">
          <p className="flex items-center gap-x-1">
            Routing URL :
            <Link className="hover:underline" target="_blank" rel="noreferrer" href={activeGraphWithSDL.routingUrl}>
              {activeGraphWithSDL.routingUrl}
            </Link>
          </p>
          {activeGraphWithSDL.time && (
            <p className="flex items-center gap-x-1">
              Last updated :<span>{formatDateTime(new Date(activeGraphWithSDL.time))}</span>
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
                    <Button className="flex w-[220px] text-sm" variant="outline" asChild>
                      <div className="flex justify-between">
                        <div className="flex">
                          <p className="max-w-[120px] truncate">
                            {graphData?.graph?.supportsFederation
                              ? activeGraphWithSDL.title
                              : activeSubgraph
                                ? 'Published SDL'
                                : 'Router SDL'}
                          </p>
                          {!activeSubgraph && (
                            <Badge variant="secondary" className="ml-2">
                              {activeSchemaType}
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
                          <DropdownMenuSubTrigger>{graphData.graph.name}</DropdownMenuSubTrigger>
                          <DropdownMenuPortal>
                            <DropdownMenuSubContent>
                              <DropdownMenuRadioGroup
                                onValueChange={(value) => selectSchemaSource({ schemaType: value })}
                                value={!activeFeatureFlag && !activeSubgraph ? activeSchemaType : ''}
                              >
                                <DropdownMenuRadioItem
                                  className="w-[150px] items-center justify-between pl-2"
                                  value="client"
                                >
                                  Client Schema
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem
                                  className="w-[150px] items-center justify-between pl-2"
                                  value="router"
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
                              <MdOutlineFeaturedPlayList className="h-3 w-3" /> Feature Flags
                            </DropdownMenuLabel>
                            {featureFlags.map(({ id, name, hasFailedLatestComposition }) => {
                              const isActiveFlag = name === activeFeatureFlag;
                              const featureSubgraphs = featureSubgraphsOfFlag(id);

                              return (
                                <DropdownMenuSub key={id}>
                                  <DropdownMenuSubTrigger>
                                    <span className="flex items-center gap-x-1.5">
                                      {name}
                                      {hasFailedLatestComposition && <StaleCompositionIcon />}
                                    </span>
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuPortal>
                                    <DropdownMenuSubContent>
                                      <DropdownMenuRadioGroup
                                        value={isActiveFlag && !activeSubgraph ? activeSchemaType : ''}
                                        onValueChange={(value) =>
                                          selectSchemaSource({ featureFlag: name, schemaType: value })
                                        }
                                      >
                                        <DropdownMenuRadioItem
                                          className="w-[170px] items-center justify-between pl-2"
                                          value="client"
                                        >
                                          Client Schema
                                        </DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem
                                          className="w-[170px] items-center justify-between pl-2"
                                          value="router"
                                        >
                                          Router Schema
                                        </DropdownMenuRadioItem>
                                      </DropdownMenuRadioGroup>

                                      {featureSubgraphs.length > 0 && (
                                        <>
                                          <DropdownMenuSeparator className="my-2" />
                                          <DropdownMenuLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                                            <RxComponentInstance className="h-3 w-3" /> Feature Subgraphs
                                          </DropdownMenuLabel>
                                          <DropdownMenuRadioGroup
                                            value={isActiveFlag ? (activeSubgraph ?? '') : ''}
                                            onValueChange={(value) =>
                                              selectSchemaSource({ featureFlag: name, subgraph: value })
                                            }
                                          >
                                            {featureSubgraphs.map((featureSubgraph) => (
                                              <DropdownMenuRadioItem
                                                className="w-[170px] items-center justify-between pl-2"
                                                key={featureSubgraph.id}
                                                value={featureSubgraph.name}
                                              >
                                                <span className="truncate">{featureSubgraph.name}</span>
                                              </DropdownMenuRadioItem>
                                            ))}
                                          </DropdownMenuRadioGroup>
                                        </>
                                      )}
                                    </DropdownMenuSubContent>
                                  </DropdownMenuPortal>
                                </DropdownMenuSub>
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
                          onValueChange={(value) => selectSchemaSource({ subgraph: value })}
                          value={activeFeatureFlag ? '' : (activeSubgraph ?? '')}
                        >
                          {subgraphs.map(({ name }) => {
                            return (
                              <DropdownMenuRadioItem
                                className="items-center justify-between pl-2"
                                key={name}
                                value={name}
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
                        onValueChange={(value) => selectSchemaSource({ subgraph: value || undefined })}
                        value={activeSubgraph ?? ''}
                      >
                        <DropdownMenuRadioItem className="w-[150px] items-center justify-between pl-2" value="">
                          Router SDL
                        </DropdownMenuRadioItem>
                        {subgraphs.map(({ name }) => {
                          return (
                            <DropdownMenuRadioItem
                              className="w-[150px] items-center justify-between pl-2"
                              key={name}
                              value={name}
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
                sdl={activeGraphWithSDL.sdl ?? ''}
                targetName={activeGraphWithSDL.downloadName !== '' ? activeGraphWithSDL.downloadName : undefined}
              />
            </div>
          </SchemaToolbar>
        }
      >
        {!validGraph && !activeFeatureFlag && (
          <CompositionErrorsBanner errors={graphData?.graph?.compositionErrors} className="mx-4 mt-4" />
        )}
        {activeFeatureFlagIsStale && activeFeatureFlag && (
          <CompositionErrorsBanner
            viewCompositionsHref={buildUrl('/:organizationSlug/:namespace/graph/:graphName/compositions', {
              organizationSlug,
              namespace,
              graphName,
            })}
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

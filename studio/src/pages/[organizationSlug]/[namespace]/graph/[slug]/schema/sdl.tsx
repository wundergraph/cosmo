import { CompositionErrorsBanner } from '@/components/composition-errors-banner';
import { GraphContext, GraphPageLayout, getGraphLayout } from '@/components/layout/graph-layout';
import { PageHeader } from '@/components/layout/head';
import { EmptySchema } from '@/components/schema/empty-schema-state';
import { SDLViewerActions } from '@/components/schema/sdl-viewer';
import { SDLViewerMonaco } from '@/components/schema/sdl-viewer-monaco';
import { SchemaToolbar } from '@/components/schema/toolbar';
import { SchemaSelection } from '@/components/schema/schema-selection';
import { SchemaSelector } from '@/components/schema/schema-selector';
import { Loader } from '@/components/ui/loader';
import useHash from '@/hooks/use-hash';
import { buildUrl } from '@/lib/build-url';
import { formatDateTime } from '@/lib/format-date';
import { NextPageWithLayout } from '@/lib/page';
import { useQuery } from '@connectrpc/connect-query';
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

  /** Only one schema can be selected, so every selection clears the other two params. */
  const selectSchema = (next: SchemaSelection) =>
    applyParams({
      featureFlag: next.featureFlag ?? null,
      subgraph: next.subgraph ?? null,
      schemaType: next.schemaType ?? null,
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
              <SchemaSelector
                title={activeGraphWithSDL.title}
                supportsFederation={!!graphData?.graph?.supportsFederation}
                featureFlags={featureFlags}
                selection={{ featureFlag: activeFeatureFlag, subgraph: activeSubgraph, schemaType: activeSchemaType }}
                onSelect={selectSchema}
                subgraphNames={subgraphs.map(({ name }) => name)}
                featureSubgraphsOfFlag={featureSubgraphsOfFlag}
              />
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

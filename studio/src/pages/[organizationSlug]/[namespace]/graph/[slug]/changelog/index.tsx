import { useApplyParams } from '@/components/analytics/use-apply-params';
import { useParams } from 'next/navigation';
import { useDateRangeQueryState } from '@/components/analytics/useAnalyticsQueryState';
import { Changelog } from '@/components/changelog/changelog';
import { CompositionErrorsBanner } from '@/components/composition-errors-banner';
import { DatePickerWithRange, DateRangePickerChangeHandler } from '@/components/date-picker-with-range';
import { EmptyState } from '@/components/empty-state';
import { GraphContext, GraphPageLayout, getGraphLayout } from '@/components/layout/graph-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CLI } from '@/components/ui/cli';
import { Loader } from '@/components/ui/loader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toolbar } from '@/components/ui/toolbar';
import { useFeatureLimit } from '@/hooks/use-feature-limit';
import { docsBaseURL } from '@/lib/constants';
import { formatDateTime } from '@/lib/format-date';
import { createDateRange } from '@/lib/insights-helpers';
import { NextPageWithLayout } from '@/lib/page';
import { useInfiniteQuery, useQuery } from '@connectrpc/connect-query';
import { CommandLineIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  getFederatedGraphChangelog,
  getFeatureFlagsByFederatedGraph,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { endOfDay, formatISO, startOfDay } from 'date-fns';
import { useRouter } from 'next/router';
import { useQueryState } from 'nuqs';
import { ReactNode, useContext, useEffect, useRef } from 'react';
import { useWorkspace } from '@/hooks/use-workspace';

const BASE_GRAPH_VALUE = '__base_graph__';

const ChangelogToolbar = () => {
  const applyParams = useApplyParams();
  const { dateRange, range } = useDateRangeQueryState();
  const graphData = useContext(GraphContext);
  const {
    namespace: { name: namespace },
  } = useWorkspace();

  const { data: featureFlagsData } = useQuery(
    getFeatureFlagsByFederatedGraph,
    {
      federatedGraphName: graphData?.graph?.name,
      namespace,
    },
    {
      enabled: !!graphData?.graph?.name,
    },
  );
  const featureFlags = featureFlagsData?.featureFlags ?? [];
  const [featureFlagName, setFeatureFlagName] = useQueryState('featureFlag');

  const onDateRangeChange: DateRangePickerChangeHandler = ({ dateRange, range }) => {
    if (range) {
      applyParams({
        range: range.toString(),
        dateRange: null,
      });
    } else if (dateRange) {
      const stringifiedDateRange = JSON.stringify({
        start: formatISO(dateRange.start),
        end: formatISO(dateRange.end ?? dateRange.start),
      });

      applyParams({
        range: null,
        dateRange: stringifiedDateRange,
      });
    }
  };

  const changelogRetention = useFeatureLimit('changelog-retention', 7);

  return (
    <Toolbar>
      <DatePickerWithRange
        range={range}
        dateRange={dateRange}
        onChange={onDateRangeChange}
        align="start"
        calendarDaysLimit={changelogRetention}
      />
      <Select
        value={featureFlagName ?? BASE_GRAPH_VALUE}
        onValueChange={(val) => setFeatureFlagName(val === BASE_GRAPH_VALUE ? null : val)}
      >
        {/* A fixed width, so the toolbar doesn't shift with the length of the selected name; long names are truncated */}
        <SelectTrigger className="w-[200px] [&>span]:min-w-0 [&>span]:truncate [&_p]:flex [&_p]:items-center">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            value={BASE_GRAPH_VALUE}
            title={graphData?.graph?.name}
            className="[&_p]:max-w-[264px] [&_p]:truncate"
          >
            {graphData?.graph?.name}
          </SelectItem>
          {featureFlags.map(({ id, name, isEnabled }) => (
            <SelectItem
              key={id}
              value={name}
              title={isEnabled ? name : `${name} (disabled)`}
              className="[&_p]:flex [&_p]:max-w-[264px] [&_p]:items-center"
            >
              {/* Only the name is truncated, so the disabled badge stays visible for long names */}
              <span className="min-w-0 truncate">{name}</span>
              {!isEnabled && (
                <Badge variant="destructive" className="ml-2 shrink-0 px-1.5 py-0 text-[10px]">
                  Disabled
                </Badge>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Toolbar>
  );
};

const ChangelogPage: NextPageWithLayout = () => {
  const router = useRouter();
  const limit = 10;
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    namespace: { name: namespace },
  } = useWorkspace();
  const { slug: graphName } = useParams<{ slug: string }>();

  const graphData = useContext(GraphContext);

  const validGraph = graphData?.graph?.isComposable && !!graphData?.graph?.lastUpdatedAt;

  const {
    dateRange: { start, end },
    range,
  } = useDateRangeQueryState();

  const startDate = range ? createDateRange(range).start : start;
  const endDate = range ? createDateRange(range).end : end;

  // Without a feature flag, the changelog of the federated graph itself is shown
  const [featureFlagName] = useQueryState('featureFlag');

  // Each date range and feature flag selection is its own query, so switching between them never mixes their pages
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, error, refetch } = useInfiniteQuery(
    getFederatedGraphChangelog,
    {
      name: graphName,
      namespace,
      featureFlagName: featureFlagName ?? undefined,
      pagination: {
        limit,
        offset: 0,
      },
      dateRange: {
        start: formatISO(startOfDay(startDate)),
        end: formatISO(endOfDay(endDate)),
      },
    },
    {
      pageParamKey: 'pagination',
      getNextPageParam: (lastPage, allPages) =>
        lastPage.hasNextPage ? { limit, offset: allPages.length * limit } : undefined,
    },
  );

  const items = data?.pages.flatMap((page) => page.federatedGraphChangelogOutput) ?? [];
  const lastPage = data?.pages[data.pages.length - 1];

  useEffect(() => {
    // Start a new selection from the top instead of the previous selection's scroll position
    scrollRef.current?.scrollTo({ top: 0 });
  }, [router.query.dateRange, router.query.range, featureFlagName]);

  useEffect(() => {
    // The changelog scrolls inside the page layout, not the window
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      if (
        container.scrollTop + container.clientHeight >= container.scrollHeight - 5 &&
        hasNextPage &&
        !isFetchingNextPage
      ) {
        fetchNextPage();
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  let content: ReactNode;
  if (isLoading) {
    // Keep the toolbar mounted while a new selection loads, instead of replacing the whole page with a loader
    content = (
      <div className="my-24">
        <Loader />
      </div>
    );
  } else if (items.length === 0 && (!lastPage || error || lastPage.response?.code !== EnumStatusCode.OK)) {
    content = (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve changelog"
        description={lastPage?.response?.details || error?.message || 'Please try again'}
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  return (
    <GraphPageLayout
      title="Changelog"
      subtitle="Keep track of changes made to your federated graph"
      toolbar={<ChangelogToolbar />}
      scrollRef={scrollRef}
    >
      {content ? (
        content
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CommandLineIcon />}
          title="Publish schema using the CLI"
          description={
            <>
              No changelogs found. Use the CLI tool to publish or adjust the date range.{' '}
              <a target="_blank" rel="noreferrer" href={docsBaseURL + '/cli/subgraph/publish'} className="text-primary">
                Learn more.
              </a>
            </>
          }
          actions={
            <CLI
              command={
                !graphData?.graph?.supportsFederation
                  ? `npx wgc monograph publish ${graphData?.graph?.name} --namespace ${namespace} --schema <path-to-schema>`
                  : `npx wgc subgraph publish <subgraph-name> --namespace ${namespace} --schema <path-to-schema>`
              }
            />
          }
        />
      ) : (
        <div className="relative">
          {!validGraph && <CompositionErrorsBanner errors={graphData?.graph?.compositionErrors} />}
          <div className="sticky top-[20px] z-20 h-0 overflow-visible">
            <div className="absolute right-0 hidden w-[280px] grid-cols-2 rounded border bg-card px-4 py-2 lg:grid">
              <h2 className="text-sm font-semibold">Jump to log</h2>
              <div className="scrollbar-custom flex max-h-96 flex-col overflow-y-auto text-xs">
                {items.map(({ schemaVersionId: id, createdAt }) => {
                  return (
                    <button
                      onClick={() => {
                        const parent = scrollRef.current || window;
                        const element = document.getElementById(id)!;
                        const offset = 112;

                        const top = scrollRef.current ? scrollRef.current.scrollTop : window.scrollY;

                        const elementPosition = element.getBoundingClientRect().top;
                        const scrollPosition = top + elementPosition - offset;

                        parent.scrollTo({ top: scrollPosition });
                      }}
                      key={id}
                      className="text-left text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {formatDateTime(new Date(createdAt))}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="absolute left-40 ml-1.5 hidden h-full w-px border-r lg:block" />
          <Changelog entries={items} />
          {isFetchingNextPage && (
            <div className="my-12">
              <Loader />
            </div>
          )}
          {!hasNextPage && <p className="mx-auto py-12 text-sm font-bold leading-none">End of changelog</p>}
        </div>
      )}
    </GraphPageLayout>
  );
};

ChangelogPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: 'Changelog',
  });

export default ChangelogPage;

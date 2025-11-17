import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useDateRangeQueryState } from "@/components/analytics/useAnalyticsQueryState";
import { Changelog } from "@/components/changelog/changelog";
import { CompositionErrorsBanner } from "@/components/composition-errors-banner";
import {
  DatePickerWithRange,
  DateRangePickerChangeHandler,
} from "@/components/date-picker-with-range";
import { EmptyState } from "@/components/empty-state";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { Button } from "@/components/ui/button";
import { CLI } from "@/components/ui/cli";
import { Loader } from "@/components/ui/loader";
import { Toolbar } from "@/components/ui/toolbar";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { docsBaseURL } from "@/lib/constants";
import { formatDateTime } from "@/lib/format-date";
import { createDateRange } from "@/lib/insights-helpers";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import {
  CommandLineIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getFederatedGraphChangelog } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { FederatedGraphChangelogOutput } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { endOfDay, formatISO, startOfDay } from "date-fns";
import { useRouter } from "next/router";
import { useContext, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/hooks/use-workspace";

const ChangelogToolbar = () => {
  const applyParams = useApplyParams();
  const { dateRange, range } = useDateRangeQueryState();

  const onDateRangeChange: DateRangePickerChangeHandler = ({
    dateRange,
    range,
  }) => {
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

  const changelogRetention = useFeatureLimit("changelog-retention", 7);

  return (
    <Toolbar>
      <DatePickerWithRange
        range={range}
        dateRange={dateRange}
        onChange={onDateRangeChange}
        align="start"
        calendarDaysLimit={changelogRetention}
      />
    </Toolbar>
  );
};

const ChangelogPage: NextPageWithLayout = () => {
  const router = useRouter();
  const limit = 10;
  const [items, setItems] = useState<FederatedGraphChangelogOutput[]>([]);
  const [offset, setOffset] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { namespace: { name: namespace } } = useWorkspace();

  const graphData = useContext(GraphContext);

  const validGraph =
    graphData?.graph?.isComposable && !!graphData?.graph?.lastUpdatedAt;

  const {
    dateRange: { start, end },
    range,
  } = useDateRangeQueryState();

  const startDate = range ? createDateRange(range).start : start;
  const endDate = range ? createDateRange(range).end : end;

  const { data, isLoading, isSuccess, error, refetch } = useQuery(
    getFederatedGraphChangelog,
    {
      name: router.query.slug as string,
      namespace,
      pagination: {
        limit,
        offset,
      },
      dateRange: {
        start: formatISO(startOfDay(startDate)),
        end: formatISO(endOfDay(endDate)),
      },
    },
    {
      enabled: false,
    },
  );

  useEffect(() => {
    if (isSuccess && data) {
      setItems((prev) => [...prev, ...data.federatedGraphChangelogOutput]);
    }
  }, [data, isSuccess]);

  useEffect(() => {
    // We need to fetch from scratch on date change
    setItems([]);
    setOffset(0);
  }, [router.query.dateRange, router.query.range]);

  useEffect(() => {
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 5 &&
        !isLoading &&
        data?.hasNextPage
      ) {
        setOffset((prevOffset) => prevOffset + limit);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isLoading, data?.hasNextPage]);

  useEffect(() => {
    refetch();
  }, [refetch, offset, router.query.dateRange, router.query.range]);

  if (items.length === 0 && isLoading) return <Loader fullscreen />;

  if (
    items.length === 0 &&
    (!data || error || data.response?.code !== EnumStatusCode.OK)
  )
    return (
      <GraphPageLayout
        title="Changelog"
        subtitle="Keep track of changes made to your federated graph"
        toolbar={<ChangelogToolbar />}
        scrollRef={scrollRef}
      >
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve changelog"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </GraphPageLayout>
    );

  return (
    <GraphPageLayout
      title="Changelog"
      subtitle="Keep track of changes made to your federated graph"
      toolbar={<ChangelogToolbar />}
      scrollRef={scrollRef}
    >
      {items.length === 0 ? (
        <EmptyState
          icon={<CommandLineIcon />}
          title="Publish schema using the CLI"
          description={
            <>
              No changelogs found. Use the CLI tool to publish or adjust the
              date range.{" "}
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
          {!validGraph && (
            <CompositionErrorsBanner
              errors={graphData?.graph?.compositionErrors}
            />
          )}
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

                        const top = scrollRef.current
                          ? scrollRef.current.scrollTop
                          : window.scrollY;

                        const elementPosition =
                          element.getBoundingClientRect().top;
                        const scrollPosition = top + elementPosition - offset;

                        parent.scrollTo({ top: scrollPosition });
                      }}
                      key={createdAt}
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
          {!data?.hasNextPage && (
            <p className="mx-auto py-12 text-sm font-bold leading-none">
              End of changelog
            </p>
          )}
        </div>
      )}
    </GraphPageLayout>
  );
};

ChangelogPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Changelog",
  });

export default ChangelogPage;

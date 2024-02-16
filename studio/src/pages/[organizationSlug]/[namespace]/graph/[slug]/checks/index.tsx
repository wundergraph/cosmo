import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useDateRangeQueryState } from "@/components/analytics/useAnalyticsQueryState";
import {
  getCheckBadge,
  getCheckIcon,
  isCheckSuccessful,
} from "@/components/check-badge-icon";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CLI } from "@/components/ui/cli";
import { Loader } from "@/components/ui/loader";
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui/table";
import { Toolbar } from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { useSessionStorage } from "@/hooks/use-session-storage";
import { useUser } from "@/hooks/use-user";
import { docsBaseURL } from "@/lib/constants";
import { formatDateTime } from "@/lib/format-date";
import { createDateRange } from "@/lib/insights-helpers";
import { NextPageWithLayout } from "@/lib/page";
import {
  CommandLineIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
  GitHubLogoIcon,
} from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getChecksByFederatedGraphName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  endOfDay,
  formatDistanceToNow,
  formatISO,
  startOfDay,
  subDays,
} from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useContext } from "react";

const ChecksPage: NextPageWithLayout = () => {
  const router = useRouter();
  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;

  const limit = Number.parseInt((router.query.pageSize as string) || "10");

  const {
    dateRange: { start, end },
    range,
  } = useDateRangeQueryState();
  const startDate = range ? createDateRange(range).start : start;
  const endDate = range ? createDateRange(range).end : end;

  const graphContext = useContext(GraphContext);

  const [, setRouteCache] = useSessionStorage("checks.route", router.asPath);

  const { data, isLoading, error, refetch } = useQuery(
    getChecksByFederatedGraphName.useQuery({
      name: router.query.slug as string,
      namespace: router.query.namespace as string,
      limit: limit > 50 ? 50 : limit,
      offset: (pageNumber - 1) * limit,
      startDate: formatISO(startDate),
      endDate: formatISO(endDate),
    }),
  );

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve federated graphs"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  if (!data?.checks || !graphContext?.graph) return null;

  if (data.totalChecksCount === 0)
    return (
      <EmptyState
        icon={<CommandLineIcon />}
        title="Run checks using the CLI"
        description={
          <>
            No checks found. Use the CLI tool to run one{" "}
            <a
              target="_blank"
              rel="noreferrer"
              href={docsBaseURL + "/cli/subgraphs/check"}
              className="text-primary"
            >
              Learn more.
            </a>
          </>
        }
        actions={
          <CLI
            command={`npx wgc subgraph check users --namespace ${router.query.namespace} --schema users.graphql`}
          />
        }
      />
    );

  const noOfPages = Math.ceil(data.checksCountBasedOnDateRange / limit);

  return (
    <div className="flex h-full flex-col gap-y-3">
      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Check</TableHead>
              <TableHead>Subgraph</TableHead>
              <TableHead>Tasks</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.checks.length !== 0 ? (
              data.checks.map(
                ({
                  id,
                  isComposable,
                  isBreaking,
                  hasClientTraffic,
                  isForcedSuccess,
                  subgraphName,
                  timestamp,
                  ghDetails,
                }) => {
                  const isSuccessful = isCheckSuccessful(
                    isComposable,
                    isBreaking,
                    hasClientTraffic,
                  );

                  const path = `${router.asPath.split("?")[0]}/${id}`;

                  return (
                    <TableRow
                      key={id}
                      className="group cursor-pointer hover:bg-secondary/30"
                      onClick={() => router.push(path)}
                    >
                      <TableCell>
                        <div className="flex flex-row items-center gap-1">
                          <div className="w-20">
                            {getCheckBadge(isSuccessful, isForcedSuccess)}
                          </div>

                          <div className="flex flex-col items-start">
                            <Link
                              href={path}
                              className="font-medium text-foreground"
                            >
                              {id}
                            </Link>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-xs text-muted-foreground">
                                  {formatDistanceToNow(new Date(timestamp), {
                                    addSuffix: true,
                                  })}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                {formatDateTime(new Date(timestamp))}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{subgraphName}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-start gap-2">
                          <Badge variant="outline" className="gap-2 py-1.5">
                            {getCheckIcon(isComposable)} <span>Composes</span>
                          </Badge>

                          <Badge variant="outline" className="gap-2 py-1.5">
                            {getCheckIcon(!isBreaking)}{" "}
                            <span>Breaking changes</span>
                          </Badge>
                          <Badge variant="outline" className="gap-2 py-1.5">
                            {getCheckIcon(!hasClientTraffic)}{" "}
                            <span>Operations</span>
                          </Badge>
                        </div>
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {ghDetails ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  asChild
                                  variant="ghost"
                                  size="sm"
                                  className="table-action"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Link
                                    href={`https://github.com/${ghDetails.ownerSlug}/${ghDetails.repositorySlug}/commit/${ghDetails.commitSha}`}
                                    className="inline-flex items-center gap-2 text-xs"
                                    aria-label="View on GitHub"
                                    target="_blank"
                                  >
                                    <GitHubLogoIcon />
                                  </Link>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Commit {ghDetails.commitSha.substring(0, 7)}
                                <br />
                                <strong>View on GitHub</strong>
                              </TooltipContent>
                            </Tooltip>
                          ) : null}
                          <Button
                            asChild
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setRouteCache(router.asPath);
                            }}
                            className="table-action"
                          >
                            <Link href={path}>View</Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                },
              )
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableWrapper>
      <Pagination limit={limit} noOfPages={noOfPages} pageNumber={pageNumber} />
    </div>
  );
};

const ChecksToolbar = () => {
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

  const breakingChangeRetention = useFeatureLimit(
    "breaking-change-retention",
    7,
  );

  return (
    <Toolbar>
      <DatePickerWithRange
        range={range}
        dateRange={dateRange}
        onChange={onDateRangeChange}
        calendarDaysLimit={breakingChangeRetention}
      />
    </Toolbar>
  );
};

ChecksPage.getLayout = (page) =>
  getGraphLayout(
    <GraphPageLayout
      title="Checks"
      subtitle="A record of composition and schema checks"
      toolbar={<ChecksToolbar />}
    >
      {page}
    </GraphPageLayout>,
    {
      title: "Checks",
    },
  );

export default ChecksPage;

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
import {
  ChecksFilterMenu,
  parseSelectedSubgraphs,
} from "@/components/checks/checks-filter-menu";
import { SelectedChecksFilters } from "@/components/checks/selected-checks-filters";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { useSessionStorage } from "@/hooks/use-session-storage";
import { docsBaseURL } from "@/lib/constants";
import { formatDateTime } from "@/lib/format-date";
import { createDateRange } from "@/lib/insights-helpers";
import { NextPageWithLayout } from "@/lib/page";
import {
  CommandLineIcon,
  ExclamationTriangleIcon,
  NoSymbolIcon,
} from "@heroicons/react/24/outline";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { useQuery } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getChecksByFederatedGraphName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { formatDistanceToNow, formatISO } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext } from "react";
import { cn } from "@/lib/utils";
import { useFeature } from "@/hooks/use-feature";
import { useWorkspace } from "@/hooks/use-workspace";

const ChecksPage: NextPageWithLayout = () => {
  const router = useRouter();
  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;

  const limit = Number.parseInt((router.query.pageSize as string) || "10");
  const selectedSubgraphs = parseSelectedSubgraphs(router.query.subgraphs);
  const { namespace: { name: namespace } } = useWorkspace();

  const {
    dateRange: { start, end },
    range,
  } = useDateRangeQueryState();
  const startDate = range ? createDateRange(range).start : start;
  const endDate = range ? createDateRange(range).end : end;

  const graphContext = useContext(GraphContext);
  const proposalsFeature = useFeature("proposals");

  const [, setRouteCache] = useSessionStorage("checks.route", router.asPath);

  const { data, isLoading, error, refetch } = useQuery(
    getChecksByFederatedGraphName,
    {
      name: router.query.slug as string,
      namespace,
      limit: limit > 50 ? 50 : limit,
      offset: (pageNumber - 1) * limit,
      startDate: formatISO(startDate),
      endDate: formatISO(endDate),
      filters: {
        subgraphs: !selectedSubgraphs.length
          ? graphContext?.subgraphs?.map((sg) => sg.id) ?? []
          : selectedSubgraphs,
      },
    },
    {
      placeholderData: (prev) => prev,
    },
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

  if (data.checks.length === 0)
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
              href={docsBaseURL + "/cli/subgraph/check"}
              className="text-primary"
            >
              Learn more.
            </a>
          </>
        }
        actions={
          <CLI
            command={
              !graphContext.graph.supportsFederation
                ? `npx wgc monograph check ${graphContext.graph?.name} --namespace ${namespace} --schema <path-to-schema>`
                : `npx wgc subgraph check users --namespace ${namespace} --schema users.graphql`
            }
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
              {graphContext.graph.supportsFederation && (
                <TableHead>Subgraph</TableHead>
              )}
              <TableHead>Tasks</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.checks.length !== 0 &&
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
                  hasLintErrors,
                  hasGraphPruningErrors,
                  clientTrafficCheckSkipped,
                  lintSkipped,
                  graphPruningSkipped,
                  checkedSubgraphs,
                  proposalMatch,
                  compositionSkipped,
                  breakingChangesSkipped,
                  linkedChecks,
                }) => {
                  const isLinkedTrafficCheckFailed = linkedChecks.some(
                    (linkedCheck) =>
                      linkedCheck.hasClientTraffic &&
                      !linkedCheck.isForcedSuccess,
                  );
                  const isLinkedPruningCheckFailed = linkedChecks.some(
                    (linkedCheck) =>
                      linkedCheck.hasGraphPruningErrors &&
                      !linkedCheck.isForcedSuccess,
                  );
                  const isSuccessful = isCheckSuccessful(
                    isComposable,
                    isBreaking,
                    hasClientTraffic,
                    hasLintErrors,
                    hasGraphPruningErrors,
                    clientTrafficCheckSkipped,
                    proposalMatch === "error",
                    isLinkedTrafficCheckFailed,
                    isLinkedPruningCheckFailed,
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
                      {graphContext.graph?.supportsFederation && (
                        <TableCell>
                          {subgraphName ||
                            (checkedSubgraphs.length > 1
                              ? "Multiple Subgraphs"
                              : checkedSubgraphs.length > 0
                              ? checkedSubgraphs[0].subgraphName
                              : "Subgraph")}
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex flex-wrap items-start gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "gap-2 py-1.5",
                              compositionSkipped && "text-muted-foreground",
                            )}
                          >
                            {compositionSkipped ? (
                              <NoSymbolIcon className="h-4 w-4" />
                            ) : (
                              getCheckIcon(isComposable)
                            )}
                            <span>Composes</span>
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              "gap-2 py-1.5",
                              breakingChangesSkipped && "text-muted-foreground",
                            )}
                          >
                            {breakingChangesSkipped ? (
                              <NoSymbolIcon className="h-4 w-4" />
                            ) : (
                              getCheckIcon(!isBreaking)
                            )}
                            <span>Breaking changes</span>
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              "gap-2 py-1.5",
                              clientTrafficCheckSkipped &&
                                "text-muted-foreground",
                            )}
                          >
                            {clientTrafficCheckSkipped ? (
                              <NoSymbolIcon className="h-4 w-4" />
                            ) : (
                              getCheckIcon(!hasClientTraffic)
                            )}
                            <span>Operations</span>
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              "gap-2 py-1.5",
                              lintSkipped && "text-muted-foreground",
                            )}
                          >
                            {lintSkipped ? (
                              <NoSymbolIcon className="h-4 w-4" />
                            ) : (
                              getCheckIcon(!hasLintErrors)
                            )}
                            <span>Lint Errors</span>
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              "gap-2 py-1.5",
                              graphPruningSkipped && "text-muted-foreground",
                            )}
                          >
                            {graphPruningSkipped ? (
                              <NoSymbolIcon className="h-4 w-4" />
                            ) : (
                              getCheckIcon(!hasGraphPruningErrors)
                            )}
                            <span className="flex-1 truncate">
                              Pruning Errors
                            </span>
                          </Badge>
                          {proposalsFeature?.enabled && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "gap-2 py-1.5",
                                !proposalMatch && "text-muted-foreground",
                              )}
                            >
                              {!proposalMatch ? (
                                <NoSymbolIcon className="h-4 w-4" />
                              ) : (
                                getCheckIcon(proposalMatch !== "error")
                              )}
                              <span className="flex-1 truncate">
                                Proposal Match
                              </span>
                            </Badge>
                          )}
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

      <ChecksFilterMenu />
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

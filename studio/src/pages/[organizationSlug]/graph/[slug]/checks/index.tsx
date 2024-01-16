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

const useDateRange = () => {
  const router = useRouter();

  const dateRange = router.query.dateRange
    ? JSON.parse(router.query.dateRange as string)
    : {
        start: subDays(new Date(), 7),
        end: new Date(),
      };
  const startDate = new Date(dateRange.start);
  const endDate = new Date(dateRange.end);

  return {
    startDate,
    endDate,
  };
};

const ChecksPage: NextPageWithLayout = () => {
  const router = useRouter();
  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;

  const limit = Number.parseInt((router.query.pageSize as string) || "10");

  const { startDate, endDate } = useDateRange();

  const graphContext = useContext(GraphContext);

  const [, setRouteCache] = useSessionStorage("checks.route", router.asPath);

  const { data, isLoading, error, refetch } = useQuery(
    getChecksByFederatedGraphName.useQuery({
      name: router.query.slug as string,
      limit: limit,
      offset: (pageNumber - 1) * limit,
      startDate: formatISO(startOfDay(startDate)),
      endDate: formatISO(endOfDay(endDate)),
    }),
  );

  const applyNewParams = useCallback(
    (newParams: Record<string, string>) => {
      router.push({
        query: {
          ...router.query,
          ...newParams,
        },
      });
    },
    [router],
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

  if (parseInt(data.totalChecksCount) === 0)
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
            command={`npx wgc subgraph check users --schema users.graphql`}
          />
        }
      />
    );

  const noOfPages = Math.ceil(
    parseInt(data.checksCountBasedOnDateRange) / limit,
  );

  return (
    <div className="flex flex-col gap-y-3">
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
                        <div className="flex items-start gap-2">
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
      <div className="mr-2 flex justify-end">
        <div className="flex items-center space-x-2">
          <p className="text-sm font-medium">Rows per page</p>
          <Select
            value={`${limit}`}
            onValueChange={(value) => {
              applyNewParams({ pageSize: value });
            }}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue placeholder={`${limit}`} />
            </SelectTrigger>
            <SelectContent side="top">
              {[10, 20, 30, 40, 50].map((pageSize) => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-[100px] items-center justify-center text-sm font-medium">
          Page {noOfPages === 0 ? "0" : pageNumber} of {noOfPages}
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => {
              applyNewParams({ page: "1" });
            }}
            disabled={pageNumber === 1}
          >
            <span className="sr-only">Go to first page</span>
            <DoubleArrowLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => {
              applyNewParams({ page: (pageNumber - 1).toString() });
            }}
            disabled={pageNumber === 1}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => {
              applyNewParams({ page: (pageNumber + 1).toString() });
            }}
            disabled={pageNumber === noOfPages || noOfPages === 0}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => {
              applyNewParams({ page: noOfPages.toString() });
            }}
            disabled={pageNumber === noOfPages || noOfPages === 0}
          >
            <span className="sr-only">Go to last page</span>
            <DoubleArrowRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

const ChecksToolbar = () => {
  const router = useRouter();
  const user = useUser();

  const { startDate, endDate } = useDateRange();

  const onDateRangeChange: DateRangePickerChangeHandler = ({ dateRange }) => {
    const stringifiedDateRange = JSON.stringify({
      start: dateRange?.start as Date,
      end: (dateRange?.end as Date) ?? (dateRange?.end as Date),
    });

    router.push({
      query: {
        ...router.query,
        dateRange: stringifiedDateRange,
      },
    });
  };

  const breakingChangeRetention = useFeatureLimit(
    "breaking-change-retention",
    7,
  );

  return (
    <Toolbar>
      <DatePickerWithRange
        dateRange={{ start: startDate, end: endDate }}
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

import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useDateRangeQueryState } from "@/components/analytics/useAnalyticsQueryState";
import { getCheckIcon } from "@/components/check-badge-icon";
import {
  DatePickerWithRange,
  DateRangePickerChangeHandler,
} from "@/components/date-picker-with-range";
import { EmptyState } from "@/components/empty-state";
import { InfoTooltip } from "@/components/info-tooltip";
import {
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { formatDateTime } from "@/lib/format-date";
import { createDateRange } from "@/lib/insights-helpers";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getCompositions } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { formatDistanceToNow, formatISO } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { MdNearbyError, MdVerifiedUser } from "react-icons/md";
import { useWorkspace } from "@/hooks/use-workspace";

const CompositionsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;

  const limit = Number.parseInt((router.query.pageSize as string) || "10");
  const { namespace: { name: namespace } } = useWorkspace();

  const {
    dateRange: { start, end },
    range,
  } = useDateRangeQueryState();

  const startDate = range ? createDateRange(range).start : start;
  const endDate = range ? createDateRange(range).end : end;

  const { data, isLoading, error, refetch } = useQuery(
    getCompositions,
    {
      fedGraphName: router.query.slug as string,
      namespace,
      limit: limit > 50 ? 50 : limit,
      offset: (pageNumber - 1) * limit,
      startDate: formatISO(startDate),
      endDate: formatISO(endDate),
      excludeFeatureFlagCompositions: true,
    },
    {
      placeholderData: (prev) => prev,
    },
  );

  if (isLoading) return <Loader fullscreen />;

  if (
    !data ||
    !data?.compositions ||
    error ||
    data?.response?.code !== EnumStatusCode.OK
  )
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

  const noOfPages = Math.ceil(data.count / limit);

  return (
    <div className="flex h-full flex-col gap-y-3">
      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Id</TableHead>
              <TableHead>Triggered By Subgraph</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead className="flex items-center space-x-1">
                <div>Admission</div>
                <div>
                  <InfoTooltip>
                    Indicates if the composition has been validated and signed
                    by your Admission Controller.
                  </InfoTooltip>
                </div>
              </TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.compositions.length !== 0 ? (
              data.compositions.map(
                ({
                  id,
                  isComposable,
                  createdAt,
                  createdBy,
                  isLatestValid,
                  admissionError,
                  routerConfigSignature,
                  deploymentError,
                  hasMultipleChangedSubgraphs,
                  triggeredBySubgraphName,
                }) => {
                  const path = `${router.asPath.split("?")[0]}/${id}`;
                  return (
                    <TableRow
                      key={id}
                      className="group cursor-pointer hover:bg-secondary/30"
                      onClick={() => router.push(path)}
                    >
                      <TableCell>
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
                                {formatDistanceToNow(new Date(createdAt), {
                                  addSuffix: true,
                                })}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              {formatDateTime(new Date(createdAt))}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                      <TableCell
                        className={cn({
                          italic: hasMultipleChangedSubgraphs,
                        })}
                      >
                        {hasMultipleChangedSubgraphs
                          ? "Multiple Subgraphs"
                          : triggeredBySubgraphName}
                      </TableCell>
                      <TableCell>{createdBy}</TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger>
                            <div className="flex items-center space-x-1">
                              {admissionError ? (
                                <Badge
                                  variant="outline"
                                  className="gap-2 py-1.5"
                                >
                                  <MdNearbyError className="h-4 w-4 text-destructive" />
                                  <span>Error</span>
                                </Badge>
                              ) : routerConfigSignature ? (
                                <Badge
                                  variant="outline"
                                  className="gap-2 py-1.5"
                                >
                                  <MdVerifiedUser className="h-4 w-4 text-amber-500" />
                                  <span>Validated & Signed</span>
                                </Badge>
                              ) : (
                                "-"
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {admissionError ? (
                              <>
                                {" "}
                                This composition could not be validated due to
                                an error in the Admission Controller Webhooks.
                                Please open the composition details page to see
                                the error.
                              </>
                            ) : routerConfigSignature ? (
                              <>
                                {" "}
                                This composition has been validated and signed
                                successfully by your Admission Controller.
                              </>
                            ) : null}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="w-[128px] md:w-auto">
                        <div className="flex w-max flex-col gap-2 md:flex-row md:items-center">
                          <Badge variant="outline" className="gap-2 py-1.5">
                            {getCheckIcon(isComposable)} <span>Composes</span>
                          </Badge>
                          {isLatestValid && (
                            <Badge
                              variant="outline"
                              className="gap-2 bg-success py-1.5"
                            >
                              <div className="h-2 w-2 rounded-full bg-white" />
                              <span>Ready to fetch</span>
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="table-action"
                        >
                          <Link href={path}>View</Link>
                        </Button>
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

const CompositionToolbar = () => {
  const applyParams = useApplyParams();

  const {
    dateRange: { start: startDate, end: endDate },
    range,
  } = useDateRangeQueryState();

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
        dateRange={{ start: startDate, end: endDate }}
        onChange={onDateRangeChange}
        calendarDaysLimit={breakingChangeRetention}
      />
    </Toolbar>
  );
};

CompositionsPage.getLayout = (page) =>
  getGraphLayout(
    <GraphPageLayout
      title="Compositions"
      subtitle="A record of compositions"
      toolbar={<CompositionToolbar />}
    >
      {page}
    </GraphPageLayout>,
    {
      title: "Compositions",
    },
  );

export default CompositionsPage;

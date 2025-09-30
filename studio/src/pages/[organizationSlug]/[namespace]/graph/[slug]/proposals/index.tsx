import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useDateRangeQueryState } from "@/components/analytics/useAnalyticsQueryState";
import { getCheckIcon } from "@/components/check-badge-icon";
import {
  DatePickerWithRange,
  DateRangePickerChangeHandler,
} from "@/components/date-picker-with-range";
import { EmptyState } from "@/components/empty-state";
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
import { useFeature } from "@/hooks/use-feature";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { useUser } from "@/hooks/use-user";
import { formatDateTime } from "@/lib/format-date";
import { createDateRange } from "@/lib/insights-helpers";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getProposalsByFederatedGraph } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { formatDistanceToNow, formatISO } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useWorkspace } from "@/hooks/use-workspace";

const ProposalsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const user = useUser();
  const proposalsFeature = useFeature("proposals");
  const federatedGraphName = router.query.slug as string;
  const { namespace: { name: namespace } } = useWorkspace();
  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;

  const limit = Number.parseInt((router.query.pageSize as string) || "10");

  const {
    dateRange: { start, end },
    range,
  } = useDateRangeQueryState(168);

  const startDate = range ? createDateRange(range).start : start;
  const endDate = range ? createDateRange(range).end : end;

  const { data, isLoading, error, refetch } = useQuery(
    getProposalsByFederatedGraph,
    {
      federatedGraphName,
      namespace,
      startDate: formatISO(startDate),
      endDate: formatISO(endDate),
      limit,
      offset: (pageNumber - 1) * limit,
    },
    {
      placeholderData: (prev) => prev,
      enabled: proposalsFeature?.enabled,
    },
  );

  if (!proposalsFeature?.enabled) {
    return (
      <EmptyState
        icon={<InfoCircledIcon className="h-12 w-12" />}
        title="Proposals are not available"
        description="Please contact support to enable the proposals feature."
      />
    );
  }

  if (isLoading) return <Loader fullscreen />;

  if (!data?.isProposalsEnabled) {
    return (
      <EmptyState
        icon={<InfoCircledIcon className="h-12 w-12" />}
        title="Proposals are not enabled"
        description="Enable proposals to create and manage schema change proposals."
        actions={
          <Button
            onClick={() => {
              router.push(
                `/${user?.currentOrganization.slug}/policies?namespace=${router.query.namespace}#proposals`,
              );
            }}
          >
            Configure Proposals
          </Button>
        }
      />
    );
  }

  if (!data || error || data?.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve proposals"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  // Since API doesn't support pagination yet, we need to do client-side pagination
  const startIndex = (pageNumber - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedProposals = data.proposals.slice(startIndex, endIndex);
  const noOfPages = Math.ceil(data.proposals.length / limit);

  return (
    <div className="flex h-full flex-col gap-y-3">
      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Id</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Created By</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Latest Check</TableHead>
              <TableHead className="text-center">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedProposals.length !== 0 ? (
              paginatedProposals.map((proposal) => {
                const {
                  id,
                  name,
                  createdAt,
                  createdByEmail,
                  state,
                  subgraphs,
                } = proposal;
                // These fields will be available after the RPC is updated
                const latestCheckSuccess = (proposal as any).latestCheckSuccess;
                const latestCheckId = (proposal as any).latestCheckId;

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
                    <TableCell>{name}</TableCell>
                    <TableCell>{createdByEmail}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn("gap-2 py-1.5", {
                          "border-success/20 bg-success/10 text-success hover:bg-success/20":
                            state === "APPROVED",
                          "border-warning/20 bg-warning/10 text-warning hover:bg-warning/20":
                            state === "DRAFT",
                          "border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/20":
                            state === "CLOSED",
                          "border-purple-400/20 bg-purple-400/10 text-purple-400 hover:bg-purple-400/20":
                            state === "PUBLISHED",
                        })}
                      >
                        <span>{state}</span>
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {latestCheckId ? (
                        <Link
                          href={`/${user?.currentOrganization.slug}/${namespace}/graph/${federatedGraphName}/checks/${latestCheckId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-2"
                        >
                          {getCheckIcon(latestCheckSuccess)}
                          <span>
                            {latestCheckSuccess ? "Successful" : "Failed"}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          No checks run
                        </span>
                      )}
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
              })
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  No proposals found.
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

const ProposalToolbar = () => {
  const applyParams = useApplyParams();

  const {
    dateRange: { start: startDate, end: endDate },
    range,
  } = useDateRangeQueryState(168);

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

  const proposalRetention = useFeatureLimit("proposal-retention", 30);

  return (
    <Toolbar>
      <DatePickerWithRange
        range={range}
        dateRange={{ start: startDate, end: endDate }}
        onChange={onDateRangeChange}
        calendarDaysLimit={proposalRetention}
      />
    </Toolbar>
  );
};

ProposalsPage.getLayout = (page) =>
  getGraphLayout(
    <GraphPageLayout
      title="Proposals"
      subtitle="A record of schema change proposals"
      toolbar={<ProposalToolbar />}
    >
      {page}
    </GraphPageLayout>,
    {
      title: "Proposals",
    },
  );

export default ProposalsPage;

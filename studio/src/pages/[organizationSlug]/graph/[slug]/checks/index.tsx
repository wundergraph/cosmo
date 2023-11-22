import { UserContext } from "@/components/app-provider";
import {
  getCheckBadge,
  getCheckIcon,
  isCheckSuccessful,
} from "@/components/check-badge-icon";
import { DateRangePicker } from "@/components/date-range-picker";
import { EmptyState } from "@/components/empty-state";
import { GraphContext, getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
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
} from "@/components/ui/table";
import { useSessionStorage } from "@/hooks/use-session-storage";
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
} from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getChecksByFederatedGraphName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { endOfDay, formatISO, startOfDay, subDays } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useContext } from "react";
import { DateRange } from "react-day-picker";

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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">Timestamp</TableHead>
            <TableHead>Subgraph</TableHead>
            <TableHead className="text-center">Status</TableHead>
            <TableHead className="text-center">Composition Check</TableHead>
            <TableHead className="text-center">
              Breaking Change Detection
            </TableHead>
            <TableHead className="text-center">Operations Check</TableHead>
            <TableHead className="text-center">Details</TableHead>
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
              }) => {
                const isSuccessful = isCheckSuccessful(
                  isComposable,
                  isBreaking,
                  hasClientTraffic,
                );

                return (
                  <TableRow key={id}>
                    <TableCell className="font-medium ">
                      {formatDateTime(new Date(timestamp))}
                    </TableCell>
                    <TableCell>{subgraphName}</TableCell>
                    <TableCell className="text-center">
                      {getCheckBadge(isSuccessful, isForcedSuccess)}
                    </TableCell>
                    <TableCell>{getCheckIcon(isComposable)}</TableCell>
                    <TableCell>{getCheckIcon(!isBreaking)}</TableCell>
                    <TableCell>{getCheckIcon(!hasClientTraffic)}</TableCell>
                    <TableCell className="text-center text-primary">
                      <Link
                        onClick={() => setRouteCache(router.asPath)}
                        href={`${router.asPath.split("?")[0]}/${id}`}
                      >
                        View
                      </Link>
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
          Page {pageNumber} of {noOfPages}
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
            disabled={pageNumber === noOfPages}
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
            disabled={pageNumber === noOfPages}
          >
            <span className="sr-only">Go to last page</span>
            <DoubleArrowRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

const Toolbar = () => {
  const router = useRouter();
  const user = useContext(UserContext);

  const { startDate, endDate } = useDateRange();

  const onDateRangeChange = (val: DateRange) => {
    const stringifiedDateRange = JSON.stringify({
      start: val.from as Date,
      end: (val.to as Date) ?? (val.from as Date),
    });

    router.push({
      query: {
        ...router.query,
        dateRange: stringifiedDateRange,
      },
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <DateRangePicker
        className="ml-auto"
        selectedDateRange={{ from: startDate, to: endDate }}
        onDateRangeChange={onDateRangeChange}
        calendarDaysLimit={
          user?.currentOrganization.limits.breakingChangeRetentionLimit || 7
        }
      />
    </div>
  );
};

ChecksPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Studio | Checks">
      <TitleLayout
        title="Checks"
        subtitle="A record of composition and schema checks"
        toolbar={<Toolbar />}
      >
        {page}
      </TitleLayout>
    </PageHeader>,
  );

export default ChecksPage;

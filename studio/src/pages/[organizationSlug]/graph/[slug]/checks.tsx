import { EmptyState } from "@/components/empty-state";
import { getGraphLayout, GraphContext } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { SchemaViewer, SchemaViewerActions } from "@/components/schmea-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CLI } from "@/components/ui/cli";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader } from "@/components/ui/loader";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { docsBaseURL } from "@/lib/constants";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import {
  CommandLineIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  CheckCircledIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CrossCircledIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
} from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { endOfDay, format, formatISO, startOfDay, subDays } from "date-fns";
import { useRouter } from "next/router";
import {
  getCheckDetails,
  getChecksByFederatedGraphName,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { useCallback, useContext } from "react";
import { DatePickerWithRange } from "@/components/date-picker-with-range";
import { DateRange } from "react-day-picker";

const Details = ({ id, graphName }: { id: string; graphName: string }) => {
  const { data, isLoading, error, refetch } = useQuery(
    getCheckDetails.useQuery({
      checkID: id,
      graphName,
    })
  );

  if (isLoading) return <Loader fullscreen />;

  if (error || data.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve details"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  if (!data) return null;

  return (
    <div className="space-y-4">
      {data.changes.length === 0 && data.compositionErrors.length == 0 && (
        <p>No changes or composition errors to show</p>
      )}
      {data.changes.length > 0 && (
        <div>
          <p className="text-sm font-semibold">Changes</p>
          <Separator className="my-2" />
          <div className="scrollbar-custom max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Change</TableHead>
                  <TableHead className="w-[200px]">Type</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {data.changes.map(({ changeType, message, isBreaking }) => {
                  return (
                    <TableRow
                      key={changeType + message}
                      className={cn(isBreaking && "text-destructive")}
                    >
                      <TableCell>
                        {isBreaking ? "Breaking" : "Non-Breaking"}
                      </TableCell>
                      <TableCell>{changeType}</TableCell>
                      <TableCell>{message}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      {data.compositionErrors.length > 0 && (
        <div className="text-sm">
          <p className="font-semibold">Composition Errors</p>
          <Separator className="my-2" />
          <pre className="py-4">{data.compositionErrors.join("\n")}</pre>
        </div>
      )}
    </div>
  );
};

const DetailsDialog = ({
  id,
  graphName,
}: {
  id: string;
  graphName: string;
}) => {
  return (
    <Dialog>
      <DialogTrigger className="text-primary">View</DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Details</DialogTitle>
        </DialogHeader>
        <Details id={id} graphName={graphName} />
      </DialogContent>
    </Dialog>
  );
};

const ProposedSchema = ({
  sdl,
  subgraphName,
}: {
  sdl: string;
  subgraphName: string;
}) => {
  return (
    <Dialog>
      <DialogTrigger className="text-primary">View</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Schema</DialogTitle>
        </DialogHeader>
        <div className="scrollbar-custom h-[70vh] overflow-auto rounded border">
          <SchemaViewer sdl={sdl} disableLinking />
        </div>
        <SchemaViewerActions sdl={sdl} subgraphName={subgraphName} />
      </DialogContent>
    </Dialog>
  );
};

const ChecksPage: NextPageWithLayout = () => {
  const router = useRouter();
  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;

  const limit = 10;

  const dateRange = router.query.dateRange
    ? JSON.parse(router.query.dateRange as string)
    : {
        start: subDays(new Date(), 2),
        end: new Date(),
      };
  const startDate = new Date(dateRange.start);
  const endDate = new Date(dateRange.end);

  const onDateRangeChange = (val: DateRange) => {
    const stringifiedDateRange = JSON.stringify({
      start: val.from as Date,
      end: (val.to as Date) ?? (val.from as Date),
    });

    applyNewParams({
      dateRange: stringifiedDateRange,
    });
  };

  const getIcon = (check: boolean) => {
    if (check) {
      return (
        <div className="flex justify-center">
          <CheckCircledIcon className="h-4 w-4 text-success" />
        </div>
      );
    }
    return (
      <div className="flex justify-center">
        <CrossCircledIcon className="h-4 w-4 text-destructive" />
      </div>
    );
  };

  const graphContext = useContext(GraphContext);

  const { data, isLoading, error, refetch } = useQuery(
    getChecksByFederatedGraphName.useQuery({
      name: router.query.slug as string,
      limit: limit,
      offset: (pageNumber - 1) * limit,
      startDate: formatISO(startOfDay(startDate)),
      endDate: formatISO(endOfDay(endDate)),
    })
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
    [router]
  );

  if (isLoading) return <Loader fullscreen />;

  if (error || data.response?.code !== EnumStatusCode.OK)
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
            No checks found. Use the CLI tool to run one.{" "}
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

  const noOfPages =
    Math.floor(parseInt(data.checksCountBasedOnDateRange) / limit) + 1;

  return (
    <div className="flex flex-col gap-y-3">
      <DatePickerWithRange
        className="mr-2 flex justify-end"
        selectedDateRange={{ from: startDate, to: endDate }}
        onDateRangeChange={onDateRangeChange}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">Timestamp</TableHead>
            <TableHead>Subgraph</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-center">Composable</TableHead>
            <TableHead className="text-center">Non Breaking</TableHead>
            <TableHead className="text-center">Proposed Schema</TableHead>
            <TableHead className="text-center">Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.checks.length !== 0 ? (
            data.checks.map(
              ({
                id,
                isBreaking,
                isComposable,
                subgraphName,
                timestamp,
                proposedSubgraphSchemaSDL,
              }) => {
                return (
                  <TableRow key={id}>
                    <TableCell className="font-medium ">
                      {format(new Date(timestamp), "dd MMM yyyy HH:mm")}
                    </TableCell>
                    <TableCell>{subgraphName}</TableCell>
                    <TableCell>
                      {isComposable && !isBreaking ? (
                        <Badge variant="success">PASSED</Badge>
                      ) : (
                        <Badge variant="destructive">FAILED</Badge>
                      )}
                    </TableCell>
                    <TableCell>{getIcon(isComposable)}</TableCell>
                    <TableCell>{getIcon(!isBreaking)}</TableCell>
                    <TableCell className="text-center">
                      {proposedSubgraphSchemaSDL ? (
                        <ProposedSchema
                          sdl={proposedSubgraphSchemaSDL}
                          subgraphName={subgraphName}
                        />
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <DetailsDialog
                        id={id}
                        graphName={graphContext.graph?.name ?? ""}
                      />
                    </TableCell>
                  </TableRow>
                );
              }
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

ChecksPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Studio | Checks">
      <TitleLayout
        title="Checks"
        subtitle="Summary of composition and schema checks"
      >
        {page}
      </TitleLayout>
    </PageHeader>
  );

export default ChecksPage;

import { createFilterState } from "@/components/analytics/constructAnalyticsTableQueryState";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { ConfigureOverride } from "@/components/checks/override";
import { EmptyState } from "@/components/empty-state";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { docsBaseURL } from "@/lib/constants";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import {
  ColumnDef,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getAllOverrides } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { GetAllOverridesResponse } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext } from "react";
import { BiAnalyse } from "react-icons/bi";
import { IoBarcodeSharp } from "react-icons/io5";

const OverridesPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();

  const organizationSlug = router.query.organizationSlug as string;
  const namespace = router.query.namespace as string;
  const slug = router.query.slug as string;

  const constructLink = (
    name: string,
    hash: string,
    mode: "metrics" | "traces",
  ) => {
    const filterState = createFilterState({
      operationName: name,
      operationHash: hash,
    });

    if (mode === "metrics") {
      return `/${organizationSlug}/${namespace}/graph/${slug}/analytics?filterState=${filterState}`;
    }

    return `/${organizationSlug}/${namespace}/graph/${slug}/analytics/traces?filterState=${filterState}`;
  };

  const { data, isLoading, error, refetch } = useQuery({
    ...getAllOverrides.useQuery({
      graphName: graphContext?.graph?.name,
      namespace: graphContext?.graph?.namespace,
    }),
    enabled: !!graphContext?.graph?.name,
  });

  const applyParams = useApplyParams();

  const columnHelper =
    createColumnHelper<GetAllOverridesResponse["overrides"][number]>();

  const columns = [
    columnHelper.accessor("name", {
      header: () => <div>Name</div>,
      cell: (ctx) => (
        <span
          className={cn("font-medium", {
            "italic text-muted-foreground": !ctx.getValue(),
          })}
        >
          {ctx.getValue() || "unnamed operation"}
        </span>
      ),
    }),
    columnHelper.accessor("hash", {
      header: () => <div>Hash</div>,
    }),
    columnHelper.accessor("changesOverrideCount", {
      header: () => <div>Change Override</div>,
      cell: (ctx) => {
        const count = ctx.getValue();
        return `${count} ${count === 1 ? "change" : "changes"}`;
      },
    }),
    columnHelper.accessor("hasIgnoreAllOverride", {
      header: () => <div>Ignore Override</div>,
      cell: (ctx) => {
        const hasIgnoreOverride = ctx.getValue();
        return hasIgnoreOverride ? "Active" : "No";
      },
    }),
    columnHelper.accessor("updatedAt", {
      header: () => <div>Last updated</div>,
      cell: (ctx) => formatDistanceToNow(new Date(ctx.getValue())),
    }),
    columnHelper.display({
      id: "actions",
      cell: (ctx) => {
        const hash = ctx.row.getValue<string>("hash");
        const name = ctx.row.getValue<string>("name");
        return (
          <div className="flex items-center justify-end gap-x-2">
            <Tooltip delayDuration={0}>
              <TooltipTrigger>
                <Button variant="ghost" size="icon-sm" asChild>
                  <Link
                    href={constructLink(name, hash, "metrics")}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <BiAnalyse className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Metrics</TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={0}>
              <TooltipTrigger>
                <Button variant="ghost" size="icon-sm" asChild>
                  <Link
                    href={constructLink(name, hash, "traces")}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IoBarcodeSharp className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Traces</TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="sm"
              className="table-action"
              onClick={() => {
                applyParams({
                  override: hash,
                  overrideName: name,
                });
              }}
            >
              Configure
            </Button>
          </div>
        );
      },
    }),
  ];

  const table = useReactTable({
    data: data?.overrides ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve operation overrides"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  if (data.overrides.length === 0) {
    return (
      <EmptyState
        icon={<InformationCircleIcon />}
        title="No overrides found"
        description={
          <>
            Overrides that you add from schema checks will appear here.{" "}
            <a
              target="_blank"
              rel="noreferrer"
              href={docsBaseURL + "/studio/overrides"}
              className="text-primary"
            >
              Learn more.
            </a>
          </>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Overrides for operations that you add from schema checks will appear
          here.{" "}
          <Link
            href={docsBaseURL + "/studio/overrides"}
            className="text-primary"
            target="_blank"
            rel="noreferrer"
          >
            Learn more
          </Link>
        </p>
      </div>
      <TableWrapper>
        <Table>
          <TableCaption>
            Found {table.getRowModel().rows?.length} operations with overrides
          </TableCaption>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableWrapper>
      <ConfigureOverride />
    </div>
  );
};

OverridesPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Overrides | Studio">
      <GraphPageLayout
        title="Overrides"
        subtitle="View all operation overrides that are used against traffic checks"
      >
        {page}
      </GraphPageLayout>
    </PageHeader>,
  );

export default OverridesPage;

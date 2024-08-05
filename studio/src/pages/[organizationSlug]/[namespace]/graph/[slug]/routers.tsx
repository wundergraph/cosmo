import { EmptyState } from "@/components/empty-state";
import {
  GraphPageLayout,
  getGraphLayout,
  GraphContext,
} from "@/components/layout/graph-layout";
import Link from "next/link";
import { ArrowRightIcon, SizeIcon } from "@radix-ui/react-icons";
import { motion, AnimatePresence, easeInOut } from "framer-motion";
import prettyBytes from "pretty-bytes";
import {
  CommandLineIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/layout/head";
import { MdCheckCircle } from "react-icons/md";
import { Button } from "@/components/ui/button";
import { NextPageWithLayout } from "@/lib/page";
import {
  FiArrowDown,
  FiArrowRight,
  FiArrowUp,
  FiChevronDown,
  FiChevronUp,
} from "react-icons/fi";
import { useQuery } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { Router } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { getRouters } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import React, { useContext, useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui/table";
import { formatDistanceToNow, subSeconds } from "date-fns";
import { useHotkeys } from "@saas-ui/use-hotkeys";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { CopyButton } from "@/components/ui/copy-button";
import { Spacer } from "@/components/ui/spacer";
import { docsBaseURL } from "@/lib/constants";
import { InfoTooltip } from "@/components/info-tooltip";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Loader } from "@/components/ui/loader";
import { RunRouterCommand } from "@/components/federatedgraphs-cards";

const sizes = {
  default: "lg:max-w-3xl xl:max-w-6xl",
  full: "max-w-full",
};

const RouterSheet: React.FC<any> = (props) => {
  const router = useRouter();
  const [size, setSize] = useState<keyof typeof sizes>("default");

  const serviceInstanceId = router.query.serviceInstanceId as string;

  const index = props.data.findIndex(
    (r: any) => r.serviceInstanceId === serviceInstanceId,
  );

  const routerData = props.data[index];

  const nextServer = () => {
    if (index + 1 < props.data.length) {
      const newQuery = { ...router.query };
      newQuery["serviceInstanceId"] = props.data[index + 1].serviceInstanceId;
      router.replace({
        query: newQuery,
      });
    }
  };

  const previousServer = () => {
    if (index - 1 >= 0) {
      const newQuery = { ...router.query };
      newQuery["serviceInstanceId"] = props.data[index - 1].serviceInstanceId;
      router.replace({
        query: newQuery,
      });
    }
  };

  useHotkeys(
    "K",
    () => {
      previousServer();
    },
    {},
    [serviceInstanceId],
  );

  useHotkeys(
    "J",
    () => {
      nextServer();
    },
    {},
    [serviceInstanceId],
  );

  return (
    <Sheet
      modal={false}
      open={!!serviceInstanceId}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          const newQuery = { ...router.query };
          delete newQuery["serviceInstanceId"];

          router.replace({
            query: newQuery,
          });
        }
      }}
    >
      <SheetContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        hideOverlay
        className={cn(
          "scrollbar-custom w-full max-w-full overflow-y-scroll shadow-xl sm:max-w-full",
          sizes[size],
        )}
      >
        <SheetHeader className="mb-12 flex flex-row items-center space-x-2 space-y-0">
          <div className="space-x-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => previousServer()}
                  disabled={index === 0}
                >
                  <FiChevronUp />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Previous Router • <Kbd>K</Kbd>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => nextServer()}
                  disabled={index === props.data.length - 1}
                >
                  <FiChevronDown />
                </Button>
              </TooltipTrigger>

              <TooltipContent>
                Next Router • <Kbd>J</Kbd>
              </TooltipContent>
            </Tooltip>
          </div>

          <SheetTitle className="m-0 flex flex-wrap items-center gap-x-1.5 text-sm">
            <code className="break-all px-1.5 text-left text-sm text-secondary-foreground">
              {serviceInstanceId}
            </code>
            <CopyButton tooltip="Copy instance id" value={serviceInstanceId} />
          </SheetTitle>

          <Spacer />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className="hidden lg:flex"
                onClick={() =>
                  size === "default" ? setSize("full") : setSize("default")
                }
              >
                {size === "default" ? <SizeIcon /> : <ArrowRightIcon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {size === "default" ? "Full size" : "Collapse"} • <Kbd>F</Kbd>
            </TooltipContent>
          </Tooltip>
        </SheetHeader>
        {routerData && <RouterPage router={routerData} />}
      </SheetContent>
    </Sheet>
  );
};

const RouterPage: React.FC<{ router: Router }> = ({ router }) => {
  return (
    <div className="grid auto-cols-fr grid-flow-row auto-rows-max gap-4 lg:grid-flow-col lg:grid-rows-none">
      <div className="rounded border p-4">
        <div className="font-bold">General</div>
        <div>
          <ul className="divide-y">
            <li className="flex justify-between py-4 text-sm">
              <div className="font-semibold text-muted-foreground">
                Process Uptime
              </div>
              <div>
                {router.uptimeSeconds
                  ? formatDistanceToNow(
                      subSeconds(new Date(), parseInt(router.uptimeSeconds)),
                    )
                  : "N/A"}
              </div>
            </li>
            <li className="flex justify-between py-4 text-sm">
              <div className="font-semibold text-muted-foreground">
                Server Uptime
              </div>
              <div>
                {router.serverUptimeSeconds
                  ? formatDistanceToNow(
                      subSeconds(
                        new Date(),
                        parseInt(router.serverUptimeSeconds),
                      ),
                    )
                  : "N/A"}
              </div>
            </li>
            <li className="flex justify-between py-4 text-sm">
              <div className="font-semibold text-muted-foreground">ID</div>
              <div>{router.serviceInstanceId}</div>
            </li>
            <li className="flex justify-between py-4 text-sm">
              <div className="font-semibold text-muted-foreground">
                Service Name
              </div>
              <div>{router.serviceName}</div>
            </li>
            <li className="flex justify-between py-4 text-sm">
              <div className="font-semibold text-muted-foreground">
                Service Version
              </div>
              <div>{router.serviceVersion}</div>
            </li>
            <li className="flex justify-between py-4 text-sm">
              <div className="font-semibold text-muted-foreground">
                Cluster Name
              </div>
              <div>{router.clusterName || "-"}</div>
            </li>
            <li className="flex justify-between py-4 text-sm">
              <div className="font-semibold text-muted-foreground">
                Hostname
              </div>
              <div>{router.hostname}</div>
            </li>
            <li className="flex justify-between py-4 text-sm">
              <div className="font-semibold text-muted-foreground">
                Process ID
              </div>
              <div>{router.processId}</div>
            </li>
          </ul>
        </div>
      </div>
      <div className="rounded border p-4">
        <div className="font-bold">Utilization</div>
        <div>
          <ul className="divide-y">
            <li className="flex justify-between py-4 text-sm">
              <div className="font-semibold text-muted-foreground">
                Memory (Heap)
              </div>
              <div>
                {prettyBytes(router.memoryUsageMb * 1024 * 1024, {
                  maximumFractionDigits: 2,
                })}
              </div>
            </li>
            <li className="flex justify-between py-4 text-sm">
              <div className="font-semibold text-muted-foreground">CPU %</div>
              <div>{router.cpuUsagePercent.toFixed(2)}</div>
            </li>
          </ul>
        </div>
      </div>
      <div className="relative rounded border">
        <div className="absolute z-10 h-full w-full py-12 text-center font-bold">
          <span>Can&apos;t find what you&apos;re looking for?</span>
          <div>
            <a
              target="_blank"
              rel="noreferrer"
              href={
                "https://github.com/wundergraph/cosmo/issues/new?assignees=&labels=enhancement%2Cneeds+triage&projects=&template=feature_request.yaml"
              }
              className="text-primary"
            >
              Open an issue on GitHub
            </a>
          </div>
        </div>
        {/* Dummy */}
        <div className="p-4 blur">
          <div className="font-bold">General</div>
          <div>
            <ul className="divide-y">
              <li className="flex justify-between py-4 text-sm">
                <div className="font-semibold text-muted-foreground">
                  Service Name
                </div>
                <div>Service Name</div>
              </li>
              <li className="flex justify-between py-4 text-sm">
                <div className="font-semibold text-muted-foreground">
                  Service Version
                </div>
                <div>Service Version</div>
              </li>
              <li className="flex justify-between py-4 text-sm">
                <div className="font-semibold text-muted-foreground">ID</div>
                <div>serviceInstanceId</div>
              </li>
              <li className="flex justify-between py-4 text-sm">
                <div className="font-semibold text-muted-foreground">
                  Cluster Name
                </div>
                <div> Cluster Name</div>
              </li>
              <li className="flex justify-between py-4 text-sm">
                <div className="font-semibold text-muted-foreground">
                  Hostname
                </div>
                <div>Hostname</div>
              </li>
              <li className="flex justify-between py-4 text-sm">
                <div className="font-semibold text-muted-foreground">
                  Process ID
                </div>
                <div>232332</div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

const RoutersPage: NextPageWithLayout = () => {
  const graphData = useContext(GraphContext);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const namespace = router.query.namespace as string;
  const slug = router.query.slug as string;

  const { data, isLoading, error, refetch } = useQuery(
    getRouters,
    {
      fedGraphName: slug,
      namespace,
    },
    {
      refetchInterval: 15_000,
    },
  );

  const columns: ColumnDef<Router, any>[] = [
    {
      accessorKey: "serviceName",
      header: () => <div>Name</div>,
    },
    {
      accessorKey: "serviceInstanceId",
      header: () => {
        return (
          <div className="flex items-center space-x-1">
            <div>Instance ID</div>
            <div>
              <InfoTooltip>The unique instance ID.</InfoTooltip>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: () => {
        return (
          <div className="flex items-center space-x-1">
            <div>Status</div>
            <div>
              <InfoTooltip>The Router status</InfoTooltip>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "serviceVersion",
      header: () => <div>Version</div>,
    },
    {
      accessorKey: "onLatestComposition",
      header: () => <div>Composition</div>,
    },
    {
      accessorKey: "clusterName",
      header: () => {
        return (
          <div className="flex items-center space-x-1">
            <div>Cluster</div>
            <div>
              <InfoTooltip>The name of the logical cluster.</InfoTooltip>
            </div>
          </div>
        );
      },
    },
    { accessorKey: "uptimeSeconds", header: () => <div>Uptime</div> },
    {
      accessorKey: "memCpu",
      header: () => {
        return (
          <div className="flex items-center space-x-1">
            <div>Mem / CPU</div>
            <div>
              <InfoTooltip>
                Current utilization of the instance. Arrows show the trend in
                percentage.
              </InfoTooltip>
            </div>
          </div>
        );
      },
    },
  ];

  const table = useReactTable({
    data: data?.routers ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      pagination: {
        pageIndex: 0,
        pageSize: 100,
      },
    },
  });

  if (isLoading) {
    return <Loader fullscreen />;
  }

  if (!data || error || data.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve routers"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  if (data?.routers?.length === 0) {
    return (
      <EmptyState
        icon={<CommandLineIcon />}
        title="No active router found"
        description={
          <>
            Turn on your router and wait a few seconds (~15 seconds) until the
            metrics arrive.{" "}
            <a
              target="_blank"
              rel="noreferrer"
              href={docsBaseURL + "/studio/cluster-management"}
              className="text-primary"
            >
              Learn more.
            </a>
          </>
        }
        actions={
          <RunRouterCommand
            open={open}
            graphName={graphData?.graph?.name ?? ""}
            setOpen={setOpen}
            namespace={namespace}
            triggerLabel="Run Router locally"
          />
        }
      />
    );
  }

  const clusters = new Set(data.routers.map((r) => r.clusterName)).size;
  const totalMemoryUsage = data.routers.reduce((acc, r) => {
    return acc + r.memoryUsageMb * 1024 * 1024;
  }, 0);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Track and monitor your router cluster. This view will update itself.{" "}
          <Link
            href={docsBaseURL + "/studio/cluster-management"}
            className="text-primary"
            target="_blank"
            rel="noreferrer"
          >
            Learn more
          </Link>
        </p>
      </div>
      <div className="grid auto-cols-fr grid-flow-col grid-rows-2 gap-4 md:grid-rows-none">
        <div className="flex h-full w-full flex-col gap-y-4 rounded-md border px-8 py-6">
          <h2 className="flex items-center gap-x-2">
            <span className="leading-none tracking-tight text-muted-foreground">
              Routers
            </span>
          </h2>
          <div>
            <span className="text-xl font-semibold">{data.routers.length}</span>
          </div>
        </div>

        <div className="flex h-full w-full flex-col gap-y-4 rounded-md border px-8 py-6">
          <h2 className="flex items-center gap-x-2">
            <span className="leading-none tracking-tight text-muted-foreground">
              Memory Usage
            </span>
          </h2>
          <div>
            <span className="text-xl font-semibold">
              {prettyBytes(totalMemoryUsage, {
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>

        <div className="flex h-full w-full flex-col gap-y-4 rounded-md border px-8 py-6">
          <h2 className="flex items-center gap-x-2">
            <span className="leading-none tracking-tight text-muted-foreground">
              Clusters
            </span>
          </h2>
          <div>
            <span className="text-xl font-semibold">{clusters}</span>
          </div>
        </div>
      </div>
      <div>
        <TableWrapper>
          <Table>
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
              <AnimatePresence initial={false}>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => {
                    return (
                      <motion.tr
                        initial={{ opacity: 0 }}
                        animate={{
                          opacity: 1,
                          transition: { duration: 1, ease: easeInOut },
                        }}
                        exit={{
                          transition: { duration: 0.5, ease: easeInOut },
                        }}
                        key={row.original.serviceInstanceId}
                        data-state={row.getIsSelected() && "selected"}
                        onClick={() => {
                          router.push({
                            pathname:
                              "/[organizationSlug]/[namespace]/graph/[slug]/routers",
                            query: {
                              ...router.query,
                              serviceInstanceId:
                                row.getValue("serviceInstanceId"),
                            },
                          });
                        }}
                        className={cn(
                          "group cursor-pointer hover:bg-secondary/30",
                          "border-b transition-colors data-[state=selected]:bg-muted",
                          {
                            "bg-secondary/50":
                              row.original.serviceInstanceId ===
                              router.query.serviceInstanceId,
                          },
                        )}
                      >
                        {row.getVisibleCells().map((cell) => {
                          let customCell: React.JSX.Element | String = (
                            <div className="flex items-center space-x-2">
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext(),
                              )}
                            </div>
                          );

                          if (cell.column.id === "serviceName") {
                            customCell = (
                              <>
                                {" "}
                                <p className="flex w-48 items-center">
                                  {cell.row.original.serviceName}
                                </p>
                                <div className="text-muted-foreground">
                                  <Tooltip delayDuration={200}>
                                    <TooltipTrigger asChild>
                                      <span>{cell.row.original.hostname}</span>
                                    </TooltipTrigger>
                                    <TooltipContent>Hostname</TooltipContent>
                                  </Tooltip>
                                </div>
                              </>
                            );
                          } else if (cell.column.id === "clusterName") {
                            customCell = cell.row.original.clusterName || "-";
                          } else if (cell.column.id === "status") {
                            customCell = (
                              <MdCheckCircle className="h-5 w-5 text-green-600" />
                            );
                          } else if (cell.column.id === "onLatestComposition") {
                            customCell = (
                              <div className="whitespace-nowrap">
                                <Button
                                  variant="link"
                                  asChild
                                  className="px-0 hover:no-underline"
                                >
                                  <Link
                                    href={{
                                      pathname:
                                        "/[organizationSlug]/[namespace]/graph/[slug]/compositions/[compositionId]/",
                                      query: {
                                        ...router.query,
                                        compositionId:
                                          cell.row.original.compositionId,
                                      },
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                    }}
                                  >
                                    {
                                      cell.row.original.compositionId.split(
                                        "-",
                                      )[0]
                                    }{" "}
                                  </Link>
                                </Button>
                                <span className="whitespace-nowrap text-muted-foreground">
                                  {" "}
                                  (
                                  {cell.row.original.onLatestComposition
                                    ? "Latest"
                                    : "Outdated"}
                                  )
                                </span>
                              </div>
                            );
                          } else if (cell.column.id === "uptimeSeconds") {
                            customCell = (
                              <>
                                {formatDistanceToNow(
                                  subSeconds(
                                    new Date(),
                                    parseInt(cell.row.original.uptimeSeconds),
                                  ),
                                )}
                              </>
                            );
                          } else if (cell.column.id === "memCpu") {
                            let memBadge = (
                              <FiArrowRight className="h-4 w-4 text-muted-foreground" />
                            );
                            let cpuBadge = (
                              <FiArrowRight className="h-4 w-4 text-muted-foreground" />
                            );
                            if (
                              cell.row.original.memoryUsageChangePercent > 0
                            ) {
                              memBadge = (
                                <FiArrowUp className="h-4 w-4 text-pink-500" />
                              );
                            } else if (
                              cell.row.original.memoryUsageChangePercent < 0
                            ) {
                              memBadge = (
                                <FiArrowDown className="h-4 w-4 text-green-500" />
                              );
                            }

                            if (cell.row.original.cpuUsageChangePercent > 0) {
                              cpuBadge = (
                                <FiArrowUp className="h-4 w-4 text-pink-500" />
                              );
                            } else if (
                              cell.row.original.cpuUsageChangePercent < 0
                            ) {
                              cpuBadge = (
                                <FiArrowDown className="h-4 w-4 text-green-500" />
                              );
                            }
                            customCell = (
                              <div className="space-x-2">
                                <span className="flex whitespace-nowrap font-mono">
                                  {prettyBytes(
                                    cell.row.original.memoryUsageMb *
                                      1024 *
                                      1024,
                                    {
                                      maximumFractionDigits: 2,
                                    },
                                  )}{" "}
                                  <span className="h-4 w-4">{memBadge}</span>
                                  <span>/</span>
                                  <span className="h-4 w-4">{cpuBadge}</span>
                                  <span>
                                    {cell.row.original.cpuUsagePercent.toFixed(
                                      2,
                                    )}
                                  </span>
                                  <span>%</span>
                                </span>
                              </div>
                            );
                          }

                          return (
                            <TableCell key={cell.id}>{customCell}</TableCell>
                          );
                        })}
                      </motion.tr>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center"
                    >
                      <Loader />
                    </TableCell>
                  </TableRow>
                )}
              </AnimatePresence>
            </TableBody>
          </Table>
        </TableWrapper>
      </div>
      <div>
        <RouterSheet data={data.routers} />
      </div>
    </div>
  );
};

RoutersPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Routers | Studio">
      <GraphPageLayout
        title="Routers"
        subtitle="View and Observe all running routers of your graph."
      >
        {page}
      </GraphPageLayout>
    </PageHeader>,
  );

export default RoutersPage;

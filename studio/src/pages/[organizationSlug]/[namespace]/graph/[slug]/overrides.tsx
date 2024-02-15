import { EmptyState } from "@/components/empty-state";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getAllOverrides } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useContext } from "react";
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
import { cn } from "@/lib/utils";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { ConfigureOverride } from "@/components/checks/override";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { createFilterState } from "@/components/analytics/constructAnalyticsTableQueryState";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BiAnalyse } from "react-icons/bi";
import { IoBarcodeSharp } from "react-icons/io5";
import { docsBaseURL } from "@/lib/constants";

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

  if (data.overrides.length !== 0) {
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
            Found {data.overrides.length} operations with overrides
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Hash</TableHead>
              <TableHead>Change Overrides</TableHead>
              <TableHead>Ignore Override</TableHead>
              <TableHead>Last updated</TableHead>
              <TableHead className="w-52"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.overrides.map((o) => {
              return (
                <TableRow
                  onClick={() => {
                    applyParams({
                      override: o.hash,
                      overrideName: o.name,
                    });
                  }}
                  className="group cursor-pointer hover:bg-secondary/30"
                  key={o.hash}
                >
                  <TableCell
                    className={cn("font-medium", {
                      "italic text-muted-foreground": !o.name,
                    })}
                  >
                    {o.name || "unnamed operation"}
                  </TableCell>
                  <TableCell>{o.hash}</TableCell>
                  <TableCell>
                    {o.changesOverrideCount}{" "}
                    {o.changesOverrideCount === 1 ? "change" : "changes"}
                  </TableCell>
                  <TableCell>
                    {o.hasIgnoreAllOverride ? "Active" : "No"}
                  </TableCell>
                  <TableCell>
                    {formatDistanceToNow(new Date(o.updatedAt))}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-x-2">
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger>
                          <Button variant="ghost" size="icon-sm" asChild>
                            <Link
                              href={constructLink(o.name, o.hash, "metrics")}
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
                              href={constructLink(o.name, o.hash, "traces")}
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
                            override: o.hash,
                            overrideName: o.name,
                          });
                        }}
                      >
                        Configure
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
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

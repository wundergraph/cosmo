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

const OverridesPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);

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

  if (data.overrides.length === 0) {
    return (
      <EmptyState
        icon={<InformationCircleIcon />}
        title="No overrides found"
        description="Overrides that you add from schema checks will appear here"
      />
    );
  }

  return (
    <>
      <TableWrapper>
        <Table>
          <TableCaption>
            Found {data.overrides.length} operations with overrides
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Hash</TableHead>
              <TableHead>Changes Count</TableHead>
              <TableHead>Ignore All</TableHead>
              <TableHead>Updated At</TableHead>
              <TableHead className="w-24"></TableHead>
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
                  <TableCell>{o.changesOverrideCount}</TableCell>
                  <TableCell>{`${o.hasIgnoreAllOverride}`}</TableCell>
                  <TableCell>
                    {formatDistanceToNow(new Date(o.updatedAt))}
                  </TableCell>
                  <TableCell>
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
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableWrapper>
      <ConfigureOverride />
    </>
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

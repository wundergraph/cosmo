import {
  getCheckBadge,
  getCheckIcon,
  isCheckSuccessful,
} from "@/components/check-badge-icon";
import { ChecksToolbar } from "@/components/checks/toolbar";
import { EmptyState } from "@/components/empty-state";
import { GraphContext, getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { SchemaViewer, SchemaViewerActions } from "@/components/schema-viewer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader } from "@/components/ui/loader";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { CubeIcon, DashIcon, MinusIcon, PlusIcon } from "@radix-ui/react-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  forceCheckSuccess,
  getCheckSummary,
  getFederatedGraphs,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { subDays } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import React, { useContext } from "react";
import { PiGraphLight } from "react-icons/pi";
import { InfoTooltip } from "@/components/info-tooltip";

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

const CheckOverviewPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();
  const { toast } = useToast();

  const organizationSlug = router.query.organizationSlug as string;
  const slug = router.query.slug as string;
  const id = router.query.checkId as string;

  const { data, isLoading, error, refetch } = useQuery({
    ...getCheckSummary.useQuery({
      checkId: id,
      graphName: graphContext?.graph?.name,
    }),
    enabled: !!graphContext?.graph?.name,
  });

  const { data: allGraphsData } = useQuery(getFederatedGraphs.useQuery());

  const { mutate: forceSuccess, isLoading: isForcingSuccess } = useMutation({
    ...forceCheckSuccess.useMutation(),
    onSuccess: (data) => {
      if (data.response?.code === EnumStatusCode.OK) {
        toast({ description: "Marked check as successful", duration: 3000 });
        refetch();
      } else {
        toast({
          description: `Could not marked check as successful. ${data.response?.details}`,
          duration: 3000,
        });
      }
    },
    onError: () => {
      toast({
        description: "Could not marked check as successful. Please try again",
        duration: 3000,
      });
    },
  });

  if (isLoading) return <Loader fullscreen />;

  if (error || data.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve check summary"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  if (!data || !data.check || !graphContext) return null;

  const sdl = data.proposedSubgraphSchemaSDL ?? "";

  const isSuccessful = isCheckSuccessful(
    data.check.isComposable,
    data.check.isBreaking,
    data.check.hasClientTraffic,
  );

  const currentAffectedGraph = data.affectedGraphs.find(
    (graph) => graph.id === graphContext.graph?.id,
  );

  const reason = !data.check.isComposable
    ? "Composition errors were found"
    : data.check.isBreaking && data.check.hasClientTraffic
    ? "Operations were affected by breaking changes"
    : data.check.isBreaking && !data.check.hasClientTraffic
    ? "No operations were affected by breaking changes"
    : "All tasks were successful";

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-col gap-y-2">
        <h3 className="mb-2 text-xl font-semibold">Overview</h3>

        <div className="flex items-center gap-x-4">
          <span className="w-24 flex-shrink-0 md:w-36">Status</span> :
          {getCheckBadge(isSuccessful, data.check.isForcedSuccess)}
        </div>

        <div className="flex gap-x-4">
          <span className="w-24 flex-shrink-0 md:w-36">Reason</span> :
          <p>{reason}</p>
        </div>

        <div className="flex gap-x-4">
          <span className="w-24 flex-shrink-0 md:w-36">Subgraph</span> :
          <Link
            key={id}
            href={`/${organizationSlug}/graph/${slug}/schema/sdl?subgraph=${data.check.subgraphName}`}
            className="text-primary"
          >
            <div className="flex items-center gap-x-1">
              <CubeIcon />
              {data.check.subgraphName}
            </div>
          </Link>
        </div>

        {data.affectedGraphs.length > 0 && (
          <div className="flex items-start gap-x-4">
            <span className="w-24 flex-shrink-0 md:w-36">Affected Graphs</span>{" "}
            :
            <div className="flex flex-wrap items-center gap-2">
              {data.affectedGraphs.map((ag) => {
                const graph = allGraphsData?.graphs.find((g) => g.id === ag.id);

                if (!graph) return null;

                return (
                  <Link
                    key={id}
                    href={`/${organizationSlug}/graph/${graph.name}`}
                    className="text-primary"
                  >
                    <div className="flex items-center gap-x-1">
                      <PiGraphLight />
                      {graph.name}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center gap-x-4">
          <span className="w-24 flex-shrink-0 md:w-36">Proposed Schema</span> :
          <ProposedSchema sdl={sdl} subgraphName={data.check.subgraphName} />
        </div>

        <div className="flex gap-x-4">
          <span className="w-24 flex-shrink-0 md:w-36">Created At</span> :
          <p>{formatDateTime(new Date(data.check.timestamp))}</p>
        </div>
      </div>
      <div className="flex flex-col">
        <h3 className="text-xl font-semibold">Tasks</h3>
        <div className="mt-4 md:w-96">
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>
                  <div className="flex items-center space-x-1.5">
                    <div>Composition Check</div>
                    <InfoTooltip>
                      Describes if the proposed schema can be composed with all
                      other subgraphs in the federated graph.
                    </InfoTooltip>
                  </div>
                </TableCell>

                <TableCell className="border-l text-center">
                  {getCheckIcon(data.check.isComposable)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <div className="flex items-center space-x-1.5">
                    <div>Breaking Change Detection</div>
                    <InfoTooltip>
                      Describes if the proposed schema is free of changes that
                      break existing client operations.
                    </InfoTooltip>
                  </div>
                </TableCell>
                <TableCell className="border-l text-center">
                  {getCheckIcon(!data.check.isBreaking)}
                </TableCell>
              </TableRow>
              {data.check.isBreaking && (
                <TableRow>
                  <TableCell>
                    <div className="flex items-center space-x-1.5">
                      <div>Operations Check</div>
                      <InfoTooltip>
                        Describes if the proposed schema affects any client
                        operations based on real usage data.
                      </InfoTooltip>
                    </div>
                  </TableCell>
                  <TableCell className="border-l text-center">
                    {getCheckIcon(!data.check.hasClientTraffic)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {data.changeCounts && (
        <div className="flex flex-col">
          <h3 className="mb-4 text-xl font-semibold">Changes</h3>
          <div>
            <div className="flex items-center gap-x-1">
              <PlusIcon className="text-success" />
              <p className="text-sm text-success">
                {data.changeCounts.additions} additions
              </p>
            </div>
            <div className="flex items-center gap-x-1">
              <MinusIcon className="text-destructive" />
              <p className="text-sm text-destructive">
                {data.changeCounts.deletions} deletions
              </p>
            </div>
          </div>
        </div>
      )}
      {currentAffectedGraph && (
        <div className="flex flex-col">
          <h3 className="mb-4 text-xl font-semibold">Timeframe checked</h3>
          <p className="flex items-center gap-x-2 text-muted-foreground">
            {formatDateTime(
              subDays(
                new Date(data.check.timestamp),
                currentAffectedGraph.trafficCheckDays,
              ),
            )}
            <DashIcon />
            {formatDateTime(new Date(data.check.timestamp))}
          </p>
        </div>
      )}
      {!data.check.isForcedSuccess &&
        data.check.isBreaking &&
        data.check.isComposable && (
          <>
            <hr />
            <Card>
              <CardHeader className="gap-y-6 md:flex-row">
                <div className="space-y-1.5">
                  <CardTitle>Override</CardTitle>
                  <CardDescription>
                    Manually set the state of the check to be successful.
                    Affects GitHub commit check if integrated.
                  </CardDescription>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      className="flex-shrink-0 md:ml-auto"
                      variant="secondary"
                    >
                      Force Success
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will forcefully mark
                        the check as successful.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          forceSuccess({
                            checkId: id,
                            graphName: graphContext.graph?.name,
                          });
                        }}
                      >
                        Force Success
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardHeader>
            </Card>
          </>
        )}
    </div>
  );
};

CheckOverviewPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Studio | Checks">
      <TitleLayout
        title="Check Summary"
        subtitle="A quick glance of the details for this check run"
        toolbar={<ChecksToolbar tab="overview" />}
      >
        {page}
      </TitleLayout>
    </PageHeader>,
  );

export default CheckOverviewPage;

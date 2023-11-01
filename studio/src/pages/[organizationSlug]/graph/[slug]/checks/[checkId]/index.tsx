import { getCheckBadge, getCheckIcon } from "@/components/check-badge-icon";
import { ChecksToolbar } from "@/components/checks/toolbar";
import { EmptyState } from "@/components/empty-state";
import { GraphContext, getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { SchemaViewer } from "@/components/schema-viewer";
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
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import { useToast } from "@/components/ui/use-toast";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  forceCheckSuccess,
  getCheckSummary,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useContext } from "react";

const CheckOverviewPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();
  const { toast } = useToast();

  const id = router.query.checkId as string;

  const { data, isLoading, error, refetch } = useQuery({
    ...getCheckSummary.useQuery({
      checkId: id,
      graphName: graphContext?.graph?.name,
    }),
    enabled: !!graphContext?.graph?.name,
  });

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

  const sdl = data.check.proposedSubgraphSchemaSDL ?? "";

  return (
    <div className="space-y-4">
      <Card className="relative flex grow flex-col justify-between">
        <CardHeader>
          <CardDescription>
            Created At: {formatDateTime(new Date(data.check.timestamp))}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-y-2 text-sm">
          <div className="flex items-center gap-x-4">
            <span className="w-28">Status</span> :
            {getCheckBadge(
              data.check.isBreaking,
              data.check.isComposable,
              data.check.isForcedSuccess,
            )}
          </div>
          <div className="flex gap-x-4">
            <span className="w-28">Subgraph</span> :
            <span className="w-32">{data.check.subgraphName}</span>
          </div>
          <div className="flex gap-x-4">
            <span className="w-28">Composable</span> :
            <span>{getCheckIcon(data.check.isComposable)}</span>
          </div>
          <div className="flex gap-x-4">
            <span className="w-28">Non Breaking</span> :
            <span>{getCheckIcon(!data.check.isBreaking)}</span>
          </div>
          <div className="flex gap-x-4">
            <span className="w-28">Operations</span> :
            <span className="flex items-center gap-x-2">
              {getCheckIcon(
                (data.operationUsageStats?.totalOperations ?? 0) === 0,
              )}
              ( {data.operationUsageStats?.totalOperations} affected )
            </span>
          </div>
          {data.operationUsageStats &&
            data.operationUsageStats.totalOperations > 0 && (
              <div className="flex gap-x-4">
                <span className="w-28 flex-shrink-0">Timeframe</span> :
                <div className="flex flex-col">
                  <span>
                    First seen at{" "}
                    {formatDateTime(
                      new Date(data.operationUsageStats.firstSeenAt),
                    )}{" "}
                  </span>
                  <span>
                    Last seen at{" "}
                    {formatDateTime(
                      new Date(data.operationUsageStats.lastSeenAt),
                    )}
                  </span>
                </div>
              </div>
            )}
          {!data.check.isForcedSuccess &&
            data.check.isBreaking &&
            data.check.isComposable && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    className="right-6 top-6 mt-4 md:absolute md:ml-auto md:mt-0 md:w-max"
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
            )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="scrollbar-custom relative h-96 overflow-auto rounded border">
          <div className="absolute left-0 right-0 h-full">
            <SchemaViewer sdl={sdl} disableLinking />
          </div>
        </div>
      </div>
    </div>
  );
};

CheckOverviewPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Studio | Checks">
      <TitleLayout
        title="Check Overview"
        subtitle="Summary for this check run"
        toolbar={<ChecksToolbar tab="overview" />}
      >
        {page}
      </TitleLayout>
    </PageHeader>,
  );

export default CheckOverviewPage;

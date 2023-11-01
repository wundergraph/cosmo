import { UserContext } from "@/components/app-provider";
import { getCheckBadge, getCheckIcon } from "@/components/check-badge-icon";
import { EmptyState } from "@/components/empty-state";
import { GraphContext, getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { SchemaViewer } from "@/components/schema-viewer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { useSessionStorage } from "@/hooks/use-session-storage";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { checkUserAccess, cn } from "@/lib/utils";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { ChevronLeftIcon } from "@radix-ui/react-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  forceCheckSuccess,
  getCheckDetails,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useCallback, useContext } from "react";

const CheckDetailsPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();
  const { toast } = useToast();
  const user = useContext(UserContext);

  const id = router.query.checkID as string;

  const { data, isLoading, error, refetch } = useQuery({
    ...getCheckDetails.useQuery({
      checkID: id,
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

  const [checksRoute] = useSessionStorage<string | undefined>(
    "checks.route",
    undefined
  );

  const handleViewAll = useCallback(() => {
    if (checksRoute) {
      router.back();
      return;
    }
    const parts = router.asPath.split("/");
    router.push(parts.slice(0, parts.length - 1).join("/"));
  }, [checksRoute, router]);

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

  if (!data || !data.check || !graphContext) return null;

  const sdl = data.check.proposedSubgraphSchemaSDL ?? "";

  return (
    <div>
      <Button
        onClick={() => handleViewAll()}
        variant="link"
        size="sm"
        className="p-0"
      >
        <ChevronLeftIcon />
        View all checks
      </Button>
      <Card className="mt-4 flex grow flex-col justify-between">
        <CardHeader>
          <CardTitle>Check details</CardTitle>
          <CardDescription>
            Created At: {formatDateTime(new Date(data.check.timestamp))}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-y-2 text-sm">
          <div className="flex gap-x-4">
            <span className="w-28">Subgraph</span> :
            <span className="w-32">{data.check.subgraphName}</span>
          </div>
          <div className="flex gap-x-4">
            <span className="w-28">Composable</span> :
            <span className="">{getCheckIcon(data.check.isComposable)}</span>
          </div>
          <div className="flex gap-x-4">
            <span className="w-28">Non Breaking</span> :
            <span className="">{getCheckIcon(!data.check.isBreaking)}</span>
          </div>
          <div className="flex items-center gap-x-4">
            <span className="w-28">Status</span> :
            {getCheckBadge(
              data.check.isBreaking,
              data.check.isComposable,
              data.check.isForcedSuccess
            )}
          </div>
          {!data.check.isForcedSuccess &&
            data.check.isBreaking &&
            data.check.isComposable &&
            checkUserAccess({
              rolesToBe: ["admin", "member"],
              userRoles: user?.currentOrganization.roles || [],
            }) && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    className="mt-4 md:ml-auto md:mt-0 md:w-max"
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
      <div className="mt-6 space-y-2">
        <h3 className="font-semibold">Proposed Schema</h3>
        <div className="scrollbar-custom relative h-96 overflow-auto rounded border">
          <div className="absolute left-0 right-0 h-full">
            <SchemaViewer sdl={sdl} disableLinking />
          </div>
        </div>
      </div>

      {data.changes.length === 0 && data.compositionErrors.length == 0 && (
        <Alert className="mt-6">
          <AlertTitle>All good!</AlertTitle>
          <AlertDescription>
            No changes or composition errors to show
          </AlertDescription>
        </Alert>
      )}
      {data.changes.length > 0 && (
        <div className="mt-6 space-y-2">
          <h3 className="font-semibold">Changes</h3>
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
        <div className="mt-6 space-y-2">
          <h3 className="font-semibold">Composition Errors</h3>
          <pre className="overflow-auto rounded-md bg-secondary p-4 text-sm text-secondary-foreground">
            {data.compositionErrors.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
};

CheckDetailsPage.getLayout = (page) =>
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

export default CheckDetailsPage;

import { FieldUsageSheet } from "@/components/analytics/field-usage";
import { ChecksToolbar } from "@/components/checks/toolbar";
import { EmptyState } from "@/components/empty-state";
import { GraphContext, getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
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
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getCheckDetails } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useContext } from "react";

const CheckDetailsPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();
  const { toast } = useToast();

  const id = router.query.checkId as string;

  const { data, isLoading, error, refetch } = useQuery({
    ...getCheckDetails.useQuery({
      checkId: id,
      graphName: graphContext?.graph?.name,
    }),
    enabled: !!graphContext?.graph?.name,
  });

  if (isLoading) return <Loader fullscreen />;

  if (error || data.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve check details"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  const openUsage = (changeType: string, path?: string) => {
    if (!path) {
      toast({
        description: "Not enough data to fetch usage for this change",
        duration: 2000,
      });
      return;
    }

    const query: Record<string, any> = {
      showUsage: path,
    };

    if (
      [
        "UNION_MEMBER_REMOVED",
        "ENUM_VALUE_ADDED",
        "ENUM_VALUE_REMOVED",
      ].includes(changeType)
    ) {
      query.isNamedType = true;
    }

    router.replace({
      pathname: router.pathname,
      query: {
        ...router.query,
        ...query,
      },
    });
  };

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-col gap-y-2">
        <h3 className="font-semibold">Changes</h3>
        <div className="scrollbar-custom max-h-[70vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Change</TableHead>
                <TableHead className="w-[200px]">Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-2/12 2xl:w-1/12">Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {data.changes.map(({ changeType, message, isBreaking, path }) => {
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
                    <TableCell>
                      <Button
                        onClick={() => openUsage(changeType, path)}
                        className="p-0"
                        variant="link"
                      >
                        View usage
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            {data.changes.length === 0 && (
              <TableCaption className="pb-3">No changes found</TableCaption>
            )}
          </Table>
        </div>
      </div>
      <div className="flex flex-col gap-y-2">
        <h3 className="font-semibold">Composition Errors</h3>
        <pre className="overflow-auto rounded-md bg-secondary p-4 text-sm text-secondary-foreground">
          {data.compositionErrors.length > 0
            ? data.compositionErrors.join("\n")
            : "No composition errors"}
        </pre>
      </div>
      <FieldUsageSheet />
    </div>
  );
};

CheckDetailsPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Studio | Checks">
      <TitleLayout
        title="Check Details"
        subtitle="View breaking changes and composition errors for this check run"
        toolbar={<ChecksToolbar tab="details" />}
      >
        {page}
      </TitleLayout>
    </PageHeader>,
  );

export default CheckDetailsPage;

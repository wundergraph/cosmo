import { FieldUsageSheet } from "@/components/analytics/field-usage";
import { ChangesTable } from "@/components/checks/changes-table";
import { ChecksToolbar } from "@/components/checks/toolbar";
import { EmptyState } from "@/components/empty-state";
import { GraphContext, getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getCheckDetails } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useContext } from "react";

const CheckDetailsPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();

  const id = router.query.checkId as string;

  const { data, isLoading, error, refetch } = useQuery({
    ...getCheckDetails.useQuery({
      checkId: id,
      graphName: graphContext?.graph?.name,
    }),
    enabled: !!graphContext?.graph?.name,
  });

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK)
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

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-col gap-y-4">
        <h3 className="text-xl font-semibold">Changes</h3>
        <ChangesTable
          changes={data.changes}
          caption={`${data.changes.length} changes found`}
          trafficCheckDays={data.trafficCheckDays}
          createdAt={data.createdAt}
        />
      </div>
      <div className="flex flex-col gap-y-4">
        <h3 className="text-xl font-semibold">Composition Errors</h3>
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

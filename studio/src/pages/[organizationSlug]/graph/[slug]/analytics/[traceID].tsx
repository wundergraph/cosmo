import Trace from "@/components/analytics/trace";
import { EmptyState } from "@/components/empty-state";
import { getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { SchemaViewer } from "@/components/schmea-viewer";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/router";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common_pb";
import { getTrace } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { AnalyticsToolbar } from "@/components/analytics/toolbar";
import { CopyButton } from "@/components/ui/copy-button";

const TracePage: NextPageWithLayout = () => {
  const { query } = useRouter();

  const traceID = query.traceID as string;

  const { data, isLoading, error, refetch } = useQuery({
    ...getTrace.useQuery({
      id: traceID,
    }),
    refetchInterval: 10000,
  });

  if (isLoading) {
    return <Loader fullscreen />;
  } else if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        className="order-2 h-72 border lg:order-last"
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve request information"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  return (
    <div>
      <Trace spans={data.spans} />
      <div className="scrollbar-custom !mt-6 max-h-96 overflow-auto rounded border">
        <SchemaViewer
          sdl={data.spans[0].attributes?.operationContent ?? ""}
          disableLinking
        />
      </div>
    </div>
  );
};

const TraceToolbar = () => {
  const router = useRouter();
  return (
    <AnalyticsToolbar tab="operations">
      <span className="text-muted-foreground">/</span>{" "}
      <span className="text-sm">{router.query.traceID}</span>
      <CopyButton
        tooltip="Copy trace id"
        value={router.query.traceID?.toString() || ""}
      />
    </AnalyticsToolbar>
  );
};

TracePage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Analytics | Trace">
      <TitleLayout
        title="Analytics"
        subtitle="Comprehensive view into Federated GraphQL Performance"
        toolbar={<TraceToolbar />}
      >
        {page}
      </TitleLayout>
    </PageHeader>
  );

export default TracePage;

import { EmptyState } from "@/components/empty-state";
import {
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { formatDateTime } from "@/lib/format-date";
import { useRouter } from "next/router";
import { NextPageWithLayout } from "@/lib/page";
import { useCurrentOrganization } from "@/hooks/use-current-organization";
import { useWorkspace } from "@/hooks/use-workspace";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getOperationDetailPage } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { CodeViewer } from "@/components/code-viewer";
import { useQuery } from "@connectrpc/connect-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import Link from "next/link";

const OperationDefinitionRow = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className="flex flex-col gap-2">
    <dt className="text-sm text-muted-foreground">{label}</dt>
    <dd className="text-sm">{children}</dd>
  </div>
);

const OperationDetailsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const id = router.query.operationId as string;
  const organizationSlug = useCurrentOrganization()?.slug;
  const slug = router.query.slug as string;
  const {
    namespace: { name: namespace },
  } = useWorkspace();

  const { data, isLoading, error, refetch } = useQuery(getOperationDetailPage, {
    id,
    namespace,
    federatedGraphName: slug,
  });

  if (isLoading) return <Loader fullscreen />;

  if (!isLoading && (error || data?.response?.code !== EnumStatusCode.OK)) {
    return (
      <div className="my-auto">
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve operation detail data"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </div>
    );
  }

  if (!data || !data.detail)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve operation detail"
        description={data?.response?.details}
        actions={<Button onClick={() => undefined}>Retry</Button>}
      />
    );

  return (
    <GraphPageLayout
      title={id}
      subtitle="Detail related to a specific operation"
      breadcrumbs={[
        <Link
          key={0}
          href={`/${organizationSlug}/${namespace}/graph/${slug}/operations`}
        >
          Operations
        </Link>,
      ]}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:px-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex flex-col rounded-md border">
            <h3 className="border-b px-4 py-2 font-semibold tracking-tight">
              Operation Details
            </h3>
            <dl className="flex flex-col gap-4 px-4 py-4">
              <OperationDefinitionRow label="ID">{id}</OperationDefinitionRow>
              <OperationDefinitionRow label="Name">
                {data.detail.operationName}
              </OperationDefinitionRow>
              <OperationDefinitionRow label="Type">
                <Badge variant="secondary">
                  {data.detail.operationType.toLocaleUpperCase()}
                </Badge>
              </OperationDefinitionRow>
              <OperationDefinitionRow label="Last seen at">
                {formatDateTime(new Date(data.detail.timestamp))}
              </OperationDefinitionRow>
              <OperationDefinitionRow label="Client">
                {data.detail.clientName}
              </OperationDefinitionRow>
              <OperationDefinitionRow label="Version">
                {data.detail.clientVersion}
              </OperationDefinitionRow>
            </dl>
          </div>
          <div className="flex flex-col rounded-md border">
            <h3 className="border-b px-4 py-2 font-semibold tracking-tight">
              Latency Stats
            </h3>
            <dl className="flex flex-col gap-4 px-4 py-4">
              <OperationDefinitionRow label="Executions Minimum Duration (ms)">
                {data.detail.minDurationMs}
              </OperationDefinitionRow>
              <OperationDefinitionRow label="Executions Maximum Duration (ms)">
                {data.detail.maxDurationMs}
              </OperationDefinitionRow>
              <OperationDefinitionRow label="Executions Average Duration (ms)">
                {data.detail.avgDurationMs}
              </OperationDefinitionRow>
            </dl>
            <h3 className="border-b px-4 py-2 font-semibold tracking-tight">
              Request Stats
            </h3>
            <dl className="flex flex-col gap-4 px-4 py-4">
              <OperationDefinitionRow label="Total Requests">
                {Number(data.detail.totalRequests)}
              </OperationDefinitionRow>
              <OperationDefinitionRow label="Total Errors">
                {Number(data.detail.totalErrors)}
              </OperationDefinitionRow>
            </dl>
          </div>
        </div>
        <div className="flex flex-col rounded-md border">
          <h3 className="border-b px-4 py-2 font-semibold tracking-tight">
            Content
          </h3>
          <div className="px-4 py-4">
            <CodeViewer
              prettyPrint
              code={data.detail.operationContent}
              language="graphql"
            />
          </div>
        </div>
      </div>
    </GraphPageLayout>
  );
};

OperationDetailsPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Operation Details",
  });

export default OperationDetailsPage;

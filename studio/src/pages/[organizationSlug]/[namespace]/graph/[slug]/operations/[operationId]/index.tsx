import { EmptyState } from "@/components/empty-state";
import {
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { useRouter } from "next/router";
import { NextPageWithLayout } from "@/lib/page";
import { useCurrentOrganization } from "@/hooks/use-current-organization";
import { useWorkspace } from "@/hooks/use-workspace";
import { OperationDetailPageItem } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getOperationDetailPage } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { OperationType } from "@wundergraph/cosmo-connect/dist/graphqlmetrics/v1/graphqlmetrics_pb";
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
  <div className="flex-start flex min-w-[240px] flex-col gap-2">
    <dt className="text-sm text-muted-foreground">{label}</dt>
    <dd className="text-sm">{children}</dd>
  </div>
);

const OperationTypeBadge = ({
  operationType,
}: {
  operationType: OperationType;
}) => {
  let label = "UNKNOWN";

  switch (operationType) {
    case OperationType.QUERY:
      label = "QUERY";
      break;
    case OperationType.MUTATION:
      label = "MUTATION";
      break;
    case OperationType.SUBSCRIPTION:
      label = "SUBSCRIPTION";
      break;
  }

  return <Badge variant="secondary">{label}</Badge>;
}

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
      <div className="flex h-full flex-col">
        <div className="flex-shrink-0 overflow-x-auto border-b scrollbar-thin">
          <dl className="flex w-full flex-col flex-wrap gap-x-8 gap-y-4 px-4 py-4 text-sm xl:flex-row">
            <OperationDefinitionRow label="ID">{id}</OperationDefinitionRow>
            <OperationDefinitionRow label="Name">
              {data.detail.operationName}
            </OperationDefinitionRow>
            <OperationDefinitionRow label="Type">
              <OperationTypeBadge operationType={data.detail.operationType} />
            </OperationDefinitionRow>
            <OperationDefinitionRow label="Last seen at">
              {new Date(data.detail.timestamp).toLocaleString()}
            </OperationDefinitionRow>
          </dl>
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

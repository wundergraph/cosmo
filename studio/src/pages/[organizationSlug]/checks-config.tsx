import { NamespaceSelector } from "@/components/dashboard/NamespaceSelector";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { ChecksConfig } from "@/components/checks/checks-config";
import { useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getNamespaceChecksConfig,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";

const ChecksConfigPage: NextPageWithLayout = () => {
  const router = useRouter();
  const namespace = (router.query.namespace as string) || "default";
  const { data, isLoading, refetch, error } = useQuery(getNamespaceChecksConfig, {
    namespace,
  });

  if (isLoading) return <Loader fullscreen />;
  if (
    error ||
    !data ||
    data?.response?.code !== EnumStatusCode.OK
  )
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve the checks configuration for the namespace"
        description={
            data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  return (
    <div className="space-y-6">
      <ChecksConfig namespace={namespace} data={data} />
    </div>
  );
};

ChecksConfigPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Checks Configuration",
    "Configure the options used for checks of subgraphs of the namespace.",
    undefined,
    undefined,
    [<NamespaceSelector key="0" />],
  );
};

export default ChecksConfigPage;

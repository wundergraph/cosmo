import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { getFederatedGraphs } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { FederatedGraphsCards } from "@/components/federatedgraphs-cards";
import { createPopup } from "@typeform/embed";
import { useContext } from "react";
import { UserContext } from "@/components/app-provider";

export const openCosmoTypeForm = () => {
  // Waitlist form
  const toggle = createPopup(process.env.NEXT_PUBLIC_TYPEFORM_ID || "", {
    hideHeaders: true,
    size: 70,
  });
  toggle.open();
};

const GraphsDashboardPage: NextPageWithLayout = () => {
  const { data, isLoading, error, refetch } = useQuery(
    getFederatedGraphs.useQuery({
      includeMetrics: true,
    })
  );

  const [user] = useContext(UserContext);

  if (isLoading) return <Loader fullscreen />;

  if (error || data.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve federated graphs"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  return (
    <div className="flex flex-col gap-y-4">
      {user?.currentOrganization.isFreeTrial && (
        <div
          className="flex cursor-pointer justify-center rounded bg-secondary py-1 text-secondary-foreground"
          onClick={openCosmoTypeForm}
        >
          Limited trial version. Talk to sales for Production use.
        </div>
      )}
      <FederatedGraphsCards graphs={data.graphs} refetch={refetch} />
    </div>
  );
};

GraphsDashboardPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Federated Graphs",
    "View all your federated graphs"
  );
};

export default GraphsDashboardPage;

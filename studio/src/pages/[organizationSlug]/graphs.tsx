import { useApplyParams } from "@/components/analytics/use-apply-params";
import { UserContext } from "@/components/app-provider";
import { NamespaceSelector } from "@/components/dashboard/NamespaceSelector";
import { EmptyState } from "@/components/empty-state";
import { FederatedGraphsCards } from "@/components/federatedgraphs-cards";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toolbar } from "@/components/ui/toolbar";
import { useCurrentOrganization } from "@/hooks/use-current-organization";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getFederatedGraphs } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { capitalCase } from "change-case";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext } from "react";

const GraphToolbar = () => {
  const org = useCurrentOrganization();
  const router = useRouter();
  const applyParams = useApplyParams();

  const type = (router.query.type as string) || "all-graphs";
  const namespace = router.query.namespace;

  return (
    <Toolbar className="py-0 md:w-auto">
      <Select
        value={type}
        onValueChange={(type) => {
          applyParams({ type });
        }}
      >
        <SelectTrigger className="w-64" value={type}>
          <SelectValue aria-label={type}>{capitalCase(type)}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          <SelectGroup>
            <SelectItem value="all-graphs">All Graphs</SelectItem>
            <SelectItem value="federated-graphs">Federated Graphs</SelectItem>
            <SelectItem value="monographs">Monographs</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button asChild>
        <Link href={`/${org?.slug}/new?namespace=${namespace}`}>Create</Link>
      </Button>
    </Toolbar>
  );
};

const GraphsDashboardPage: NextPageWithLayout = () => {
  const user = useContext(UserContext);
  const router = useRouter();
  const namespace = router.query.namespace as string;

  const type = (router.query.type as string) || "all-graphs";

  const { data, isLoading, error, refetch } = useQuery(getFederatedGraphs, {
    includeMetrics: true,
    namespace,
  });

  // refetch the query when the organization changes

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK)
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

  const graphs = data.graphs.filter((g) => {
    if (type === "all-graphs") {
      return true;
    } else if (type === "federated-graphs") {
      return g.supportsFederation === true;
    } else {
      return g.supportsFederation === false;
    }
  });

  return <FederatedGraphsCards graphs={graphs} refetch={refetch} />;
};

GraphsDashboardPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Graphs",
    "An overview of all your federated graphs and monographs",
    undefined,
    <GraphToolbar />,
    [<NamespaceSelector key="0" />],
  );
};

export default GraphsDashboardPage;

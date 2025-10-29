import { EmptyState } from "@/components/empty-state";
import {
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { OperationPageItem } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getOperationsPage } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui/table";
import { GraphContext } from "@/components/layout/graph-layout";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/router";
import { useContext } from "react";
import type { ReactNode } from "react";

const OperationsTableRow = ({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) => {
  const router = useRouter();

  const handleRowClick = () => {
    const route = `${router.asPath.split("?")[0]}/${id}`;

    router.push(route);
  };

  return (
    <TableRow
      className=" group cursor-pointer py-1 hover:bg-secondary/30"
      onClick={handleRowClick}
    >
      {children}
    </TableRow>
  );
};

const OperationsPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);

  const { data, isLoading, error, refetch } = useQuery(getOperationsPage, {
    namespace: graphContext?.graph?.namespace,
    federatedGraphName: graphContext?.graph?.name,
  });

  if (isLoading) return <Loader fullscreen />;

  if (!isLoading && (error || data?.response?.code !== EnumStatusCode.OK)) {
    return (
      <div className="my-auto">
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve operations data"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </div>
    );
  }

  if (!data || !data.operations || data.operations.length === 0)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve operations"
        description={"" /* TBD */}
        actions={<Button onClick={() => undefined}>Retry</Button>}
      />
    );

  return (
    <div className="flex h-full flex-col gap-y-3">
      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Operation name</TableHead>
              <TableHead>Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.operations.map((operation: OperationPageItem) => (
              <OperationsTableRow id={operation.id} key={operation.id}>
                <TableCell>{operation.operationName}</TableCell>
                <TableCell>
                  {new Date(operation.timestamp).toLocaleString()}
                </TableCell>
              </OperationsTableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrapper>
    </div>
  );
};

OperationsPage.getLayout = (page) =>
  getGraphLayout(
    <GraphPageLayout
      title="Operations"
      subtitle="A list of recorded operations"
    >
      {page}
    </GraphPageLayout>,
    {
      title: "Operations",
    },
  );

export default OperationsPage;

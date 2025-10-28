import { EmptyState } from "@/components/empty-state";
import {
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
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
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/router";

const OperationsPage: NextPageWithLayout = () => {
  const router = useRouter();

  const data = null;
  const isLoading = false;
  if (isLoading) return <Loader fullscreen />;

  if (!data)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve operations"
        description={""/* TBD */}
        actions={<Button onClick={() => undefined}>Retry</Button>}
      />
    );

  return (
    <div className="flex h-full flex-col gap-y-3">
      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Id</TableHead>
              <TableHead>Operation name</TableHead>
              <TableHead>Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data ? (
              <TableRow>
                <TableCell>-</TableCell>
                <TableCell>-</TableCell>
                <TableCell>-</TableCell>
              </TableRow>
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
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

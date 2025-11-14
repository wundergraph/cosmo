import { Loader } from "@/components/ui/loader";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@connectrpc/connect-query";
import { getOperationClients } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useContext } from "react";
import { GraphContext } from "@/components/layout/graph-layout";
import { useAnalyticsQueryState } from "@/components/analytics/useAnalyticsQueryState";
import { formatISO, formatDistanceToNow } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui/table";

interface ClientUsage {
  name: string;
  version: string;
  requestCount: number;
  lastUsed: Date;
}

interface ClientUsageTableProps {
  operationHash: string;
  operationName: string;
  className?: string;
}

export const ClientUsageTable = ({
  operationHash,
  operationName,
  className,
}: ClientUsageTableProps) => {
  const graphContext = useContext(GraphContext);
  const { range, dateRange } = useAnalyticsQueryState();

  const { data, isLoading, error } = useQuery(
    getOperationClients,
    {
      namespace: graphContext?.graph?.namespace,
      federatedGraphName: graphContext?.graph?.name,
      operationHash,
      operationName,
      range,
      dateRange: range
        ? undefined
        : {
            start: formatISO(dateRange.start),
            end: formatISO(dateRange.end),
          },
    },
    {
      enabled: !!operationHash && !!graphContext?.graph?.name,
    },
  );

  const clientUsageData: ClientUsage[] =
    data?.clients?.map((client) => ({
      name: client.name || "",
      version: client.version || "",
      requestCount: Number(client.requestCount || 0),
      lastUsed: new Date(client.lastUsed || new Date()),
    })) || [];

  const totalClients = clientUsageData.length;
  const totalRequests = clientUsageData.reduce(
    (sum, client) => sum + client.requestCount,
    0,
  );
  const hasClients = clientUsageData.length > 0;

  return (
    <div className={className}>
      <div className="mb-4">
        <h3 className="text-md font-semibold">Client Usage</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Clients that have used this operation
        </p>
      </div>
      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client Name</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Requests</TableHead>
              <TableHead>Last Used</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  <Loader />
                </TableCell>
              </TableRow>
            ) : hasClients ? (
              clientUsageData.map((client, index) => (
                <TableRow key={`${client.name}-${client.version}-${index}`}>
                  <TableCell>
                    <span className="text-sm font-medium">{client.name}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {client.version}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {client.requestCount.toLocaleString()}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {formatDistanceToNow(client.lastUsed, {
                        addSuffix: true,
                      })}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-muted-foreground"
                >
                  No clients found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {!isLoading && hasClients && (
            <TableFooter>
              <TableRow className="bg-background hover:bg-background">
                <TableCell colSpan={4}>
                  <div className="flex items-center justify-center space-x-1 text-xs text-muted-foreground">
                    <span>
                      {totalClients} {totalClients === 1 ? "client" : "clients"}
                    </span>
                    <span>•</span>
                    <span>{totalRequests.toLocaleString()} total requests</span>
                  </div>
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </TableWrapper>
    </div>
  );
};

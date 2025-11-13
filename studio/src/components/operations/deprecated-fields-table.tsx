import { Loader } from "@/components/ui/loader";
import { useQuery } from "@connectrpc/connect-query";
import { getOperationDeprecatedFields } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useContext } from "react";
import { GraphContext } from "@/components/layout/graph-layout";
import { useAnalyticsQueryState } from "@/components/analytics/useAnalyticsQueryState";
import { formatISO } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/router";
import { Separator } from "../ui/separator";

interface DeprecatedField {
  fieldName: string;
  typeName: string;
  path: string;
}

interface DeprecatedFieldsTableProps {
  operationHash: string;
  operationName: string;
  className?: string;
}

export const DeprecatedFieldsTable = ({
  operationHash,
  operationName,
  className,
}: DeprecatedFieldsTableProps) => {
  const graphContext = useContext(GraphContext);
  const { range, dateRange } = useAnalyticsQueryState();
  const router = useRouter();

  const { data, isLoading, error } = useQuery(
    getOperationDeprecatedFields,
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

  const deprecatedFields: DeprecatedField[] =
    data?.deprecatedFields?.map((field) => ({
      fieldName: field.fieldName || "",
      typeName: field.typeName || "",
      path: field.path || "",
    })) || [];
  const hasDeprecatedFields = deprecatedFields.length > 0;

  const handleShowUsage = (field: DeprecatedField) => {
    // Set query params to open FieldUsageSheet
    // Format: typeName.fieldName (e.g., "User.email")
    const showUsageValue = field.typeName
      ? `${field.typeName}.${field.fieldName}`
      : field.fieldName;

    router.push({
      pathname: router.pathname,
      query: {
        ...router.query,
        showUsage: showUsageValue,
        isNamedType: "false",
      },
    });
  };

  if (isLoading) {
    return null;
  }

  return (
    <div className={className}>
      <div className="mb-4">
        <h3 className="text-md font-semibold">Deprecated Fields</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Fields in this operation that have been marked as deprecated
        </p>
      </div>
      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field Path</TableHead>
              <TableHead className="w-[150px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hasDeprecatedFields &&
              deprecatedFields.map((field, index) => (
                <TableRow key={`${field.path}-${index}`}>
                  <TableCell>
                    <code className="rounded bg-muted px-2 py-1 font-mono text-sm">
                      {field.path}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleShowUsage(field)}
                    >
                      Show Usage
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            {!hasDeprecatedFields && (
              <TableRow>
                <TableCell
                  colSpan={2}
                  className="text-center text-muted-foreground"
                >
                  No deprecated fields found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableWrapper>
    </div>
  );
};

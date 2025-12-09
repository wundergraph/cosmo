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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/router";

interface DeprecatedField {
  fieldName: string;
  typeName: string;
  path: string;
  deprecationReason: string;
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
      deprecationReason: field.deprecationReason || "-",
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
              <TableHead className="w-[30%]">Field Path</TableHead>
              <TableHead className="w-[50%]">Deprecation Reason</TableHead>
              <TableHead className="w-[20%] text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
        <div className="scrollbar-custom max-h-[232px] flex-1 overflow-y-auto">
          <Table>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-24 text-center">
                    <Loader />
                  </TableCell>
                </TableRow>
              ) : hasDeprecatedFields ? (
                deprecatedFields.map((field, index) => (
                  <TableRow key={`${field.path}-${index}`}>
                    <TableCell className="w-[30%]">
                      <code className="rounded bg-muted px-2 py-1 font-mono text-sm">
                        {field.path}
                      </code>
                    </TableCell>
                    <TableCell className="w-[50%]">
                      <span className="text-sm text-muted-foreground">
                        {field.deprecationReason || "-"}
                      </span>
                    </TableCell>
                    <TableCell className="w-[20%] text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleShowUsage(field)}
                      >
                        Show Usage
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="text-center text-muted-foreground"
                  >
                    No deprecated fields found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {!isLoading && hasDeprecatedFields && (
          <Table className="w-full border-t">
            <TableFooter>
              <TableRow className="border-b-0 bg-background hover:bg-background">
                <TableCell colSpan={3}>
                  <div className="flex items-center justify-center space-x-1 text-xs text-muted-foreground">
                    <span>
                      Found {deprecatedFields.length}{" "}
                      {deprecatedFields.length === 1
                        ? "deprecated field"
                        : "deprecated fields"}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </TableWrapper>
    </div>
  );
};

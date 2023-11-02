import { cn } from "@/lib/utils";
import { SchemaChange } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useRouter } from "next/router";
import { Button } from "../ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { useToast } from "../ui/use-toast";

export const ChangesTable = ({
  changes,
  caption,
}: {
  changes: SchemaChange[];
  caption: React.ReactNode;
}) => {
  const router = useRouter();
  const { toast } = useToast();

  const openUsage = (changeType: string, path?: string) => {
    if (!path) {
      toast({
        description: "Not enough data to fetch usage for this change",
        duration: 2000,
      });
      return;
    }

    const query: Record<string, any> = {
      showUsage: path,
    };

    if (
      [
        "UNION_MEMBER_REMOVED",
        "ENUM_VALUE_ADDED",
        "ENUM_VALUE_REMOVED",
      ].includes(changeType)
    ) {
      query.isNamedType = true;
      query.showUsage = path.split(".")[0];
    }

    router.replace({
      pathname: router.pathname,
      query: {
        ...router.query,
        ...query,
      },
    });
  };

  return (
    <div className="scrollbar-custom max-h-[70vh] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">Change</TableHead>
            <TableHead className="w-[200px]">Type</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-2/12 2xl:w-1/12">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {changes.map(({ changeType, message, isBreaking, path }) => {
            return (
              <TableRow key={changeType + message}>
                <TableCell className={cn(isBreaking && "text-destructive")}>
                  {isBreaking ? "Breaking" : "Non-Breaking"}
                </TableCell>
                <TableCell>{changeType}</TableCell>
                <TableCell>{message}</TableCell>
                <TableCell>
                  <Button
                    onClick={() => openUsage(changeType, path)}
                    className="p-0"
                    variant="link"
                  >
                    View usage
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableCaption>{caption}</TableCaption>
      </Table>
    </div>
  );
};

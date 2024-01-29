import { cn } from "@/lib/utils";
import {
  BarChartIcon,
  CheckIcon,
  Cross1Icon,
  GlobeIcon,
} from "@radix-ui/react-icons";
import { SchemaChange } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatISO, subHours } from "date-fns";
import Link from "next/link";
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
  TableWrapper,
} from "../ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useToast } from "../ui/use-toast";

export const ChangesTable = ({
  changes,
  caption,
  trafficCheckDays,
  createdAt,
}: {
  changes: SchemaChange[];
  caption: React.ReactNode;
  trafficCheckDays: number;
  createdAt: string;
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

    if (trafficCheckDays) {
      query.dateRange = JSON.stringify({
        start: formatISO(subHours(new Date(createdAt), 24 * trafficCheckDays)),
        end: formatISO(new Date(createdAt)),
      });
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
    <div>
      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Change</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-2/12 2xl:w-1/12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changes.map(({ changeType, message, isBreaking, path }) => {
              return (
                <TableRow
                  key={changeType + message}
                  className="group hover:bg-secondary/20"
                >
                  <TableCell
                    className={cn(
                      isBreaking ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {isBreaking ? <Cross1Icon /> : <CheckIcon />}
                      <span
                        className="block w-[160px] truncate"
                        title={changeType}
                      >
                        {changeType}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{message}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-x-2">
                      <TooltipProvider>
                        <Tooltip delayDuration={100}>
                          <TooltipTrigger>
                            <Button
                              disabled={!path}
                              variant="ghost"
                              size="icon-sm"
                              asChild
                              className="table-action"
                            >
                              <Link
                                href={
                                  path
                                    ? {
                                        pathname: `/[organizationSlug]/[namespace]/graph/[slug]/schema`,
                                        query: {
                                          organizationSlug:
                                            router.query.organizationSlug,
                                          namespace: router.query.namespace,
                                          slug: router.query.slug,
                                          typename: path?.split(".")?.[0],
                                        },
                                      }
                                    : "#"
                                }
                              >
                                <GlobeIcon />
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {path
                              ? "Open in Explorer"
                              : "Cannot open in explorer. Path to type unavailable"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip delayDuration={100}>
                          <TooltipTrigger>
                            <Button
                              onClick={() => openUsage(changeType, path)}
                              variant="ghost"
                              size="icon-sm"
                              className="table-action"
                            >
                              <BarChartIcon />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View Usage</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableCaption>{caption}</TableCaption>
        </Table>
      </TableWrapper>
    </div>
  );
};

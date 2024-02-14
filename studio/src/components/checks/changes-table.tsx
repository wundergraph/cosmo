import { cn } from "@/lib/utils";
import {
  BarChartIcon,
  CheckIcon,
  Cross1Icon,
  GlobeIcon,
} from "@radix-ui/react-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createOperationOverrides,
  getCheckOperations,
  removeOperationOverrides,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { SchemaChange } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatISO, subHours } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext } from "react";
import { GraphContext } from "../layout/graph-layout";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useToast } from "../ui/use-toast";

export const ChangesTable = ({
  changes,
  caption,
  trafficCheckDays,
  createdAt,
  operationHash,
}: {
  changes: SchemaChange[];
  caption?: React.ReactNode;
  trafficCheckDays?: number;
  createdAt?: string;
  operationHash?: string;
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

    if (trafficCheckDays && createdAt) {
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
    <TableWrapper>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">Change</TableHead>
            <TableHead>Description</TableHead>
            {operationHash && (
              <TableHead className="lg:w-28 2xl:w-40">Override</TableHead>
            )}
            <TableHead className="w-2/12 2xl:w-1/12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {changes.map((c, i) => (
            <Row
              key={i}
              {...c}
              operationHash={operationHash}
              openUsage={openUsage}
            />
          ))}
        </TableBody>
        {caption && <TableCaption>{caption}</TableCaption>}
      </Table>
    </TableWrapper>
  );
};

const Row = ({
  changeType,
  message,
  isBreaking,
  path,
  hasOverride,
  operationHash,
  openUsage,
}: {
  changeType: string;
  message: string;
  isBreaking: boolean;
  path?: string;
  hasOverride?: boolean;
  operationHash?: string;
  openUsage: (changeType: string, path?: string) => void;
}) => {
  const router = useRouter();
  const { toast } = useToast();
  const graphContext = useContext(GraphContext);

  const client = useQueryClient();

  const invalidateCheckOperations = () => {
    const key = getCheckOperations.getQueryKey();
    client.invalidateQueries({
      queryKey: key,
    });
  };

  const { mutate: createOverrides, isPending: creatingOverrides } = useMutation(
    {
      ...createOperationOverrides.useMutation(),
      onSuccess: (d) => {
        if (d.response?.code === EnumStatusCode.OK) {
          invalidateCheckOperations();
        } else {
          toast({
            description:
              d.response?.details ??
              "Could not update overrides. Please try again.",
            duration: 3000,
          });
        }
      },
      onError: () => {
        toast({
          description: "Could not update overrides. Please try again.",
          duration: 3000,
        });
      },
    },
  );

  const { mutate: removeOverrides, isPending: removingOverrides } = useMutation(
    {
      ...removeOperationOverrides.useMutation(),
      onSuccess: (d) => {
        if (d.response?.code === EnumStatusCode.OK) {
          invalidateCheckOperations();
        } else {
          toast({
            description:
              d.response?.details ??
              "Could not remove override. Please try again.",
            duration: 3000,
          });
        }
      },
      onError: () => {
        toast({
          description: "Could not remove override. Please try again.",
          duration: 3000,
        });
      },
    },
  );

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
          <span className="block w-[160px] truncate" title={changeType}>
            {changeType}
          </span>
        </div>
      </TableCell>
      <TableCell>{message}</TableCell>
      {operationHash && (
        <TableCell>
          <Switch
            checked={hasOverride}
            disabled={creatingOverrides || removingOverrides}
            onCheckedChange={() =>
              hasOverride
                ? removeOverrides({
                    graphName: graphContext?.graph?.name,
                    namespace: graphContext?.graph?.namespace,
                    operationHash,
                    changes: [
                      {
                        changeType,
                        path,
                      },
                    ],
                  })
                : createOverrides({
                    graphName: graphContext?.graph?.name,
                    namespace: graphContext?.graph?.namespace,
                    operationHash,
                    changes: [
                      {
                        changeType,
                        path,
                      },
                    ],
                  })
            }
          />
        </TableCell>
      )}
      <TableCell>
        <div className="flex items-center gap-x-2">
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
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
                            organizationSlug: router.query.organizationSlug,
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

          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
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
        </div>
      </TableCell>
    </TableRow>
  );
};

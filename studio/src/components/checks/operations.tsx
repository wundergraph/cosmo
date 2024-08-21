import { FieldUsageSheet } from "@/components/analytics/field-usage";
import { ChangesTable } from "@/components/checks/changes-table";
import { EmptyState } from "@/components/empty-state";
import { GraphContext } from "@/components/layout/graph-layout";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { useToast } from "@/components/ui/use-toast";
import { formatDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  ChevronDownIcon,
  Cross1Icon,
  InfoCircledIcon,
  MagnifyingGlassIcon,
  Share1Icon,
} from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createIgnoreOverridesForAllOperations,
  createOperationIgnoreAllOverride,
  createOperationOverrides,
  getCheckOperations,
  removeOperationIgnoreAllOverride,
  removeOperationOverrides,
  toggleChangeOverridesForAllOperations,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import copy from "copy-to-clipboard";
import Fuse from "fuse.js";
import { useRouter } from "next/router";
import { useContext, useMemo, useState } from "react";
import { useApplyParams } from "../analytics/use-apply-params";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { OperationContentDialog } from "./operation-content";

export const CheckOperations = () => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();
  const { toast } = useToast();

  const id = router.query.checkId as string;

  const { data, isLoading, error, refetch } = useQuery(
    getCheckOperations,
    {
      checkId: id,
      graphName: graphContext?.graph?.name,
      namespace: graphContext?.graph?.namespace,
    },
    {
      enabled: !!graphContext?.graph?.name,
    },
  );

  const { mutate: createOverrides, isPending: creatingOverrides } = useMutation(
    createOperationOverrides,
    {
      onSuccess: (d) => {
        if (d.response?.code === EnumStatusCode.OK) {
          refetch();
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

  const { mutate: removeIgnoreAll, isPending: removing } = useMutation(
    removeOperationIgnoreAllOverride,
    {
      onSuccess: (d) => {
        if (d.response?.code === EnumStatusCode.OK) {
          refetch();
        } else {
          toast({
            description:
              d.response?.details ??
              "Could not remove ignore all override. Please try again.",
            duration: 3000,
          });
        }
      },
      onError: () => {
        toast({
          description:
            "Could not remove ignore all override. Please try again.",
          duration: 3000,
        });
      },
    },
  );

  const { mutate: createIgnoreAll, isPending: ignoring } = useMutation(
    createOperationIgnoreAllOverride,
    {
      onSuccess: (d) => {
        if (d.response?.code === EnumStatusCode.OK) {
          refetch();
        } else {
          toast({
            description:
              d.response?.details ??
              "Could not create ignore all override. Please try again.",
            duration: 3000,
          });
        }
      },
      onError: () => {
        toast({
          description:
            "Could not create ignore all override. Please try again.",
          duration: 3000,
        });
      },
    },
  );

  const { mutate: removeOverrides, isPending: removingOverrides } = useMutation(
    removeOperationOverrides,
    {
      onSuccess: (d) => {
        if (d.response?.code === EnumStatusCode.OK) {
          refetch();
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

  const {
    mutate: toggleGlobalChangeOverrides,
    isPending: togglingGlobalChangeOverrides,
  } = useMutation(toggleChangeOverridesForAllOperations, {
    onSuccess: (d) => {
      if (d.response?.code === EnumStatusCode.OK) {
        toast({
          description: "All overrides have been toggled successfully",
        });
        refetch();
      } else {
        toast({
          description:
            d.response?.details ??
            "Could not toggle overrides. Please try again.",
          duration: 3000,
        });
      }
    },
    onError: () => {
      toast({
        description: "Could not toggle override. Please try again.",
        duration: 3000,
      });
    },
  });

  const {
    mutate: createGlobalIgnoreOverrides,
    isPending: creatingGlobalIgnoreOverrides,
  } = useMutation(createIgnoreOverridesForAllOperations, {
    onSuccess: (d) => {
      if (d.response?.code === EnumStatusCode.OK) {
        toast({
          description:
            "All listed operations will now be ignored for future checks",
        });
        refetch();
      } else {
        toast({
          description:
            d.response?.details ??
            "Could not toggle overrides. Please try again.",
          duration: 3000,
        });
      }
    },
    onError: () => {
      toast({
        description: "Could not toggle override. Please try again.",
        duration: 3000,
      });
    },
  });

  const [search, setSearch] = useState(router.query.search as string);

  const applyParams = useApplyParams();

  const copyLink = (hash: string) => {
    const [base, _] = window.location.href.split("?");
    const link = base + `?search=${hash.slice(0, 6)}`;
    copy(link);
    toast({ description: "Copied link to clipboard" });
  };

  const filteredOperations = useMemo(() => {
    const fuse = new Fuse(data?.operations ?? [], {
      keys: ["hash", "name"],
      minMatchCharLength: 1,
    });

    return search
      ? fuse.search(search).map(({ item }) => item)
      : data?.operations || [];
  }, [data?.operations, search]);

  const doAllOperationsHaveIgnoreAllOverride = useMemo(() => {
    return filteredOperations.every((op) => op.hasIgnoreAllOverride);
  }, [filteredOperations]);

  const doAllOperationsHaveAllTheirChangesMarkedSafe = useMemo(() => {
    return filteredOperations.every((op) =>
      op.impactingChanges.every((c) => !!c.hasOverride),
    );
  }, [filteredOperations]);

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve affected operations"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  if (data && data.operations.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircleIcon className="text-success" />}
        title="Operations Check Successful"
        description="There are no operations that are affected by breaking changes"
      />
    );
  }

  return (
    <div className="px-4 lg:px-6">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute bottom-0 left-3 top-0 my-auto" />
          <Input
            placeholder="Search by hash or name"
            className="pl-8 pr-10"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              applyParams({ search: e.target.value });
            }}
          />
          {search && (
            <Button
              variant="ghost"
              className="absolute bottom-0 right-0 top-0 my-auto rounded-l-none"
              onClick={() => {
                setSearch("");
                applyParams({ search: null });
              }}
            >
              <Cross1Icon />
            </Button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              Override All
              <ChevronDownIcon className="ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={togglingGlobalChangeOverrides}
              onClick={() => {
                toggleGlobalChangeOverrides({
                  checkId: id,
                  isSafe: !doAllOperationsHaveAllTheirChangesMarkedSafe,
                  graphName: graphContext?.graph?.name,
                  namespace: graphContext?.graph?.namespace,
                });
              }}
              className="cursor-pointer flex-col items-start gap-1"
            >
              {doAllOperationsHaveAllTheirChangesMarkedSafe
                ? "Toggle changes as unsafe"
                : "Toggle changes as safe"}
              <p className="max-w-xs text-xs text-muted-foreground">
                {doAllOperationsHaveAllTheirChangesMarkedSafe
                  ? "Future checks will break if the current changes appear again for the detected operations"
                  : "Future checks will ignore the current breaking changes for the detected operations"}
              </p>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={
                creatingGlobalIgnoreOverrides ||
                doAllOperationsHaveIgnoreAllOverride
              }
              onClick={() => {
                createGlobalIgnoreOverrides({
                  checkId: id,
                  graphName: graphContext?.graph?.name,
                  namespace: graphContext?.graph?.namespace,
                });
              }}
              className="cursor-pointer flex-col items-start gap-1"
            >
              Ignore All Operations
              <p className="max-w-xs text-xs text-muted-foreground">
                Future checks will ignore all current and new breaking changes
                for the detected operations
              </p>
              {doAllOperationsHaveIgnoreAllOverride && (
                <p className=" mt-2 flex items-center gap-x-2 text-xs">
                  <InfoCircledIcon className="h-4 w-4" /> All listed operations
                  are already ignored
                </p>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Accordion type="single" collapsible className="mt-4 w-full">
        {filteredOperations.map(
          ({
            hash,
            name,
            type,
            firstSeenAt,
            lastSeenAt,
            impactingChanges,
            hasIgnoreAllOverride,
            isSafe,
          }) => {
            const doAllChangesHaveOverrides = !impactingChanges.some(
              (c) => !c.hasOverride,
            );

            const firstSeenFormatted = formatDateTime(new Date(firstSeenAt));
            const lastSeenAtFormatted = formatDateTime(new Date(lastSeenAt));

            return (
              <AccordionItem id={hash} key={hash} value={hash}>
                <AccordionTrigger className="px-2 hover:bg-secondary/30 hover:no-underline">
                  <div className="flex flex-1 items-center gap-2">
                    <p className="w-16 text-start text-muted-foreground">
                      {hash.slice(0, 6)}
                    </p>
                    <p
                      className={cn({
                        "italic text-muted-foreground": name.length === 0,
                      })}
                    >
                      {name || "unnamed operation"}
                    </p>
                    <Badge
                      className="!inline-block !decoration-[none]"
                      variant="outline"
                    >
                      {type}
                    </Badge>
                    {isSafe && (
                      <Badge
                        className="!inline-block !decoration-[none]"
                        variant="success"
                      >
                        ignored for this check
                      </Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="mt-2 flex flex-col gap-y-6 px-2">
                    <div className="items-center justify-between space-y-6 md:flex-row xl:flex xl:space-y-0">
                      <p className="text-muted-foreground">
                        {firstSeenFormatted === lastSeenAtFormatted
                          ? `Last seen at ${lastSeenAtFormatted}`
                          : `First seen at ${firstSeenFormatted} and last seen at ${lastSeenAtFormatted}`}
                      </p>
                      <div className="flex items-center gap-x-2">
                        <OperationContentDialog hash={hash} />
                        <Tooltip delayDuration={100}>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon-sm"
                              variant="secondary"
                              onClick={() => copyLink(hash)}
                            >
                              <Share1Icon />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Copy link</TooltipContent>
                        </Tooltip>
                        {!hasIgnoreAllOverride && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="secondary">
                                Configure Override
                                <ChevronDownIcon className="ml-2" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                disabled={
                                  removingOverrides || creatingOverrides
                                }
                                onClick={() => {
                                  doAllChangesHaveOverrides
                                    ? removeOverrides({
                                        graphName: graphContext?.graph?.name,
                                        namespace:
                                          graphContext?.graph?.namespace,
                                        operationHash: hash,
                                        changes: impactingChanges,
                                      })
                                    : createOverrides({
                                        graphName: graphContext?.graph?.name,
                                        namespace:
                                          graphContext?.graph?.namespace,
                                        operationHash: hash,
                                        operationName: name,
                                        changes: impactingChanges,
                                      });
                                }}
                                className="cursor-pointer flex-col items-start gap-1"
                              >
                                {doAllChangesHaveOverrides
                                  ? "Toggle changes as unsafe"
                                  : "Toggle changes as safe"}
                                <p className="max-w-xs text-xs text-muted-foreground">
                                  {doAllChangesHaveOverrides
                                    ? "Future checks will break if the listed changes appear again for this operation"
                                    : "Future checks will ignore the listed breaking changes for this operation"}
                                </p>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={ignoring}
                                onClick={() => {
                                  createIgnoreAll({
                                    operationHash: hash,
                                    operationName: name,
                                    graphName: graphContext?.graph?.name,
                                    namespace: graphContext?.graph?.namespace,
                                  });
                                }}
                                className="cursor-pointer flex-col items-start gap-1"
                              >
                                Ignore Operation
                                <p className="max-w-xs text-xs text-muted-foreground">
                                  Future checks will ignore all current and new
                                  breaking changes for this operation
                                </p>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                    {hasIgnoreAllOverride && (
                      <Alert>
                        <AlertTitle>
                          Ignore Operation override is active
                        </AlertTitle>
                        <AlertDescription>
                          Future checks will ignore this operation even if
                          breaking changes affect it. To configure overrides for
                          individual changes, please remove this override.
                        </AlertDescription>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="mt-4"
                          isLoading={removing}
                          onClick={() =>
                            removeIgnoreAll({
                              graphName: graphContext?.graph?.name,
                              namespace: graphContext?.graph?.namespace,
                              operationHash: hash,
                            })
                          }
                        >
                          Remove Override
                        </Button>
                      </Alert>
                    )}
                    <ChangesTable
                      operationHash={hash}
                      operationName={name}
                      changes={impactingChanges}
                      hasIgnoreAll={hasIgnoreAllOverride}
                      caption={
                        <>
                          {impactingChanges.length} Impacting Change
                          {impactingChanges.length === 1 ? "" : "s"}
                        </>
                      }
                      trafficCheckDays={data.trafficCheckDays}
                      createdAt={data.createdAt}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          },
        )}
      </Accordion>
      <FieldUsageSheet />
    </div>
  );
};

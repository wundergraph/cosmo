import { FieldUsageSheet } from "@/components/analytics/field-usage";
import { ChangesTable } from "@/components/checks/changes-table";
import { CodeViewer } from "@/components/code-viewer";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useToast } from "@/components/ui/use-toast";
import { formatDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import {
  Cross1Icon,
  MagnifyingGlassIcon,
  Share1Icon,
} from "@radix-ui/react-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createOperationIgnoreAllOverride,
  createOperationOverride,
  getCheckOperations,
  getOperationContent,
  getOperationOverrides,
  removeOperationIgnoreAllOverride,
  removeOperationOverride,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { SchemaChange } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import copy from "copy-to-clipboard";
import Fuse from "fuse.js";
import Link from "next/link";
import { useRouter } from "next/router";
import graphQLPlugin from "prettier/plugins/graphql";
import * as prettier from "prettier/standalone";
import { useContext, useEffect, useState } from "react";
import { PiBracketsCurly } from "react-icons/pi";
import { useApplyParams } from "../analytics/use-apply-params";
import { Separator } from "../ui/separator";

const Override = ({
  checkId,
  changes,
  createdAt,
  refresh,
  operationHash,
}: {
  checkId: string;
  changes: SchemaChange[];
  createdAt: string;
  operationHash: string;
  refresh: () => void;
}) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug;

  const graphContext = useContext(GraphContext);
  const { toast } = useToast();

  const { mutate: removeOverride, isPending } = useMutation({
    ...removeOperationOverride.useMutation(),
    onSuccess: (d) => {
      if (d.response?.code === EnumStatusCode.OK) {
        refresh();
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
  });

  return (
    <ChangesTable
      changes={changes}
      hideActions
      hideHeaders
      caption={
        <div className="flex flex-col items-start justify-between gap-4 px-4 md:flex-row md:items-center">
          <p className="text-left text-xs">
            Created on check{" "}
            <Link
              className="text-primary"
              href={`/${organizationSlug}/${graphContext?.graph?.namespace}/graph/${graphContext?.graph?.name}/checks/${checkId}`}
            >
              {checkId.slice(0, 6)}
            </Link>
            . Created at {formatDateTime(new Date(createdAt))}
          </p>
          <Button
            isLoading={isPending}
            onClick={() => {
              removeOverride({
                checkId,
                graphName: graphContext?.graph?.name,
                namespace: graphContext?.graph?.namespace,
                operationHash,
              });
            }}
            size="sm"
            variant="outline"
          >
            Remove
          </Button>
        </div>
      }
    />
  );
};

const ConfigureOverride = ({
  operationHash,
  operationName,
}: {
  operationHash: string;
  operationName: string;
}) => {
  const graphContext = useContext(GraphContext);

  const router = useRouter();
  const override = router.query.override;
  const checkId = router.query.checkId as string;

  const { toast } = useToast();
  const applyParams = useApplyParams();

  const { data, error, isLoading, refetch } = useQuery({
    ...getOperationOverrides.useQuery({
      graphName: graphContext?.graph?.name,
      namespace: graphContext?.graph?.namespace,
      operationHash,
    }),
    enabled: !!override,
  });

  const { mutate: createOverride, isPending } = useMutation({
    ...createOperationOverride.useMutation(),
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
  });

  const { mutate: removeIgnoreAll, isPending: removing } = useMutation({
    ...removeOperationIgnoreAllOverride.useMutation(),
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
        description: "Could not remove ignore all override. Please try again.",
        duration: 3000,
      });
    },
  });

  const { mutate: createIgnoreAll, isPending: ignoring } = useMutation({
    ...createOperationIgnoreAllOverride.useMutation(),
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
        description: "Could not create ignore all override. Please try again.",
        duration: 3000,
      });
    },
  });

  let content;

  if (isLoading) {
    content = <Loader fullscreen />;
  } else if (error || data?.response?.code !== EnumStatusCode.OK) {
    content = (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve overrides"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  } else {
    content = (
      <div className="relative flex flex-1 flex-col">
        {data.ignoreAll && (
          <div className="absolute flex h-full w-full items-center justify-center">
            <div className="absolute inset-0 z-40 bg-background/80 backdrop-blur-lg"></div>
            <EmptyState
              className="z-50 -mt-24"
              icon={<InformationCircleIcon />}
              title="Ignoring All Changes"
              description="All breaking changes are ignored for the operation traffic check."
              actions={
                <Button
                  isLoading={removing}
                  onClick={() =>
                    removeIgnoreAll({
                      graphName: graphContext?.graph?.name,
                      namespace: graphContext?.graph?.namespace,
                      operationHash,
                    })
                  }
                >
                  Remove ignore override
                </Button>
              }
            />
          </div>
        )}
        <div className="scrollbar-custom relative flex h-full flex-col gap-y-8 overflow-auto">
          {data.overrides.map((override) => {
            return (
              <Override
                key={override.checkId}
                operationHash={operationHash}
                refresh={() => refetch()}
                {...override}
              />
            );
          })}

          {data.overrides.length === 0 && (
            <EmptyState
              icon={<InformationCircleIcon />}
              title="No overrides found"
              description="You can add the changes from the current check to the overrides"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <Sheet
      open={!!override}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          applyParams({
            override: null,
          });
        } else {
          applyParams({
            override: operationHash,
          });
        }
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline">Configure overrides</Button>
      </SheetTrigger>
      <SheetContent className="flex h-full w-full max-w-full flex-col sm:max-w-full md:max-w-2xl lg:max-w-4xl">
        <SheetHeader>
          <SheetTitle>
            Overrides for{" "}
            <span
              className={cn({
                "italic text-muted-foreground": operationName.length === 0,
              })}
            >
              {operationName || "unnamed operation"}
            </span>
          </SheetTitle>
          <SheetDescription>
            Remove existing overrides or add new changes from the current check.
            Overrides are only applicable for new checks.{" "}
          </SheetDescription>
        </SheetHeader>
        {content}
        {data?.overrides && !data.ignoreAll && (
          <>
            <Separator />
            <SheetFooter className="gap-2 md:gap-0">
              {!data.overrides.find((o) => o.checkId === checkId) && (
                <Button
                  isLoading={isPending}
                  onClick={() =>
                    createOverride({
                      checkId,
                      operationHash,
                      graphName: graphContext?.graph?.name,
                      namespace: graphContext?.graph?.namespace,
                    })
                  }
                >
                  Add current check to overrides
                </Button>
              )}
              <Button
                variant="secondary"
                isLoading={ignoring}
                onClick={() =>
                  createIgnoreAll({
                    operationHash,
                    graphName: graphContext?.graph?.name,
                    namespace: graphContext?.graph?.namespace,
                  })
                }
              >
                Ignore All
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

const OperationContent = ({
  hash,
  enabled,
}: {
  hash: string;
  enabled: boolean;
}) => {
  const [content, setContent] = useState("");

  const { data, error, isLoading, refetch } = useQuery({
    ...getOperationContent.useQuery({
      hash,
    }),
    enabled,
  });

  useEffect(() => {
    const set = async (source: string) => {
      const res = await prettier.format(source, {
        parser: "graphql",
        plugins: [graphQLPlugin],
      });
      setContent(res);
    };

    if (!data) return;
    set(data.operationContent);
  }, [data]);

  if (isLoading) {
    return (
      <div className="h-96">
        <Loader fullscreen />
      </div>
    );
  }

  if (error)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve content"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  return (
    <div className="scrollbar-custom h-[50vh] overflow-auto rounded border">
      <CodeViewer code={content} disableLinking />
    </div>
  );
};

const OperationContentDialog = ({ hash }: { hash: string }) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(val) => setOpen(val)}>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="secondary">
          <PiBracketsCurly />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Operation Content</DialogTitle>
        </DialogHeader>
        <OperationContent hash={hash} enabled={open} />
      </DialogContent>
    </Dialog>
  );
};

export const CheckOperations = () => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();
  const { toast } = useToast();

  const id = router.query.checkId as string;

  const { data, isLoading, error, refetch } = useQuery({
    ...getCheckOperations.useQuery({
      checkId: id,
      graphName: graphContext?.graph?.name,
      namespace: graphContext?.graph?.namespace,
    }),
    enabled: !!graphContext?.graph?.name,
  });

  const [search, setSearch] = useState(router.query.search as string);

  const applyParams = (search: string) => {
    const query = { ...router.query };
    query.search = search;

    if (!search) {
      delete query.search;
    }

    router.replace({
      query,
    });
  };

  const copyLink = (hash: string) => {
    const [base, _] = window.location.href.split("?");
    const link = base + `?search=${hash.slice(0, 6)}`;
    copy(link);
    toast({ description: "Copied link to clipboard" });
  };

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

  const fuse = new Fuse(data.operations, {
    keys: ["hash", "name"],
    minMatchCharLength: 1,
  });

  const filteredOperations = search
    ? fuse.search(search).map(({ item }) => item)
    : data.operations;

  return (
    <div className="px-4 lg:px-6">
      <div className="relative">
        <MagnifyingGlassIcon className="absolute bottom-0 left-3 top-0 my-auto" />
        <Input
          placeholder="Search by hash or name"
          className="pl-8 pr-10"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            applyParams(e.target.value);
          }}
        />
        {search && (
          <Button
            variant="ghost"
            className="absolute bottom-0 right-0 top-0 my-auto rounded-l-none"
            onClick={() => {
              setSearch("");
              applyParams("");
            }}
          >
            <Cross1Icon />
          </Button>
        )}
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
            isSafe,
          }) => {
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
                        safe
                      </Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="mt-2 flex flex-col gap-y-6 px-2">
                    <div className="items-center justify-between space-y-6 md:flex-row xl:flex xl:space-y-0">
                      <p className="text-muted-foreground">
                        First seen at {formatDateTime(new Date(firstSeenAt))}{" "}
                        and last seen at {formatDateTime(new Date(lastSeenAt))}
                      </p>
                      <div className="flex items-center gap-x-2">
                        <ConfigureOverride
                          operationHash={hash}
                          operationName={name}
                        />
                        <OperationContentDialog hash={hash} />
                        <Button
                          size="icon-sm"
                          variant="secondary"
                          onClick={() => copyLink(hash)}
                        >
                          <Share1Icon />
                        </Button>
                      </div>
                    </div>
                    <ChangesTable
                      changes={impactingChanges}
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

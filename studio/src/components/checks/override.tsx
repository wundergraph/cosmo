import { EmptyState } from "@/components/empty-state";
import { GraphContext } from "@/components/layout/graph-layout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createOperationIgnoreAllOverride,
  getAllOverrides,
  getCheckOperations,
  getOperationOverrides,
  removeOperationIgnoreAllOverride,
  removeOperationOverrides,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useContext } from "react";
import { useApplyParams } from "../analytics/use-apply-params";
import { CopyButton } from "../ui/copy-button";
import { Label } from "../ui/label";
import { Separator } from "../ui/separator";
import { Switch } from "../ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "../ui/table";

const Override = ({
  changeType,
  path,
  operationHash,
  refresh,
}: {
  changeType: string;
  path?: string;
  operationHash?: string;
  refresh?: () => void;
}) => {
  const router = useRouter();
  const { toast } = useToast();
  const graphContext = useContext(GraphContext);

  const { mutate: removeOverrides, isPending: removingOverrides } = useMutation(
    {
      ...removeOperationOverrides.useMutation(),
      onSuccess: (d) => {
        if (d.response?.code === EnumStatusCode.OK) {
          refresh?.();
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
    <TableRow key={changeType + path} className="group hover:bg-secondary/20">
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="block w-[160px] truncate" title={changeType}>
            {changeType}
          </span>
        </div>
      </TableCell>
      <TableCell>{path}</TableCell>
      {operationHash && (
        <TableCell>
          <Button
            variant="outline"
            isLoading={removingOverrides}
            onClick={() =>
              removeOverrides({
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
          >
            Remove
          </Button>
        </TableCell>
      )}
    </TableRow>
  );
};

export const ConfigureOverride = () => {
  const graphContext = useContext(GraphContext);

  const router = useRouter();
  const operationHash = router.query.override as string;
  const operationName = router.query.overrideName as string;

  const client = useQueryClient();

  const { toast } = useToast();
  const applyParams = useApplyParams();

  const { data, error, isLoading, refetch } = useQuery({
    ...getOperationOverrides.useQuery({
      graphName: graphContext?.graph?.name,
      namespace: graphContext?.graph?.namespace,
      operationHash,
    }),
    enabled: !!operationHash,
  });

  const invalidateOverrides = () => {
    const key = getAllOverrides.getQueryKey();
    client.invalidateQueries({
      queryKey: key,
    });
  };

  const { mutate: removeIgnoreAll, isPending: removing } = useMutation({
    ...removeOperationIgnoreAllOverride.useMutation(),
    onSuccess: (d) => {
      if (d.response?.code === EnumStatusCode.OK) {
        refetch();
        invalidateOverrides();
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
        invalidateOverrides();
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
        <div className="flex w-full flex-row items-center justify-between rounded-lg border px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="ignore-all">Ignore All</Label>
            <p className="text-[0.8rem] text-muted-foreground">
              Future checks will not fail if any breaking changes are observed
              for this operation
            </p>
          </div>

          <Switch
            id="ignore-all"
            checked={data.ignoreAll}
            disabled={ignoring || removing}
            onCheckedChange={() =>
              data.ignoreAll
                ? removeIgnoreAll({
                    graphName: graphContext?.graph?.name,
                    namespace: graphContext?.graph?.namespace,
                    operationHash,
                  })
                : createIgnoreAll({
                    operationHash,
                    operationName,
                    graphName: graphContext?.graph?.name,
                    namespace: graphContext?.graph?.namespace,
                  })
            }
          />
        </div>
        <Separator className="my-4" />
        <div className="relative h-full w-full">
          {data.ignoreAll && (
            <div className="absolute flex h-full w-full items-center justify-center">
              <div className="absolute inset-0 z-40 bg-background/80 backdrop-blur-lg"></div>
              <EmptyState
                className="z-50 -mt-44"
                icon={<InformationCircleIcon />}
                title="Ignoring All Changes"
              />
            </div>
          )}
          {data.changes.length === 0 ? (
            <EmptyState
              icon={<InformationCircleIcon />}
              title="No overrides found"
            />
          ) : (
            <TableWrapper>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Change</TableHead>
                    <TableHead>Schema Path</TableHead>
                    <TableHead className="w-2/12 2xl:w-1/12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.changes.map((c, i) => (
                    <Override
                      key={i}
                      {...c}
                      operationHash={operationHash}
                      refresh={() => {
                        refetch();
                        invalidateOverrides();
                      }}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </div>
      </div>
    );
  }

  return (
    <Sheet
      open={!!operationHash}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          applyParams({
            override: null,
            overrideName: null,
          });
        }
      }}
    >
      <SheetContent className="flex h-full w-full max-w-full flex-col sm:max-w-full md:max-w-2xl lg:max-w-4xl">
        <SheetHeader>
          <SheetTitle>
            Overrides for{" "}
            <span
              className={cn({
                "italic text-muted-foreground": !operationName,
              })}
            >
              {operationName || "unnamed operation"}
            </span>
          </SheetTitle>
          <SheetDescription>
            Configure override for the operation with hash {operationHash}{" "}
            <CopyButton value={operationHash} tooltip="Copy operation hash" />
          </SheetDescription>
        </SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  );
};

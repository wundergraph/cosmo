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
  TrashIcon,
} from "@heroicons/react/24/outline";
import { ClipboardCopyIcon, GlobeIcon } from "@radix-ui/react-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useQuery,
  useMutation,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createOperationIgnoreAllOverride,
  getAllOverrides,
  getOperationOverrides,
  removeOperationIgnoreAllOverride,
  removeOperationOverrides,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import copy from "copy-to-clipboard";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext } from "react";
import { useApplyParams } from "../analytics/use-apply-params";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { OperationContentDialog } from "./operation-content";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

const Override = ({
  changeType,
  path,
  operationHash,
  isAdminOrDeveloper,
  refresh,
}: {
  changeType: string;
  path?: string;
  operationHash: string;
  isAdminOrDeveloper: boolean;
  refresh?: () => void;
}) => {
  const router = useRouter();
  const { toast } = useToast();
  const graphContext = useContext(GraphContext);
  const { namespace: { name: namespace } } = useWorkspace();
  const organizationSlug = useCurrentOrganization()?.slug;

  const { mutate: removeOverrides, isPending: removingOverrides } = useMutation(
    removeOperationOverrides,
    {
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
      <TableCell>
        <div className="flex items-center justify-end gap-x-2">
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <Button
                disabled={!path}
                variant="ghost"
                className="table-action"
                size="icon-sm"
                asChild
              >
                <Link
                  href={
                    path
                      ? {
                          pathname: `/[organizationSlug]/[namespace]/graph/[slug]/schema`,
                          query: {
                            organizationSlug,
                            namespace,
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
          {isAdminOrDeveloper && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  className="table-action text-destructive"
                  size="icon-sm"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent
                onEscapeKeyDown={(event) => {
                  event.preventDefault();
                }}
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Future checks will fail if this breaking change is detected
                    for this operation.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <Button
                    variant="destructive"
                    onClick={() => {
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
                      });
                    }}
                  >
                    Confirm
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
};

export const ConfigureOverride = () => {
  const graphContext = useContext(GraphContext);
  const checkUserAccess = useCheckUserAccess();
  const isAdminOrDeveloper = checkUserAccess({ rolesToBe: ['organization-admin', 'organization-developer'] })

  const router = useRouter();
  const operationHash = router.query.override as string;
  const operationName = router.query.overrideName as string;

  const client = useQueryClient();

  const { toast } = useToast();
  const applyParams = useApplyParams();

  const { data, error, isLoading, refetch } = useQuery(
    getOperationOverrides,
    {
      graphName: graphContext?.graph?.name,
      namespace: graphContext?.graph?.namespace,
      operationHash,
    },
    {
      enabled: !!operationHash,
    },
  );

  const invalidateOverrides = () => {
    const key = createConnectQueryKey(getAllOverrides, {
      graphName: graphContext?.graph?.name,
      namespace: graphContext?.graph?.namespace,
    });
    client.invalidateQueries({
      queryKey: key,
    });
  };

  const { mutate: removeIgnoreAll, isPending: removing } = useMutation(
    removeOperationIgnoreAllOverride,
    {
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
          description:
            "Could not create ignore all override. Please try again.",
          duration: 3000,
        });
      },
    },
  );

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
        {isAdminOrDeveloper && (
          <>
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
          </>
        )}
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
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.changes.map((c, i) => (
                    <Override
                      key={i}
                      {...c}
                      operationHash={operationHash}
                      isAdminOrDeveloper={isAdminOrDeveloper}
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
            <div className="mt-4 flex w-full items-center gap-2">
              <Button
                variant="secondary"
                className=""
                onClick={() => {
                  copy(operationHash);
                  toast({
                    description: "Copied operation hash",
                  });
                }}
              >
                <ClipboardCopyIcon className="mr-3" />
                Copy Hash
              </Button>
              <OperationContentDialog
                hash={operationHash}
                trigger={
                  <Button className="w-max" variant="secondary">
                    View Operation Content
                  </Button>
                }
                federatedGraphName={graphContext?.graph?.name ?? ""}
                namespace={graphContext?.graph?.namespace ?? ""}
              />
            </div>
          </SheetDescription>
        </SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  );
};

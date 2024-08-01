import { UserContext } from "@/components/app-provider";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { useFeature } from "@/hooks/use-feature";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { useUser } from "@/hooks/use-user";
import { docsBaseURL } from "@/lib/constants";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { checkUserAccess } from "@/lib/utils";
import {
  EllipsisVerticalIcon,
  ExclamationTriangleIcon,
  KeyIcon,
} from "@heroicons/react/24/outline";
import { PlusIcon } from "@radix-ui/react-icons";
import { useQuery, useMutation } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createAPIKey,
  deleteAPIKey,
  getAPIKeys,
  getUserAccessiblePermissions,
  getUserAccessibleResources,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  ExpiresAt,
  GetUserAccessibleResourcesResponse_Graph,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import copy from "copy-to-clipboard";
import Link from "next/link";
import {
  Dispatch,
  SetStateAction,
  useContext,
  useEffect,
  useState,
} from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import { z } from "zod";

const CreateAPIKeyDialog = ({
  setApiKey,
  refresh,
}: {
  setApiKey: Dispatch<SetStateAction<string | undefined>>;
  refresh: () => void;
}) => {
  const user = useUser();
  const rbac = useFeature("rbac");
  const { toast } = useToast();

  const { mutate, isPending } = useMutation(createAPIKey);

  const { data } = useQuery(getUserAccessibleResources);
  const { data: permissionsData } = useQuery(getUserAccessiblePermissions);
  const federatedGraphs = data?.federatedGraphs || [];
  const subgraphs = data?.subgraphs || [];
  const isAdmin = user?.currentOrganization.roles.includes("admin");

  const expiresOptions = ["Never", "30 days", "6 months", "1 year"];
  const expiresOptionsMappingToEnum: {
    [key: string]: ExpiresAt;
  } = {
    Never: ExpiresAt.NEVER,
    "30 days": ExpiresAt.THIRTY_DAYS,
    "6 months": ExpiresAt.SIX_MONTHS,
    "1 year": ExpiresAt.ONE_YEAR,
  };

  const [expires, setExpires] = useState(expiresOptions[0]);
  const [open, setOpen] = useState(false);
  const [selectedAllResources, setSelectedAllResources] = useState(false);
  // target ids of the selected federated graphs
  const [selectedFedGraphs, setSelectedFedGraphs] = useState<string[]>([]);
  // target ids of the selected subgraphs
  const [selectedSubgraphs, setSelectedSubgraphs] = useState<string[]>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>();

  const createAPIKeyInputSchema = z.object({
    name: z
      .string()
      .trim()
      .min(3, { message: "API key name must be a minimum of 3 characters" })
      .max(50, { message: "API key name must be maximum 50 characters" }),
  });

  type CreateAPIKeyInput = z.infer<typeof createAPIKeyInputSchema>;

  const {
    register,
    formState: { isValid, errors },
    handleSubmit,
    reset,
  } = useZodForm<CreateAPIKeyInput>({
    mode: "onBlur",
    schema: createAPIKeyInputSchema,
  });

  const onSubmit: SubmitHandler<CreateAPIKeyInput> = (data) => {
    if (
      rbac?.enabled &&
      !selectedAllResources &&
      selectedFedGraphs.length === 0 &&
      selectedSubgraphs.length === 0
    ) {
      setErrorMsg("Please select at least one of the resources.");
      return;
    }

    mutate(
      {
        name: data.name,
        userID: user?.id,
        expires: expiresOptionsMappingToEnum[expires],
        federatedGraphTargetIds: selectedAllResources ? [] : selectedFedGraphs,
        subgraphTargetIds: selectedAllResources ? [] : selectedSubgraphs,
        permissions: selectedPermissions,
        allowAllResources: selectedAllResources,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            setApiKey(d.apiKey);
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 3000 });
          }
          refresh();
          reset();
        },
        onError: (error) => {
          toast({
            description: "Could not create an API key. Please try again.",
            duration: 3000,
          });
          reset();
        },
      },
    );
    setOpen(false);
    setSelectedAllResources(false);
    setSelectedFedGraphs([]);
    setSelectedSubgraphs([]);
    setSelectedPermissions([]);
  };

  const groupedSubgraphs = subgraphs.reduce<
    Record<string, GetUserAccessibleResourcesResponse_Graph[]>
  >((result, graph) => {
    const { namespace, name } = graph;

    if (!result[namespace]) {
      result[namespace] = [];
    }

    result[namespace].push(graph);

    return result;
  }, {});

  // When rbac is enabled and this is the case for enterprise users
  // you can only create an API key if you are an admin or have access to at least one federated graph or subgraph
  if (
    rbac?.enabled &&
    !(isAdmin || federatedGraphs.length > 0 || subgraphs.length > 0)
  ) {
    return (
      <Button disabled>
        <div className="flex items-center gap-x-2">
          <PlusIcon />
          <span>New API key</span>
        </div>
      </Button>
    );
  }

  const groupedFederatedGraphs = federatedGraphs.reduce<
    Record<string, GetUserAccessibleResourcesResponse_Graph[]>
  >((result, graph) => {
    const { namespace, name } = graph;

    if (!result[namespace]) {
      result[namespace] = [];
    }

    result[namespace].push(graph);

    return result;
  }, {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button>
          <div className="flex items-center gap-x-2">
            <PlusIcon />
            <span>New API key</span>
          </div>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create API Key</DialogTitle>
        </DialogHeader>
        <form
          className="mt-4 flex flex-col gap-y-3"
          onSubmit={handleSubmit(onSubmit)}
        >
          <div className="flex flex-col gap-y-2">
            <span className="text-sm font-semibold">Name</span>
            <Input className="w-full" type="text" {...register("name")} />
            {errors.name && (
              <span className="px-2 text-xs text-destructive">
                {errors.name.message}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-y-2">
            <span className="text-sm font-semibold">Expires</span>
            <Select
              value={expires}
              onValueChange={(value) => setExpires(value)}
            >
              <SelectTrigger value={expires} className="w-[200px] lg:w-full">
                <SelectValue aria-label={expires}>{expires}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {expiresOptions.map((option) => {
                  return (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          {isAdmin &&
            permissionsData &&
            permissionsData.permissions.length > 0 && (
              <div className="mt-2 flex flex-col gap-y-3">
                <div className="flex flex-col gap-y-1">
                  <span className="text-base font-semibold">Permissions</span>
                  <span className="text-sm text-muted-foreground">
                    {"Select permissions for the API key."}
                  </span>
                </div>
                {permissionsData.permissions.map((permission) => {
                  return (
                    <div
                      className="flex items-center gap-x-2"
                      key={permission.value}
                    >
                      <Checkbox
                        id="scim"
                        checked={selectedPermissions.includes(permission.value)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedPermissions([
                              ...Array.from(
                                new Set([
                                  ...selectedPermissions,
                                  permission.value,
                                ]),
                              ),
                            ]);
                          } else {
                            setSelectedPermissions([
                              ...selectedPermissions.filter(
                                (p) => p !== permission.value,
                              ),
                            ]);
                          }
                        }}
                      />
                      <label
                        htmlFor="scim"
                        className="text-sm font-medium capitalize leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {permission.displayName}
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          {rbac?.enabled && (
            <div className="mt-3 flex flex-col gap-y-3">
              <div className="flex flex-col gap-y-1">
                <span className="text-base font-semibold">
                  Select Resources
                </span>
                <span className="text-sm text-muted-foreground">
                  {"Select resources the API key can access."}
                </span>
              </div>
              <div className="flex flex-col gap-y-2">
                {federatedGraphs.length > 0 && (
                  <div className="flex flex-col gap-y-1">
                    <div>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          asChild
                          disabled={selectedAllResources}
                        >
                          <Button size="sm" variant="outline">
                            {selectedFedGraphs.length > 0
                              ? `${selectedFedGraphs.length} graphs selected`
                              : "Select graphs"}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          className="scrollbar-custom max-h-[min(calc(var(--radix-dropdown-menu-content-available-height)_-24px),384px)] overflow-y-auto"
                        >
                          {Object.entries(groupedFederatedGraphs ?? {}).map(
                            ([namespace, graphs]) => {
                              return (
                                <SelectGroup key={namespace}>
                                  <SelectLabel>{namespace}</SelectLabel>
                                  {graphs.map((graph) => {
                                    return (
                                      <DropdownMenuCheckboxItem
                                        key={graph.targetId}
                                        checked={selectedFedGraphs.includes(
                                          graph.targetId,
                                        )}
                                        onCheckedChange={(val) => {
                                          if (val) {
                                            setSelectedFedGraphs([
                                              ...Array.from(
                                                new Set([
                                                  ...selectedFedGraphs,
                                                  graph.targetId,
                                                ]),
                                              ),
                                            ]);
                                            setErrorMsg(undefined);
                                          } else {
                                            setSelectedFedGraphs([
                                              ...selectedFedGraphs.filter(
                                                (g) => g !== graph.targetId,
                                              ),
                                            ]);
                                          }
                                        }}
                                        onSelect={(e) => e.preventDefault()}
                                      >
                                        {graph.name}
                                      </DropdownMenuCheckboxItem>
                                    );
                                  })}
                                </SelectGroup>
                              );
                            },
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )}
                {subgraphs.length > 0 && (
                  <div className="flex flex-col gap-y-1">
                    <div>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          asChild
                          disabled={selectedAllResources}
                        >
                          <Button size="sm" variant="outline">
                            {selectedSubgraphs.length > 0
                              ? `${selectedSubgraphs.length} subgraphs selected`
                              : "Select subgraphs"}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          className="scrollbar-custom max-h-[min(calc(var(--radix-dropdown-menu-content-available-height)_-24px),384px)] overflow-y-auto"
                        >
                          {Object.entries(groupedSubgraphs ?? {}).map(
                            ([namespace, graphs]) => {
                              return (
                                <SelectGroup key={namespace}>
                                  <SelectLabel>{namespace}</SelectLabel>
                                  {graphs.map((graph) => {
                                    return (
                                      <DropdownMenuCheckboxItem
                                        key={graph.targetId}
                                        checked={selectedSubgraphs.includes(
                                          graph.targetId,
                                        )}
                                        onCheckedChange={(val) => {
                                          if (val) {
                                            setSelectedSubgraphs([
                                              ...Array.from(
                                                new Set([
                                                  ...selectedSubgraphs,
                                                  graph.targetId,
                                                ]),
                                              ),
                                            ]);
                                            setErrorMsg(undefined);
                                          } else {
                                            setSelectedSubgraphs([
                                              ...selectedSubgraphs.filter(
                                                (g) => g !== graph.targetId,
                                              ),
                                            ]);
                                          }
                                        }}
                                        onSelect={(e) => e.preventDefault()}
                                      >
                                        {graph.name}
                                      </DropdownMenuCheckboxItem>
                                    );
                                  })}
                                </SelectGroup>
                              );
                            },
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )}
                {isAdmin && (
                  <div className="mt-2 flex flex-col gap-y-2">
                    <div className="flex items-start gap-x-2">
                      <Checkbox
                        id="all-resources"
                        checked={selectedAllResources}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedAllResources(true);
                            setErrorMsg(undefined);
                          } else {
                            setSelectedAllResources(false);
                          }
                        }}
                      />
                      <div className="flex flex-col gap-y-1">
                        <label
                          htmlFor="all-resources"
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          All Resources
                        </label>
                        <span className="text-sm text-muted-foreground">
                          {
                            "Choose 'All resources' to include all the current and future resources"
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {errorMsg && (
            <span className="px-2 text-xs text-destructive">{errorMsg}</span>
          )}

          <Button
            className="mt-2"
            type="submit"
            disabled={
              // should be disabled if the form is invalid or if either the resources or the all resources option is not selected
              !isValid ||
              !!errorMsg ||
              (rbac?.enabled &&
                !selectedAllResources &&
                selectedFedGraphs.length === 0 &&
                selectedSubgraphs.length === 0)
            }
            variant="default"
            isLoading={isPending}
          >
            Generate API key
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const DeleteAPIKeyDialog = ({
  apiKeyName,
  refresh,
  open,
  setOpen,
  setDeleteApiKeyName,
}: {
  apiKeyName: string;
  refresh: () => void;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  setDeleteApiKeyName: Dispatch<SetStateAction<string | undefined>>;
}) => {
  const { toast } = useToast();

  const { mutate, isPending } = useMutation(deleteAPIKey);

  const regex = new RegExp(`^${apiKeyName}$`);
  const schema = z.object({
    apiKeyName: z.string().regex(regex, {
      message: "Please enter the api key name as requested.",
    }),
  });

  type DeleteAPIKeyInput = z.infer<typeof schema>;

  const {
    register,
    formState: { isValid, errors },
    handleSubmit,
    reset,
  } = useZodForm<DeleteAPIKeyInput>({
    mode: "onChange",
    schema: schema,
  });

  const onSubmit: SubmitHandler<DeleteAPIKeyInput> = (data) => {
    mutate(
      { name: data.apiKeyName },
      {
        onSuccess: (d) => {
          toast({
            description: d.response?.details || "API key deleted successfully.",
            duration: 3000,
          });
          refresh();
          reset();
          setDeleteApiKeyName(undefined);
        },
        onError: (error) => {
          toast({
            description: "Could not delete an API key. Please try again.",
            duration: 3000,
          });
          reset();
          setDeleteApiKeyName(undefined);
        },
      },
    );
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete API Key</DialogTitle>
        </DialogHeader>
        <form
          className="mt-4 flex flex-col gap-y-3"
          onSubmit={handleSubmit(onSubmit)}
        >
          <div className="flex flex-col gap-y-2">
            <span className="text-sm">
              Are you sure you want to delete this api key? <br />
              Enter <strong>{apiKeyName}</strong> to confirm you want to delete
              this api key.
            </span>
            {/* </div> */}
            <Input
              className="w-full"
              type="text"
              {...register("apiKeyName")}
              autoFocus
            />
            {errors.apiKeyName && (
              <span className="px-2 text-xs text-destructive">
                {errors.apiKeyName.message}
              </span>
            )}
          </div>
          <Button
            className="mt-2"
            type="submit"
            disabled={!isValid}
            variant="destructive"
            isLoading={isPending}
          >
            Delete API key
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const APIKeyCreatedDialog = ({
  open,
  setOpen,
  apiKey,
}: {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  apiKey: string;
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const copyHandler = (value: string) => {
    copy(value);
    setCopied(true);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>API key generated!</DialogTitle>
        </DialogHeader>
        <div className="text-sm">
          <p className="pb-6">
            Make sure to copy your client ID user secret key, we&apos;ll only
            show it to you once.
          </p>
          <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
            <code className="break-all">{apiKey}</code>
            <Button
              asChild={true}
              size="sm"
              variant="secondary"
              onClick={() => copyHandler(apiKey)}
              className="cursor-pointer"
            >
              <div>
                {copied ? (
                  <FiCheck className="text-xs" />
                ) : (
                  <FiCopy className="text-xs" />
                )}
              </div>
            </Button>
          </div>
          <div className="mt-5">
            <Button className="w-full" onClick={() => setOpen(false)}>
              I&apos;ve saved my key
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const Empty = ({
  apiKey,
  setApiKey,
  open,
  setOpen,
}: {
  apiKey: string | undefined;
  setApiKey: Dispatch<SetStateAction<string | undefined>>;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}) => {
  const user = useContext(UserContext);

  return (
    <EmptyState
      icon={<KeyIcon />}
      title="Create an API key"
      description={
        <>
          No Api keys found.{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={docsBaseURL + "/studio/api-keys"}
            className="text-primary"
          >
            Learn more.
          </a>
        </>
      }
      actions={
        <div className="mt-2">
          {checkUserAccess({
            rolesToBe: ["admin", "developer"],
            userRoles: user?.currentOrganization.roles || [],
          }) && (
            <CreateAPIKey
              apiKey={apiKey}
              setApiKey={setApiKey}
              open={open}
              setOpen={setOpen}
            />
          )}
        </div>
      }
    />
  );
};

export const CreateAPIKey = ({
  apiKey,
  setApiKey,
  open,
  setOpen,
}: {
  apiKey: string | undefined;
  setApiKey: Dispatch<SetStateAction<string | undefined>>;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}) => {
  const { refetch } = useQuery(getAPIKeys);

  useEffect(() => {
    if (!apiKey) return;
    setOpen(true);
  }, [apiKey, setOpen]);

  return (
    <>
      <CreateAPIKeyDialog refresh={refetch} setApiKey={setApiKey} />
      {apiKey && (
        <APIKeyCreatedDialog open={open} setOpen={setOpen} apiKey={apiKey} />
      )}
    </>
  );
};

const APIKeysPage: NextPageWithLayout = () => {
  const user = useContext(UserContext);
  const { data, isLoading, error, refetch } = useQuery(getAPIKeys);

  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [apiKey, setApiKey] = useState<string | undefined>();
  const [deleteApiKeyName, setDeleteApiKeyName] = useState<
    string | undefined
  >();
  const [openApiKeyCreatedDialog, setOpenApiKeyCreatedDialog] = useState(false);

  useEffect(() => {
    if (!openApiKeyCreatedDialog) setApiKey(undefined);
  }, [openApiKeyCreatedDialog, setApiKey]);

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve federated graphs"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  const apiKeys = data.apiKeys;

  return (
    <div className="flex flex-col gap-y-6">
      {apiKeys.length === 0 ? (
        <Empty
          apiKey={apiKey}
          setApiKey={setApiKey}
          open={openApiKeyCreatedDialog}
          setOpen={setOpenApiKeyCreatedDialog}
        />
      ) : (
        <>
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <div>
              <p className="text-sm text-muted-foreground">
                API keys are used to authenticate the Cosmo CLI for local
                development or CI/CD.{" "}
                <Link
                  href={docsBaseURL + "/studio/api-keys"}
                  className="text-primary"
                  target="_blank"
                  rel="noreferrer"
                >
                  Learn more
                </Link>
              </p>
              <p className="text-sm text-muted-foreground">
                If you need a token for the Router please take a look{" "}
                <Link
                  href={docsBaseURL + "/cli/router/token/create"}
                  className="text-primary"
                  target="_blank"
                  rel="noreferrer"
                >
                  here
                </Link>
                .
              </p>
            </div>
            <div>
              {checkUserAccess({
                rolesToBe: ["admin", "developer"],
                userRoles: user?.currentOrganization.roles || [],
              }) && (
                <CreateAPIKey
                  apiKey={apiKey}
                  setApiKey={setApiKey}
                  open={openApiKeyCreatedDialog}
                  setOpen={setOpenApiKeyCreatedDialog}
                />
              )}
            </div>
          </div>
          {deleteApiKeyName &&
            checkUserAccess({
              rolesToBe: ["admin", "developer"],
              userRoles: user?.currentOrganization.roles || [],
            }) && (
              <DeleteAPIKeyDialog
                apiKeyName={deleteApiKeyName}
                refresh={refetch}
                open={openDeleteDialog}
                setOpen={setOpenDeleteDialog}
                setDeleteApiKeyName={setDeleteApiKeyName}
              />
            )}
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Expires At</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Last Used At</TableHead>
                  {checkUserAccess({
                    rolesToBe: ["admin", "developer"],
                    userRoles: user?.currentOrganization.roles || [],
                  }) && (
                    <TableHead className="flex items-center justify-center" />
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map(
                  ({ name, createdBy, createdAt, lastUsedAt, expiresAt }) => {
                    return (
                      <TableRow key={name}>
                        <TableCell className="font-medium">{name}</TableCell>
                        <TableCell>{createdBy}</TableCell>
                        <TableCell>
                          {expiresAt
                            ? formatDateTime(new Date(expiresAt))
                            : "Never"}
                        </TableCell>
                        <TableCell>
                          {createdAt
                            ? formatDateTime(new Date(createdAt))
                            : "Never"}
                        </TableCell>
                        <TableCell>
                          {lastUsedAt
                            ? formatDateTime(new Date(lastUsedAt))
                            : "Never"}
                        </TableCell>
                        {checkUserAccess({
                          rolesToBe: ["admin", "developer"],
                          userRoles: user?.currentOrganization.roles || [],
                        }) && (
                          <TableCell>
                            <DropdownMenu>
                              <div className="flex justify-center">
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon">
                                    <EllipsisVerticalIcon className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                              </div>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setDeleteApiKeyName(name);
                                    setOpenDeleteDialog(true);
                                  }}
                                >
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  },
                )}
              </TableBody>
            </Table>
          </TableWrapper>
        </>
      )}
    </div>
  );
};

APIKeysPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "API Keys",
    "Manage all the API keys of your organization",
  );
};

export default APIKeysPage;

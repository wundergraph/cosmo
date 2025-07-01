import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent, DialogDescription, DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import {
  Select,
  SelectContent,
  SelectItem,
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
  updateAPIKey,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { ExpiresAt } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import copy from "copy-to-clipboard";
import Link from "next/link";
import {
  Dispatch,
  SetStateAction,
  useEffect, useId,
  useState,
} from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import { z } from "zod";
import { GroupSelect } from "@/components/group-select";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";

const CreateAPIKeyDialog = ({
  existingApiKeys,
  canManageAPIKeys,
  setApiKey,
  refresh,
}: {
  existingApiKeys: string[];
  canManageAPIKeys: boolean;
  setApiKey: Dispatch<SetStateAction<string | undefined>>;
  refresh: () => void;
}) => {
  const user = useUser();
  const rbac = useFeature("rbac");
  const { toast } = useToast();

  const { mutate, isPending } = useMutation(createAPIKey);

  const { data: permissionsData } = useQuery(getUserAccessiblePermissions);

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
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const createAPIKeyInputSchema = z.object({
    name: z
      .string()
      .trim()
      .min(3, { message: "API key name must be a minimum of 3 characters" })
      .max(50, { message: "API key name must be maximum 50 characters" })
      .regex(
        new RegExp("^[a-zA-Z0-9]+(?:[_.@/-][a-zA-Z0-9]+)*$"),
        "The name should start and end with an alphanumeric character. Only '.', '_', '@', '/', and '-' are allowed as separators in between.",
      )
      .superRefine((arg, ctx) => {
        if (!existingApiKeys.includes(arg)) {
          return;
        }

        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `An API key with the name ${arg} already exists`
        });
      }),
    groupId: z
      .string()
      .uuid({ message: "Select a valid group" })
  });

  type CreateAPIKeyInput = z.infer<typeof createAPIKeyInputSchema>;

  const {
    register,
    formState: { isValid, errors },
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
  } = useZodForm<CreateAPIKeyInput>({
    mode: "onBlur",
    schema: createAPIKeyInputSchema,
  });

  const onSubmit: SubmitHandler<CreateAPIKeyInput> = (data) => {
    mutate(
      {
        name: data.name,
        userID: user?.id,
        expires: expiresOptionsMappingToEnum[expires],
        groupId: data.groupId,
        permissions: selectedPermissions,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            setOpen(false);
            setSelectedPermissions([]);

            setApiKey(d.apiKey);
            refresh();
            reset();
          } else if (d.response?.details) {
            setError('name', { message: d.response.details });
          }
        },
        onError: () => {
          toast({
            description: "Could not create an API key. Please try again.",
            duration: 3000,
          });
        },
      },
    );
  };

  const nameInputId = `${useId()}-key-name`;
  const expiresInputLabel = `${useId()}-expires`;
  const groupInputLabel = `${useId()}-group`;

  // When rbac is enabled and this is the case for enterprise users
  // you can only create an API key if you are an admin
  if (rbac?.enabled && !canManageAPIKeys) {
    return (
      <Button disabled>
        <div className="flex items-center gap-x-2">
          <PlusIcon />
          <span>New API key</span>
        </div>
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => {
      setOpen(v);
      if (!v) {
        setSelectedPermissions([]);
        reset();
      }
    }}>
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
            <label className="text-sm font-semibold" htmlFor={nameInputId}>Name</label>
            <Input className="w-full" id={nameInputId} type="text" {...register("name")} />
            {errors.name && (
              <span className="px-2 text-xs text-destructive">
                {errors.name.message}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-y-2">
            <label className="text-sm font-semibold" htmlFor={expiresInputLabel}>Expires</label>
            <Select
              value={expires}
              onValueChange={(value) => setExpires(value)}
            >
              <SelectTrigger value={expires} className="w-[200px] lg:w-full" id={expiresInputLabel}>
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

          <div className="flex flex-col gap-y-2">
            <label className="text-sm font-semibold" htmlFor={groupInputLabel}>Group</label>
            <GroupSelect
              id={groupInputLabel}
              value={watch('groupId')}
              onValueChange={(group) => setValue(
                'groupId',
                group.groupId,
                { shouldValidate: true, shouldDirty: true, shouldTouch: true },
              )}
            />

            {errors.groupId && (
              <span className="px-2 text-xs text-destructive">
                {errors.groupId.message}
              </span>
            )}
          </div>

          {canManageAPIKeys &&
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

          <Button
            className="mt-2"
            type="submit"
            disabled={!isValid}
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
        onError: () => {
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
  canManageAPIKeys,
  setOpen,
  refetch,
}: {
  apiKey: string | undefined;
  setApiKey: Dispatch<SetStateAction<string | undefined>>;
  open: boolean;
  canManageAPIKeys: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  refetch: () => void;
}) => {
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
          {canManageAPIKeys && (
            <CreateAPIKey
              apiKey={apiKey}
              existingApiKeys={[]}
              canManageAPIKeys={canManageAPIKeys}
              setApiKey={setApiKey}
              open={open}
              setOpen={setOpen}
              refetch={refetch}
            />
          )}
        </div>
      }
    />
  );
};

export const CreateAPIKey = ({
  apiKey,
  existingApiKeys,
  canManageAPIKeys,
  setApiKey,
  open,
  setOpen,
  refetch,
}: {
  apiKey: string | undefined;
  existingApiKeys: string[];
  canManageAPIKeys: boolean;
  setApiKey: Dispatch<SetStateAction<string | undefined>>;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  refetch: () => void;
}) => {
  useEffect(() => {
    if (!apiKey) return;
    setOpen(true);
  }, [apiKey, setOpen]);

  return (
    <>
      <CreateAPIKeyDialog
        refresh={refetch}
        setApiKey={setApiKey}
        existingApiKeys={existingApiKeys}
        canManageAPIKeys={canManageAPIKeys}
      />
      {apiKey && (
        <APIKeyCreatedDialog open={open} setOpen={setOpen} apiKey={apiKey} />
      )}
    </>
  );
};

const UpdateAPIKey = ({ selectedApiKeyName, open, selectedGroupId, refresh, onOpenChange }: {
  open: boolean;
  selectedApiKeyName: string | undefined;
  selectedGroupId: string | undefined;
  refresh(): void;
  onOpenChange(open: boolean): void;
}) => {
  const { mutate, isPending } = useMutation(updateAPIKey);
  const { toast } = useToast();
  const [groupId, setGroupId] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      setGroupId(selectedGroupId);
    }
  }, [open, selectedGroupId]);

  const onOpenChangeCallback = (isOpen: boolean) => {
    if (isPending) {
      return;
    }

    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChangeCallback}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update API key group</DialogTitle>
          <DialogDescription>
            Select the new group for the API key.
          </DialogDescription>
        </DialogHeader>
        <GroupSelect
          value={groupId}
          onValueChange={(group) => setGroupId(group.groupId)}
        />

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChangeCallback(false)}>
            Cancel
          </Button>
          <Button
            disabled={isPending || !groupId}
            isLoading={isPending}
            onClick={() => {
              if (isPending || !selectedApiKeyName || !groupId) {
                return;
              }

              mutate({ name: selectedApiKeyName, groupId }, {
                onSuccess(d){
                  if (d.response?.code === EnumStatusCode.OK) {
                    onOpenChange(false);
                    toast({
                      description: "API key group updated successfully.",
                      duration: 3000,
                    });

                    refresh();
                  } else {
                    toast({
                      description: d.response?.details ?? "Could not update the API key. Please try again.",
                      duration: 3000,
                    });
                  }
                },
                onError(){
                  toast({
                    description: "Could not update the API key. Please try again.",
                    duration: 3000,
                  });
                },
              });
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const APIKeysPage: NextPageWithLayout = () => {
  const checkUserAccess = useCheckUserAccess();
  const { data, isLoading, error, refetch } = useQuery(getAPIKeys);

  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [openUpdateDialog, setOpenUpdateDialog] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<{ apiKeyName: string; groupId: string | undefined; }>();
  const [apiKey, setApiKey] = useState<string | undefined>();
  const [deleteApiKeyName, setDeleteApiKeyName] = useState<
    string | undefined
  >();
  const [openApiKeyCreatedDialog, setOpenApiKeyCreatedDialog] = useState(false);

  const canCreateAPIKey = checkUserAccess({ rolesToBe: ['organization-admin', 'organization-developer'] });
  const canManageAPIKeys = canCreateAPIKey || checkUserAccess({ rolesToBe: ['organization-apikey-manager'] });

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
          canManageAPIKeys={canManageAPIKeys}
          setOpen={setOpenApiKeyCreatedDialog}
          refetch={refetch}
        />
      ) : (
        <>
          <UpdateAPIKey
            open={openUpdateDialog}
            selectedApiKeyName={selectedGroup?.apiKeyName}
            selectedGroupId={selectedGroup?.groupId}
            refresh={refetch}
            onOpenChange={() => {
              setOpenUpdateDialog(false);
              setSelectedGroup(undefined);
            }}
          />

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
              <CreateAPIKey
                apiKey={apiKey}
                existingApiKeys={apiKeys.map((k) => k.name)}
                canManageAPIKeys={canManageAPIKeys}
                setApiKey={setApiKey}
                open={openApiKeyCreatedDialog}
                setOpen={setOpenApiKeyCreatedDialog}
                refetch={refetch}
              />
            </div>
          </div>
          {deleteApiKeyName && canManageAPIKeys && (
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
                  <TableHead>Group</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Last Used At</TableHead>
                  {canManageAPIKeys && (
                    <TableHead className="flex items-center justify-center" />
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map(
                  ({ name, createdBy, createdAt, lastUsedAt, expiresAt, group }) => {
                    return (
                      <TableRow key={name}>
                        <TableCell className="font-medium">{name}</TableCell>
                        <TableCell>{createdBy}</TableCell>
                        <TableCell>
                          {expiresAt
                            ? formatDateTime(new Date(expiresAt))
                            : "Never"}
                        </TableCell>
                        <TableCell className={!group?.id ? "text-muted-foreground" : undefined}>
                          {group?.name ?? "-"}
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
                        {canManageAPIKeys && (
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
                                    setOpenUpdateDialog(true);
                                    setSelectedGroup({
                                      apiKeyName: name,
                                      groupId: group?.id,
                                    });
                                  }}
                                >
                                  Update group
                                </DropdownMenuItem>
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

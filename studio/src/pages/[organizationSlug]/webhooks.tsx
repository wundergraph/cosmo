import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import {
  EventsMeta,
  Meta,
  NotificationToolbar,
  notificationEvents,
} from "@/components/notifications/components";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
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
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { docsBaseURL } from "@/lib/constants";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { Pencil1Icon, PlusIcon, TrashIcon } from "@radix-ui/react-icons";
import { useQuery, useMutation } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createOrganizationWebhookConfig,
  deleteOrganizationWebhookConfig,
  getOrganizationWebhookConfigs,
  getOrganizationWebhookMeta,
  updateOrganizationWebhookConfig,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PiWebhooksLogo } from "react-icons/pi";
import { z } from "zod";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";

const DeleteWebhook = ({
  id,
  refresh,
}: {
  id: string;
  refresh: () => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  const { mutate, isPending } = useMutation(deleteOrganizationWebhookConfig);

  const onDelete = () => {
    mutate(
      {
        id,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            toast({ description: "Webhook deleted", duration: 3000 });
            refresh();
            setIsOpen(false);
          } else {
            toast({
              description:
                d.response?.details ??
                "Could not delete webhook. Please try again.",
              duration: 3000,
            });
          }
        },
        onError: () => {
          toast({
            description: "Could not delete webhook. Please try again.",
            duration: 3000,
          });
        },
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(state) => setIsOpen(state)}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="icon">
          <TrashIcon />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Webhook</DialogTitle>
          <DialogDescription>
            This action cannot be undone. Are you sure?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            className="w-full"
            variant="destructive"
            type="button"
            onClick={onDelete}
            isLoading={isPending}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const FormSchema = z.object({
  endpoint: z
    .string()
    .url()
    .refine(
      (url) =>
        process.env.NODE_ENV === "production"
          ? url.startsWith("https://")
          : true,
      "The endpoint must use https",
    ),
  key: z.string().optional(),
  events: z.array(z.string()).optional(),
});

type Input = z.infer<typeof FormSchema>;

const Webhook = ({
  mode,
  refresh,
  existing,
}: {
  mode: "create" | "update";
  refresh: () => void;
  buttonText?: React.ReactNode;
  existing?: {
    id: string;
    endpoint: string;
    events: string[];
  };
}) => {
  const checkUserAccess = useCheckUserAccess();
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  const { mutate: create, isPending: isCreating } = useMutation(
    createOrganizationWebhookConfig,
  );

  const { mutate: update, isPending: isUpdating } = useMutation(
    updateOrganizationWebhookConfig,
  );

  const [shouldUpdateKey, setShouldUpdateKey] = useState(false);

  const form = useZodForm<Input>({
    mode: "onBlur",
    schema: FormSchema,
  });

  const { data, isLoading, error, refetch } = useQuery(
    getOrganizationWebhookMeta,
    {
      id: existing?.id ?? "",
    },
    {
      gcTime: 0,
      enabled: !!existing?.id && mode === "update" && isOpen,
    },
  );

  const [meta, setMeta] = useState<EventsMeta>(data?.eventsMeta || []);

  useEffect(() => {
    if (!data?.eventsMeta || meta.length !== 0) {
      return;
    }
    setMeta(data.eventsMeta);
  }, [data?.eventsMeta, meta]);

  const onSubmit: SubmitHandler<Input> = (data) => {
    if (mode === "create") {
      create(
        {
          endpoint: data.endpoint,
          key: data.key,
          events: data.events ?? [],
          eventsMeta: meta,
        },
        {
          onSuccess: (d) => {
            if (d.response?.code === EnumStatusCode.OK) {
              toast({ description: "Webhook created", duration: 3000 });
              refresh();
              setIsOpen(false);
            } else {
              toast({
                description:
                  d.response?.details ??
                  "Could not create webhook. Please try again.",
                duration: 3000,
              });
            }
          },
          onError: () => {
            toast({
              description: "Could not create webhook. Please try again.",
              duration: 3000,
            });
          },
        },
      );
    } else if (mode === "update" && existing?.id) {
      update(
        {
          id: existing.id,
          endpoint: data.endpoint,
          key: data.key,
          events: data.events ?? [],
          eventsMeta: meta,
          shouldUpdateKey,
        },
        {
          onSuccess: (d) => {
            if (d.response?.code === EnumStatusCode.OK) {
              toast({ description: "Webhook updated", duration: 3000 });
              refresh();
              setShouldUpdateKey(false);
              setIsOpen(false);
            } else {
              toast({
                description:
                  d.response?.details ??
                  "Could not update webhook. Please try again.",
                duration: 3000,
              });
            }
          },
          onError: () => {
            toast({
              description: "Could not update webhook. Please try again.",
              duration: 3000,
            });
          },
        },
      );
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(state) => {
        if (!state) {
          setShouldUpdateKey(false);
          setMeta([]);
        }
        setIsOpen(state);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant={mode === "create" ? "default" : "secondary"}
          size={mode === "create" ? "default" : "icon"}
          disabled={
            !checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] })
          }
        >
          {mode === "create" ? (
            <>
              <PlusIcon className="mr-2" /> Create
            </>
          ) : (
            <Pencil1Icon />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create" : "Update"} webhook
          </DialogTitle>
          <DialogDescription>
            A POST request will be sent to the provided endpoint
          </DialogDescription>
        </DialogHeader>
        {error && mode === "update" && (
          <EmptyState
            icon={<ExclamationTriangleIcon />}
            title="Could not retrieve webhook"
            description={
              data?.response?.details || error?.message || "Please try again"
            }
            actions={<Button onClick={() => refetch()}>Retry</Button>}
          />
        )}
        {isLoading && mode === "update" && <Loader className="my-8" />}
        {(data?.eventsMeta !== undefined || mode === "create") && (
          <Form {...form}>
            <form
              className="flex w-full flex-col gap-y-6"
              onSubmit={form.handleSubmit(onSubmit)}
            >
              <FormField
                defaultValue={existing?.endpoint}
                control={form.control}
                name="endpoint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Endpoint</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://example.com/webhook"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Alert
                className={cn({
                  hidden: mode === "create" || shouldUpdateKey,
                })}
              >
                <AlertDescription>
                  If you have lost or forgotten this secret key, you can change
                  it.{" "}
                  <button
                    className="text-primary"
                    type="button"
                    onClick={() => setShouldUpdateKey(true)}
                  >
                    Change secret key
                  </button>
                </AlertDescription>
              </Alert>

              <FormField
                control={form.control}
                name="key"
                render={({ field }) => (
                  <FormItem
                    className={cn({
                      hidden: mode === "update" && !shouldUpdateKey,
                    })}
                  >
                    <FormLabel>Secret key</FormLabel>
                    <FormControl>
                      <Input placeholder="************" {...field} />
                    </FormControl>
                    <FormDescription>
                      This can be used to verify if the events are originating
                      from Cosmo.{" "}
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={docsBaseURL + "/studio/webhooks#verification"}
                        className="text-primary"
                      >
                        Learn more.
                      </a>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                defaultValue={existing?.events}
                control={form.control}
                name="events"
                render={() => (
                  <FormItem>
                    <div className="mb-4">
                      <FormLabel className="text-base">Events</FormLabel>
                      <FormDescription>
                        Select the events for which you want webhooks to fire
                      </FormDescription>
                    </div>
                    {notificationEvents.map((event) => (
                      <FormField
                        key={event.id}
                        control={form.control}
                        name="events"
                        render={({ field }) => {
                          return (
                            <div className="flex flex-col gap-y-1">
                              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(event.name)}
                                    onCheckedChange={(checked) => {
                                      return checked
                                        ? field.onChange([
                                            ...(field.value ?? []),
                                            event.name,
                                          ])
                                        : field.onChange(
                                            field.value?.filter(
                                              (value) => value !== event.name,
                                            ),
                                          );
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="text-sm font-normal">
                                  {event.label}
                                  <FormDescription>
                                    {event.description}
                                  </FormDescription>
                                </FormLabel>
                              </FormItem>
                              <div className="ml-7">
                                <Meta
                                  id={event.id}
                                  meta={meta}
                                  setMeta={setMeta}
                                />
                              </div>
                            </div>
                          );
                        }}
                      />
                    ))}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                className="mt-2"
                type="submit"
                disabled={!form.formState.isValid}
                variant="default"
                isLoading={mode === "create" ? isCreating : isUpdating}
              >
                {mode === "create" ? "Create" : "Save"}
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
};

const WebhooksPage: NextPageWithLayout = () => {
  const checkUserAccess = useCheckUserAccess();
  const { data, isLoading, error, refetch } = useQuery(
    getOrganizationWebhookConfigs,
  );

  const isAdminOrDeveloper = checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] });

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve webhooks"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  if (data.configs.length === 0) {
    return (
      <EmptyState
        icon={<PiWebhooksLogo />}
        title="Create a new webhook"
        description={
          <>
            Receive data when certain events occur.{" "}
            <a
              target="_blank"
              rel="noreferrer"
              href={docsBaseURL + "/studio/webhooks"}
              className="text-primary"
            >
              Learn more.
            </a>
          </>
        }
        actions={<Webhook mode="create" refresh={() => refetch()} />}
      />
    );
  }

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <p className="ml-1 text-sm text-muted-foreground">
          Webhooks are used to receive certain events from the platform.{" "}
          <Link
            href={docsBaseURL + "/studio/webhooks"}
            className="text-primary"
            target="_blank"
            rel="noreferrer"
          >
            Learn more
          </Link>
        </p>
        {isAdminOrDeveloper && <Webhook mode="create" refresh={() => refetch()} />}
      </div>
      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Endpoint</TableHead>
              <TableHead>Events</TableHead>
              {isAdminOrDeveloper && <TableHead aria-label="Actions"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.configs.map(({ id, endpoint, events }) => {
              return (
                <TableRow key={id}>
                  <TableCell className="font-medium">{endpoint}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {events.map((event) => {
                        return (
                          <Badge variant="secondary" key={event}>
                            {event}
                          </Badge>
                        );
                      })}
                      {events.length === 0 && (
                        <p className="italic">No events</p>
                      )}
                    </div>
                  </TableCell>
                  {isAdminOrDeveloper && (
                    <TableCell className="flex justify-end space-x-2">
                      <Webhook
                        mode="update"
                        refresh={() => refetch()}
                        existing={{
                          id,
                          endpoint,
                          events,
                        }}
                      />
                      <DeleteWebhook id={id} refresh={() => refetch()} />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableWrapper>
    </div>
  );
};

WebhooksPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Webhooks",
    "Configure webhooks for your organization",
    null,
    <NotificationToolbar tab="webhooks" />,
  );
};

export default WebhooksPage;

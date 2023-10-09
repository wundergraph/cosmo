import { UserContext } from "@/components/app-provider";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import {
  EventsMeta,
  Meta,
  NotificationTabs,
  notificationEvents,
} from "@/components/notifications/components";
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
import { Input as CreateIntegrationInput } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { docsBaseURL } from "@/lib/constants";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import {
  ExclamationTriangleIcon,
  Pencil1Icon,
  PlusIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { OrganizationEventName } from "@wundergraph/cosmo-connect/dist/notifications/events_pb";
import {
  createIntegration,
  deleteIntegration,
  getOrganizationIntegrations,
  updateIntegrationConfig,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { IntegrationConfig } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext, useState } from "react";
import { FiSlack } from "react-icons/fi";
import { z } from "zod";

const CreateIntegrationFormSchema = z.object({
  endpoint: z
    .string()
    .url()
    .refine(
      (url) =>
        process.env.NODE_ENV === "production"
          ? url.startsWith("https://")
          : true,
      "The endpoint must use https"
    ),
  name: z.string(),
  events: z.array(z.string()).optional(),
});

type CreateIntegrationInput = z.infer<typeof CreateIntegrationFormSchema>;

const UpdateIntegrationFormSchema = z.object({
  endpoint: z
    .string()
    .url()
    .refine(
      (url) =>
        process.env.NODE_ENV === "production"
          ? url.startsWith("https://")
          : true,
      "The endpoint must use https"
    ),
  name: z.string(),
  events: z.array(z.string()).optional(),
});

type UpdateIntegrationInput = z.infer<typeof UpdateIntegrationFormSchema>;

const DeleteIntegration = ({
  id,
  refresh,
}: {
  id: string;
  refresh: () => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  const { mutate, isLoading } = useMutation(deleteIntegration.useMutation());

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
      }
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
            isLoading={isLoading}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Integration = ({
  mode,
  refresh,
  existing,
}: {
  mode: "create" | "update";
  refresh: () => void;
  buttonText?: React.ReactNode;
  existing?: {
    id: string;
    name: string;
    integrationConfig: IntegrationConfig | undefined;
    events: string[];
    meta: EventsMeta;
  };
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  const { mutate: create, isLoading: isCreating } = useMutation(
    createIntegration.useMutation()
  );

  const { mutate: update, isLoading: isUpdating } = useMutation(
    updateIntegrationConfig.useMutation()
  );

  const form = useZodForm<CreateIntegrationInput | UpdateIntegrationInput>({
    mode: "onBlur",
    schema:
      mode === "create"
        ? CreateIntegrationFormSchema
        : UpdateIntegrationFormSchema,
  });

  const [meta, setMeta] = useState<EventsMeta>(existing?.meta || []);
  const [existingEvents, setExistingEvents] = useState<string[]>(
    existing?.events || []
  );

  const endpoint = existing?.integrationConfig?.config.value?.endpoint || "";

  const onSubmit: SubmitHandler<CreateIntegrationInput> = (data) => {
    const compiledMeta: EventsMeta = [];

    if (data?.events && data.events.length !== 0) {
      for (const m of meta) {
        if (data.events.includes(OrganizationEventName[m.eventName!] || "")) {
          compiledMeta.push(m);
        }
      }
    }

    if (mode === "create") {
      create(
        {
          endpoint: data.endpoint,
          name: data.name,
          events: data.events ?? [],
          eventsMeta: compiledMeta,
          type: "slack",
        },
        {
          onSuccess: (d) => {
            if (d.response?.code === EnumStatusCode.OK) {
              toast({ description: "Integration created", duration: 3000 });
              refresh();
              setIsOpen(false);
            } else {
              toast({
                description:
                  d.response?.details ??
                  "Could not create integration. Please try again.",
                duration: 3000,
              });
            }
          },
          onError: () => {
            toast({
              description: "Could not create integration. Please try again.",
              duration: 3000,
            });
          },
        }
      );
    } else if (mode === "update" && existing?.id) {
      update(
        {
          id: existing.id,
          endpoint: data.endpoint,
          name: data.name,
          events: data.events ?? [],
          eventsMeta: compiledMeta,
        },
        {
          onSuccess: (d) => {
            if (d.response?.code === EnumStatusCode.OK) {
              toast({ description: "Integration updated", duration: 3000 });
              refresh();
              setIsOpen(false);
            } else {
              toast({
                description:
                  d.response?.details ??
                  "Could not update integration. Please try again.",
                duration: 3000,
              });
            }
          },
          onError: () => {
            toast({
              description: "Could not update integration. Please try again.",
              duration: 3000,
            });
          },
        }
      );
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(state) => {
        if (state) {
          setMeta(existing?.meta || []);
          setExistingEvents(existing?.events || []);
        }
        setIsOpen(state);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant={mode === "create" ? "default" : "secondary"}
          size={mode === "create" ? "default" : "icon"}
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
            {mode === "create" ? "Set up" : "Update"} slack integration
          </DialogTitle>
          <DialogDescription>
            A message will be sent to the provided slack channel.
          </DialogDescription>
        </DialogHeader>

        {(existing?.meta !== undefined || mode === "create") && (
          <Form {...form}>
            <form
              className="flex w-full flex-col gap-y-6"
              onSubmit={form.handleSubmit(onSubmit)}
            >
              <FormField
                defaultValue={endpoint}
                control={form.control}
                name="endpoint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Endpoint</FormLabel>
                    <FormControl>
                      <CreateIntegrationInput
                        placeholder="https://hooks.slack.com/..."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                defaultValue={existing?.name}
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem
                    className={cn({
                      hidden: mode === "update",
                    })}
                  >
                    <FormLabel>Integration Name</FormLabel>
                    <FormControl>
                      <CreateIntegrationInput
                        placeholder="slack_channel_name"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      An unique name to identify the integration.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                defaultValue={existingEvents}
                control={form.control}
                name="events"
                render={() => (
                  <FormItem>
                    <div className="mb-4">
                      <FormLabel className="text-base">Events</FormLabel>
                      <FormDescription>
                        Select the events for which you want webhooks to fire.
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
                                              (value) => value !== event.name
                                            )
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

const IntegrationsPage: NextPageWithLayout = () => {
  const user = useContext(UserContext);
  const router = useRouter();
  const { data, isLoading, error, refetch } = useQuery({
    ...getOrganizationIntegrations.useQuery(),
    queryKey: [user?.currentOrganization.slug || "", router.asPath, {}],
  });

  if (isLoading) return <Loader fullscreen />;

  if (error || data.response?.code !== EnumStatusCode.OK)
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

  if (data.integrations.length === 0) {
    return (
      <EmptyState
        icon={<FiSlack />}
        title="Create a new slack integration"
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
        actions={<Integration mode="create" refresh={() => refetch()} />}
      />
    );
  }

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <p className="ml-1 text-sm text-muted-foreground">
          Integrations are used to receive notifications on certain events from the platform.{" "}
          <Link
            href={docsBaseURL + "/studio/webhooks"}
            className="text-primary"
            target="_blank"
            rel="noreferrer"
          >
            Learn more
          </Link>
        </p>
        <Integration mode="create" refresh={() => refetch()} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Events</TableHead>
            <TableHead aria-label="Actions"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.integrations.map(
            ({ id, name, events, eventsMeta, integrationConfig }) => {
              return (
                <TableRow key={id}>
                  <TableCell className="font-medium">{name}</TableCell>
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
                  <TableCell className="flex justify-end space-x-2">
                    <Integration
                      mode="update"
                      refresh={() => refetch()}
                      existing={{
                        id,
                        name,
                        integrationConfig,
                        events,
                        meta: eventsMeta,
                      }}
                    />
                    <DeleteIntegration id={id} refresh={() => refetch()} />
                  </TableCell>
                </TableRow>
              );
            }
          )}
        </TableBody>
      </Table>
    </div>
  );
};

IntegrationsPage.getLayout = (page) => {
  return getDashboardLayout(
    <div className="flex flex-col gap-y-4">
      <NotificationTabs tab="integrations" />
      <>{page}</>
    </div>,
    "Integrations",
    "Configure integrations for your organization"
  );
};

export default IntegrationsPage;

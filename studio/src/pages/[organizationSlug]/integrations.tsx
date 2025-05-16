import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import {
  EventsMeta,
  Meta,
  NotificationToolbar,
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
  TableWrapper,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { docsBaseURL } from "@/lib/constants";
import { NextPageWithLayout } from "@/lib/page";
import {
  ExclamationTriangleIcon,
  Pencil1Icon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { useQuery, useMutation } from "@connectrpc/connect-query";
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
import { useEffect, useState } from "react";
import { FiSlack } from "react-icons/fi";
import { z } from "zod";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";

const CreateIntegrationFormSchema = z.object({
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
      "The endpoint must use https",
    ),
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

  const { mutate, isPending } = useMutation(deleteIntegration);

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

const Integration = ({
  mode,
  refresh,
  existing,
  open,
  code,
}: {
  mode: "create" | "update";
  refresh: () => void;
  existing?: {
    id: string;
    name: string;
    integrationConfig: IntegrationConfig | undefined;
    events: string[];
    meta: EventsMeta;
  };
  open?: boolean;
  code?: string;
}) => {
  const [isOpen, setIsOpen] = useState(open || false);
  const { toast } = useToast();
  const router = useRouter();

  const { mutate: create, isPending: isCreating } =
    useMutation(createIntegration);

  const { mutate: update, isPending: isUpdating } = useMutation(
    updateIntegrationConfig,
  );

  const createForm = useZodForm<CreateIntegrationInput>({
    mode: "onBlur",
    schema: CreateIntegrationFormSchema,
  });

  const updateForm = useZodForm<UpdateIntegrationInput>({
    mode: "onBlur",
    schema: UpdateIntegrationFormSchema,
  });

  const [meta, setMeta] = useState<EventsMeta>(existing?.meta || []);
  const [existingEvents, setExistingEvents] = useState<string[]>(
    existing?.events || [],
  );

  const endpoint = existing?.integrationConfig?.config.value?.endpoint || "";

  const onSubmitOfCreate: SubmitHandler<CreateIntegrationInput> = (data) => {
    const compiledMeta: EventsMeta = [];

    if (data?.events && data.events.length !== 0) {
      for (const m of meta) {
        if (data.events.includes(OrganizationEventName[m.eventName!] || "")) {
          compiledMeta.push(m);
        }
      }
    }

    create(
      {
        name: data.name,
        code,
        events: data.events ?? [],
        eventsMeta: compiledMeta,
        type: "slack",
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            toast({ description: "Integration created", duration: 3000 });
            refresh();
          } else {
            toast({
              description:
                d.response?.details ??
                "Could not create integration. Please try again.",
              duration: 3000,
            });
          }
          router.replace(router.asPath.split("?")[0], undefined, {
            shallow: true,
          });
        },
        onError: () => {
          toast({
            description: "Could not create integration. Please try again.",
            duration: 3000,
          });
          router.replace(router.asPath.split("?")[0], undefined, {
            shallow: true,
          });
        },
      },
    );
  };

  const onSubmitOfUpdate: SubmitHandler<UpdateIntegrationInput> = (data) => {
    if (mode === "update" && existing?.id) {
      update(
        {
          id: existing.id,
          endpoint: data.endpoint,
          events: data.events ?? [],
          eventsMeta: meta,
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
        },
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
      {mode === "update" && (
        <DialogTrigger asChild>
          <Button variant="secondary" size="icon">
            <Pencil1Icon />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className="sm:max-w-[425px]"
        onInteractOutside={(event) => {
          if (mode === "create") {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Set up a" : "Update"} slack integration
          </DialogTitle>
          <DialogDescription>
            A message will be sent to the provided slack channel.
          </DialogDescription>
        </DialogHeader>

        {mode === "create" && (
          <Form {...createForm}>
            <form
              className="flex w-full flex-col gap-y-6"
              onSubmit={createForm.handleSubmit(onSubmitOfCreate)}
            >
              <FormField
                defaultValue={existing?.name}
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
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
                control={createForm.control}
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
                        control={createForm.control}
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
                disabled={!createForm.formState.isValid}
                variant="default"
                isLoading={isCreating}
              >
                Create
              </Button>
            </form>
          </Form>
        )}

        {mode === "update" && (
          <Form {...updateForm}>
            <form
              className="flex w-full flex-col gap-y-6"
              onSubmit={updateForm.handleSubmit(onSubmitOfUpdate)}
            >
              <FormField
                defaultValue={endpoint}
                control={updateForm.control}
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
                defaultValue={existingEvents}
                control={updateForm.control}
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
                        control={updateForm.control}
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
                disabled={!updateForm.formState.isValid}
                variant="default"
                isLoading={isUpdating}
              >
                Save
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
};

const IntegrationsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const checkUserAccess = useCheckUserAccess();

  const isAdminOrDeveloper = checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] });

  const organizationSlug = router.query.organizationSlug as string;
  const code = router.query.code as string;
  const slackRedirectURL = `${process.env.NEXT_PUBLIC_COSMO_STUDIO_URL}/${organizationSlug}/integrations`;
  const [shouldCreate, setShouldCreate] = useState(false);

  const { data, isLoading, error, refetch } = useQuery(
    getOrganizationIntegrations,
  );

  useEffect(() => {
    if (!code) {
      setShouldCreate(false);
      return;
    }
    if (!shouldCreate) {
      setShouldCreate(true);
    }
  }, [code, shouldCreate]);

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve integrations."
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
              href={docsBaseURL + "/studio/slack-integration"}
              className="text-primary"
            >
              Learn more.
            </a>
          </>
        }
        actions={
          <>
            <Button
              variant="default"
              size="default"
              asChild={isAdminOrDeveloper}
              disabled={!isAdminOrDeveloper}
            >
              <Link
                href={`https://slack.com/oauth/v2/authorize?scope=incoming-webhook%2Cchat%3Awrite&user_scope=&redirect_uri=${slackRedirectURL}&client_id=${process.env.NEXT_PUBLIC_SLACK_CLIENT_ID}`}
              >
                Integrate
              </Link>
            </Button>
            {shouldCreate && (
              <Integration
                mode="create"
                refresh={() => refetch()}
                open={true}
                code={code}
              />
            )}
          </>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <p className="ml-1 text-sm text-muted-foreground">
          Integrations are used to receive notifications on certain events from
          the platform.{" "}
          <Link
            href={docsBaseURL + "/studio/slack-integration"}
            className="text-primary"
            target="_blank"
            rel="noreferrer"
          >
            Learn more
          </Link>
        </p>
        {isAdminOrDeveloper && (
          <>
            <Button variant="default" size="default" asChild>
              <Link
                href={`https://slack.com/oauth/v2/authorize?scope=incoming-webhook%2Cchat%3Awrite&user_scope=&redirect_uri=${slackRedirectURL}&client_id=${process.env.NEXT_PUBLIC_SLACK_CLIENT_ID}`}
              >
                Integrate
              </Link>
            </Button>
            {shouldCreate && (
              <Integration
                mode="create"
                refresh={() => refetch()}
                open={true}
                code={code}
              />
            )}
          </>
        )}
      </div>
      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Events</TableHead>
              {isAdminOrDeveloper && <TableHead aria-label="Actions"></TableHead>}
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
                    {isAdminOrDeveloper && (
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
                    )}
                  </TableRow>
                );
              },
            )}
          </TableBody>
        </Table>
      </TableWrapper>
    </div>
  );
};

IntegrationsPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Integrations",
    "Configure integrations for your organization",
    undefined,
    <NotificationToolbar tab="integrations" />,
  );
};

export default IntegrationsPage;

import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader } from "@/components/ui/loader";
import { useToast } from "@/components/ui/use-toast";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common_pb";
import {
  getOrganizationWebhookConfig,
  saveOrganizationWebhookConfig,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { z } from "zod";

const FormSchema = z.object({
  endpoint: z.string().url(),
  key: z.string().optional(),
  events: z.array(z.string()).optional(),
});

type Input = z.infer<typeof FormSchema>;

const events = [
  { id: "graph.schema.updated", label: "Graph Schema Update" },
] as const;

const WebhooksPage: NextPageWithLayout = () => {
  const { toast } = useToast();

  const { data, isLoading, error, refetch } = useQuery(
    getOrganizationWebhookConfig.useQuery()
  );

  const { mutate, isLoading: isSaving } = useMutation(
    saveOrganizationWebhookConfig.useMutation()
  );

  const form = useZodForm<Input>({
    mode: "onBlur",
    schema: FormSchema,
  });

  const onSubmit: SubmitHandler<Input> = (data) => {
    mutate(
      {
        endpoint: data.endpoint,
        key: data.key,
        events: data.events ?? [],
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            toast({ description: "Configuration saved", duration: 3000 });
          } else {
            toast({
              description:
                d.response?.details ??
                "Could not save configuration. Please try again.",
              duration: 3000,
            });
          }
        },
        onError: (error) => {
          toast({
            description: "Could not save configuration. Please try again.",
            duration: 3000,
          });
        },
      }
    );
  };

  if (isLoading) return <Loader fullscreen />;

  if (error || data.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve webhooks configuration"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  return (
    <div className="flex h-full flex-1 items-center justify-center">
      <Form {...form}>
        <form
          className="mx-auto mt-4 flex w-full flex-col gap-y-6 rounded-md border bg-popover p-8 md:max-w-xl xl:max-w-lg"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <FormField
            defaultValue={data?.endpoint}
            control={form.control}
            name="endpoint"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Endpoint</FormLabel>
                <FormControl>
                  <Input placeholder="https://example.com/webhook" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="key"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Secret key</FormLabel>
                <FormControl>
                  <Input placeholder="************" {...field} />
                </FormControl>
                <FormDescription>
                  This is attached in the header{" "}
                  <code>x-cosmo-webhook-key</code> which you can use for
                  verification
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            defaultValue={data.events}
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
                {events.map((event) => (
                  <FormField
                    key={event.id}
                    control={form.control}
                    name="events"
                    render={({ field }) => {
                      return (
                        <FormItem
                          key={event.id}
                          className="flex flex-row items-start space-x-3 space-y-0"
                        >
                          <FormControl>
                            <Checkbox
                              checked={field.value?.includes(event.id)}
                              onCheckedChange={(checked) => {
                                return checked
                                  ? field.onChange([
                                      ...(field.value ?? []),
                                      event.id,
                                    ])
                                  : field.onChange(
                                      field.value?.filter(
                                        (value) => value !== event.id
                                      )
                                    );
                              }}
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal">
                            {event.label}
                          </FormLabel>
                        </FormItem>
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
            isLoading={isSaving}
          >
            Save
          </Button>
        </form>
      </Form>
    </div>
  );
};

WebhooksPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Webhooks",
    "Configure webhooks for your organization"
  );
};

export default WebhooksPage;

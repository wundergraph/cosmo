import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
import { Tag, TagInput } from "@/components/ui/tag-input/tag-input";
import { useToast } from "@/components/ui/use-toast";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { useUser } from "@/hooks/use-user";
import { docsBaseURL } from "@/lib/constants";
import { useMutation, createConnectQueryKey } from "@connectrpc/connect-query";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createFederatedGraph,
  createMonograph,
  getWorkspace
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { z } from "zod";
import { EmptyState } from "./empty-state";
import { cn } from "@/lib/utils";
import {
  CreateFederatedGraphResponse,
  CreateMonographResponse,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useWorkspace } from "@/hooks/use-workspace";
import { useQueryClient } from "@tanstack/react-query";

export const CreateGraphForm = ({
  isMonograph = false,
}: {
  isMonograph?: boolean;
}) => {
  const router = useRouter();
  const user = useUser();
  const { namespace: { name: namespace } } = useWorkspace();
  const queryClient = useQueryClient();

  const [tags, setTags] = useState<Tag[]>([]);
  const [activeTagIndex, setActiveTagIndex] = useState<number | null>(null);

  const {
    mutate: mutateFederatedGraph,
    isPending: creatingFederatedGraph,
    data: federatedGraphData,
  } = useMutation(createFederatedGraph);

  const {
    mutate: mutateMonograph,
    isPending: creatingMonograph,
    data: monographData,
  } = useMutation(createMonograph);

  const isPending = creatingFederatedGraph || creatingMonograph;

  const urlSchema = z
    .string()
    .url()
    .min(1, {
      message: "The routing url cannot be empty",
    })
    .refine(
      (url) =>
        process.env.NODE_ENV === "production"
          ? url.startsWith("https://")
          : url.startsWith("http://") || url.startsWith("https://"),
      process.env.NODE_ENV === "production"
        ? "The endpoint must use https"
        : "The endpoint must use http or https",
    );

  const schema = z.object({
    name: z
      .string()
      .min(1, {
        message: "The name cannot be empty",
      })
      .max(100, {
        message: "The name must be at most 100 characters long",
      })
      .regex(
        new RegExp("^[a-zA-Z0-9]+(?:[_.@/-][a-zA-Z0-9]+)*$"),
        "Name should start and end with an alphanumeric character. Only '.', '_', '@', '/', and '-' are allowed as separators in between.",
      ),
    routingUrl: urlSchema,
    graphUrl: isMonograph ? urlSchema : urlSchema.optional(),
    labelMatchers: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
        }),
      )
      .default([]),
    admissionWebhookUrl: urlSchema.optional(),
    admissionWebhookSecret: z.string().optional(),
  });

  type GraphDetailsInput = z.infer<typeof schema>;

  const form = useZodForm<GraphDetailsInput>({
    schema,
    mode: "onChange",
  });

  const { toast } = useToast();

  const onSubmit: SubmitHandler<GraphDetailsInput> = (data) => {
    const responseHandlers = {
      onSuccess: async (
        d: CreateFederatedGraphResponse | CreateMonographResponse,
      ) => {
        if (d.response?.code === EnumStatusCode.OK) {
          // We need to refresh the workspace after creating a graph
          await queryClient.refetchQueries({ queryKey: createConnectQueryKey(getWorkspace) });
          router.replace(
            `/${user?.currentOrganization.slug}/${namespace}/graph/${data.name}`,
          );
        } else if (d.response?.details) {
          toast({ description: d.response.details, duration: 3000 });
        }
      },
      onError: () => {
        toast({
          description: "Could not create graph. Please try again.",
          duration: 3000,
        });
      },
    };

    if (isMonograph) {
      mutateMonograph(
        {
          name: data.name,
          routingUrl: data.routingUrl,
          graphUrl: data.graphUrl,
          admissionWebhookURL: data.admissionWebhookUrl,
          admissionWebhookSecret: data.admissionWebhookSecret,
          namespace,
        },
        {
          ...responseHandlers,
        },
      );
    } else {
      mutateFederatedGraph(
        {
          name: data.name,
          routingUrl: data.routingUrl,
          labelMatchers: data.labelMatchers.map((lm) => lm.text),
          admissionWebhookURL: data.admissionWebhookUrl,
          admissionWebhookSecret: data.admissionWebhookSecret,
          namespace,
        },
        {
          ...responseHandlers,
        },
      );
    }
  };

  if (
    federatedGraphData?.response?.code === EnumStatusCode.OK ||
    monographData?.response?.code === EnumStatusCode.OK
  ) {
    return (
      <EmptyState
        icon={<CheckCircleIcon className="text-success" />}
        title={`${isMonograph ? "Monograph" : "Federated Graph"} created`}
        description="You will be now be redirected to your new graph"
      />
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-y-4"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} autoFocus />
              </FormControl>
              <FormDescription>
                This is used to uniquely identify your graph.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="routingUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Routing URL</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>
                This is the URL that the router will be accessible at.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="graphUrl"
          render={({ field }) => (
            <FormItem className={cn(!isMonograph && "hidden")}>
              <FormLabel>Graph URL</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>
                The endpoint of your GraphQL server that is accessible from the
                router.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="item-1">
            <AccordionTrigger>Optional</AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-col gap-y-4">
                <Separator />
                <FormField
                  control={form.control}
                  name="labelMatchers"
                  render={({ field }) => (
                    <FormItem className={cn(isMonograph && "hidden")}>
                      <FormLabel className="text-left">
                        Label Matchers{" "}
                      </FormLabel>
                      <FormControl>
                        <TagInput
                          {...field}
                          size="sm"
                          placeholder="key=value, ..."
                          tags={tags}
                          setTags={(newTags) => {
                            setTags(newTags);
                            form.setValue(
                              "labelMatchers",
                              newTags as [Tag, ...Tag[]],
                              {
                                shouldValidate: true,
                              },
                            );
                          }}
                          delimiterList={[" ", ",", "Enter"]}
                          activeTagIndex={activeTagIndex}
                          setActiveTagIndex={setActiveTagIndex}
                          allowDuplicates={false}
                        />
                      </FormControl>
                      <FormDescription className="text-left">
                        Comma-separated values in the form of key=value. These
                        will be used to match subgraphs for composition. Learn
                        more{" "}
                        <Link
                          href={docsBaseURL + "/cli/essentials#label-matcher"}
                          className="text-primary"
                          target="_blank"
                          rel="noreferrer"
                        >
                          here.
                        </Link>
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="admissionWebhookUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Admission Webhook URL</FormLabel>
                      <FormControl>
                        <Input {...field} autoFocus />
                      </FormControl>
                      <FormDescription>
                        The endpoint used to implement admission control for the
                        graph. Learn more{" "}
                        <Link
                          href={
                            docsBaseURL +
                            "/router/security/config-validation-and-signing"
                          }
                          className="text-primary"
                          target="_blank"
                          rel="noreferrer"
                        >
                          here.
                        </Link>
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="admissionWebhookSecret"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Admission Webhook Secret</FormLabel>
                      <FormControl>
                        <Input {...field} autoFocus />
                      </FormControl>
                      <FormDescription>
                        This is used to sign requests made to the above webhook.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Button
          className="ml-auto"
          isLoading={isPending}
          type="submit"
          disabled={!form.formState.isValid}
        >
          Create Graph
        </Button>
      </form>
    </Form>
  );
};

import { FullscreenLayout } from "@/components/layout/fullscreen-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { TagInput, Tag } from "@/components/ui/tag-input/tag-input";
import { useToast } from "@/components/ui/use-toast";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { useUser } from "@/hooks/use-user";
import { docsBaseURL } from "@/lib/constants";
import { NextPageWithLayout } from "@/lib/page";
import { useMutation } from "@connectrpc/connect-query";
import { HomeIcon } from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { createFederatedGraph } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { z } from "zod";

const CreateGraphForm = () => {
  const router = useRouter();
  const user = useUser();

  const [tags, setTags] = useState<Tag[]>([]);
  const [activeTagIndex, setActiveTagIndex] = useState<number | null>(null);

  const { mutate, isPending } = useMutation(createFederatedGraph);

  const schema = z.object({
    name: z.string().min(1, {
      message: "The name cannot be empty",
    }),
    routingUrl: z
      .string()
      .url()
      .min(1, {
        message: "The routing url cannot be empty",
      })
      .refine(
        (url) =>
          process.env.NODE_ENV === "production"
            ? url.startsWith("https://")
            : true,
        "The endpoint must use https",
      ),
    labelMatchers: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
        }),
      )
      .default([]),
  });

  type GraphDetailsInput = z.infer<typeof schema>;

  const form = useZodForm<GraphDetailsInput>({
    schema,
    mode: "onChange",
  });

  const { toast } = useToast();

  const onSubmit: SubmitHandler<GraphDetailsInput> = (data) => {
    mutate(
      {
        name: data.name,
        routingUrl: data.routingUrl,
        labelMatchers: data.labelMatchers.map((lm) => lm.text),
      },
      {
        onSuccess: async (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            router.replace(
              `/${user?.currentOrganization.slug}/default/graph/${data.name}`,
            );
            toast({
              title: "Federated Graph created successfully",
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 3000 });
          }
        },
        onError: () => {
          toast({
            description: "Could not create federated graph. Please try again.",
            duration: 3000,
          });
        },
      },
    );
  };

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
                This is the url that the router will be accessible at.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="labelMatchers"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-left">
                Label Matchers{" "}
                <span className="text-muted-foreground">(optional)</span>
              </FormLabel>
              <FormControl>
                <TagInput
                  {...field}
                  size="sm"
                  placeholder="Enter tags in the form of key=value, ...."
                  tags={tags}
                  setTags={(newTags) => {
                    setTags(newTags);
                    form.setValue("labelMatchers", newTags as [Tag, ...Tag[]], {
                      shouldValidate: true,
                    });
                  }}
                  delimiterList={[" ", ",", "Enter"]}
                  activeTagIndex={activeTagIndex}
                  setActiveTagIndex={setActiveTagIndex}
                  allowDuplicates={false}
                />
              </FormControl>
              <FormDescription className="text-left">
                These will be used to match subgraphs for composition. Learn
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

const NewGraphPage: NextPageWithLayout = () => {
  return (
    <div>
      <div className="mb-20 flex h-16 items-center border-b px-4 lg:px-8">
        <Button asChild variant="outline">
          <Link href="/">
            <HomeIcon className="mr-2" /> Home
          </Link>
        </Button>
      </div>
      <div className="mx-auto max-w-screen-sm px-4 md:px-0">
        <Card>
          <CardHeader>
            <CardTitle>Create Federated Graph</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateGraphForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

NewGraphPage.getLayout = (page) => {
  return <FullscreenLayout>{page}</FullscreenLayout>;
};

export default NewGraphPage;

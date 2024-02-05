import { CodeViewer } from "@/components/code-viewer";
import { GraphContext, getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TraceContext, TraceView } from "@/components/playground/trace-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { NextPageWithLayout } from "@/lib/page";
import { parseSchema } from "@/lib/schema-helpers";
import { explorerPlugin } from "@graphiql/plugin-explorer";
import { createGraphiQLFetcher } from "@graphiql/toolkit";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { MobileIcon } from "@radix-ui/react-icons";
import { TooltipContent, TooltipTrigger } from "@radix-ui/react-tooltip";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getClients,
  getFederatedGraphSDLByName,
  publishPersistedOperations,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  PersistedOperation,
  PublishedOperationStatus,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import crypto from "crypto";
import { GraphiQL } from "graphiql";
import { useTheme } from "next-themes";
import { useRouter } from "next/router";
import { useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FaNetworkWired } from "react-icons/fa";
import { FiSave } from "react-icons/fi";
import { PiBracketsCurly, PiDevices } from "react-icons/pi";
import { z } from "zod";

const graphiQLFetch = async (
  onFetch: any,
  graphRequestToken: string,
  url: URL,
  init: RequestInit,
) => {
  try {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
    };

    let hasTraceHeader = false;
    for (const headersKey in headers) {
      if (headersKey.toLowerCase() === "x-wg-trace") {
        hasTraceHeader = headers[headersKey] === "true";
        break;
      }
    }

    // add token if trace header is present
    if (hasTraceHeader) {
      headers["X-WG-Token"] = graphRequestToken;
    }

    const response = await fetch(url, {
      ...init,
      headers,
    });
    onFetch(await response.clone().json());
    return response;
  } catch (e) {
    // @ts-expect-error
    if (e?.message?.includes("Failed to fetch")) {
      throw new Error(
        "Unable to connect to the server. Please check if your server is running.",
      );
    }
    throw e;
  }
};

const FormSchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().trim().min(1, "The name cannot be empty"),
});

type Input = z.infer<typeof FormSchema>;

const PersistOperation = () => {
  const router = useRouter();
  const slug = router.query.slug as string;
  const namespace = router.query.namespace as string;

  const { query } = useContext(TraceContext);

  const [isOpen, setIsOpen] = useState(false);

  const [isNew, setIsNew] = useState(false);

  const { toast } = useToast();

  const { mutate, isPending } = useMutation({
    ...publishPersistedOperations.useMutation(),
    onSuccess(data) {
      if (data.response?.code !== EnumStatusCode.OK) {
        toast({
          variant: "destructive",
          title: "Could not save operation",
          description: data.response?.details ?? "Please try again",
        });
        return;
      }

      if (
        data.operations.length > 0 &&
        data.operations[0].status === PublishedOperationStatus.CONFLICT
      ) {
        toast({
          variant: "destructive",
          title: "Could not save operation",
          description: "There were conflicts detected while saving",
        });
        return;
      }

      toast({
        title: "Operation persisted successfully",
      });

      setIsOpen(false);
    },
  });

  const { data, refetch } = useQuery(
    getClients.useQuery({
      fedGraphName: slug,
      namespace,
    }),
  );

  useEffect(() => {
    if (isOpen) {
      refetch();
    }
  }, [isOpen, refetch]);

  const form = useZodForm<Input>({
    schema: FormSchema,
  });

  const onSubmit: SubmitHandler<Input> = (formData) => {
    const clientName = formData.clientId
      ? data?.clients.find((c) => c.id === formData.clientId)?.name
      : formData.clientName;

    if (!query) {
      toast({
        description: "Please save a valid query",
      });
      return;
    }

    if (!clientName) {
      toast({
        description: "Please use a valid client name",
      });
      return;
    }

    const operations = [
      new PersistedOperation({
        id: crypto.createHash("sha256").update(query).digest("hex"),
        contents: query,
      }),
    ];

    mutate({
      fedGraphName: slug,
      clientName,
      operations,
      namespace,
    });
  };

  if (!query) return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="graphiql-toolbar-button"
            >
              <FiSave className="graphiql-toolbar-icon" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent className="rounded-md border bg-background px-2 py-1">
          Persist Operation
        </TooltipContent>
      </Tooltip>

      <DialogContent className="grid  max-w-4xl grid-cols-5 items-start divide-x">
        <div className="scrollbar-custom col-span-3 h-full max-h-[450px] overflow-auto">
          <CodeViewer code={query} />
        </div>
        <div className="col-span-2 flex h-full w-full flex-col pl-4">
          <DialogHeader>
            <DialogTitle>Persist Operation</DialogTitle>
            <DialogDescription>
              Save query to persisted operations
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex-1">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="flex h-full flex-col gap-y-6"
              >
                <FormField
                  control={form.control}
                  name="clientId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client</FormLabel>
                      <Select
                        onValueChange={(val) => {
                          if (!val) {
                            setIsNew(true);
                            form.setValue("clientName", "");
                          } else {
                            setIsNew(false);
                            form.setValue(
                              "clientName",
                              data?.clients.find((c) => c.id === val)?.name ??
                                "",
                            );
                          }

                          field.onChange(val);
                        }}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a client" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="">
                            <span className="flex items-center gap-x-2">
                              <SparklesIcon className="h-4 w-4" /> Create New
                            </span>
                          </SelectItem>
                          {data?.clients?.map((c) => {
                            return (
                              <SelectItem key={c.id} value={c.id}>
                                <span className="flex items-center gap-x-2">
                                  <PiDevices className="h-4 w-4" /> {c.name}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>

                      <FormMessage />
                    </FormItem>
                  )}
                />
                {isNew && (
                  <FormField
                    control={form.control}
                    name="clientName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Enter name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Enter new client name"
                            {...field}
                          />
                        </FormControl>

                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <Button
                  isLoading={isPending}
                  disabled={!form.formState.isValid}
                  className="mt-auto w-full"
                  type="submit"
                >
                  Save
                </Button>
              </form>
            </Form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ResponseTabs = () => {
  const onValueChange = (val: string) => {
    const response = document.getElementsByClassName(
      "graphiql-response",
    )[0] as HTMLDivElement;

    const visual = document.getElementById(
      "response-visualization",
    ) as HTMLDivElement;

    if (!response || !visual) {
      return;
    }

    if (val === "plan") {
      response.classList.add("!invisible");
      visual.classList.remove("invisible");
      visual.classList.remove("-z-50");
    } else {
      response.classList.remove("!invisible");
      visual.classList.add("-z-50");
      visual.classList.add("invisible");
    }
  };

  return (
    <div className="flex items-center justify-center gap-x-2">
      <Tabs
        defaultValue="response"
        className="w-full md:w-auto"
        onValueChange={onValueChange}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger className="!cursor-pointer" value="response" asChild>
            <div className="flex items-center gap-x-2">
              <PiBracketsCurly className="h-4 w-4 flex-shrink-0" />
              Response
            </div>
          </TabsTrigger>
          <TabsTrigger className="!cursor-pointer" value="plan" asChild>
            <div className="flex items-center gap-x-2">
              <FaNetworkWired className="h-4 w-4 flex-shrink-0" />
              Trace
            </div>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
};

const PlaygroundPortal = () => {
  const tabDiv = document.getElementById("response-tabs");
  const visDiv = document.getElementById("response-visualization");
  const saveDiv = document.getElementById("save-button");

  if (!tabDiv || !visDiv || !saveDiv) return null;

  return (
    <>
      {createPortal(<ResponseTabs />, tabDiv)}
      {createPortal(<TraceView />, visDiv)}
      {createPortal(<PersistOperation />, saveDiv)}
    </>
  );
};

const PlaygroundPage: NextPageWithLayout = () => {
  const router = useRouter();
  const operation = router.query.operation as string;
  const variables = router.query.variables as string;

  const graphContext = useContext(GraphContext);

  const { data, isLoading } = useQuery(
    getFederatedGraphSDLByName.useQuery({
      name: graphContext?.graph?.name,
      namespace: graphContext?.graph?.namespace,
    }),
  );

  const schema = useMemo(() => {
    return parseSchema(data?.sdl);
  }, [data?.sdl]);

  const [query, setQuery] = useState<string | undefined>(
    operation ? decodeURIComponent(operation) : undefined,
  );
  const [headers, setHeaders] = useState(`{
  "X-WG-TRACE" : "true"
}`);
  const [response, setResponse] = useState<string>("");

  const [isGraphiqlRendered, setIsGraphiqlRendered] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    if (isMounted) return;

    const header = document.getElementsByClassName(
      "graphiql-session-header-right",
    )[0] as any as HTMLDivElement;

    if (header) {
      const logo = document.getElementsByClassName("graphiql-logo")[0];
      logo.classList.add("hidden");
      const div = document.createElement("div");
      div.id = "response-tabs";
      div.className = "flex items-center justify-center mx-2";
      header.append(div);
    }

    const responseSection =
      document.getElementsByClassName("graphiql-response")[0];
    const responseSectionParent =
      responseSection.parentElement as any as HTMLDivElement;

    if (responseSectionParent) {
      responseSectionParent.id = "response-parent";
      responseSectionParent.classList.add("relative");
      const div = document.createElement("div");
      div.id = "response-visualization";
      div.className = "flex flex-1 h-full w-full absolute invisible -z-50";
      responseSectionParent.append(div);
    }

    const toolbar = document.getElementsByClassName(
      "graphiql-toolbar",
    )[0] as any as HTMLDivElement;

    if (toolbar) {
      const div = document.createElement("div");
      div.id = "save-button";
      toolbar.append(div);
    }

    setIsMounted(true);
  }, [isMounted]);

  useEffect(() => {
    if (!isGraphiqlRendered && typeof query === "string") {
      if (!query) {
        // query is empty - fill it with template
        setQuery(`# Welcome to WunderGraph Studio
#
#
# Type queries into this side of the screen, and you will see intelligent
# typeaheads aware of the current GraphQL type schema and live syntax and
# validation errors highlighted within the text.
#
# GraphQL queries typically start with a "{" character. Lines that start
# with a # are ignored.
#
# An example GraphQL query might look like:
#
#     {
#       field(arg: "value") {
#         subField
#       }
#     }
#
# Keyboard shortcuts:
#
#   Prettify query:  Shift-Ctrl-P (or press the prettify button)
#
#  Merge fragments:  Shift-Ctrl-M (or press the merge button)
#
#        Run Query:  Ctrl-Enter (or press the play button)
#
#    Auto Complete:  Ctrl-Space (or just start typing)
#
`);
      }
      // set first render flag to true - to prevent opening new tab / filling data while user is editing
      setIsGraphiqlRendered(true);
    }
  }, [query, isGraphiqlRendered]);

  const fetcher = useMemo(() => {
    const onFetch = (response: any) => {
      setResponse(JSON.stringify(response));
    };

    const url = graphContext?.graph?.routingURL ?? "";
    return createGraphiQLFetcher({
      url: url,
      subscriptionUrl: url.replace("http", "ws"),
      fetch: (...args) =>
        graphiQLFetch(
          onFetch,
          graphContext?.graphRequestToken!,
          args[0] as URL,
          args[1] as RequestInit,
        ),
    });
  }, [graphContext?.graph?.routingURL, graphContext?.graphRequestToken]);

  const { theme } = useTheme();

  useEffect(() => {
    if (theme === "light") {
      document.body.classList.add("graphiql-light");
      document.body.classList.remove("graphiql-dark");
    } else {
      document.body.classList.add("graphiql-dark");
      document.body.classList.remove("graphiql-light");
    }

    return () => {
      document.body.classList.remove("graphiql-dark");
      document.body.classList.remove("graphiql-light");
    };
  }, [theme]);

  if (!graphContext?.graph) return null;

  return (
    <PageHeader title="Playground | Studio">
      <TraceContext.Provider
        value={{
          query,
          headers,
          response,
          subgraphs: graphContext.subgraphs,
        }}
      >
        <div className="hidden h-[100%] flex-1 md:flex">
          <GraphiQL
            shouldPersistHeaders
            showPersistHeadersSettings={false}
            fetcher={fetcher}
            query={query}
            variables={variables ? decodeURIComponent(variables) : undefined}
            onEditQuery={setQuery}
            headers={headers}
            onEditHeaders={setHeaders}
            plugins={[
              explorerPlugin({
                showAttribution: false,
              }),
            ]}
            // null stops introspection and undefined forces introspection if schema is null
            schema={isLoading ? null : schema ?? undefined}
          />
          {isMounted && <PlaygroundPortal />}
        </div>
      </TraceContext.Provider>
      <div className="flex flex-1 items-center justify-center md:hidden">
        <Alert className="m-8">
          <MobileIcon className="h-4 w-4" />
          <AlertTitle>Heads up!</AlertTitle>
          <AlertDescription>
            Cosmo GraphQL Playground is not available on mobile devices. Please
            open this page on your desktop.
          </AlertDescription>
        </Alert>
      </div>
    </PageHeader>
  );
};

PlaygroundPage.getLayout = (page: React.ReactNode) => {
  return getGraphLayout(page, {
    title: "Playground",
  });
};

export default PlaygroundPage;

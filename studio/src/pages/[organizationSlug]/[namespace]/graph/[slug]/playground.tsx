import { CodeViewer } from "@/components/code-viewer";
import {
  getGraphLayout,
  GraphContext,
  GraphPageLayout,
} from "@/components/layout/graph-layout";
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
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { NextPageWithLayout } from "@/lib/page";
import { parseSchema } from "@/lib/schema-helpers";
import { cn } from "@/lib/utils";
import { explorerPlugin } from "@graphiql/plugin-explorer";
import { createGraphiQLFetcher } from "@graphiql/toolkit";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { MobileIcon } from "@radix-ui/react-icons";
import { TooltipContent, TooltipTrigger } from "@radix-ui/react-tooltip";
import { useQuery, useMutation } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getClients,
  getFederatedGraphSDLByName,
  getSubgraphSDLFromLatestComposition,
  publishPersistedOperations,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  PersistedOperation,
  PublishedOperationStatus,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import crypto from "crypto";
import { GraphiQL } from "graphiql";
import { GraphQLSchema, parse, validate } from "graphql";
import { useTheme } from "next-themes";
import { useRouter } from "next/router";
import { ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FaNetworkWired } from "react-icons/fa";
import { FiSave } from "react-icons/fi";
import { PiBracketsCurly, PiDevices } from "react-icons/pi";
import { TbDevicesCheck } from "react-icons/tb";
import { z } from "zod";
import { useApplyParams } from "@/components/analytics/use-apply-params";

const graphiQLFetch = async (
  onFetch: any,
  graphRequestToken: string,
  schema: GraphQLSchema | null,
  clientValidationEnabled: boolean,
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

    if (schema && clientValidationEnabled) {
      const query = JSON.parse(init.body as string)?.query;
      const errors = validate(schema, parse(query));

      if (errors.length > 0) {
        const responseData = {
          message:
            "Client-side validation failed. The request was not sent to the Router.",
          errors: errors.map((e) => ({
            message: e.message,
            path: e.path,
            locations: e.locations,
          })),
        };

        const response = new Response(JSON.stringify(responseData), {
          headers: {
            "Content-Type": "application/json",
          },
        });

        onFetch(await response.clone().json());
        return response;
      }
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

  const { mutate, isPending } = useMutation(publishPersistedOperations, {
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

  const { data, refetch } = useQuery(getClients, {
    fedGraphName: slug,
    namespace,
  });

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

const ToggleClientValidation = () => {
  const { clientValidationEnabled, setClientValidationEnabled } =
    useContext(TraceContext);

  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <Button
          onClick={() => setClientValidationEnabled(!clientValidationEnabled)}
          variant="ghost"
          size="icon"
          className="graphiql-toolbar-button"
        >
          <TbDevicesCheck
            className={cn("graphiql-toolbar-icon", {
              "text-success": clientValidationEnabled,
            })}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="rounded-md border bg-background px-2 py-1">
        {clientValidationEnabled
          ? "Client-side validation enabled"
          : "Client-side validation disabled"}
      </TooltipContent>
    </Tooltip>
  );
};

const PlaygroundPortal = () => {
  const tabDiv = document.getElementById("response-tabs");
  const visDiv = document.getElementById("response-visualization");
  const saveDiv = document.getElementById("save-button");
  const toggleClientValidation = document.getElementById(
    "toggle-client-validation",
  );

  if (!tabDiv || !visDiv || !saveDiv || !toggleClientValidation) return null;

  return (
    <>
      {createPortal(<ResponseTabs />, tabDiv)}
      {createPortal(<TraceView />, visDiv)}
      {createPortal(<PersistOperation />, saveDiv)}
      {createPortal(<ToggleClientValidation />, toggleClientValidation)}
    </>
  );
};

const PlaygroundPage: NextPageWithLayout = () => {
  const router = useRouter();
  const operation = router.query.operation as string;
  const variables = router.query.variables as string;

  const graphContext = useContext(GraphContext);

  const loadSchemaGraphId =
    (router.query.load as string) || graphContext?.graph?.id || "";

  const { data, isLoading: isLoadingGraphSchema } = useQuery(
    getFederatedGraphSDLByName,
    {
      name: graphContext?.graph?.name,
      namespace: graphContext?.graph?.namespace,
    },
  );

  const { data: subgraphData, isLoading: isLoadingSubgraphSchema } = useQuery(
    getSubgraphSDLFromLatestComposition,
    {
      name: graphContext?.subgraphs.find((s) => s.id === loadSchemaGraphId)
        ?.name,
      fedGraphName: graphContext?.graph?.name,
      namespace: graphContext?.graph?.namespace,
    },
    {
      enabled:
        !!loadSchemaGraphId && loadSchemaGraphId !== graphContext?.graph?.id,
    },
  );

  const isLoading = isLoadingGraphSchema || isLoadingSubgraphSchema;

  const schema = useMemo(() => {
    return parseSchema(subgraphData?.sdl || data?.clientSchema);
  }, [data?.clientSchema, subgraphData?.sdl]);

  const [query, setQuery] = useState<string | undefined>(
    operation ? decodeURIComponent(operation) : undefined,
  );
  const [headers, setHeaders] = useState(`{
  "X-WG-TRACE" : "true"
}`);
  const [response, setResponse] = useState<string>("");

  const [clientValidationEnabled, setClientValidationEnabled] = useState(true);

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
      const saveButton = document.createElement("div");
      saveButton.id = "save-button";
      toolbar.append(saveButton);

      const toggleClientValidation = document.createElement("div");
      toggleClientValidation.id = "toggle-client-validation";
      toolbar.append(toggleClientValidation);
    }

    // remove settings button
    const sidebarSection = document.getElementsByClassName(
      "graphiql-sidebar-section",
    )[1];
    const children = Array.from(sidebarSection.childNodes.values());
    sidebarSection.removeChild(children[2]);

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

  const { routingUrl, subscriptionUrl } = useMemo(() => {
    if (!loadSchemaGraphId || loadSchemaGraphId === graphContext?.graph?.id) {
      const url = graphContext?.graph?.routingURL ?? "";
      return { routingUrl: url, subscriptionUrl: url.replace("http", "ws") };
    }

    const subgraph = graphContext?.subgraphs?.find(
      (s) => s.id === loadSchemaGraphId,
    );
    if (!subgraph) {
      return { routingUrl: "", subscriptionUrl: "" };
    }

    return {
      routingUrl: subgraph.routingURL,
      subscriptionUrl: subgraph.subscriptionUrl,
    };
  }, [
    graphContext?.graph?.id,
    graphContext?.graph?.routingURL,
    graphContext?.subgraphs,
    loadSchemaGraphId,
  ]);

  const fetcher = useMemo(() => {
    const onFetch = (response: any) => {
      setResponse(JSON.stringify(response));
    };

    return createGraphiQLFetcher({
      url: routingUrl,
      subscriptionUrl: subscriptionUrl,
      fetch: (...args) =>
        graphiQLFetch(
          onFetch,
          graphContext?.graphRequestToken!,
          schema,
          clientValidationEnabled,
          args[0] as URL,
          args[1] as RequestInit,
        ),
    });
  }, [
    routingUrl,
    subscriptionUrl,
    graphContext?.graphRequestToken,
    schema,
    clientValidationEnabled,
  ]);

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
    <TraceContext.Provider
      value={{
        query,
        headers,
        response,
        subgraphs: graphContext.subgraphs,
        clientValidationEnabled,
        setClientValidationEnabled,
      }}
    >
      <div className="hidden h-full flex-1 pl-2.5 md:flex">
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
    </TraceContext.Provider>
  );
};

const ConfigSelect = () => {
  const router = useRouter();

  const graphContext = useContext(GraphContext);
  const subgraphs = graphContext?.subgraphs;

  const selected =
    (router.query.load as string) || graphContext?.graph?.id || "";

  const applyParams = useApplyParams();

  return (
    <div className="ml-1 flex items-center gap-x-2 pl-3">
      <span className="text-sm text-muted-foreground">
        Querying {selected === graphContext?.graph?.id ? "Graph" : "Subgraph"} :
      </span>
      <Select
        value={selected}
        onValueChange={(value) => {
          applyParams({
            load: value,
          });
        }}
      >
        <SelectTrigger className="ml-1 mr-4 flex h-8 w-auto gap-x-2 border-0 bg-transparent pl-3 pr-1 shadow-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:ring-0 md:ml-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={graphContext?.graph?.id ?? ""}>
              {graphContext?.graph?.name}
            </SelectItem>
          </SelectGroup>
          <SelectSeparator />
          {subgraphs && subgraphs.length > 0 && (
            <SelectGroup>
              {subgraphs.map(({ name, id }) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );
};

PlaygroundPage.getLayout = (page: ReactNode) => {
  return getGraphLayout(
    <PageHeader title="Playground | Studio">
      <GraphPageLayout
        title="Playground"
        subtitle="Execute queries against your graph"
        noPadding
        toolbar={<ConfigSelect />}
      >
        {page}
      </GraphPageLayout>
    </PageHeader>,
  );
};

export default PlaygroundPage;

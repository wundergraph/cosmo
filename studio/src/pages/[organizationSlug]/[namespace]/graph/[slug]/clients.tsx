import { createFilterState } from "@/components/analytics/constructAnalyticsTableQueryState";
import { CodeViewer } from "@/components/code-viewer";
import { EmptyState } from "@/components/empty-state";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CLI } from "@/components/ui/cli";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { docsBaseURL } from "@/lib/constants";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import {
  extractVariablesFromGraphQL,
  useParseSchema,
} from "@/lib/schema-helpers";
import { cn } from "@/lib/utils";
import {
  CommandLineIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  CopyIcon,
  Cross1Icon,
  MagnifyingGlassIcon,
  PlayIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import { useQuery, useMutation } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getClients,
  getFederatedGraphSDLByName,
  getPersistedOperations,
  publishPersistedOperations,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import copy from "copy-to-clipboard";
import { formatDistanceToNow } from "date-fns";
import Fuse from "fuse.js";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/router";
import { useContext, useState } from "react";
import { BiAnalyse } from "react-icons/bi";
import { IoBarcodeSharp } from "react-icons/io5";
import { z } from "zod";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

const getSnippets = ({
  clientName,
  operationId,
  operationNames,
  routingURL,
  variables,
}: {
  clientName: string;
  operationId: string;
  operationNames: string[];
  routingURL: string;
  variables: Record<string, any>;
}) => {
  const variablesString =
    Object.keys(variables).length > 0 ? JSON.stringify(variables) : undefined;

  let variablesDeclaration = "";
  for (const [key, value] of Object.entries(variables)) {
    variablesDeclaration += `${key}: ${JSON.stringify(value)},\n`;
  }

  // Compatibility with curl >=7.81.0 (Release-Date: 2022-01-05)
  const curl = `curl '${routingURL}' \\
    -H 'graphql-client-name: ${clientName}' \\
    -H 'Content-Type: application/json' \\
    -d '{${
      operationNames.length > 1 ? `"operationName":"${operationNames[0]}",` : ""
    }"extensions":{"persistedQuery":{"version":1,"sha256Hash":"${operationId}"}}${
      variablesString ? `,"variables": ${variablesString}` : ""
    }}'`;

  const js = `const url = '${routingURL}';
const headers = {
  'Content-Type': 'application/json',
  'graphql-client-name': '${clientName}',
};

const body = {
  ${operationNames.length > 1 ? `operationName: "${operationNames[0]}",` : ""}
  extensions: {
    persistedQuery: {
      version: 1,
      sha256Hash: '${operationId}',
    },
  }${
    variablesDeclaration.length > 0
      ? `,
  variables: {
    ${variablesDeclaration}  },`
      : ""
  }
};

fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify(body),
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`;

  return { curl, js };
};

const ClientOperations = () => {
  const router = useRouter();
  const slug = router.query.slug as string;
  const { namespace: { name: namespace } } = useWorkspace();
  const organizationSlug = router.query.organizationSlug as string;
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId");
  const clientName = searchParams.get("clientName");
  const graphContext = useContext(GraphContext);

  const { data: sdlData } = useQuery(
    getFederatedGraphSDLByName,
    {
      name: slug,
      namespace,
    },
    {
      enabled: !!clientId,
    },
  );

  const { ast } = useParseSchema(sdlData?.sdl);

  const [search, setSearch] = useState(router.query.search as string);
  const applyParams = (search: string) => {
    const query = { ...router.query };
    query.search = search;

    if (!search) {
      delete query.search;
    }

    router.replace({
      query,
    });
  };

  const { data, isLoading, error, refetch } = useQuery(
    getPersistedOperations,
    {
      clientId: clientId ?? "",
      federatedGraphName: slug,
      namespace,
    },
    {
      enabled: !!clientId,
    },
  );

  let content: React.ReactNode;

  if (isLoading) {
    content = <Loader fullscreen />;
  } else if (error || data?.response?.code !== EnumStatusCode.OK) {
    content = (
      <div className="my-auto">
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve operations"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </div>
    );
  } else if (data.operations.length === 0) {
    content = (
      <div className="my-auto">
        <EmptyState
          icon={<CommandLineIcon />}
          title="No operations found."
          description={
            <>
              Push new operations to this client using the CLI.{" "}
              <a
                target="_blank"
                rel="noreferrer"
                href={docsBaseURL + "/router/persisted-queries/persisted-operations"}
                className="text-primary"
              >
                Learn more.
              </a>
            </>
          }
          actions={
            <CLI
              command={`npx wgc operations push ${slug} -n ${namespace} -c ${clientName} -f <path-to-file>`}
            />
          }
        />
      </div>
    );
  } else if (data && graphContext?.graph) {
    const fuse = new Fuse(data.operations, {
      keys: ["id", "operationNames"],
      minMatchCharLength: 1,
    });

    const filteredOperations = search
      ? fuse.search(search).map(({ item }) => item)
      : data.operations;

    content = (
      <div>
        <div className="relative">
          <MagnifyingGlassIcon className="absolute bottom-0 left-3 top-0 my-auto" />
          <Input
            placeholder="Search by Name or ID"
            className="pl-8 pr-10"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              applyParams(e.target.value);
            }}
          />
          {search && (
            <Button
              variant="ghost"
              className="absolute bottom-0 right-0 top-0 my-auto rounded-l-none"
              onClick={() => {
                setSearch("");
                applyParams("");
              }}
            >
              <Cross1Icon />
            </Button>
          )}
        </div>
        <Accordion type="single" collapsible className="mt-4 w-full">
          {filteredOperations.map((op) => {
            const [base, _] = window.location.href.split("?");
            const link =
              base +
              `?clientId=${clientId}&clientName=${clientName}&search=${op.id}`;

            const variables = extractVariablesFromGraphQL(op.contents, ast);

            const snippets = getSnippets({
              clientName: clientName ?? "",
              operationId: op.id,
              operationNames: op.operationNames,
              routingURL: graphContext.graph?.routingURL ?? "",
              variables,
            });

            return (
              <AccordionItem key={op.id} value={op.id}>
                <AccordionTrigger className="gap-x-4 truncate px-2 hover:bg-secondary/30 hover:no-underline">
                  <Badge
                    className="flex w-20 items-center justify-center"
                    variant="secondary"
                  >
                    {op.id.slice(0, 6)}
                  </Badge>
                  <span
                    className={cn("w-full truncate text-start", {
                      "italic text-muted-foreground":
                        op.operationNames.length === 0,
                    })}
                  >
                    {op.operationNames.length > 0
                      ? op.operationNames.length > 1
                        ? `[ ${op.operationNames.join(", ")} ]`
                        : op.operationNames[0]
                      : "unnamed operation"}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="mt-2 px-2">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {op.lastUpdatedAt ? (
                        <p className="text-muted-foreground">
                          Updated at{" "}
                          {formatDateTime(new Date(op.lastUpdatedAt))}
                        </p>
                      ) : (
                        <p className="text-muted-foreground">
                          Created at {formatDateTime(new Date(op.createdAt))}
                        </p>
                      )}
                      <div className="flex items-center gap-x-2">
                        <Tooltip delayDuration={100}>
                          <TooltipTrigger>
                            <Button variant="outline" size="icon" asChild>
                              <Link
                                href={{
                                  pathname: `/[organizationSlug]/[namespace]/graph/[slug]/analytics`,
                                  query: {
                                    organizationSlug:
                                      router.query.organizationSlug,
                                    namespace,
                                    slug: router.query.slug,
                                    filterState: createFilterState({
                                      operationPersistedId: op.id,
                                    }),
                                  },
                                }}
                              >
                                <BiAnalyse />
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View Metrics</TooltipContent>
                        </Tooltip>
                        <Tooltip delayDuration={100}>
                          <TooltipTrigger>
                            <Button variant="outline" size="icon" asChild>
                              <Link
                                href={`/${organizationSlug}/${namespace}/graph/${slug}/playground?operation=${encodeURIComponent(
                                  op.contents || "",
                                )}&variables=${encodeURIComponent(
                                  JSON.stringify(variables),
                                )}`}
                              >
                                <PlayIcon />
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Run in Playground</TooltipContent>
                        </Tooltip>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon">
                              <CopyIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                copy(op.id);
                                toast({
                                  description:
                                    "Copied persisted ID of operation",
                                });
                              }}
                            >
                              Operation Persisted ID
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                copy(link);
                                toast({
                                  description: "Copied link to operation",
                                });
                              }}
                            >
                              Link to operation
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                copy(snippets.js);
                                toast({
                                  description: "Copied snippet",
                                });
                              }}
                            >
                              Javascript snippet
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                copy(snippets.curl);
                                toast({
                                  description: "Copied snippet",
                                });
                              }}
                            >
                              curl snippet
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <div className="scrollbar-custom mt-2 h-96 overflow-auto rounded border">
                      <CodeViewer code={op.contents} disableLinking />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    );
  }

  return (
    <Sheet
      modal
      open={!!clientId}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          const newQuery = { ...router.query };
          delete newQuery["clientId"];
          delete newQuery["clientName"];
          router.replace({
            query: newQuery,
          });
        }
      }}
    >
      <SheetContent className="scrollbar-custom w-full max-w-full overflow-y-scroll sm:max-w-full md:max-w-2xl lg:max-w-3xl">
        <SheetHeader className="mb-12">
          <SheetTitle className="flex flex-wrap items-center gap-x-1.5">
            Persisted Operations in{" "}
            <code className="break-all rounded bg-secondary px-1.5 text-left text-secondary-foreground">
              {clientName}
            </code>
          </SheetTitle>
        </SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  );
};

const FormSchema = z.object({
  clientName: z.string().trim().min(1, "The name cannot be empty"),
});

type Input = z.infer<typeof FormSchema>;

const CreateClient = ({ refresh }: { refresh: () => void }) => {
  const checkUserAccess = useCheckUserAccess();
  const router = useRouter();
  const { namespace: { name: namespace } } = useWorkspace();
  const slug = router.query.slug as string;
  const [isOpen, setIsOpen] = useState(false);

  const { toast } = useToast();

  const form = useZodForm<Input>({
    schema: FormSchema,
  });

  const { mutate, isPending } = useMutation(publishPersistedOperations, {
    onSuccess(data) {
      if (data.response?.code !== EnumStatusCode.OK) {
        toast({
          variant: "destructive",
          title: "Could not create client",
          description: data.response?.details ?? "Please try again",
        });
        return;
      }

      toast({
        title: "Client created successfully",
      });

      form.setValue("clientName", "");
      refresh();
      setIsOpen(false);
    },
  });

  const onSubmit: SubmitHandler<Input> = (formData) => {
    mutate({
      namespace,
      fedGraphName: slug,
      clientName: formData.clientName,
      operations: [],
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          disabled={!checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] })}
        >
          <PlusIcon className="mr-2" />
          Create Client
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Client</DialogTitle>
          <DialogDescription>
            Create a new client to store persisted operations by providing a
            name
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <FormField
                control={form.control}
                name="clientName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter new client name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                disabled={!form.formState.isValid}
                className="w-full"
                type="submit"
              >
                Submit
              </Button>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ClientsPage: NextPageWithLayout = () => {
  const checkUserAccess = useCheckUserAccess();
  const router = useRouter();
  const organizationSlug = useCurrentOrganization()?.slug;
  const { namespace: { name: namespace } } = useWorkspace();
  const slug = router.query.slug as string;

  const constructLink = (name: string, mode: "metrics" | "traces") => {
    const filters = [];
    const value = {
      label: name,
      value: name,
      operator: 0,
    };

    const filter = {
      id: "clientName",
      value: [JSON.stringify(value)],
    };
    filters.push(filter);

    if (mode === "metrics") {
      return `/${organizationSlug}/${namespace}/graph/${slug}/analytics?filterState=${JSON.stringify(
        filters,
      )}`;
    } else {
      return `/${organizationSlug}/${namespace}/graph/${slug}/analytics/traces?filterState=${JSON.stringify(
        filters,
      )}`;
    }
  };

  const { data, isLoading, error, refetch } = useQuery(getClients, {
    fedGraphName: slug,
    namespace,
  });

  if (!data) return null;

  if (!data || error || data.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve changelog"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  return (
    <div className="flex flex-col gap-y-4">
      {data.clients.length === 0 ? (
        <EmptyState
          icon={<CommandLineIcon />}
          title="No clients found"
          description={
            <>
              Create one and use the CLI tool to publish persisted operations to
              it.{" "}
              <a
                target="_blank"
                rel="noreferrer"
                href={docsBaseURL + "/router/persisted-queries/persisted-operations"}
                className="text-primary"
              >
                Learn more.
              </a>
            </>
          }
          actions={<CreateClient refresh={() => refetch()} />}
        />
      ) : (
        <>
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <p className="text-sm text-muted-foreground">
              Create and view clients to which you can publish persisted
              operations.{" "}
              <Link
                href={docsBaseURL + "/router/persisted-queries/persisted-operations"}
                className="text-primary"
                target="_blank"
                rel="noreferrer"
              >
                Learn more
              </Link>
            </p>
            {checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] }) && (
              <CreateClient refresh={() => refetch()} />
            )}
          </div>

          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Updated By</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Last Push</TableHead>
                  <TableHead>Operations</TableHead>
                  <TableHead className="w-32"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.clients.map(
                  ({
                    id,
                    name,
                    createdAt,
                    lastUpdatedAt,
                    createdBy,
                    lastUpdatedBy,
                  }) => {
                    return (
                      <TableRow key={id}>
                        <TableCell className="font-medium">
                          <p className="flex w-48 items-center truncate">
                            {name}
                          </p>
                        </TableCell>
                        <TableCell className="font-medium">
                          {createdBy || "unknown user"}
                        </TableCell>
                        <TableCell className="font-medium">
                          <p
                            className={cn({
                              "flex w-20 items-center justify-center":
                                lastUpdatedBy === "",
                            })}
                          >
                            {lastUpdatedBy !== "" ? lastUpdatedBy : "-"}
                          </p>
                        </TableCell>
                        <TableCell>
                          {formatDistanceToNow(new Date(createdAt))}
                        </TableCell>
                        <TableCell>
                          {lastUpdatedAt
                            ? formatDistanceToNow(new Date(lastUpdatedAt))
                            : "Never"}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="link"
                            className="px-0 hover:no-underline"
                            onClick={() => {
                              router.replace({
                                pathname: router.pathname,
                                query: {
                                  ...router.query,
                                  clientId: id,
                                  clientName: name,
                                },
                              });
                            }}
                          >
                            View Operations
                          </Button>
                        </TableCell>
                        <TableCell className="flex items-center gap-x-2 pr-8">
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger>
                              <Button variant="ghost" size="icon" asChild>
                                <Link href={constructLink(name, "metrics")}>
                                  <BiAnalyse className="h-4 w-4" />
                                </Link>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Metrics</TooltipContent>
                          </Tooltip>
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger>
                              <Button variant="ghost" size="icon" asChild>
                                <Link href={constructLink(name, "traces")}>
                                  <IoBarcodeSharp className="h-4 w-4" />
                                </Link>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Traces</TooltipContent>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  },
                )}
              </TableBody>
            </Table>
          </TableWrapper>
        </>
      )}
      <ClientOperations />
    </div>
  );
};

ClientsPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Clients | Studio">
      <GraphPageLayout
        title="Clients"
        subtitle="View registered clients and their persisted operations"
      >
        {page}
      </GraphPageLayout>
    </PageHeader>,
  );

export default ClientsPage;

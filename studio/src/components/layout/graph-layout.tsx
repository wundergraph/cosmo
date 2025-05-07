import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useQuery } from "@connectrpc/connect-query";
import {
  ChartBarIcon,
  ClipboardIcon,
  ExclamationTriangleIcon,
  ServerStackIcon,
} from "@heroicons/react/24/outline";
import {
  CaretSortIcon,
  CheckCircledIcon,
  CheckIcon,
  Component2Icon,
  FileTextIcon,
  HomeIcon,
  PlayIcon,
} from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getFederatedGraphByName,
  getFederatedGraphs,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  FederatedGraph,
  GetFederatedGraphByNameResponse,
  GetFederatedGraphsResponse,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useRouter } from "next/router";
import { Fragment, createContext, useContext, useMemo, useState } from "react";
import { MdOutlineFeaturedPlayList } from "react-icons/md";
import {
  PiBracketsCurlyBold,
  PiChat,
  PiCubeFocus,
  PiDevices,
  PiGitBranch,
  PiToggleRight,
} from "react-icons/pi";
import { EmptyState } from "../empty-state";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Link } from "../ui/link";
import { Loader } from "../ui/loader";
import { PageHeader } from "./head";
import { LayoutProps } from "./layout";
import { NavLink, SideNav } from "./sidenav";
import { useFeature } from "@/hooks/use-feature";

export interface GraphContextProps {
  graph: GetFederatedGraphByNameResponse["graph"];
  subgraphs: GetFederatedGraphByNameResponse["subgraphs"];
  graphs: GetFederatedGraphsResponse["graphs"];
  graphRequestToken: string;
  featureFlagsInLatestValidComposition: GetFederatedGraphByNameResponse["featureFlagsInLatestValidComposition"];
  featureSubgraphs: GetFederatedGraphByNameResponse["featureSubgraphs"];
}

export const GraphContext = createContext<GraphContextProps | undefined>(
  undefined,
);

export const GraphLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const namespace = router.query.namespace as string;
  const slug = router.query.slug as string;

  const proposalsFeature = useFeature("proposals");

  const { data, isLoading, error, refetch } = useQuery(
    getFederatedGraphByName,
    {
      name: slug,
      namespace,
    },
  );

  const { data: graphsData } = useQuery(getFederatedGraphs);

  const graphContextData = useMemo(() => {
    if (!data || !graphsData) {
      return undefined;
    }
    return {
      graph: data.graph,
      subgraphs: data.subgraphs,
      graphRequestToken: data.graphRequestToken,
      graphs: graphsData.graphs,
      featureFlagsInLatestValidComposition:
        data.featureFlagsInLatestValidComposition,
      featureSubgraphs: data.featureSubgraphs,
    };
  }, [data, graphsData]);

  const links: NavLink[] = useMemo(() => {
    const basePath = `/${organizationSlug}/${namespace}/graph/${slug}`;

    const graphLinks = [
      {
        title: "Overview",
        href: basePath,
        icon: <HomeIcon className="h-4 w-4" />,
      },
      {
        title: "Subgraphs",
        href: basePath + "/subgraphs",
        icon: <Component2Icon className="h-4 w-4" />,
      },
      {
        title: "Feature Flags",
        href: basePath + "/feature-flags",
        icon: <MdOutlineFeaturedPlayList className="h-4 w-4" />,
        matchExact: false,
      },
      {
        title: "Playground",
        href: basePath + "/playground",
        icon: <PlayIcon className="h-4 w-4" />,
      },
      {
        title: "Schema",
        href: basePath + "/schema",
        matchExact: false,
        icon: <FileTextIcon className="h-4 w-4" />,
      },
      {
        title: "Analytics",
        href: basePath + "/analytics",
        matchExact: false,
        icon: <ChartBarIcon className="h-4 w-4" />,
      },
      {
        title: "Routers",
        href: basePath + "/routers",
        matchExact: false,
        icon: <ServerStackIcon className="h-4 w-4" />,
      },
      {
        title: "Compositions",
        href: basePath + "/compositions",
        matchExact: false,
        icon: <PiCubeFocus className="h-4 w-4" />,
      },
      {
        title: "Clients",
        href: basePath + "/clients",
        icon: <PiDevices className="h-4 w-4" />,
      },
      {
        title: "Changelog",
        href: basePath + "/changelog",
        icon: <PiGitBranch className="h-4 w-4" />,
      },
      {
        title: "Checks",
        href: basePath + "/checks",
        matchExact: false,
        icon: <CheckCircledIcon className="h-4 w-4" />,
      },
      {
        title: "Overrides",
        href: basePath + "/overrides",
        matchExact: true,
        icon: <PiToggleRight className="h-4 w-4" />,
      },
      {
        title: "Cache Operations",
        href: basePath + "/cache-operations",
        matchExact: false,
        icon: <PiBracketsCurlyBold className="h-4 w-4" />,
      },
    ];

    if (proposalsFeature?.enabled) {
      graphLinks.push({
        title: "Proposals",
        href: basePath + "/proposals",
        matchExact: false,
        icon: <ClipboardIcon className="h-4 w-4" />,
      });
    }
    
    return graphLinks;
  }, [organizationSlug, namespace, slug, proposalsFeature]);

  let render: React.ReactNode;

  if (isLoading) {
    render = <Loader fullscreen />;
  } else if (error || data?.response?.code !== EnumStatusCode.OK) {
    render = (
      <div className="my-auto">
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve your federated graph"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </div>
    );
  } else {
    render = (
      <GraphContext.Provider value={graphContextData}>
        {children}
      </GraphContext.Provider>
    );
  }

  return (
    <div className="2xl:flex 2xl:flex-1 2xl:flex-col 2xl:items-center">
      <div className="flex min-h-screen w-full flex-1 flex-col bg-background font-sans antialiased lg:grid lg:grid-cols-[auto_minmax(10px,1fr)] lg:divide-x">
        <SideNav links={links} />
        <main className="flex-1">{render}</main>
      </div>
    </div>
  );
};

function sortFederatedGraphs(graphs: FederatedGraph[]): FederatedGraph[] {
  const result: FederatedGraph[] = [];
  const contractedGraphs: FederatedGraph[] = [];

  for (const graph of graphs) {
    if (graph.contract) {
      contractedGraphs.push(graph);
    } else {
      result.push(graph);
    }
  }

  // sort source graph followed by contract graphs
  for (let i = 0; i < result.length; i++) {
    const sourceId = result[i].id;
    result.splice(
      i + 1,
      0,
      ...contractedGraphs.filter(
        (graph) =>
          graph.contract && graph.contract.sourceFederatedGraphId === sourceId,
      ),
    );
    i += contractedGraphs.filter(
      (graph) =>
        graph.contract && graph.contract.sourceFederatedGraphId === sourceId,
    ).length;
  }

  return result;
}

export const GraphSelect = () => {
  const data = useContext(GraphContext);

  const router = useRouter();
  const slug = router.query.slug as string;
  const namespace = router.query.namespace as string;

  const [open, setOpen] = useState(false);

  const selected = data?.graphs.find(
    (g) => g.name === slug && g.namespace === namespace,
  );

  const sortedGraphs = sortFederatedGraphs(data?.graphs ?? []);

  const groupedGraphs = sortedGraphs.reduce<Record<string, FederatedGraph[]>>(
    (result, graph) => {
    const { namespace, name } = graph;

    if (!result[namespace]) {
      result[namespace] = [];
    }

    result[namespace].push(graph);

    return result;
    },
    {},
  );

  if (router.pathname.split("/")[3] !== "graph") {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          role="combobox"
          aria-expanded={open}
          className="flex h-8 w-auto gap-x-2 border-0 bg-transparent pl-3 pr-1 text-muted-foreground shadow-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:ring-0"
        >
          {selected?.name}{" "}
          <Badge variant="secondary">{selected?.namespace}</Badge>
          <CaretSortIcon className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="min-w-[200px] p-0">
        <Command className="max-h-[calc(var(--radix-popover-content-available-height)_-24px)]">
          <CommandInput placeholder="Search graph..." className="h-9" />
          <CommandEmpty>No graph found.</CommandEmpty>
          <div className="scrollbar-custom h-full overflow-y-auto">
            {Object.entries(groupedGraphs ?? {}).map(
              ([namespace, graphs], index) => {
                return (
                  <CommandGroup key={namespace} heading={namespace}>
                    {graphs.map(({ id, name, contract }) => {
                      return (
                        <CommandItem
                          onSelect={() => {
                            router.push({
                              pathname: router.pathname,
                              query: {
                                ...router.query,
                                namespace,
                                slug: name,
                              },
                            });
                            setOpen(false);
                          }}
                          className="pl-4"
                          key={id}
                          value={`${namespace}.${name}`}
                        >
                          {name}
                          {contract && (
                            <Badge variant="muted" className="ml-2">
                              contract
                            </Badge>
                          )}
                          <CheckIcon
                            className={cn(
                              "ml-auto h-4 w-4",
                              id === selected?.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                        </CommandItem>
                      );
                    })}
                    {index !==
                      Object.entries(groupedGraphs ?? {}).length - 1 && (
                      <CommandSeparator className="mt-2" />
                    )}
                  </CommandGroup>
                );
              },
            )}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export const getGraphLayout = (page: React.ReactNode, { title }: any = {}) => {
  return (
    <GraphLayout>
      <PageHeader title={`${title} | Studio`}>{page}</PageHeader>
    </GraphLayout>
  );
};

export interface TitleLayoutProps {
  breadcrumbs?: React.ReactNode[];
  title: React.ReactNode;
  subtitle: string;
  items?: React.ReactNode;
  toolbar?: React.ReactNode;
  noPadding?: boolean;
  children?: React.ReactNode;
  scrollRef?: React.RefObject<HTMLDivElement>;
}

export const GraphPageLayout = ({
  title,
  breadcrumbs,
  items,
  toolbar,
  noPadding,
  children,
  scrollRef,
}: TitleLayoutProps) => {
  const router = useRouter();

  const breadcrumb = (
    <div className="flex flex-row items-center space-x-2 text-sm">
      <Link
        className="text-muted-foreground hover:text-current"
        href={`/${router.query.organizationSlug}`}
      >
        Home
      </Link>
      <span className="text-muted-foreground">/</span>
      <GraphSelect /> <span className="text-muted-foreground">/</span>
      {breadcrumbs?.map((b, i) => (
        <Fragment key={i}>
          <span className="text-muted-foreground hover:text-current">{b}</span>
          <span className="text-muted-foreground">/</span>
        </Fragment>
      ))}
      <h1 className="truncate whitespace-nowrap font-medium">{title}</h1>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh_-_104px)] flex-col lg:h-screen">
      <div className="flex w-full flex-wrap items-center justify-between gap-4 border-b bg-background py-4">
        <div
          className={cn(
            "flex w-full flex-col justify-between gap-y-4 px-4 md:w-auto lg:flex-row lg:items-center lg:px-6 xl:px-8",
          )}
        >
          {breadcrumb}
          {items}
        </div>
        {toolbar}
      </div>
      <div
        ref={scrollRef}
        className={cn(
          "scrollbar-custom h-auto flex-1 overflow-y-auto",
          noPadding !== true && "px-4 py-6 lg:px-8",
        )}
      >
        {children}
      </div>
    </div>
  );
};

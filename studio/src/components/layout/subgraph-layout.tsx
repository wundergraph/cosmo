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
import { ChartBarIcon } from "@heroicons/react/24/outline";
import {
  CaretSortIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  FileTextIcon,
  HomeIcon,
} from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getSubgraphByName,
  getSubgraphs,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  GetSubgraphByNameResponse,
  Subgraph,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useRouter } from "next/router";
import { Fragment, createContext, useMemo, useState } from "react";
import { PiChat, PiGraphLight } from "react-icons/pi";
import { EmptyState } from "../empty-state";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Link } from "../ui/link";
import { Loader } from "../ui/loader";
import { TitleLayoutProps } from "./graph-layout";
import { PageHeader } from "./head";
import { LayoutProps } from "./layout";
import { NavLink, SideNav } from "./sidenav";

export interface SubgraphContextProps {
  subgraph: GetSubgraphByNameResponse["graph"];
  members: GetSubgraphByNameResponse["members"];
  linkedSubgraph?: GetSubgraphByNameResponse["linkedSubgraph"];
}

export const SubgraphContext = createContext<SubgraphContextProps | undefined>(
  undefined,
);

export const SubgraphLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const namespace = router.query.namespace as string;
  const slug = router.query.subgraphSlug as string;

  const { data, isLoading, error, refetch } = useQuery(getSubgraphByName, {
    name: slug,
    namespace,
  });

  const subgraphContextData = useMemo(() => {
    if (!data) {
      return undefined;
    }
    return {
      subgraph: data.graph,
      members: data.members,
      linkedSubgraph: data.linkedSubgraph,
    };
  }, [data]);

  const links: NavLink[] = useMemo(() => {
    const basePath = `/${organizationSlug}/${namespace}/subgraph/${slug}`;

    return [
      {
        title: "Overview",
        href: basePath,
        icon: <HomeIcon className="h-4 w-4" />,
      },
      {
        title: "Schema",
        href: basePath + "/schema",
        icon: <FileTextIcon className="h-4 w-4" />,
      },
      {
        title: "Graphs",
        href: basePath + "/graphs",
        icon: <PiGraphLight className="h-4 w-4" />,
      },
      {
        title: "Analytics",
        href: basePath + "/analytics",
        matchExact: false,
        icon: <ChartBarIcon className="h-4 w-4" />,
      },
    ];
  }, [organizationSlug, namespace, slug]);

  let render: React.ReactNode;

  if (isLoading) {
    render = <Loader fullscreen />;
  } else if (error || data?.response?.code !== EnumStatusCode.OK) {
    render = (
      <div className="my-auto">
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve your subgraph"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </div>
    );
  } else {
    render = (
      <SubgraphContext.Provider value={subgraphContextData}>
        {children}
      </SubgraphContext.Provider>
    );
  }

  return (
    <div className="2xl:flex 2xl:flex-1 2xl:flex-col 2xl:items-center">
      <div className="flex min-h-screen w-full flex-1 flex-col bg-background font-sans antialiased lg:grid lg:lg:grid-cols-[auto_minmax(10px,1fr)] lg:divide-x">
        <SideNav links={links} />
        <main className="flex-1">{render}</main>
      </div>
    </div>
  );
};

export const SubgraphSelect = () => {
  const { data } = useQuery(getSubgraphs);

  const router = useRouter();
  const slug = router.query.subgraphSlug as string;
  const namespace = router.query.namespace as string;

  const [open, setOpen] = useState(false);

  const selected = data?.graphs.find(
    (g) => g.name === slug && g.namespace === namespace,
  );

  const groupedGraphs = data?.graphs.reduce<Record<string, Subgraph[]>>(
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
          <CommandInput placeholder="Search subgraph..." className="h-9" />
          <CommandEmpty>No subgraph found.</CommandEmpty>
          <div className="scrollbar-custom h-full overflow-y-auto">
            {Object.entries(groupedGraphs ?? {}).map(
              ([namespace, graphs], index) => {
                return (
                  <CommandGroup key={namespace} heading={namespace}>
                    {graphs.map((graph) => {
                      return (
                        <CommandItem
                          onSelect={() => {
                            router.push({
                              pathname: router.pathname,
                              query: {
                                ...router.query,
                                namespace: graph?.namespace,
                                subgraphSlug: graph?.name,
                              },
                            });
                            setOpen(false);
                          }}
                          className="pl-4"
                          key={graph.id}
                          value={`${namespace}.${graph.name}`}
                        >
                          {graph.name}
                          <CheckIcon
                            className={cn(
                              "ml-auto h-4 w-4",
                              graph.id === selected?.id
                                ? "opacity-100"
                                : "opacity-0",
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

export const getSubgraphLayout = (
  page: React.ReactNode,
  { title }: any = {},
) => {
  return (
    <SubgraphLayout>
      <PageHeader title={`${title} | Studio`}>{page}</PageHeader>
    </SubgraphLayout>
  );
};

export const SubgraphPageLayout = ({
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
      <SubgraphSelect /> <span className="text-muted-foreground">/</span>
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

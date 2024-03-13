import { cn } from "@/lib/utils";
import {
  ChartBarIcon,
  ServerStackIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  CheckCircledIcon,
  Component2Icon,
  FileTextIcon,
  HomeIcon,
  PlayIcon,
} from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getFederatedGraphByName,
  getFederatedGraphs,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  FederatedGraph,
  GetFederatedGraphByNameResponse,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useRouter } from "next/router";
import { Fragment, createContext, useMemo } from "react";
import {
  PiChat,
  PiCubeFocus,
  PiDevices,
  PiGitBranch,
  PiToggleRight,
} from "react-icons/pi";
import { EmptyState } from "../empty-state";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Loader } from "../ui/loader";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { PageHeader } from "./head";
import { LayoutProps } from "./layout";
import { NavLink, SideNav } from "./sidenav";
import { Link } from "../ui/link";

export interface GraphContextProps {
  graph: GetFederatedGraphByNameResponse["graph"];
  subgraphs: GetFederatedGraphByNameResponse["subgraphs"];
  graphRequestToken: string;
}

export const GraphContext = createContext<GraphContextProps | undefined>(
  undefined,
);

export const GraphLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const namespace = router.query.namespace as string;
  const slug = router.query.slug as string;

  const { data, isLoading, error, refetch } = useQuery(
    getFederatedGraphByName.useQuery({
      name: slug,
      namespace,
    }),
  );

  const graphContextData = useMemo(() => {
    if (!data) {
      return undefined;
    }
    return {
      graph: data.graph,
      subgraphs: data.subgraphs,
      graphRequestToken: data.graphRequestToken,
    };
  }, [data]);

  const links: NavLink[] = useMemo(() => {
    const basePath = `/${organizationSlug}/${namespace}/graph/${slug}`;

    return [
      {
        title: "Overview",
        href: basePath,
        icon: <HomeIcon className="h-4 w-4" />,
      },
      ...(graphContextData?.graph?.type === "federated"
        ? [
            {
              title: "Subgraphs",
              href: basePath + "/subgraphs",
              icon: <Component2Icon className="h-4 w-4" />,
            },
          ]
        : []),
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
      ...(graphContextData?.graph?.type === "federated"
        ? [
            {
              title: "Compositions",
              href: basePath + "/compositions",
              matchExact: false,
              icon: <PiCubeFocus className="h-4 w-4" />,
            },
          ]
        : []),
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
        title: "Discussions",
        href: basePath + "/discussions",
        matchExact: false,
        icon: <PiChat className="h-4 w-4" />,
      },
    ];
  }, [organizationSlug, namespace, slug, graphContextData?.graph?.type]);

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

export const GraphSelect = () => {
  const { data } = useQuery(getFederatedGraphs.useQuery());

  const router = useRouter();
  const slug = router.query.slug as string;
  const namespace = router.query.namespace as string;

  const selected = data?.graphs.find(
    (g) => g.name === slug && g.namespace === namespace,
  );

  const groupedGraphs = data?.graphs.reduce<Record<string, FederatedGraph[]>>(
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
    <Select
      value={selected?.id}
      onValueChange={(gID) => {
        const graph = data?.graphs.find((g) => g.id === gID);

        // don't show subgraphs and compositions page for monographs
        if (
          graph?.type === "graph" &&
          ["subgraphs", "compositions"].includes(router.pathname.split("/")[5])
        ) {
          router.push(
            `/${router.query.organizationSlug}/${graph.namespace}/graph/${graph.name}`,
          );
          return;
        }

        router.push({
          pathname: router.pathname,
          query: {
            ...router.query,
            namespace: graph?.namespace,
            slug: graph?.name,
          },
        });
      }}
    >
      <SelectTrigger
        value={selected?.id}
        className="flex h-8 w-auto gap-x-2 border-0 bg-transparent pl-3 pr-1 text-muted-foreground shadow-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:ring-0"
      >
        <SelectValue aria-label={selected?.name}>
          {selected?.name}{" "}
          <Badge variant="secondary">{selected?.namespace}</Badge>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-[200px]">
        {Object.entries(groupedGraphs ?? {}).map(
          ([namespace, graphs], index) => {
            return (
              <SelectGroup key={namespace}>
                <SelectLabel>{namespace}</SelectLabel>
                {graphs.map(({ id, name }) => {
                  return (
                    <SelectItem className="pl-4" key={id} value={id}>
                      {name}
                    </SelectItem>
                  );
                })}
                {index !== Object.entries(groupedGraphs ?? {}).length - 1 && (
                  <SelectSeparator />
                )}
              </SelectGroup>
            );
          },
        )}
      </SelectContent>
    </Select>
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

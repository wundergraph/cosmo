import {
  ChartBarIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  Component2Icon,
  HomeIcon,
  PlayIcon,
  FileTextIcon,
  CheckCircledIcon,
} from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/router";
import {
  getFederatedGraphByName,
  getFederatedGraphs,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { GetFederatedGraphByNameResponse } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { ReactNode, createContext, useContext, useMemo } from "react";
import { PiGitBranch } from "react-icons/pi";
import { EmptyState } from "../empty-state";
import { Button } from "../ui/button";
import { Loader } from "../ui/loader";
import { LayoutProps } from "./layout";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { UserContext } from "../app-provider";
import { SideNav, NavLink } from "./sidenav";
import { PageHeader } from "./head";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn } from "@/lib/utils";

const icons: { [key: string]: ReactNode } = {
  Overview: <HomeIcon />,
  Subgraphs: <Component2Icon />,
  Explorer: <PlayIcon />,
  Schema: <FileTextIcon />,
  Changelog: <PiGitBranch />,
  Checks: <CheckCircledIcon />,
  Analytics: <ChartBarIcon className="h-4 w-4" />,
};

export interface GraphContextProps {
  graph: GetFederatedGraphByNameResponse["graph"];
  subgraphs: GetFederatedGraphByNameResponse["subgraphs"];
  graphToken: string;
}

export const GraphContext = createContext<GraphContextProps | undefined>(
  undefined,
);

export const GraphLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const slug = router.query.slug as string;
  const user = useContext(UserContext);

  const { data, isLoading, error, refetch } = useQuery(
    getFederatedGraphByName.useQuery({
      name: slug,
    }),
  );

  const graphContextData = useMemo(() => {
    if (!data) {
      return undefined;
    }
    return {
      graph: data.graph,
      subgraphs: data.subgraphs,
      graphToken: data.graphToken,
    };
  }, [data]);

  const links: NavLink[] = useMemo(() => {
    const basePath = `/${organizationSlug}/graph/${slug}`;

    return [
      { title: "Overview", href: basePath, icon: <HomeIcon /> },
      {
        title: "Subgraphs",
        href: basePath + "/subgraphs",
        icon: <Component2Icon />,
      },
      {
        title: "Playground",
        href: basePath + "/playground",
        icon: <PlayIcon />,
      },
      {
        title: "Schema",
        href: basePath + "/schema",
        matchExact: false,
        icon: <FileTextIcon />,
      },
      {
        title: "Analytics",
        href: basePath + "/analytics",
        matchExact: false,
        icon: <ChartBarIcon className="h-4 w-4" />,
      },
      {
        title: "Changelog",
        href: basePath + "/changelog",
        icon: <PiGitBranch />,
      },
      {
        title: "Checks",
        href: basePath + "/checks",
        matchExact: false,
        icon: <CheckCircledIcon />,
      },
    ];
  }, [slug, organizationSlug]);

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
      <div className="flex min-h-screen w-full flex-1 flex-col bg-background font-sans antialiased lg:grid lg:grid-cols-[auto_1fr] lg:divide-x">
        <SideNav links={links} />
        <main className="flex-1 pt-4 lg:pt-0">{render}</main>
      </div>
    </div>
  );
};

export const GraphSelect = () => {
  const { data } = useQuery(getFederatedGraphs.useQuery());

  const router = useRouter();
  const slug = router.query.slug as string;
  const organizationSlug = router.query.organizationSlug as string;
  if (router.pathname.split("/")[2] !== "graph") return null;

  return (
    <Select
      value={slug}
      onValueChange={(gID) => router.push(`/${organizationSlug}/graph/${gID}`)}
    >
      <SelectTrigger
        value={slug}
        className="flex h-8 gap-x-2 border-0 bg-transparent pl-3 pr-1 text-muted-foreground shadow-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:ring-0"
      >
        <SelectValue aria-label={slug}>{slug}</SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-[200px]">
        {data?.graphs?.map(({ name }) => {
          return (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          );
        })}
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
}

export const GraphPageLayout = ({
  title,
  breadcrumbs,
  items,
  toolbar,
  noPadding,
  children,
}: TitleLayoutProps) => {
  const breadcrumb = (
    <div className="-ml-2 flex flex-row items-center space-x-2 text-sm">
      <GraphSelect /> <span className="text-muted-foreground">/</span>
      {breadcrumbs?.map((b) => (
        <>
          <span className="text-muted-foreground hover:text-current">{b}</span>
          <span className="text-muted-foreground">/</span>
        </>
      ))}
      <h1 className="whitespace-nowrap font-medium">{title}</h1>
    </div>
  );

  return (
    <div className="flex h-screen flex-col">
      <div className="bg-background">
        <div
          className={cn(
            "flex flex-col justify-between gap-y-4 px-4 pb-2 pt-4 lg:flex-row lg:items-center lg:px-8",
            {
              "border-b": !toolbar,
              "pb-4": !toolbar,
            },
          )}
        >
          {breadcrumb}
          {items}
        </div>
        {toolbar}
      </div>
      <div
        className={cn(
          "h-auto flex-1 overflow-y-auto",
          noPadding !== true && "px-4 py-6 lg:px-8",
        )}
      >
        {children}
      </div>
    </div>
  );
};

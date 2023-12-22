import { cn } from "@/lib/utils";
import {
  ExclamationTriangleIcon,
  FileTextIcon,
  HomeIcon,
} from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import {
  getSubgraphByName,
  getSubgraphs,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { Fragment, createContext, useMemo } from "react";
import { Loader } from "../ui/loader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { TitleLayoutProps } from "./graph-layout";
import { PageHeader } from "./head";
import { LayoutProps } from "./layout";
import { NavLink, SideNav } from "./sidenav";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { EmptyState } from "../empty-state";
import { Button } from "../ui/button";
import { GetSubgraphByNameResponse } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { PiGraphLight } from "react-icons/pi";

export interface SubgraphContextProps {
  subgraph: GetSubgraphByNameResponse["graph"];
  members: GetSubgraphByNameResponse["members"];
}

export const SubgraphContext = createContext<SubgraphContextProps | undefined>(
  undefined,
);

export const SubgraphLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const slug = router.query.subgraphSlug as string;

  const { data, isLoading, error, refetch } = useQuery(
    getSubgraphByName.useQuery({
      name: slug,
    }),
  );

  const subgraphContextData = useMemo(() => {
    if (!data) {
      return undefined;
    }
    return {
      subgraph: data.graph,
      members: data.members,
    };
  }, [data]);

  const links: NavLink[] = useMemo(() => {
    const basePath = `/${organizationSlug}/subgraph/${slug}`;

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
        title: "Federated Graphs",
        href: basePath + "/graphs",
        icon: <PiGraphLight className="h-4 w-4" />,
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
      <div className="flex min-h-screen w-full flex-1 flex-col bg-background font-sans antialiased lg:grid lg:grid-cols-[auto_1fr] lg:divide-x">
        <SideNav links={links} />
        <main className="flex-1">{render}</main>
      </div>
    </div>
  );
};

export const SubgraphSelect = () => {
  const { data } = useQuery(getSubgraphs.useQuery());

  const router = useRouter();
  const slug = router.query.subgraphSlug as string;

  return (
    <Select
      value={slug}
      onValueChange={(gID) =>
        router.push({
          pathname: router.pathname,
          query: {
            ...router.query,
            subgraphSlug: gID,
          },
        })
      }
    >
      <SelectTrigger
        value={slug}
        className="flex h-8 w-auto gap-x-2 border-0 bg-transparent pl-3 pr-1 text-muted-foreground shadow-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:ring-0"
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
  const breadcrumb = (
    <div className="-ml-2 flex flex-row items-center space-x-2 text-sm">
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
    <div className="flex flex-col lg:h-screen">
      <div className="bg-background">
        <div
          className={cn(
            "flex flex-col justify-between gap-y-4 px-4 pb-2 pt-4 lg:flex-row lg:items-center lg:px-6 xl:px-8",
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

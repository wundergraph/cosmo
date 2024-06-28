import { cn } from "@/lib/utils";
import { useQuery } from "@connectrpc/connect-query";
import { Component2Icon, ExclamationTriangleIcon, FileTextIcon } from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getFeatureFlagByName,
  getFeatureFlags,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  FeatureFlag,
  GetFeatureFlagByNameResponse,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useRouter } from "next/router";
import { Fragment, createContext, useMemo } from "react";
import { PiGraphLight } from "react-icons/pi";
import { EmptyState } from "../empty-state";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Link } from "../ui/link";
import { Loader } from "../ui/loader";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { TitleLayoutProps } from "./graph-layout";
import { PageHeader } from "./head";
import { LayoutProps } from "./layout";
import { NavLink, SideNav } from "./sidenav";

export interface FeatureFlagContextProps {
  featureFlag: GetFeatureFlagByNameResponse["featureFlag"];
}

export const FeatureFlagContext = createContext<
  FeatureFlagContextProps | undefined
>(undefined);

export const FeatureFlagLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const namespace = router.query.namespace as string;
  const slug = router.query.featureFlagSlug as string;

  const { data, isLoading, error, refetch } = useQuery(getFeatureFlagByName, {
    name: slug,
    namespace,
  });

  const featureFlagContextData = useMemo(() => {
    if (!data) {
      return undefined;
    }
    return {
      featureFlag: data.featureFlag,
    };
  }, [data]);

  const links: NavLink[] = useMemo(() => {
    const basePath = `/${organizationSlug}/${namespace}/feature-flag/${slug}`;

    return [
      {
        title: "Feature subgraphs",
        href: basePath + "/feature-subgraphs",
        icon: <Component2Icon className="h-4 w-4" />,
      },
      // {
      //   title: "Graphs",
      //   href: basePath + "/graphs",
      //   icon: <PiGraphLight className="h-4 w-4" />,
      // },
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
          title="Could not retrieve your feature flag"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </div>
    );
  } else {
    render = (
      <FeatureFlagContext.Provider value={featureFlagContextData}>
        {children}
      </FeatureFlagContext.Provider>
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

export const FeatureFlagSelect = () => {
  const router = useRouter();
  const namespace = router.query.namespace as string;
  const slug = router.query.featureFlagSlug as string;
  const { data } = useQuery(getFeatureFlags);

  const selected = data?.featureFlags.find(
    (g) => g.name === slug && g.namespace === namespace,
  );

  const groupedFeatureFlags = data?.featureFlags.reduce<
    Record<string, FeatureFlag[]>
  >((result, flag) => {
    const { namespace } = flag;

    if (!result[namespace]) {
      result[namespace] = [];
    }

    result[namespace].push(flag);

    return result;
  }, {});

  return (
    <Select
      value={selected?.id}
      onValueChange={(gID) => {
        const flag = data?.featureFlags.find((g) => g.id === gID);
        router.push({
          pathname: router.pathname,
          query: {
            ...router.query,
            namespace: flag?.namespace,
            featureFlagSlug: flag?.name,
          },
        });
      }}
    >
      <SelectTrigger
        value={slug}
        className="flex h-8 w-auto gap-x-2 border-0 bg-transparent pl-3 pr-1 text-muted-foreground shadow-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:ring-0"
      >
        <SelectValue aria-label={selected?.name}>
          {selected?.name}{" "}
          <Badge variant="secondary">{selected?.namespace}</Badge>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-[200px]">
        {Object.entries(groupedFeatureFlags ?? {}).map(
          ([namespace, graphs]) => {
            return (
              <SelectGroup key={namespace}>
                <SelectLabel>{namespace}</SelectLabel>
                {graphs.map(({ id, name }) => {
                  return (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            );
          },
        )}
      </SelectContent>
    </Select>
  );
};

export const getFeatureFlagLayout = (
  page: React.ReactNode,
  { title }: any = {},
) => {
  return (
    <FeatureFlagLayout>
      <PageHeader title={`${title} | Studio`}>{page}</PageHeader>
    </FeatureFlagLayout>
  );
};

export const FeatureFlagPageLayout = ({
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
      <FeatureFlagSelect /> <span className="text-muted-foreground">/</span>
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

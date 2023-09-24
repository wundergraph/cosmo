import { EmptyState } from "@/components/empty-state";
import { getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CLI } from "@/components/ui/cli";
import { Loader } from "@/components/ui/loader";
import { docsBaseURL } from "@/lib/constants";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import {
  DotFilledIcon,
  ExclamationTriangleIcon,
  MinusIcon,
  PlusIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getFederatedGraphChangelog } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  FederatedGraphChangelog,
  FederatedGraphChangelogOutput,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { noCase } from "change-case";
import { format } from "date-fns";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

interface StructuredChangelog {
  changeType: string;
  parentName: string;
  childName: string;
}

const structureChangelogs = (
  changes: FederatedGraphChangelog[]
): StructuredChangelog[] => {
  let parentNodeName = "";
  const structuredChangelogs: StructuredChangelog[] = [];

  for (const change of changes) {
    const splitPath = change.path.split(".");
    if (splitPath.length === 1) {
      structuredChangelogs.push({
        changeType: change.changeType,
        parentName: splitPath[0],
        childName: "",
      });
    } else if (splitPath[0] === parentNodeName) {
      structuredChangelogs.push({
        changeType: change.changeType,
        parentName: splitPath[0],
        childName: splitPath[1],
      });
    } else {
      structuredChangelogs.push({
        changeType: "",
        parentName: splitPath[0],
        childName: "",
      });
      structuredChangelogs.push({
        changeType: change.changeType,
        parentName: splitPath[0],
        childName: splitPath[1],
      });
    }
    parentNodeName = splitPath[0];
  }
  return structuredChangelogs;
};

const getDiffCount = (changelogs: FederatedGraphChangelog[]) => {
  let addCount = 0;
  let minusCount = 0;
  changelogs.forEach((log) => {
    if (log.changeType.includes("REMOVED")) {
      minusCount += 1;
    } else if (log.changeType.includes("ADDED")) {
      addCount += 1;
    } else if (log.changeType.includes("CHANGED")) {
      addCount += 1;
      minusCount += 1;
    }
  });
  return {
    addCount,
    minusCount,
  };
};

const Changes = ({ changes }: { changes: FederatedGraphChangelog[] }) => {
  let parentNodeName = "";
  let shouldHavePadding = false;

  const getIcon = (code: string) => {
    if (code.includes("REMOVED")) {
      return <MinusIcon className="text-destructive" width={25} />;
    }
    if (code.includes("ADDED")) {
      return <PlusIcon className="text-success" width={25} />;
    }
    if (code.includes("CHANGED")) {
      return <UpdateIcon className="text-muted-foreground" width={25} />;
    }
    return (
      <DotFilledIcon className="text-muted-foreground" width={25} height={25} />
    );
  };

  const structuredChangelogs = structureChangelogs(changes);

  return (
    <div className="flex flex-col gap-y-2 pt-4 lg:pt-0">
      {structuredChangelogs.map(
        ({ changeType, parentName, childName }, index) => {
          if (parentName !== parentNodeName) {
            parentNodeName = parentName;
            shouldHavePadding = false;
          } else {
            shouldHavePadding = true;
          }

          return (
            <div
              className={cn("flex items-center gap-x-2", {
                "ml-4": shouldHavePadding,
              })}
              key={index}
            >
              {getIcon(changeType)}
              <Badge variant="secondary" className="text-sm">
                {childName || parentName}
              </Badge>
              <span className="hidden text-xs italic text-muted-foreground md:block">
                {noCase(changeType)}
              </span>
            </div>
          );
        }
      )}
    </div>
  );
};

const ChangelogPage: NextPageWithLayout = () => {
  const router = useRouter();

  const limit = 10;
  const [items, setItems] = useState<FederatedGraphChangelogOutput[]>([]);
  const [offset, setOffset] = useState(0);

  const { data, isLoading, error, refetch } = useQuery({
    ...getFederatedGraphChangelog.useQuery({
      name: router.query.slug as string,
      pagination: {
        limit,
        offset,
      },
    }),
    enabled: false,
  });

  useEffect(() => {
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 5 &&
        !isLoading &&
        data?.hasNextPage
      ) {
        setOffset((prevOffset) => prevOffset + limit);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isLoading, refetch, data?.hasNextPage]);

  useEffect(() => {
    if (!data) return;
    setItems((prev) => [...prev, ...data.federatedGraphChangelogOutput]);
  }, [data]);

  useEffect(() => {
    refetch();
  }, [refetch, offset]);

  if (items.length === 0 && isLoading) return <Loader fullscreen />;

  if (
    items.length === 0 &&
    (!data || error || data.response?.code !== EnumStatusCode.OK)
  )
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

  if (items.length === 0)
    return (
      <EmptyState
        icon={<CommandLineIcon />}
        title="Publish schema using the CLI"
        description={
          <>
            No changelogs found. Use the CLI tool to publish.{" "}
            <a
              target="_blank"
              rel="noreferrer"
              href={docsBaseURL + "/cli/subgraphs/publish"}
              className="text-primary"
            >
              Learn more.
            </a>
          </>
        }
        actions={
          <CLI
            command={`npx wgc subgraph publish users --schema users.graphql`}
          />
        }
      />
    );

  return (
    <div className="relative h-full w-full">
      <div className="top-30 fixed z-20 hidden rounded border bg-card px-4 py-2 lg:right-6 lg:block 2xl:left-3/4 2xl:right-[unset]">
        <h2 className="text-sm font-semibold">Jump to log</h2>
        <hr className="my-2" />
        <div className="scrollbar-custom flex max-h-96 flex-col overflow-y-auto text-xs">
          {items.map(({ schemaVersionId: id, createdAt }) => {
            return (
              <button
                onClick={() => {
                  const element = document.getElementById(id)!;
                  const offset = 112;

                  const elementPosition = element.getBoundingClientRect().top;
                  const scrollPosition =
                    window.scrollY + elementPosition - offset;

                  window.scrollTo({ top: scrollPosition });
                }}
                key={createdAt}
                className="text-left text-muted-foreground hover:text-foreground hover:underline"
              >
                {format(new Date(createdAt), "dd MMM yyyy HH:mm")}
              </button>
            );
          })}
        </div>
      </div>
      <div className="absolute left-40 ml-1.5 hidden h-full w-px border-r lg:block" />
      <ol className="relative w-full">
        {items.map(({ schemaVersionId: id, createdAt, changelogs }) => {
          return (
            <li
              id={id}
              key={id}
              className="flex w-full flex-col gap-y-8 py-10 first:pt-2"
            >
              <div className="absolute left-40 mt-2 hidden h-3 w-3 rounded-full border bg-accent lg:block"></div>
              <div className="flex w-full flex-col items-start gap-x-16 gap-y-4 lg:flex-row">
                <div className="flex flex-col items-end gap-y-1">
                  <time className="mt-2 text-sm font-bold leading-none">
                    {format(new Date(createdAt), "dd MMM yyyy HH:mm")}
                  </time>
                  <p className="text-sm font-bold text-muted-foreground">
                    {id.slice(0, 6)}
                  </p>
                  <div>
                    <div className="flex items-center gap-x-1">
                      <PlusIcon className="text-success" />
                      <p className="text-sm text-success">
                        {getDiffCount(changelogs).addCount}
                      </p>
                    </div>
                    <div className="flex items-center gap-x-1">
                      <MinusIcon className="text-destructive" />
                      <p className="text-sm text-destructive">
                        {getDiffCount(changelogs).minusCount}
                      </p>
                    </div>
                  </div>
                </div>
                <hr className="w-full lg:hidden" />
                <Changes changes={changelogs} />
              </div>
            </li>
          );
        })}
      </ol>
      {!data?.hasNextPage && (
        <p className="mx-auto py-12 text-sm font-bold leading-none">
          End of changelog
        </p>
      )}
    </div>
  );
};

ChangelogPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Studio | Changelog">
      <TitleLayout
        title="Changelog"
        subtitle="Keep track of changes made to your federated graph"
      >
        {page}
      </TitleLayout>
    </PageHeader>
  );

export default ChangelogPage;

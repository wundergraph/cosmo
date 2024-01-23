import { EmptyState } from "@/components/empty-state";
import {
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import {
  DotFilledIcon,
  ExclamationTriangleIcon,
  InfoCircledIcon,
  MinusIcon,
  PlusIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getChangelogBySchemaVersion } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { FederatedGraphChangelog } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { noCase } from "change-case";
import Link from "next/link";
import { useRouter } from "next/router";

interface StructuredChangelog {
  changeType: string;
  parentName: string;
  childName: string;
}

const structureChangelogs = (
  changes: FederatedGraphChangelog[],
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
        },
      )}
    </div>
  );
};

const SchemaVersionChangelogPage: NextPageWithLayout = () => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const namespace = router.query.namespace as string;
  const slug = router.query.slug as string;
  const id = router.query.schemaVersionId as string;

  const { data, isLoading, error, refetch } = useQuery(
    getChangelogBySchemaVersion.useQuery({
      schemaVersionId: id,
    }),
  );

  if (isLoading) return <Loader fullscreen />;

  return (
    <GraphPageLayout
      title={id}
      subtitle=""
      breadcrumbs={[
        <Link
          key={0}
          href={`/${organizationSlug}/${namespace}/graph/${slug}/changelog`}
        >
          Changelog
        </Link>,
      ]}
      noPadding
    >
      {!data ||
      !data.changelog ||
      error ||
      data.response?.code !== EnumStatusCode.OK ? (
        <EmptyState
          icon={<ExclamationTriangleIcon className="h-8 w-8" />}
          title="Could not retrieve changelog"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      ) : data.changelog.changelogs.length === 0 ? (
        <EmptyState
          icon={<InfoCircledIcon className="h-8 w-8" />}
          title="No changes found for this schema version"
          actions={<Button onClick={() => router.back()}>Go back</Button>}
        />
      ) : (
        <div className="p-8">
          <ol>
            <li
              id={id}
              key={id}
              className="flex w-full flex-col gap-y-8 py-10 first:pt-2"
            >
              <div className="absolute left-40 mt-2 hidden h-3 w-3 rounded-full border bg-accent lg:block"></div>
              <div className="flex w-full flex-col items-start gap-x-16 gap-y-4 lg:flex-row">
                <div className="flex flex-col items-end gap-y-1">
                  <time className="mt-2 text-sm font-bold leading-none">
                    {formatDateTime(new Date(data.changelog.createdAt))}
                  </time>
                  <p className="text-sm font-bold text-muted-foreground">
                    {id.slice(0, 6)}
                  </p>
                  <div>
                    <div className="flex items-center gap-x-1">
                      <PlusIcon className="text-success" />
                      <p className="text-sm text-success">
                        {getDiffCount(data.changelog.changelogs).addCount}
                      </p>
                    </div>
                    <div className="flex items-center gap-x-1">
                      <MinusIcon className="text-destructive" />
                      <p className="text-sm text-destructive">
                        {getDiffCount(data.changelog.changelogs).minusCount}
                      </p>
                    </div>
                  </div>
                </div>
                <hr className="w-full lg:hidden" />
                <Changes changes={data.changelog.changelogs} />
              </div>
            </li>
          </ol>
        </div>
      )}
    </GraphPageLayout>
  );
};

SchemaVersionChangelogPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Changelog",
  });

export default SchemaVersionChangelogPage;

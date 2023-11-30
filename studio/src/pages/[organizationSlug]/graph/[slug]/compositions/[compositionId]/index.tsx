import { getCheckIcon } from "@/components/check-badge-icon";
import { CodeViewer, CodeViewerActions } from "@/components/code-viewer";
import { EmptyState } from "@/components/empty-state";
import {
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader } from "@/components/ui/loader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { CubeIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getCompositionDetails } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { PiBracketsCurlyBold, PiGitBranch } from "react-icons/pi";

const ProposedSchema = ({
  sdl,
  subgraphName,
}: {
  sdl: string;
  subgraphName: string;
}) => {
  return (
    <Dialog>
      <DialogTrigger className="text-primary">View</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Schema</DialogTitle>
        </DialogHeader>
        <div className="scrollbar-custom h-[70vh] overflow-auto rounded border">
          <CodeViewer code={sdl} disableLinking />
        </div>
        <CodeViewerActions code={sdl} subgraphName={subgraphName} />
      </DialogContent>
    </Dialog>
  );
};

const CompositionOverviewPage: NextPageWithLayout = () => {
  const router = useRouter();

  const organizationSlug = router.query.organizationSlug as string;
  const slug = router.query.slug as string;
  const id = router.query.compositionId as string;
  const tab = router.query.tab as string;

  const { data, isLoading, error, refetch } = useQuery(
    getCompositionDetails.useQuery({
      compositionId: id,
    }),
  );

  if (isLoading) return <Loader fullscreen />;

  if (
    error ||
    !data ||
    data?.response?.code !== EnumStatusCode.OK ||
    !data.composition
  )
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve composition details."
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  const { composition, changeCounts, compositionSubgraphs } = data;
  const {
    isComposable,
    isCurrentDeployed,
    createdAt,
    createdBy,
    schemaVersionId,
  } = composition;

  const setTab = (tab: string) => {
    const query: Record<string, any> = {
      ...router.query,
      tab,
    };

    if (tab === "changes") {
      delete query.tab;
    }

    router.push({
      pathname: router.pathname,
      query,
    });
  };

  return (
    <GraphPageLayout
      title={id}
      subtitle="A quick glance of the details for this check run"
      breadcrumbs={[
        <Link key={0} href={`/${organizationSlug}/graph/${slug}/compositions`}>
          Compositions
        </Link>,
      ]}
      noPadding
    >
      <div className="flex h-full flex-col">
        <div className="flex-shrink-0 overflow-x-auto border-b scrollbar-thin">
          <dl className="flex w-full flex-row gap-y-2 space-x-4 px-4 py-4 text-sm lg:px-8">
            <div
              className={cn("flex-start flex flex-1 flex-col gap-1", {
                "max-w-[300px]": isCurrentDeployed,
                "max-w-[200px]": !isCurrentDeployed,
              })}
            >
              <dt className="text-sm text-muted-foreground">Status</dt>
              <dd>
                <div className="flex items-center gap-x-2">
                  <Badge variant="outline" className="gap-2 py-1.5">
                    {getCheckIcon(isComposable)} <span>Composes</span>
                  </Badge>
                  {isCurrentDeployed && (
                    <Badge variant="outline" className="gap-2 py-1.5">
                      <div className="h-2 w-2 rounded-full bg-success" />
                      <span>Current</span>
                    </Badge>
                  )}
                </div>
              </dd>
            </div>

            {changeCounts && (
              <div className="flex-start flex max-w-[250px] flex-1 flex-col gap-2 ">
                <dt className="text-sm text-muted-foreground">Changes</dt>
                <dd className="flex gap-x-2">
                  <div className="flex items-center">
                    <p className="text-sm">
                      <span className="font-bold text-success">
                        +{changeCounts.additions}
                      </span>{" "}
                      additions
                    </p>
                  </div>
                  <div className="flex items-center">
                    <p className="text-sm">
                      <span className="font-bold text-destructive">
                        -{changeCounts.deletions}
                      </span>{" "}
                      deletions
                    </p>
                  </div>
                </dd>
              </div>
            )}

            <div className="flex-start flex max-w-[250px] flex-1 flex-col gap-2 ">
              <dt className="text-sm text-muted-foreground">Changelog</dt>
              <dd>
                <Link
                  key={id}
                  href={`/${organizationSlug}/graph/${slug}/changelog/${schemaVersionId}`}
                >
                  <div className="flex items-center gap-x-1">
                    <PiGitBranch />
                    {schemaVersionId.split("-")[0]}
                  </div>
                </Link>
              </dd>
              <dd className="whitespace-nowrap text-sm"></dd>
            </div>

            <div className="flex-start flex max-w-[250px] flex-1 flex-col gap-2 ">
              <dt className="text-sm text-muted-foreground">Triggered By</dt>
              <dd className="whitespace-nowrap text-sm">{createdBy || "-"}</dd>
            </div>

            <div className="flex-start flex max-w-[200px] flex-1 flex-col gap-2 ">
              <dt className="text-sm text-muted-foreground">Executed</dt>
              <dd className="whitespace-nowrap text-sm">
                <Tooltip>
                  <TooltipTrigger>
                    {formatDistanceToNow(new Date(createdAt), {
                      addSuffix: true,
                    })}
                  </TooltipTrigger>
                  <TooltipContent>
                    {formatDateTime(new Date(createdAt))}
                  </TooltipContent>
                </Tooltip>
              </dd>
            </div>
          </dl>
        </div>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <dl className="grid flex-shrink-0 grid-cols-3 space-y-6 overflow-hidden border-b px-4 py-4 lg:block lg:min-h-full lg:w-[240px] lg:space-y-8 lg:overflow-auto lg:border-b-0 lg:border-r lg:px-6 xl:w-[260px]">
            {compositionSubgraphs.length > 0 && (
              <div className="flex-start flex flex-col gap-2">
                <dt className="text-sm text-muted-foreground">
                  Composition Inputs
                </dt>
                <dd className="flex flex-col gap-2">
                  {compositionSubgraphs.map((cs) => {
                    return (
                      <div className="flex flex-col gap-y-1" key={cs.id}>
                        <div className="flex items-center gap-x-1.5 text-sm ">
                          <CubeIcon className="h-4 w-4" />
                          <span>{cs.name}</span>
                        </div>
                        <span className="pl-6 text-xs">
                          {cs.schemaVersionId.split("-")[0]}
                        </span>
                      </div>
                    );
                  })}
                </dd>
              </div>
            )}
          </dl>
          <div className="h-full flex-1">
            {/* <CodeViewerActions
                      code={sdl}
                      subgraphName={data.check.subgraphName}
                      size="sm"
                      variant="outline"
                    /> */}
          </div>
          <div className="scrollbar-custom h-full w-full">
            {/* <CodeViewer code={sdl} disableLinking /> */}
          </div>
        </div>
      </div>
    </GraphPageLayout>
  );
};

CompositionOverviewPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Composition Summary",
  });

export default CompositionOverviewPage;

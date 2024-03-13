import { getCheckIcon } from "@/components/check-badge-icon";
import { EmptyState } from "@/components/empty-state";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { SDLViewerActions } from "@/components/schema/sdl-viewer";
import { SDLViewerMonaco } from "@/components/schema/sdl-viewer-monaco";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Component2Icon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getCompositionDetails,
  getSdlBySchemaVersion,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext } from "react";
import { PiGitBranch } from "react-icons/pi";
import { MdNearbyError, MdVerifiedUser } from "react-icons/md";

const CompositionDetailsPage: NextPageWithLayout = () => {
  const router = useRouter();

  const organizationSlug = router.query.organizationSlug as string;
  const namespace = router.query.namespace as string;
  const slug = router.query.slug as string;
  const id = router.query.compositionId as string;
  const tab = router.query.tab as string;
  const subgraph = router.query.subgraph as string;

  const graphData = useContext(GraphContext);

  const { data, isLoading, error, refetch } = useQuery(
    getCompositionDetails.useQuery({
      compositionId: id,
    }),
  );

  const compositionSubgraph = data?.compositionSubgraphs.find(
    (s) => s.name === subgraph,
  );

  const activeSubgraph = compositionSubgraph || data?.compositionSubgraphs?.[0];
  const activeSubgraphName = activeSubgraph?.name;
  const activeSubgraphVersionId = activeSubgraph?.schemaVersionId;

  const { data: sdlData, isLoading: fetchingSdl } = useQuery({
    ...getSdlBySchemaVersion.useQuery({
      targetId:
        tab === "input" ? activeSubgraph?.targetId : graphData?.graph?.targetId,
      schemaVersionId:
        tab === "input"
          ? activeSubgraphVersionId
          : data?.composition?.schemaVersionId,
    }),
    enabled:
      tab === "input"
        ? !!activeSubgraphName && !!activeSubgraphVersionId
        : data?.composition && data.composition.schemaVersionId
        ? true
        : false,
  });

  if (isLoading || fetchingSdl) return <Loader fullscreen />;

  if (
    error ||
    !data ||
    data?.response?.code !== EnumStatusCode.OK ||
    !data.composition
  )
    return (
      <GraphPageLayout
        title={id}
        subtitle="A quick glance of the details for this composition"
        breadcrumbs={[
          <Link
            key={0}
            href={`/${organizationSlug}/${namespace}/graph/${slug}/compositions`}
          >
            Compositions
          </Link>,
        ]}
        noPadding
      >
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve composition details."
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </GraphPageLayout>
    );

  const { composition, changeCounts, compositionSubgraphs } = data;
  const {
    isComposable,
    isLatestValid,
    createdAt,
    createdBy,
    schemaVersionId,
    compositionErrors,
    routerConfigSignature,
    admissionError,
    deploymentError,
  } = composition;

  const subgraphs =
    compositionSubgraphs.map((each) => {
      return {
        name: each.name,
        versionId: each.schemaVersionId,
      };
    }) ?? [];

  return (
    <GraphPageLayout
      title={id}
      subtitle="A quick glance of the details for this composition"
      breadcrumbs={[
        <Link
          key={0}
          href={`/${organizationSlug}/${namespace}/graph/${slug}/compositions`}
        >
          Compositions
        </Link>,
      ]}
      noPadding
    >
      <div className="flex h-full flex-col">
        <div className="flex-shrink-0 overflow-x-auto border-b scrollbar-thin">
          <dl className="flex w-full flex-row gap-x-4 gap-y-2 space-x-4 px-4 py-4 text-sm lg:px-8">
            <div
              className={cn("flex-start flex flex-col gap-1", {
                "max-w-[300px]": isLatestValid,
                "max-w-[200px]": !isLatestValid,
              })}
            >
              <dt className="text-sm text-muted-foreground">Status</dt>
              <dd>
                <div className="flex items-center gap-x-2">
                  <Badge variant="outline" className="gap-2 py-1.5">
                    {getCheckIcon(isComposable)} <span>Composes</span>
                  </Badge>
                  {isLatestValid && (
                    <Badge
                      variant="outline"
                      className="gap-2 bg-success py-1.5"
                    >
                      <div className="h-2 w-2 rounded-full bg-white" />
                      <span>Latest</span>
                    </Badge>
                  )}
                </div>
              </dd>
            </div>

            {changeCounts && (
              <div className="flex-start flex max-w-[250px] flex-1 flex-col gap-2">
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
                {changeCounts &&
                changeCounts.additions === 0 &&
                changeCounts.deletions === 0 ? (
                  <span className="pl-0.5">No changes</span>
                ) : (
                  <Link
                    key={id}
                    href={`/${organizationSlug}/${namespace}/graph/${slug}/changelog/${schemaVersionId}`}
                  >
                    <div className="flex items-center gap-x-1">
                      <PiGitBranch />
                      {schemaVersionId.split("-")[0]}
                    </div>
                  </Link>
                )}
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
          <dl className="grid w-full flex-shrink-0 grid-cols-3 space-y-6 overflow-hidden border-b px-4 py-4 lg:block lg:h-full lg:w-[200px] lg:space-y-8 lg:overflow-auto lg:border-b-0 lg:border-r lg:px-6 xl:w-[220px]">
            {routerConfigSignature || admissionError ? (
              <div className="flex-start col-span-full flex flex-1 flex-col gap-2">
                <dt className="text-sm text-muted-foreground">Admission</dt>
                <dd className="flex flex-col space-y-3">
                  <div className="flex items-center gap-2">
                    {admissionError ? (
                      <>
                        <div>
                          <MdNearbyError className="h-4 w-4 text-red-500" />
                        </div>
                        <span className="text-sm">Failed</span>
                      </>
                    ) : routerConfigSignature ? (
                      <>
                        <div>
                          <MdVerifiedUser className="h-4 w-4 text-amber-500" />
                        </div>
                        <span className="text-sm">Verified</span>
                      </>
                    ) : null}
                  </div>
                  <div className="text-xs text-slate-400">
                    {admissionError ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="space-y-1">
                            <div className="font-bold">Details</div>
                            <div className="break-words">
                              {admissionError || "No details available"}
                            </div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>{admissionError}</TooltipContent>
                      </Tooltip>
                    ) : routerConfigSignature ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="space-y-1">
                            <div className="font-bold">Signature</div>
                            <div className="truncate">
                              {routerConfigSignature}
                            </div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>{routerConfigSignature}</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                </dd>
              </div>
            ) : null}
            {compositionSubgraphs.length > 0 && (
              <div className="flex-start col-span-full flex flex-1 flex-col gap-2">
                <dt className="text-sm text-muted-foreground">
                  Composition Inputs
                </dt>
                <dd className="flex flex-col gap-2">
                  {compositionSubgraphs.length === 0 ? (
                    <span className="text-sm">No subgraphs stored.</span>
                  ) : (
                    compositionSubgraphs.map((cs) => {
                      return (
                        <div className="flex flex-col gap-y-1" key={cs.id}>
                          <div className="flex items-center gap-x-1.5 text-sm">
                            <CubeIcon className="h-4 w-4" />
                            <span>{cs.name}</span>
                          </div>
                          <span className="pl-6 text-xs">
                            {cs.schemaVersionId.split("-")[0]}
                          </span>
                        </div>
                      );
                    })
                  )}
                </dd>
              </div>
            )}
          </dl>
          <div className="h-full flex-1">
            <Tabs
              value={tab ?? "output"}
              className="flex h-full min-h-0 flex-col"
            >
              <div className="flex flex-row px-4 py-4 lg:px-6">
                <TabsList>
                  <TabsTrigger value="output" asChild>
                    <Link href={{ query: { ...router.query, tab: "output" } }}>
                      Composed Schema
                    </Link>
                  </TabsTrigger>
                  <TabsTrigger value="input" asChild>
                    <Link href={{ query: { ...router.query, tab: "input" } }}>
                      Input Schemas
                    </Link>
                  </TabsTrigger>
                </TabsList>
              </div>
              <div className="flex min-h-0 flex-1">
                <TabsContent value="output" className="w-full">
                  {compositionErrors && compositionErrors.length ? (
                    <div className="px-6">
                      <Alert variant="destructive">
                        <AlertTitle>Composition Errors</AlertTitle>
                        <AlertDescription>
                          <pre className="">
                            {compositionErrors.length > 0
                              ? compositionErrors
                              : "No composition errors"}
                          </pre>
                        </AlertDescription>
                      </Alert>
                    </div>
                  ) : (
                    sdlData &&
                    sdlData.sdl !== "" && (
                      <div className="relative flex h-full min-h-[60vh] flex-col">
                        <div className="-top-[60px] right-8 w-max px-5 md:absolute md:w-auto md:px-0">
                          <SDLViewerActions sdl={sdlData.sdl} size="icon" />
                        </div>
                        <SDLViewerMonaco schema={sdlData.sdl} />
                      </div>
                    )
                  )}
                </TabsContent>

                <TabsContent value="input" className="relative w-full flex-1">
                  {compositionSubgraphs.length === 0 ? (
                    <EmptyState
                      icon={<ExclamationTriangleIcon />}
                      title="Subgraph schemas are not stored. "
                    />
                  ) : (
                    sdlData &&
                    sdlData.sdl !== "" && (
                      <div className="relative flex h-full min-h-[60vh] flex-col">
                        <div className="-top-[60px] right-8 px-5 md:absolute md:px-0">
                          <div className="flex gap-x-2">
                            <Select
                              value={activeSubgraphName}
                              onValueChange={(subgraph) =>
                                router.push({
                                  pathname: router.pathname,
                                  query: {
                                    ...router.query,
                                    subgraph,
                                  },
                                })
                              }
                            >
                              <SelectTrigger
                                value={activeSubgraphName}
                                className="w-full md:ml-auto md:w-[200px]"
                              >
                                <SelectValue aria-label={activeSubgraphName}>
                                  {activeSubgraphName}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                                    <Component2Icon className="h-3 w-3" />{" "}
                                    Subgraphs
                                  </SelectLabel>
                                  {subgraphs.map(({ name, versionId }) => {
                                    return (
                                      <SelectItem key={name} value={name}>
                                        <div>
                                          <p>{name}</p>
                                          <p className="text-xs">
                                            {versionId.split("-")[0]}
                                          </p>
                                        </div>
                                      </SelectItem>
                                    );
                                  })}
                                </SelectGroup>
                              </SelectContent>
                            </Select>

                            <SDLViewerActions sdl={sdlData.sdl} size="icon" />
                          </div>
                        </div>
                        <SDLViewerMonaco schema={sdlData.sdl} />
                      </div>
                    )
                  )}
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>
      </div>
    </GraphPageLayout>
  );
};

CompositionDetailsPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Composition Summary",
  });

export default CompositionDetailsPage;

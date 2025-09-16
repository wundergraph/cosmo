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
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { useQuery } from "@connectrpc/connect-query";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { FaPlug } from "react-icons/fa6";
import {
  BoxIcon,
  Component2Icon,
  MinusIcon,
  PlusIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getCompositionDetails,
  getSdlBySchemaVersion,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  ChangeCounts,
  FeatureFlagComposition,
  GraphComposition,
  GraphCompositionSubgraph,
  SubgraphType,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { sentenceCase } from "change-case";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext, useState } from "react";
import { MdNearbyError, MdVerifiedUser } from "react-icons/md";
import { PiGitBranch } from "react-icons/pi";
import { RxComponentInstance } from "react-icons/rx";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

export const FeatureFlagCompositionsTable = ({
  ffCompositions,
}: {
  ffCompositions: FeatureFlagComposition[];
}) => {
  const router = useRouter();
  return (
    <TableWrapper>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Id</TableHead>
            <TableHead>Feature Flag Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-center">Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ffCompositions.length !== 0 ? (
            ffCompositions.map(
              ({ id, isComposable, createdAt, featureFlagName }) => {
                const path = `${
                  router.asPath.split("?")[0]
                }/feature-flag/${id}`;
                return (
                  <TableRow
                    key={id}
                    className="group cursor-pointer hover:bg-secondary/30"
                    onClick={() => router.push(path)}
                  >
                    <TableCell>
                      <div className="flex flex-col items-start">
                        <Link
                          href={path}
                          className="font-medium text-foreground"
                        >
                          {id}
                        </Link>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(createdAt), {
                                addSuffix: true,
                              })}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {formatDateTime(new Date(createdAt))}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                    <TableCell>{featureFlagName}</TableCell>
                    <TableCell className="w-[128px] md:w-auto">
                      <div className="flex w-max flex-col gap-2 md:flex-row md:items-center">
                        <Badge variant="outline" className="gap-2 py-1.5">
                          {getCheckIcon(isComposable)} <span>Composes</span>
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="table-action"
                      >
                        <Link href={path}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              },
            )
          ) : (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableWrapper>
  );
};

const SubgraphDetails = ({
  subgraphs,
}: {
  subgraphs: GraphCompositionSubgraph[];
}) => {
  const getIcon = (subgraphId: string, isFeatureSubgraph: boolean) => {
    const isChanged = subgraphs.find((cs) => cs.id === subgraphId);
    if (isChanged) {
      switch (isChanged.changeType) {
        case "added":
          return <PlusIcon className="h-3 w-3 flex-shrink-0" />;
        case "removed":
          return <MinusIcon className="h-3 w-3 flex-shrink-0" />;
        case "updated":
          return <UpdateIcon className="h-3 w-3 flex-shrink-0" />;
      }
    }

    if (isFeatureSubgraph) {
      return <RxComponentInstance className="h-4 w-4 flex-shrink-0" />;
    }

    return <BoxIcon className="h-3 w-3 flex-shrink-0" />;
  };

  return subgraphs
    .sort((a, b) => {
      const sortOrder: { [key: string]: number } = {
        added: 1,
        updated: 2,
        removed: 3,
        unchanged: 4,
      };

      if (a.changeType === b.changeType) {
        return a.name.localeCompare(b.name);
      }

      return sortOrder[a.changeType] - sortOrder[b.changeType];
    })
    .map((subgraph) => {
      return (
        <div
          className={cn("flex flex-col gap-y-1", {
            "text-success":
              subgraph.changeType === "added" ||
              subgraph.changeType === "updated",
            "text-destructive": subgraph.changeType === "removed",
          })}
          key={subgraph.id}
        >
          <div className="flex items-start gap-x-1.5 text-sm">
            <div className="mt-1">
              {getIcon(subgraph.id, subgraph.isFeatureSubgraph)}
            </div>
            <span>{subgraph.name}</span>
            {subgraph.subgraphType === SubgraphType.GRPC_PLUGIN && (
              <div className="mt-[2px]">
                <Tooltip>
                  <TooltipTrigger>
                    <FaPlug className="h-3 w-3 flex-shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <span>Plugin</span>
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
          <span className="pl-5 text-xs">
            {subgraph.schemaVersionId.split("-")[0]}
          </span>
        </div>
      );
    });
};

export const CompositionDetails = ({
  composition,
  changeCounts,
  compositionSubgraphs,
  featureFlagCompositions,
  isFeatureFlagComposition = false,
}: {
  composition: GraphComposition;
  changeCounts: ChangeCounts | undefined;
  compositionSubgraphs: GraphCompositionSubgraph[];
  featureFlagCompositions: FeatureFlagComposition[] | undefined;
  isFeatureFlagComposition: boolean;
}) => {
  const router = useRouter();
  const organizationSlug = useCurrentOrganization()?.slug;
  const { namespace: { name: namespace } } = useWorkspace();
  const slug = router.query.slug as string;
  const id = router.query.compositionId as string;
  const tab = router.query.tab as string;
  const subgraph = router.query.subgraph as string;

  const graphData = useContext(GraphContext);
  const [schemaType, setSchemaType] = useState<"router" | "client">("client");

  const compositionSubgraph = compositionSubgraphs.find(
    (s) => s.name === subgraph,
  );

  const activeSubgraph = compositionSubgraph || compositionSubgraphs?.[0];
  const activeSubgraphName = activeSubgraph?.name;
  const activeSubgraphVersionId = activeSubgraph?.schemaVersionId;

  const { data: sdlData, isLoading: fetchingSdl } = useQuery(
    getSdlBySchemaVersion,
    {
      targetId:
        tab === "input" ? activeSubgraph?.targetId : graphData?.graph?.targetId,
      schemaVersionId:
        tab === "input"
          ? activeSubgraphVersionId
          : composition?.schemaVersionId,
    },
    {
      enabled:
        tab === "input"
          ? !!activeSubgraphName && !!activeSubgraphVersionId
          : composition && composition.schemaVersionId
          ? true
          : false,
    },
  );

  if (fetchingSdl) return <Loader fullscreen />;

  const {
    isComposable,
    isLatestValid,
    createdAt,
    createdBy,
    schemaVersionId,
    compositionErrors,
    compositionWarnings,
    routerConfigSignature,
    admissionError,
  } = composition;

  const subgraphs =
    compositionSubgraphs.map((each) => {
      return {
        name: each.name,
        versionId: each.schemaVersionId,
        changeType: each.changeType,
      };
    }) ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 overflow-x-auto border-b scrollbar-thin">
        <dl className="flex w-full flex-row gap-x-4 gap-y-2 space-x-4 px-4 py-4 text-sm lg:px-8">
          <div
            className={cn("flex-start flex flex-col gap-1", {
              "max-w-[300px]": isLatestValid || isFeatureFlagComposition,
              "max-w-[200px]": !isLatestValid,
              "w-[300px]": isFeatureFlagComposition,
            })}
          >
            <dt className="text-sm text-muted-foreground">Status</dt>
            <dd>
              <div className="flex items-center gap-x-2">
                <Badge variant="outline" className="gap-2 py-1.5">
                  {getCheckIcon(isComposable)} <span>Composes</span>
                </Badge>
                {isLatestValid && (
                  <Badge variant="outline" className="gap-2 bg-success py-1.5">
                    <div className="h-2 w-2 rounded-full bg-white" />
                    <span>Ready to fetch</span>
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

          {!isFeatureFlagComposition && (
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
                    className="text-primary"
                  >
                    <div className="flex items-center gap-x-1">
                      <PiGitBranch />
                      {schemaVersionId.slice(0, 6)}
                    </div>
                  </Link>
                )}
              </dd>
              <dd className="whitespace-nowrap text-sm"></dd>
            </div>
          )}

          <div className="flex-start flex max-w-[250px] flex-1 flex-col gap-2 ">
            <dt className="text-sm text-muted-foreground">Triggered By</dt>
            <dd className="whitespace-nowrap text-sm">{createdBy}</dd>
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
        <dl className="scrollbar-custom grid w-full flex-shrink-0 grid-cols-3 space-y-6 overflow-hidden border-b px-4 py-4 lg:block lg:h-full lg:w-[200px] lg:space-y-8 lg:overflow-auto lg:border-b-0 lg:border-r lg:px-6 xl:w-[220px]">
          {routerConfigSignature || admissionError ? (
            <div className="flex-start col-span-full flex flex-1 flex-col gap-4">
              <dt className="text-sm text-muted-foreground">Admission</dt>
              <dd className="flex flex-col space-y-3">
                <div className="flex items-center gap-2">
                  {admissionError ? (
                    <>
                      <div>
                        <MdNearbyError className="h-4 w-4 text-destructive" />
                      </div>
                      <span className="text-sm">Failed</span>
                    </>
                  ) : routerConfigSignature ? (
                    <>
                      <div>
                        <MdVerifiedUser className="h-4 w-4 text-amber-500" />
                      </div>
                      <span className="text-sm">Validated & Signed</span>
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

          <div className="flex-start col-span-full flex flex-1 flex-col gap-2">
            <dt className="text-sm text-muted-foreground">Subgraphs</dt>
            <dd className="mt-2 flex flex-col gap-2">
              {compositionSubgraphs.length === 0 ? (
                <span className="text-sm">No subgraphs stored.</span>
              ) : (
                <SubgraphDetails
                  subgraphs={compositionSubgraphs.filter(
                    (cs) => !cs.isFeatureSubgraph,
                  )}
                />
              )}
            </dd>
            {compositionSubgraphs.some((cs) => cs.isFeatureSubgraph) && (
              <>
                <dt className="text-sm text-muted-foreground">
                  Feature Subgraphs
                </dt>
                <dd className="mt-2 flex flex-col gap-2">
                  <SubgraphDetails
                    subgraphs={compositionSubgraphs.filter(
                      (cs) => cs.isFeatureSubgraph,
                    )}
                  />
                </dd>
              </>
            )}
          </div>
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
                    Output Schema
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="input" asChild>
                  <Link href={{ query: { ...router.query, tab: "input" } }}>
                    Input Schemas
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="warnings" asChild>
                  <Link href={{ query: { ...router.query, tab: "warnings" } }}>
                    Composition Warnings
                  </Link>
                </TabsTrigger>
                {featureFlagCompositions && (
                  <TabsTrigger
                    value="ffCompostions"
                    asChild
                    className="flex items-center gap-x-2"
                  >
                    <Link
                      href={{
                        query: { ...router.query, tab: "ffCompostions" },
                      }}
                    >
                      Feature Flag Compositions{" "}
                      {featureFlagCompositions.length ? (
                        <Badge
                          variant="muted"
                          className="bg-white px-1.5 text-current dark:bg-gray-900/60"
                        >
                          {featureFlagCompositions.length}
                        </Badge>
                      ) : null}
                    </Link>
                  </TabsTrigger>
                )}
              </TabsList>
            </div>
            <div className="flex min-h-0 flex-1">
              <TabsContent value="output" className="w-full">
                {compositionErrors && compositionErrors.length ? (
                  <div className="px-6">
                    <Alert variant="destructive">
                      <AlertTitle>Composition Errors</AlertTitle>
                      <AlertDescription>
                        <pre className="whitespace-pre-wrap">
                          {compositionErrors.length > 0
                            ? compositionErrors
                            : "No composition errors"}
                        </pre>
                      </AlertDescription>
                    </Alert>
                  </div>
                ) : (
                  sdlData &&
                  sdlData.sdl !== "full" && (
                    <div className="relative flex h-full min-h-[60vh] flex-col">
                      <div className="-top-[60px] right-8 flex w-max items-center gap-x-4 px-5 md:absolute md:w-auto md:px-0">
                        <Select
                          onValueChange={(v: typeof schemaType) =>
                            setSchemaType(v)
                          }
                          value={schemaType}
                        >
                          <SelectTrigger>
                            <SelectValue>
                              {sentenceCase(schemaType)}
                              Schema
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="client">
                              Client Schema
                              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                                The schema available to the clients and through
                                introspection
                              </p>
                            </SelectItem>
                            <Separator />
                            <SelectItem value="router">
                              Router Schema
                              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                                The full schema used by the router to plan your
                                operations
                              </p>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <SDLViewerActions
                          sdl={
                            schemaType === "router"
                              ? sdlData.sdl
                              : sdlData.clientSchema || sdlData.sdl
                          }
                          size="icon"
                          targetName={graphData?.graph?.name}
                        />
                      </div>
                      <SDLViewerMonaco
                        schema={
                          schemaType === "router"
                            ? sdlData.sdl
                            : sdlData.clientSchema || sdlData.sdl
                        }
                      />
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
                          {graphData?.graph?.supportsFederation && (
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
                                  {subgraphs.map(
                                    ({ name, versionId, changeType }) => {
                                      return (
                                        <SelectItem key={name} value={name}>
                                          <div
                                            className={cn({
                                              "text-destructive":
                                                changeType === "removed",
                                            })}
                                          >
                                            <p>{name}</p>
                                            <p className="text-xs">
                                              {versionId.split("-")[0]}
                                            </p>
                                          </div>
                                        </SelectItem>
                                      );
                                    },
                                  )}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          )}
                          <SDLViewerActions
                            sdl={sdlData.sdl}
                            size="icon"
                            targetName={activeSubgraphName}
                          />
                        </div>
                      </div>
                      <SDLViewerMonaco schema={sdlData.sdl} />
                    </div>
                  )
                )}
              </TabsContent>
              <TabsContent value="warnings" className="relative w-full flex-1">
                {compositionWarnings && compositionWarnings.length ? (
                  <div className="px-6">
                    <Alert variant="warn">
                      <AlertTitle>Composition Warnings</AlertTitle>
                      <AlertDescription>
                        <pre className="whitespace-pre-wrap">
                          {compositionWarnings.split("Warning: ").join("\n")}
                        </pre>
                      </AlertDescription>
                    </Alert>
                  </div>
                ) : (
                  <EmptyState
                    icon={<CheckCircleIcon className="text-success" />}
                    title="No composition warnings found."
                  />
                )}
              </TabsContent>
              {featureFlagCompositions && (
                <TabsContent value="ffCompostions" className="w-full">
                  <div className="px-6">
                    <FeatureFlagCompositionsTable
                      ffCompositions={featureFlagCompositions}
                    />
                  </div>
                </TabsContent>
              )}
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

const CompositionDetailsPage: NextPageWithLayout = () => {
  const router = useRouter();

  const organizationSlug = useCurrentOrganization()?.slug;
  const { namespace: { name: namespace } } = useWorkspace();
  const slug = router.query.slug as string;
  const id = router.query.compositionId as string;

  const { data, isLoading, error, refetch } = useQuery(getCompositionDetails, {
    compositionId: id,
    namespace,
  });

  if (isLoading) return <Loader fullscreen />;

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

  const {
    composition,
    changeCounts,
    compositionSubgraphs,
    featureFlagCompositions,
  } = data;

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
      <CompositionDetails
        composition={composition}
        changeCounts={changeCounts}
        compositionSubgraphs={compositionSubgraphs}
        featureFlagCompositions={featureFlagCompositions}
        isFeatureFlagComposition={false}
      />
    </GraphPageLayout>
  );
};

CompositionDetailsPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Composition Summary",
  });

export default CompositionDetailsPage;

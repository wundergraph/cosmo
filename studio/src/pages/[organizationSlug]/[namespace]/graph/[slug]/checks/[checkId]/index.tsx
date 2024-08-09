import { FieldUsageSheet } from "@/components/analytics/field-usage";
import {
  getCheckBadge,
  getCheckIcon,
  isCheckSuccessful,
} from "@/components/check-badge-icon";
import { ChangesTable } from "@/components/checks/changes-table";
import { LintIssuesTable } from "@/components/checks/lint-issues-table";
import { CheckOperations } from "@/components/checks/operations";
import { CodeViewerActions } from "@/components/code-viewer";
import { EmptyState } from "@/components/empty-state";
import { InfoTooltip } from "@/components/info-tooltip";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import {
  DecorationCollection,
  SDLViewerMonaco,
} from "@/components/schema/sdl-viewer-monaco";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { Loader } from "@/components/ui/loader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { useSessionStorage } from "@/hooks/use-session-storage";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import {
  ArrowLeftIcon,
  CheckCircledIcon,
  CrossCircledIcon,
  CubeIcon,
  ReaderIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import { useQuery, useMutation } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  forceCheckSuccess,
  getCheckSummary,
  getFederatedGraphs,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  GetCheckSummaryResponse,
  LintIssue,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow, subDays } from "date-fns";
import { useRouter } from "next/router";
import React, { useContext, useMemo } from "react";
import { PiBracketsCurlyBold, PiGraphLight } from "react-icons/pi";

const ForceSuccess: React.FC<{ onSubmit: () => void }> = (props) => {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          className="flex-shrink-0 space-x-2"
          variant="secondary"
          size="sm"
        >
          <CheckCircledIcon /> <span>Force Success</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will forcefully mark the check as
            successful.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={props.onSubmit}>
            Force Success
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const CheckOverviewPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();

  const organizationSlug = router.query.organizationSlug as string;
  const namespace = router.query.namespace as string;
  const slug = router.query.slug as string;
  const id = router.query.checkId as string;

  const { data, isLoading, error, refetch } = useQuery(
    getCheckSummary,
    {
      checkId: id,
      graphName: graphContext?.graph?.name,
      namespace,
    },
    {
      enabled: !!graphContext?.graph?.name,
      refetchOnWindowFocus: false,
    },
  );

  const [checksRoute] = useSessionStorage<string | undefined>(
    "checks.route",
    undefined,
  );

  let content: React.ReactNode;

  if (isLoading) {
    content = <Loader fullscreen />;
  } else if (error || data?.response?.code !== EnumStatusCode.OK) {
    content = (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve check"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={
          <div className="flex items-center space-x-2">
            <Button variant="outline">
              <Link
                href={`/${organizationSlug}/${namespace}/graph/${slug}/checks`}
                className="flex items-center"
              >
                <ArrowLeftIcon className="mr-2 h-4 w-4" />
                All checks
              </Link>
            </Button>
            <Button onClick={() => refetch()} variant="outline">
              Retry
            </Button>
          </div>
        }
      />
    );
  } else if (data && graphContext) {
    content = <CheckDetails data={data} refetch={refetch} />;
  }

  return (
    <GraphPageLayout
      title={id}
      subtitle="A quick glance of the details for this check run"
      breadcrumbs={[
        <Link
          key="checks"
          href={
            checksRoute ||
            `/${organizationSlug}/${namespace}/graph/${slug}/checks`
          }
        >
          Checks
        </Link>,
      ]}
      noPadding
    >
      {content}
    </GraphPageLayout>
  );
};

const getDecorationCollection = (
  lintIssues: LintIssue[],
): DecorationCollection[] => {
  const decorationCollection: DecorationCollection[] = [];

  for (const l of lintIssues) {
    if (!l.issueLocation) continue;
    decorationCollection.push({
      range: {
        startLineNumber: l.issueLocation.line,
        endLineNumber: l.issueLocation.endLine || l.issueLocation.line,
        startColumn: l.issueLocation.column,
        endColumn: l.issueLocation.endColumn || l.issueLocation.column,
      },
      options: {
        hoverMessage: {
          value: `${l.message}. (Rule: ${
            l.lintRuleType ? l.lintRuleType : ""
          })`,
        },
        inlineClassName:
          "underline decoration-red-500 decoration-wavy cursor-pointer z-50",
        isWholeLine: l.issueLocation.endLine === undefined,
      },
    });
  }

  return decorationCollection;
};

const CheckDetails = ({
  data,
  refetch,
}: {
  data: GetCheckSummaryResponse;
  refetch: () => void;
}) => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();
  const { toast } = useToast();

  const organizationSlug = router.query.organizationSlug as string;
  const namespace = router.query.namespace as string;
  const slug = router.query.slug as string;
  const id = router.query.checkId as string;
  const tab = router.query.tab as string;
  const hash = router.asPath.split("#")?.[1];

  const { data: allGraphsData } = useQuery(getFederatedGraphs);

  const { mutate: forceSuccess } = useMutation(forceCheckSuccess, {
    onSuccess: (data) => {
      if (data.response?.code === EnumStatusCode.OK) {
        toast({ description: "Marked check as successful", duration: 3000 });
        refetch();
      } else {
        toast({
          description: `Could not marked check as successful. ${data.response?.details}`,
          duration: 3000,
        });
      }
    },
    onError: () => {
      toast({
        description: "Could not marked check as successful. Please try again",
        duration: 3000,
      });
    },
  });

  const changeCounts = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const log of data?.changes ?? []) {
      if (log.changeType.includes("REMOVED")) {
        deletions += 1;
      } else if (log.changeType.includes("ADDED")) {
        additions += 1;
      } else if (log.changeType.includes("CHANGED")) {
        additions += 1;
        deletions += 1;
      }
    }

    return {
      additions,
      deletions,
    };
  }, [data?.changes]);

  if (!data.check || !graphContext) {
    return null;
  }

  const sdl = data.proposedSubgraphSchemaSDL ?? "";

  const isSuccessful = isCheckSuccessful(
    data.check.isComposable,
    data.check.isBreaking,
    data.check.hasClientTraffic,
    data.check.hasLintErrors,
  );

  const currentAffectedGraph = data.affectedGraphs.find(
    (graph) => graph.id === graphContext.graph?.id,
  );

  const ghDetails = data.check.ghDetails;

  const reason = !data.check.isComposable
    ? "Composition errors were found"
    : data.check.isBreaking && data.check.hasClientTraffic
    ? "Operations were affected by breaking changes"
    : data.check.isBreaking && !data.check.hasClientTraffic
    ? "No operations were affected by breaking changes"
    : "All tasks were successful";

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
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 overflow-x-auto border-b scrollbar-thin">
        <dl className="flex w-full flex-row gap-y-2 space-x-4 px-4 py-4 text-sm lg:px-8">
          <div className="flex-start flex max-w-[100px] flex-1 flex-col gap-1">
            <dt className="text-sm text-muted-foreground">Status</dt>
            <dd>{getCheckBadge(isSuccessful, data.check.isForcedSuccess)}</dd>
          </div>

          <div className="flex-start flex-1 flex-col gap-1 lg:flex">
            <dt className="text-sm text-muted-foreground">Reason</dt>
            <dd className="whitespace-nowrap">{reason}</dd>
          </div>

          <div className="flex-start flex max-w-[200px] flex-1 flex-col gap-1">
            <dt className="text-sm text-muted-foreground">Action</dt>
            <dd className="whitespace-nowrap">
              {data.check.isDeleted ? "Delete subgraph" : "Update schema"}
            </dd>
          </div>

          {graphContext.graph?.supportsFederation && (
            <div className="flex-start flex max-w-[200px] flex-1 flex-col gap-1 ">
              <dt className="text-sm text-muted-foreground">Subgraph</dt>
              <dd>
                <Link
                  key={id}
                  href={`/${organizationSlug}/${namespace}/graph/${slug}/schema/sdl?subgraph=${data.check.subgraphName}`}
                >
                  <div className="flex items-center gap-x-1">
                    <CubeIcon />
                    {data.check.subgraphName}
                  </div>
                </Link>
              </dd>
            </div>
          )}

          <div className="flex-start flex max-w-[200px] flex-1 flex-col gap-1 ">
            <dt className="text-sm text-muted-foreground">Executed</dt>
            <dd className="whitespace-nowrap text-sm">
              <Tooltip>
                <TooltipTrigger>
                  {formatDistanceToNow(new Date(data.check.timestamp), {
                    addSuffix: true,
                  })}
                </TooltipTrigger>
                <TooltipContent>
                  {formatDateTime(new Date(data.check.timestamp))}
                </TooltipContent>
              </Tooltip>
            </dd>
          </div>
        </dl>
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <dl className="flex flex-col flex-shrink-0 space-y-6 overflow-hidden border-b px-4 py-4 lg:block lg:min-h-full lg:w-[240px] lg:space-y-8 lg:overflow-auto lg:border-b-0 lg:border-r lg:px-6 xl:w-[260px] xl:px-8">
          <div className="col-span-3 flex flex-col">
            <dt className="mb-2 text-sm text-muted-foreground">Tasks</dt>
            <dd className="flex flex-wrap flex-row gap-2 lg:flex lg:flex-col">
              <Badge
                variant="outline"
                className="flex items-center space-x-1.5 py-2"
              >
                {getCheckIcon(data.check.isComposable)}
                <span className="flex-1 truncate">Composition</span>
                <InfoTooltip>
                  Describes if the proposed schema can be composed with all
                  other subgraphs in the federated graph.
                </InfoTooltip>
              </Badge>

              <Badge
                variant="outline"
                className="flex items-center space-x-1.5  py-2"
              >
                {getCheckIcon(!data.check.isBreaking)}
                <span className="flex-1 truncate">Breaking Changes</span>
                <InfoTooltip>
                  Describes if the proposed schema is free of changes that break
                  existing client operations.
                </InfoTooltip>
              </Badge>

              <Badge
                variant="outline"
                className="flex items-center space-x-1.5  py-2"
              >
                {getCheckIcon(!data.check.hasClientTraffic)}
                <span className="flex-1 truncate">Operations</span>
                <InfoTooltip>
                  Describes if the proposed schema affects any client operations
                  based on real usage data.
                </InfoTooltip>
              </Badge>

              <Badge
                variant="outline"
                className="flex items-center space-x-1.5  py-2"
              >
                {getCheckIcon(!data.check.hasLintErrors)}
                <span className="flex-1 truncate">Lint Errors</span>
                <InfoTooltip>
                  Describes if the proposed schema contains linting errors.
                </InfoTooltip>
              </Badge>
            </dd>
          </div>

          {data.affectedGraphs.length > 0 && (
            <div className="flex-start flex flex-col gap-1">
              <dt className="text-sm text-muted-foreground">Affected Graphs</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {data.affectedGraphs.map((ag) => {
                  const graph = allGraphsData?.graphs.find(
                    (g) => g.id === ag.id,
                  );

                  if (!graph) return null;

                  return (
                    <Link
                      key={ag.id}
                      href={`/${organizationSlug}/${graph.namespace}/graph/${graph.name}`}
                      className="flex items-center gap-x-1 text-sm"
                    >
                      <PiGraphLight />
                      {graph.name}
                    </Link>
                  );
                })}
              </dd>
            </div>
          )}

          {changeCounts && (
            <div className="flex flex-col">
              <dt className="mb-2 text-sm text-muted-foreground">Changes</dt>
              <dd className="text-sm">
                {data.changes.length ? (
                  <>
                    <div className="flex items-center">
                      <p>
                        <span className="font-bold text-success">
                          +{changeCounts.additions}
                        </span>{" "}
                        additions
                      </p>
                    </div>
                    <div className="flex items-center">
                      <p>
                        <span className="font-bold text-destructive">
                          -{changeCounts.deletions}
                        </span>{" "}
                        deletions
                      </p>
                    </div>
                  </>
                ) : (
                  <p>No changes</p>
                )}
              </dd>
            </div>
          )}
          {currentAffectedGraph && (
            <div className="flex flex-col">
              <dt className="mb-2 text-sm text-muted-foreground">
                Timeframe checked
              </dt>
              <dd className="flex items-center gap-x-2 text-sm">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="truncate whitespace-nowrap">
                      {formatDate(
                        subDays(
                          new Date(data.check.timestamp),
                          currentAffectedGraph.trafficCheckDays,
                        ),
                        {
                          dateStyle: "short",
                        },
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {formatDateTime(
                      subDays(
                        new Date(data.check.timestamp),
                        currentAffectedGraph.trafficCheckDays,
                      ),
                    )}
                  </TooltipContent>
                </Tooltip>
                -
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="truncate whitespace-nowrap">
                      {formatDate(new Date(data.check.timestamp), {
                        dateStyle: "short",
                      })}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {formatDateTime(new Date(data.check.timestamp))}
                  </TooltipContent>
                </Tooltip>
              </dd>
            </div>
          )}
          {ghDetails && (
            <div className="flex flex-col">
              <dt className="mb-2 text-sm text-muted-foreground">
                GitHub Commit
              </dt>
              <dd className="flex items-center gap-x-2 text-sm">
                <Link
                  href={`https://github.com/${ghDetails.ownerSlug}/${ghDetails.repositorySlug}/commit/${ghDetails.commitSha}`}
                  className="inline-flex items-center gap-2 text-xs"
                  aria-label="View on GitHub"
                  target="_blank"
                >
                  {ghDetails.commitSha.substring(0, 7)}
                </Link>
              </dd>
            </div>
          )}
        </dl>
        <div className="h-full flex-1">
          <Tabs
            value={tab ?? "changes"}
            className="flex h-full min-h-0 flex-col"
          >
            <div className="flex flex-row px-4 py-4 lg:px-6">
              <TabsList className="overflow-x-auto scrollbar-none justify-start">
                <TabsTrigger
                  value="changes"
                  className="flex items-center gap-x-2"
                  asChild
                >
                  <Link href={{ query: { ...router.query, tab: "changes" } }}>
                    <UpdateIcon />
                    Changes{" "}
                    {data.changes.length ? (
                      <Badge
                        variant="muted"
                        className="bg-white px-1.5 text-current dark:bg-gray-900/60"
                      >
                        {data.changes.length}
                      </Badge>
                    ) : null}
                  </Link>
                </TabsTrigger>
                <TabsTrigger
                  value="operations"
                  className="flex items-center gap-x-2"
                  asChild
                >
                  <Link
                    href={{ query: { ...router.query, tab: "operations" } }}
                  >
                    <PiBracketsCurlyBold className="flex-shrink-0" />
                    Operations
                  </Link>
                </TabsTrigger>
                <TabsTrigger
                  value="lintIssues"
                  className="flex items-center gap-x-2"
                  asChild
                >
                  <Link
                    href={{ query: { ...router.query, tab: "lintIssues" } }}
                  >
                    <PiBracketsCurlyBold className="flex-shrink-0" />
                    Lint Issues
                    {data.lintIssues.length ? (
                      <Badge
                        variant="muted"
                        className="bg-white px-1.5 text-current dark:bg-gray-900/60"
                      >
                        {data.lintIssues.length}
                      </Badge>
                    ) : null}
                  </Link>
                </TabsTrigger>
                {!data.check.isDeleted && (
                  <TabsTrigger
                    value="schema"
                    onClick={() => setTab("schema")}
                    className="flex items-center gap-x-2"
                    asChild
                  >
                    <Link href={{ query: { ...router.query, tab: "schema" } }}>
                      <ReaderIcon />
                      Schema
                    </Link>
                  </TabsTrigger>
                )}
              </TabsList>
            </div>
            <div className="flex min-h-0 flex-1">
              <TabsContent
                value="changes"
                className="w-full space-y-4 px-4 lg:px-6"
              >
                {data.compositionErrors?.length ? (
                  <Alert variant="destructive">
                    <AlertTitle>Composition Errors</AlertTitle>
                    <AlertDescription>
                      <pre className="">
                        {data.compositionErrors.length > 0
                          ? data.compositionErrors.join("\n")
                          : "No composition errors"}
                      </pre>
                    </AlertDescription>
                  </Alert>
                ) : null}
                {data.check.isBreaking &&
                data.check.isComposable &&
                data.check.hasClientTraffic ? (
                  <Alert variant="default">
                    {data.check.isForcedSuccess ? (
                      <CheckCircledIcon className="h-4 w-4" />
                    ) : (
                      <CrossCircledIcon className="h-4 w-4" />
                    )}

                    <AlertTitle>
                      {data.check.isForcedSuccess
                        ? "Forced Success"
                        : "Checks Failed"}
                    </AlertTitle>
                    <AlertDescription>
                      {data.check.isForcedSuccess ? (
                        <>This check was manually marked as successful.</>
                      ) : (
                        <>
                          The proposed schema changes can be composed, but there
                          are breaking changes affecting client operations.
                          <br />
                          You can manually override the state of this check to
                          accept the changes.
                        </>
                      )}
                    </AlertDescription>
                    {data.check.isForcedSuccess ? (
                      <div className="mt-2 flex space-x-2">
                        <ForceSuccess
                          onSubmit={() =>
                            forceSuccess({
                              checkId: id,
                              graphName: slug,
                              namespace,
                            })
                          }
                        />
                      </div>
                    ) : null}
                  </Alert>
                ) : null}

                {isSuccessful ? (
                  <Alert variant="default">
                    <CheckCircledIcon className="h-4 w-4" />

                    <AlertTitle>Schema check passed</AlertTitle>
                    <AlertDescription>
                      {data.changes.length
                        ? "This schema change didn't affect any operations from existing client traffic."
                        : "There were no schema changes detected."}
                    </AlertDescription>
                    {data.check.isForcedSuccess ? (
                      <div className="mt-2 flex space-x-2">
                        <ForceSuccess
                          onSubmit={() =>
                            forceSuccess({
                              checkId: id,
                              graphName: slug,
                            })
                          }
                        />
                      </div>
                    ) : null}
                  </Alert>
                ) : null}

                {data.changes.length ? (
                  <ChangesTable
                    changes={data.changes}
                    caption={`${data.changes.length} changes found`}
                    trafficCheckDays={data.trafficCheckDays}
                    createdAt={data.check.timestamp}
                  />
                ) : null}

                <FieldUsageSheet />
              </TabsContent>
              <TabsContent value="operations" className="w-full">
                <CheckOperations />
              </TabsContent>
              <TabsContent
                value="lintIssues"
                className="w-full space-y-4 px-4 lg:px-6"
              >
                <LintIssuesTable
                  lintIssues={data.lintIssues}
                  caption={`${data.lintIssues.length} issues found`}
                />
              </TabsContent>
              <TabsContent value="schema" className="relative w-full flex-1">
                <div className="right-8 top-5 px-4 md:absolute md:px-0">
                  <CodeViewerActions
                    code={sdl}
                    subgraphName={data.check.subgraphName}
                    size="sm"
                    variant="outline"
                  />
                </div>
                <div className="scrollbar-custom h-full w-full min-h-[300px] overflow-auto">
                  <SDLViewerMonaco
                    schema={sdl}
                    disablePrettier
                    decorationCollections={getDecorationCollection(
                      data.lintIssues,
                    )}
                    line={hash ? Number(hash.slice(1)) : undefined}
                  />
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

CheckOverviewPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Check Summary",
  });

export default CheckOverviewPage;

import { FieldUsageSheet } from "@/components/analytics/field-usage";
import {
  getCheckBadge,
  getCheckIcon,
  isCheckSuccessful,
} from "@/components/check-badge-icon";
import { ChangesTable } from "@/components/checks/changes-table";
import { GraphPruningIssuesTable } from "@/components/checks/graph-pruning-issues-table";
import { LintIssuesTable } from "@/components/checks/lint-issues-table";
import { CheckOperations } from "@/components/checks/operations";
import { ProposalMatchesTable } from "@/components/checks/proposal-matches-table";
import { EmptyState } from "@/components/empty-state";
import { InfoTooltip } from "@/components/info-tooltip";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { SDLViewerActions } from "@/components/schema/sdl-viewer";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui/table";
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
import { useToast } from "@/components/ui/use-toast";
import { useFeature } from "@/hooks/use-feature";
import { useSessionStorage } from "@/hooks/use-session-storage";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  NoSymbolIcon,
} from "@heroicons/react/24/outline";
import {
  ArrowLeftIcon,
  CheckCircledIcon,
  ClipboardIcon,
  Component2Icon,
  CrossCircledIcon,
  CubeIcon,
  LightningBoltIcon,
  ReaderIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  forceCheckSuccess,
  getCheckSummary,
  getProposedSchemaOfCheckedSubgraph,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  GetCheckSummaryResponse,
  GraphPruningIssue,
  LintIssue,
  LintSeverity,
  SchemaCheck_CheckedSubgraph,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow, subDays } from "date-fns";
import { useRouter } from "next/router";
import React, { useContext, useMemo } from "react";
import { HiOutlineScissors } from "react-icons/hi2";
import { PiBracketsCurlyBold, PiCubeFocus } from "react-icons/pi";
import { SiLintcode } from "react-icons/si";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

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

const ProposedSchemas = ({
  checkId,
  sdl,
  checkedSubgraphs,
  lintIssues,
  graphPruningIssues,
}: {
  checkId: string;
  sdl?: string;
  checkedSubgraphs: SchemaCheck_CheckedSubgraph[];
  lintIssues: LintIssue[];
  graphPruningIssues: GraphPruningIssue[];
}) => {
  const router = useRouter();
  const subgraph = router.query.subgraph as string;
  const hash = router.asPath.split("#")?.[1];

  const checkedSubgraph = checkedSubgraphs.find(
    (s) => s.subgraphName === subgraph,
  );

  const activeSubgraph = checkedSubgraph || checkedSubgraphs?.[0];
  const activeSubgraphName = activeSubgraph?.subgraphName;

  const { data: sdlData, isLoading: fetchingSdl } = useQuery(
    getProposedSchemaOfCheckedSubgraph,
    {
      checkId,
      checkedSubgraphId: activeSubgraph?.id,
    },
    {
      enabled: !!activeSubgraph && !!activeSubgraphName,
    },
  );

  if (fetchingSdl) return <Loader fullscreen />;

  return (
    <div className="scrollbar-custom h-full min-h-[300px] w-full overflow-auto">
      <SDLViewerMonaco
        schema={
          (checkedSubgraphs.length > 0 ? sdlData?.proposedSchema : sdl) || ""
        }
        disablePrettier
        decorationCollections={getDecorationCollection(
          lintIssues,
          graphPruningIssues,
        )}
        line={hash ? Number(hash.slice(1)) : undefined}
      />

      <div className="right-8 top-0 px-4 md:absolute md:px-0">
        <div className="flex gap-x-2">
          {checkedSubgraphs.length > 0 && (
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
                className={cn("w-full bg-background md:ml-auto md:w-[200px]", {
                  "text-destructive": activeSubgraph?.isDeleted,
                  "text-success": activeSubgraph?.isNew,
                })}
              >
                <SelectValue aria-label={activeSubgraphName}>
                  {activeSubgraphName}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                    <Component2Icon className="h-3 w-3" /> Subgraphs
                  </SelectLabel>
                  {checkedSubgraphs.map(
                    ({ subgraphName: name, id, isDeleted, isNew }) => {
                      return (
                        <SelectItem key={name} value={name}>
                          <div
                            className={cn({
                              "text-destructive": isDeleted,
                              "text-success": isNew,
                            })}
                          >
                            <p>{name}</p>
                            <p className="text-xs">{id.split("-")[0]}</p>
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
            sdl={
              (checkedSubgraphs.length > 0 ? sdlData?.proposedSchema : sdl) ||
              ""
            }
            size="icon"
            targetName={activeSubgraphName}
          />
        </div>
      </div>
    </div>
  );
};

const CheckOverviewPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();

  const organizationSlug = useCurrentOrganization()?.slug;
  const { namespace: { name: namespace } } = useWorkspace();
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
  graphPruningIssues: GraphPruningIssue[],
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
          "underline decoration-destructive decoration-wavy cursor-pointer z-50",
        isWholeLine: l.issueLocation.endLine === undefined,
      },
    });
  }

  for (const g of graphPruningIssues) {
    if (!g.issueLocation) continue;
    decorationCollection.push({
      range: {
        startLineNumber: g.issueLocation.line,
        endLineNumber: g.issueLocation.endLine || g.issueLocation.line,
        startColumn: g.issueLocation.column,
        endColumn: g.issueLocation.endColumn || g.issueLocation.column,
      },
      options: {
        hoverMessage: {
          value: `${g.message}. (Rule: ${
            g.graphPruningRuleType ? g.graphPruningRuleType : ""
          })`,
        },
        inlineClassName: `underline ${
          g.severity === LintSeverity.error
            ? "decoration-destructive"
            : "decoration-warning"
        } decoration-wavy cursor-pointer z-50`,
        isWholeLine: g.issueLocation.endLine === undefined,
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
  const proposalsFeature = useFeature("proposals");
  const organizationSlug = useCurrentOrganization()?.slug;
  const { namespace: { name: namespace } } = useWorkspace();
  const slug = router.query.slug as string;
  const id = router.query.checkId as string;
  const tab = router.query.tab as string;

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

  const isLinkedTrafficCheckFailed = data.check.linkedChecks.some(
    (linkedCheck) =>
      linkedCheck.hasClientTraffic && !linkedCheck.isForcedSuccess,
  );
  const isLinkedPruningCheckFailed = data.check.linkedChecks.some(
    (linkedCheck) =>
      linkedCheck.hasGraphPruningErrors && !linkedCheck.isForcedSuccess,
  );

  const isSuccessful = isCheckSuccessful(
    data.check.isComposable,
    data.check.isBreaking,
    data.check.hasClientTraffic,
    data.check.hasLintErrors,
    data.check.hasGraphPruningErrors,
    data.check.clientTrafficCheckSkipped,
    data.check.proposalMatch === "error",
    isLinkedTrafficCheckFailed,
    isLinkedPruningCheckFailed,
  );

  const currentAffectedGraph = data.affectedGraphs.find(
    (graph) => graph.id === graphContext.graph?.id,
  );

  const ghDetails = data.check.ghDetails;
  const vcsContext = data.check.vcsContext;

  const reason = data.check.errorMessage
    ? data.check.errorMessage
    : data.check.proposalMatch === "error"
    ? "Proposal match check failed"
    : !data.check.isComposable
    ? "Composition errors were found"
    : data.check.isBreaking && data.check?.clientTrafficCheckSkipped
    ? "Breaking changes were detected"
    : data.check.isBreaking && data.check.hasClientTraffic
    ? "Operations were affected by breaking changes"
    : data.check.isBreaking && !data.check.hasClientTraffic
    ? "No operations were affected by breaking changes"
    : "All tasks were successful";

  const subgraphName =
    data.check.subgraphName ||
    (data.check.checkedSubgraphs.length > 1
      ? "Multiple Subgraphs"
      : data.check.checkedSubgraphs.length > 0
      ? data.check.checkedSubgraphs[0].subgraphName
      : "Subgraph");

  const setTab = (tab: string) => {
    const query: Record<string, any> = {
      ...router.query,
      tab,
    };

    if (tab === "overview") {
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

          <div className="flex-start flex max-w-[200px] flex-1 flex-col gap-1">
            <dt className="text-sm text-muted-foreground">Action</dt>
            <dd className="whitespace-nowrap">
              {data.check.checkedSubgraphs.length > 1
                ? "Multiple subgraphs updated"
                : data.check.isDeleted ||
                  (data.check.checkedSubgraphs.length === 1 &&
                    data.check.checkedSubgraphs[0].isDeleted)
                ? "Delete subgraph"
                : data.check.checkedSubgraphs.length === 1 &&
                  data.check.checkedSubgraphs[0].isNew
                ? "New subgraph"
                : "Update schema"}
            </dd>
          </div>

          {graphContext.graph?.supportsFederation &&
            data.check.checkedSubgraphs.length === 1 &&
            !data.check.checkedSubgraphs[0].isNew && (
              <div className="flex-start flex max-w-[200px] flex-1 flex-col gap-1 ">
                <dt className="text-sm text-muted-foreground">Subgraph</dt>
                <dd>
                  <Link
                    key={id}
                    href={`/${organizationSlug}/${namespace}/graph/${slug}/schema/sdl?subgraph=${subgraphName}`}
                  >
                    <div className="flex items-center gap-x-1">
                      <CubeIcon />
                      {subgraphName}
                    </div>
                  </Link>
                </dd>
              </div>
            )}

          {data.proposalId && data.proposalName && (
            <div className="flex-start flex max-w-[200px] flex-1 flex-col gap-1 ">
              <dt className="text-sm text-muted-foreground">Proposal</dt>
              <dd className="whitespace-nowrap text-sm">
                <Link
                  key={data.proposalId}
                  href={`/${organizationSlug}/${namespace}/graph/${slug}/proposals/${data.proposalId}`}
                >
                  <div className="flex items-center gap-x-1">
                    <ClipboardIcon />
                    {data.proposalName}
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
        <dl className="flex flex-shrink-0 flex-col space-y-6 overflow-hidden border-b px-4 py-4 lg:block lg:min-h-full lg:w-[240px] lg:overflow-auto lg:border-b-0 lg:border-r lg:px-6 xl:w-[260px] xl:px-8">
          <div className="col-span-3 flex flex-col">
            <dt className="mb-2 text-sm text-muted-foreground">Tasks</dt>
            <dd className="flex flex-row flex-wrap gap-2 lg:flex lg:flex-col">
              <Badge
                variant="outline"
                className={cn(
                  "flex items-center space-x-1.5 py-2",
                  data.check?.compositionSkipped && "text-muted-foreground",
                )}
              >
                {data.check?.compositionSkipped ? (
                  <NoSymbolIcon className="h-4 w-4" />
                ) : (
                  getCheckIcon(data.check.isComposable)
                )}
                <span className="flex-1 truncate">Composition</span>
                <InfoTooltip>
                  Describes if the proposed schema can be composed with all
                  other subgraphs in the federated graph.
                </InfoTooltip>
              </Badge>

              <Badge
                variant="outline"
                className={cn(
                  "flex items-center space-x-1.5 py-2",
                  data.check?.breakingChangesSkipped && "text-muted-foreground",
                )}
              >
                {data.check?.breakingChangesSkipped ? (
                  <NoSymbolIcon className="h-4 w-4" />
                ) : (
                  getCheckIcon(!data.check.isBreaking)
                )}
                <span className="flex-1 truncate">Breaking Changes</span>
                <InfoTooltip>
                  Describes if the proposed schema is free of changes that break
                  existing client operations.
                </InfoTooltip>
              </Badge>

              <Badge
                variant="outline"
                className={cn(
                  "flex items-center space-x-1.5 py-2",
                  data.check?.clientTrafficCheckSkipped &&
                    "text-muted-foreground",
                )}
              >
                {data.check?.clientTrafficCheckSkipped ? (
                  <>
                    <NoSymbolIcon className="h-4 w-4" />
                    <span className="flex-1 truncate">Operations</span>
                    <InfoTooltip>
                      Describes if the proposed schema affects any client
                      operations based on real usage data. You skipped this
                      check.
                    </InfoTooltip>
                  </>
                ) : (
                  <>
                    {getCheckIcon(!data.check.hasClientTraffic)}
                    <span className="flex-1 truncate">Operations</span>
                    <InfoTooltip>
                      Describes if the proposed schema affects any client
                      operations based on real usage data.
                    </InfoTooltip>
                  </>
                )}
              </Badge>

              <Badge
                variant="outline"
                className={cn("flex items-center space-x-1.5 py-2", {
                  "text-muted-foreground": data.check.lintSkipped,
                })}
              >
                {data.check?.lintSkipped ? (
                  <>
                    <NoSymbolIcon className="h-4 w-4" />
                    <span className="flex-1 truncate">Lint Errors</span>
                    <InfoTooltip>
                      Indicates if the proposed schema contains linting errors.
                      Enable linting to see lint issues.
                    </InfoTooltip>
                  </>
                ) : (
                  <>
                    {getCheckIcon(!data.check.hasLintErrors)}
                    <span className="flex-1 truncate">Lint Errors</span>
                    <InfoTooltip>
                      Indicates if the proposed schema contains linting errors.
                    </InfoTooltip>
                  </>
                )}
              </Badge>

              <Badge
                variant="outline"
                className={cn("flex items-center space-x-1.5 py-2", {
                  "text-muted-foreground": data.check?.graphPruningSkipped,
                })}
              >
                {data.check?.graphPruningSkipped ? (
                  <>
                    <NoSymbolIcon className="h-4 w-4" />
                    <span className="flex-1 truncate">Pruning Errors</span>
                    <InfoTooltip>
                      Indicates if the proposed schema contains graph pruning
                      errors. Enable graph pruning linter to see graph pruning
                      issues.
                    </InfoTooltip>
                  </>
                ) : (
                  <>
                    {getCheckIcon(!data.check.hasGraphPruningErrors)}
                    <span className="flex-1 truncate">Pruning Errors</span>
                    <InfoTooltip>
                      Indicates if the proposed schema contains graph pruning
                      errors.
                    </InfoTooltip>
                  </>
                )}
              </Badge>

              {proposalsFeature?.enabled && (
                <Badge
                  variant="outline"
                  className={cn("flex items-center space-x-1.5 py-2", {
                    "text-muted-foreground": !data.check?.proposalMatch,
                  })}
                >
                  {!data.check?.proposalMatch ? (
                    <>
                      <NoSymbolIcon className="h-4 w-4" />
                      <span className="flex-1 truncate">Proposal Match</span>
                      <InfoTooltip>
                        Indicates if the proposed schema matches a proposal.
                      </InfoTooltip>
                    </>
                  ) : (
                    <>
                      {getCheckIcon(data.check.proposalMatch !== "error")}
                      <span className="flex-1 truncate">Proposal Match</span>
                      <InfoTooltip>
                        Indicates if the proposed schema matches a proposal.
                      </InfoTooltip>
                    </>
                  )}
                </Badge>
              )}
            </dd>
          </div>

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
          {data.check.checkedSubgraphs.length === 1 &&
            data.check.checkedSubgraphs[0].isNew && (
              <div className="flex flex-col">
                <dt className="mb-2 text-sm text-muted-foreground">
                  Labels of new subgraph
                </dt>
                <dd className="flex items-center gap-x-2 text-sm">
                  {data.check.checkedSubgraphs[0].labels.length === 0 ? (
                    <div className="italic">
                      <Tooltip delayDuration={200}>
                        <TooltipTrigger>No labels passed</TooltipTrigger>
                        <TooltipContent>
                          Only graphs with empty label matchers will compose
                          this subgraph
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  ) : (
                    data.check.checkedSubgraphs[0].labels.map(
                      ({ key, value }) => {
                        return (
                          <Badge variant="secondary" key={key + value}>
                            {key}={value}
                          </Badge>
                        );
                      },
                    )
                  )}
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
          {vcsContext && (
            <>
              {vcsContext.author && (
                <div className="flex flex-col">
                  <dt className="mb-2 text-sm text-muted-foreground">Author</dt>
                  <dd className="flex items-center gap-x-2 text-sm">
                    {vcsContext.author}
                  </dd>
                </div>
              )}
              {vcsContext.commitSha && (
                <div className="flex flex-col">
                  <dt className="mb-2 text-sm text-muted-foreground">
                    Commit sha
                  </dt>
                  <dd className="flex items-center gap-x-2 text-sm">
                    {vcsContext.commitSha}
                  </dd>
                </div>
              )}
              {vcsContext.branch && (
                <div className="flex flex-col">
                  <dt className="mb-2 text-sm text-muted-foreground">Branch</dt>
                  <dd className="flex items-center gap-x-2 text-sm">
                    {vcsContext.branch}
                  </dd>
                </div>
              )}
            </>
          )}
        </dl>
        <div className="scrollbar-custom h-full flex-1 overflow-auto">
          <Tabs
            value={tab ?? "overview"}
            className="flex h-full min-h-0 flex-col"
          >
            <div className="flex flex-row px-4 py-4 lg:px-6">
              <TabsList className="justify-start overflow-x-auto scrollbar-none">
                <TabsTrigger
                  value="overview"
                  className="flex items-center gap-x-2"
                  asChild
                >
                  <Link href={{ query: { ...router.query, tab: "overview" } }}>
                    <CheckCircleIcon className="h-4 w-4 flex-shrink-0" />
                    Overview
                  </Link>
                </TabsTrigger>
                <TabsTrigger
                  value="composition"
                  className="flex items-center gap-x-2"
                  asChild
                >
                  <Link
                    href={{
                      query: { ...router.query, tab: "composition" },
                    }}
                  >
                    <PiCubeFocus className="flex-shrink-0" />
                    Composition{" "}
                    {data.compositionErrors.length ? (
                      <Badge
                        variant="muted"
                        className="bg-white px-1.5 text-current dark:bg-gray-900/60"
                      >
                        {data.compositionErrors.length +
                          data.compositionWarnings.length}
                      </Badge>
                    ) : null}
                  </Link>
                </TabsTrigger>
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
                    <SiLintcode className="flex-shrink-0" />
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
                <TabsTrigger
                  value="graphPruningIssues"
                  className="flex items-center gap-x-2"
                  asChild
                >
                  <Link
                    href={{
                      query: { ...router.query, tab: "graphPruningIssues" },
                    }}
                  >
                    <HiOutlineScissors className="flex-shrink-0" />
                    Pruning Issues
                    {data.graphPruningIssues.length ? (
                      <Badge
                        variant="muted"
                        className="bg-white px-1.5 text-current dark:bg-gray-900/60"
                      >
                        {data.graphPruningIssues.length}
                      </Badge>
                    ) : null}
                  </Link>
                </TabsTrigger>
                {proposalsFeature?.enabled && (
                  <TabsTrigger
                    value="proposalMatches"
                    className="flex items-center gap-x-2"
                    asChild
                  >
                    <Link
                      href={{
                        query: { ...router.query, tab: "proposalMatches" },
                      }}
                    >
                      <LightningBoltIcon className="flex-shrink-0" />
                      Proposal Matches
                    </Link>
                  </TabsTrigger>
                )}

                {(data.check.checkedSubgraphs.length > 1 ||
                  (data.check.checkedSubgraphs.length === 1 &&
                    !data.check.checkedSubgraphs[0].isDeleted) ||
                  (data.check.checkedSubgraphs.length === 0 &&
                    !data.check.isDeleted)) && (
                  <TabsTrigger
                    value="schema"
                    onClick={() => setTab("schema")}
                    className="flex items-center gap-x-2"
                    asChild
                  >
                    <Link href={{ query: { ...router.query, tab: "schema" } }}>
                      <ReaderIcon />
                      Proposed Schema
                    </Link>
                  </TabsTrigger>
                )}
              </TabsList>
            </div>
            <div className="flex min-h-0 flex-1">
              <TabsContent
                value="overview"
                className="w-full space-y-4 px-4 lg:px-6"
              >
                <div className="space-y-4">
                  <div className="flex flex-col space-y-4">
                    <Alert variant={isSuccessful ? "success" : "destructive"}>
                      {isSuccessful ? (
                        <CheckCircledIcon className="h-4 w-4" />
                      ) : (
                        <CrossCircledIcon className="h-4 w-4" />
                      )}
                      <AlertTitle>
                        {isSuccessful ? "Check Passed" : "Check Failed"}
                      </AlertTitle>
                      <AlertDescription>
                        {(() => {
                          const linkedCheckFailures = [];
                          if (isLinkedTrafficCheckFailed) {
                            linkedCheckFailures.push(
                              "client traffic check failures",
                            );
                          }
                          if (isLinkedPruningCheckFailed) {
                            linkedCheckFailures.push("graph pruning errors");
                          }

                          // If reason is "All tasks were successful" but check failed, it's due to linked check
                          if (
                            reason === "All tasks were successful" &&
                            !isSuccessful
                          ) {
                            if (linkedCheckFailures.length > 0) {
                              return `Check failed because the linked check failed due to ${linkedCheckFailures.join(
                                " and ",
                              )}.`;
                            }

                            return "Check failed because the linked check failed.";
                          }

                          // If there are linked check failures and other reasons
                          if (linkedCheckFailures.length > 0) {
                            const linkedCheckMessage = `The linked check(s) failed due to ${linkedCheckFailures.join(
                              " and ",
                            )}, which is one of the reasons for this check to fail.`;
                            return `${reason}. ${linkedCheckMessage}`;
                          }

                          // Default case - just show the reason
                          return reason;
                        })()}
                      </AlertDescription>
                    </Alert>
                  </div>

                  {data.affectedGraphs.length > 1 && (
                    <div className="space-y-4 pt-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold">
                          Other affected graphs
                        </h3>
                        <InfoTooltip tooltipContentClassName="w-96">
                          These are other federated graphs that also contain the
                          subgraph being checked. Since they share the same
                          subgraph, the schema changes impact these graphs too,
                          and this check applies to them as well.
                        </InfoTooltip>
                      </div>
                      <TableWrapper>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Status</TableHead>
                              <TableHead>FederatedGraph</TableHead>
                              <TableHead>Tasks</TableHead>
                              <TableHead></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {data.affectedGraphs.map(
                              ({
                                id: federatedGraphId,
                                name,
                                hasClientTraffic,
                                hasGraphPruningErrors,
                                isComposable,
                                isBreaking,
                                hasLintErrors,
                                isCheckSuccessful,
                              }) => {
                                if (
                                  federatedGraphId === graphContext.graph?.id
                                ) {
                                  return null;
                                }

                                const path = `/${organizationSlug}/${namespace}/graph/${name}/checks/${id}`;
                                const compositionSkipped =
                                  data.check?.compositionSkipped;
                                const breakingChangesSkipped =
                                  data.check?.breakingChangesSkipped;
                                const clientTrafficCheckSkipped =
                                  data.check?.clientTrafficCheckSkipped;
                                const lintSkipped = data.check?.lintSkipped;
                                const graphPruningSkipped =
                                  data.check?.graphPruningSkipped;
                                const proposalMatch = data.check?.proposalMatch;

                                return (
                                  <TableRow
                                    key={federatedGraphId}
                                    className="group cursor-pointer hover:bg-secondary/30"
                                    onClick={() => router.push(path)}
                                  >
                                    <TableCell>
                                      {getCheckBadge(
                                        isCheckSuccessful,
                                        data.check?.isForcedSuccess || false,
                                      )}
                                    </TableCell>
                                    <TableCell>{name}</TableCell>
                                    <TableCell>
                                      <div className="flex flex-wrap items-start gap-2">
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            "gap-2 py-1.5",
                                            compositionSkipped &&
                                              "text-muted-foreground",
                                          )}
                                        >
                                          {compositionSkipped ? (
                                            <NoSymbolIcon className="h-4 w-4" />
                                          ) : (
                                            getCheckIcon(isComposable)
                                          )}
                                          <span>Composes</span>
                                        </Badge>
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            "gap-2 py-1.5",
                                            breakingChangesSkipped &&
                                              "text-muted-foreground",
                                          )}
                                        >
                                          {breakingChangesSkipped ? (
                                            <NoSymbolIcon className="h-4 w-4" />
                                          ) : (
                                            getCheckIcon(!isBreaking)
                                          )}
                                          <span>Breaking changes</span>
                                        </Badge>
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            "gap-2 py-1.5",
                                            clientTrafficCheckSkipped &&
                                              "text-muted-foreground",
                                          )}
                                        >
                                          {clientTrafficCheckSkipped ? (
                                            <NoSymbolIcon className="h-4 w-4" />
                                          ) : (
                                            getCheckIcon(!hasClientTraffic)
                                          )}
                                          <span>Operations</span>
                                        </Badge>
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            "gap-2 py-1.5",
                                            lintSkipped &&
                                              "text-muted-foreground",
                                          )}
                                        >
                                          {lintSkipped ? (
                                            <NoSymbolIcon className="h-4 w-4" />
                                          ) : (
                                            getCheckIcon(!hasLintErrors)
                                          )}
                                          <span>Lint Errors</span>
                                        </Badge>
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            "gap-2 py-1.5",
                                            graphPruningSkipped &&
                                              "text-muted-foreground",
                                          )}
                                        >
                                          {graphPruningSkipped ? (
                                            <NoSymbolIcon className="h-4 w-4" />
                                          ) : (
                                            getCheckIcon(!hasGraphPruningErrors)
                                          )}
                                          <span className="flex-1 truncate">
                                            Pruning Errors
                                          </span>
                                        </Badge>
                                        {proposalsFeature?.enabled && (
                                          <Badge
                                            variant="outline"
                                            className={cn(
                                              "gap-2 py-1.5",
                                              !proposalMatch &&
                                                "text-muted-foreground",
                                            )}
                                          >
                                            {!proposalMatch ? (
                                              <NoSymbolIcon className="h-4 w-4" />
                                            ) : (
                                              getCheckIcon(
                                                proposalMatch !== "error",
                                              )
                                            )}
                                            <span className="flex-1 truncate">
                                              Proposal Match
                                            </span>
                                          </Badge>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <div className="flex items-center justify-end gap-2">
                                        <Button
                                          asChild
                                          variant="ghost"
                                          size="sm"
                                          className="table-action"
                                        >
                                          <Link href={path}>View</Link>
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              },
                            )}
                          </TableBody>
                        </Table>
                      </TableWrapper>
                    </div>
                  )}

                  {data.check.linkedChecks.length > 0 && (
                    <div className="space-y-4 pt-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold">Linked Checks</h3>
                        <InfoTooltip tooltipContentClassName="w-96">
                          These are checks performed on subgraphs that are
                          linked to the current subgraph. The traffic and
                          pruning checks of these linked subgraphs influence the
                          result of the current check. These checks are
                          automatically run whenever the current subgraph is
                          checked.
                        </InfoTooltip>
                      </div>
                      <TableWrapper>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Status</TableHead>
                              <TableHead>Check ID</TableHead>
                              <TableHead>Subgraph</TableHead>
                              <TableHead>Tasks</TableHead>
                              <TableHead></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {data.check.linkedChecks.map((linkedCheck) => {
                              if (linkedCheck.affectedGraphNames.length === 0) {
                                return <></>;
                              }
                              return (
                                <TableRow
                                  key={linkedCheck.id}
                                  className="group cursor-pointer hover:bg-secondary/30"
                                  onClick={() =>
                                    router.push(
                                      `/${organizationSlug}/${linkedCheck.namespace}/graph/${linkedCheck.affectedGraphNames[0]}/checks/${linkedCheck.id}`,
                                    )
                                  }
                                >
                                  <TableCell>
                                    {getCheckBadge(
                                      linkedCheck.isCheckSuccessful,
                                      linkedCheck.isForcedSuccess,
                                    )}
                                  </TableCell>
                                  <TableCell>{linkedCheck.id}</TableCell>
                                  <TableCell>
                                    {linkedCheck.subgraphNames.length > 1
                                      ? "Multiple Subgraphs"
                                      : linkedCheck.subgraphNames.length > 0
                                      ? linkedCheck.subgraphNames[0]
                                      : "Subgraph"}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "gap-2 py-1.5",
                                        linkedCheck.clientTrafficCheckSkipped &&
                                          "text-muted-foreground",
                                      )}
                                    >
                                      {linkedCheck.clientTrafficCheckSkipped ? (
                                        <NoSymbolIcon className="h-4 w-4" />
                                      ) : (
                                        getCheckIcon(
                                          !linkedCheck.hasClientTraffic,
                                        )
                                      )}
                                      <span>Operations</span>
                                    </Badge>
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "gap-2 py-1.5",
                                        linkedCheck.graphPruningCheckSkipped &&
                                          "text-muted-foreground",
                                      )}
                                    >
                                      {linkedCheck.graphPruningCheckSkipped ? (
                                        <NoSymbolIcon className="h-4 w-4" />
                                      ) : (
                                        getCheckIcon(
                                          !linkedCheck.hasGraphPruningErrors,
                                        )
                                      )}
                                      <span className="flex-1 truncate">
                                        Pruning Errors
                                      </span>
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      <Button
                                        asChild
                                        variant="ghost"
                                        size="sm"
                                        className="table-action"
                                      >
                                        <Link
                                          href={`/${organizationSlug}/${linkedCheck.namespace}/graph/${linkedCheck.affectedGraphNames[0]}/checks/${linkedCheck.id}`}
                                        >
                                          View
                                        </Link>
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </TableWrapper>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent
                value="composition"
                className="w-full space-y-4 px-4 lg:px-6"
              >
                {data.check?.compositionSkipped ? (
                  <EmptyState
                    icon={<NoSymbolIcon className="text-gray-400" />}
                    title="Composition Check Skipped"
                    description="The composition check was skipped for this run."
                  />
                ) : (
                  <>
                    {data.compositionErrors?.length ? (
                      <Alert variant="destructive">
                        <AlertTitle>Composition Errors</AlertTitle>
                        <AlertDescription>
                          <pre className="whitespace-pre-wrap">
                            {data.compositionErrors.length > 0
                              ? data.compositionErrors
                                  .join("\n")
                                  .split("Error: ")
                                  .join("\n")
                              : "No composition errors"}
                          </pre>
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {data.compositionWarnings?.length ? (
                      <Alert variant="warn">
                        <AlertTitle>Composition Warnings</AlertTitle>
                        <AlertDescription>
                          <pre className="whitespace-pre-wrap">
                            {data.compositionWarnings.length > 0
                              ? data.compositionWarnings
                                  .join("\n")
                                  .split("Warning: ")
                                  .join("\n")
                              : "No composition wanings"}
                          </pre>
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {data.compositionErrors.length === 0 &&
                    data.compositionWarnings.length === 0 &&
                    !data.check.isComposable ? (
                      <EmptyState
                        icon={
                          <CrossCircledIcon className="h-16 w-16 text-destructive" />
                        }
                        title="Composition Check Failed"
                        description='This check succeeded for the current federated graph, but it failed in one or more other affected federated graphs. Please check the "Affected Graphs" section to identify which graphs encountered composition errors.'
                      />
                    ) : data.compositionErrors.length === 0 &&
                      data.compositionWarnings.length === 0 ? (
                      <EmptyState
                        icon={<CheckCircleIcon className="text-success" />}
                        title="Composition Check Successful"
                        description="There are no composition errors or warnings."
                      />
                    ) : null}
                  </>
                )}
              </TabsContent>

              <TabsContent
                value="changes"
                className="w-full space-y-4 px-4 lg:px-6"
              >
                {data.check?.breakingChangesSkipped ? (
                  <EmptyState
                    icon={<NoSymbolIcon className="text-gray-400" />}
                    title="Breaking Changes Check Skipped"
                    description="The breaking changes check was skipped for this run."
                  />
                ) : (
                  <>
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
                              The proposed schema changes can be composed, but
                              there are breaking changes affecting client
                              operations.
                              <br />
                              You can manually override the state of this check
                              to accept the changes.
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
                    ) : (
                      <EmptyState
                        icon={<CheckCircleIcon className="text-success" />}
                        title="No changes found."
                        description="There are no changes in the proposed schema."
                      />
                    )}

                    <FieldUsageSheet />
                  </>
                )}
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
                  isLintingEnabled={!data.check?.lintSkipped}
                />
              </TabsContent>
              <TabsContent
                value="graphPruningIssues"
                className="w-full space-y-4 px-4 lg:px-6"
              >
                <GraphPruningIssuesTable
                  pruneIssues={data.graphPruningIssues}
                  caption={`${data.graphPruningIssues.length} issues found`}
                  isGraphPruningEnabled={!data.check?.graphPruningSkipped}
                  hasGraphPruningErrors={data.check.hasGraphPruningErrors}
                />
              </TabsContent>

              {proposalsFeature?.enabled && (
                <TabsContent
                  value="proposalMatches"
                  className="w-full space-y-4 px-4 lg:px-6"
                >
                  <ProposalMatchesTable
                    proposalMatches={data.proposalMatches}
                    caption={`${data.proposalMatches.length} matches found`}
                    isProposalsEnabled={data.isProposalsEnabled}
                    proposalMatch={data.check.proposalMatch}
                  />
                </TabsContent>
              )}

              <TabsContent value="schema" className="relative w-full flex-1">
                <ProposedSchemas
                  checkId={id}
                  sdl={sdl}
                  checkedSubgraphs={data.check.checkedSubgraphs}
                  lintIssues={data.lintIssues}
                  graphPruningIssues={data.graphPruningIssues}
                />
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

import {
  getCheckBadge,
  getCheckIcon,
  isCheckSuccessful,
} from "@/components/check-badge-icon";
import { EmptyState } from "@/components/empty-state";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { SDLViewerActions } from "@/components/schema/sdl-viewer";
import { SDLViewerMonaco } from "@/components/schema/sdl-viewer-monaco";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Loader } from "@/components/ui/loader";
import { Pagination } from "@/components/ui/pagination";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useToast } from "@/components/ui/use-toast";
import { useUser } from "@/hooks/use-user";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import {
  ExclamationTriangleIcon,
  NoSymbolIcon,
} from "@heroicons/react/24/outline";
import {
  CheckCircledIcon,
  ChevronDownIcon,
  Component2Icon,
  GitHubLogoIcon,
  ReaderIcon,
} from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getProposal,
  getProposalChecks,
  updateProposal,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  GetProposalResponse_CurrentSubgraph,
  Proposal,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext, useState } from "react";

export const ProposalDetails = ({
  proposal,
  currentSubgraphs,
  refetch,
}: {
  proposal: Proposal;
  currentSubgraphs: GetProposalResponse_CurrentSubgraph[];
  refetch: () => void;
}) => {
  const router = useRouter();
  const user = useUser();
  const graphData = useContext(GraphContext);

  const namespace = router.query.namespace as string;
  const slug = router.query.slug as string;
  const id = router.query.proposalId as string;
  const tab = router.query.tab as string;
  const subgraph = router.query.subgraph as string;
  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;
  const limit = Number.parseInt((router.query.pageSize as string) || "10");
  const { toast } = useToast();

  const [reviewAction, setReviewAction] = useState<
    "APPROVED" | "CLOSED" | null
  >(null);

  const {
    data: checksData,
    isLoading: isChecksLoading,
    error: checksError,
  } = useQuery(
    getProposalChecks,
    {
      proposalId: id,
      limit: limit > 50 ? 50 : limit,
      offset: (pageNumber - 1) * limit,
    },
    {
      enabled: tab === "checks",
      placeholderData: (prev) => prev,
    },
  );

  const { mutate: approveProposal, isPending: isApproving } = useMutation(
    updateProposal,
    {
      onSuccess: (data) => {
        if (data.response?.code === EnumStatusCode.OK) {
          toast({
            description: "Proposal approved successfully.",
            duration: 3000,
          });
          refetch();
        } else {
          toast({
            description: `Failed to approve proposal: ${data.response?.details}`,
            duration: 3000,
          });
        }
      },
      onError: (error) => {
        toast({
          description: `Failed to approve proposal: ${error.message}`,
          duration: 3000,
        });
      },
    },
  );

  const { mutate: closeProposal, isPending: isClosing } = useMutation(
    updateProposal,
    {
      onSuccess: (data) => {
        if (data.response?.code === EnumStatusCode.OK) {
          toast({
            description: "Proposal closed successfully.",
            duration: 3000,
          });
          refetch();
        } else {
          toast({
            description: `Failed to close proposal: ${data.response?.details}`,
            duration: 3000,
          });
        }
      },
      onError: (error) => {
        toast({
          description: `Failed to close proposal: ${error.message}`,
          duration: 3000,
        });
      },
    },
  );

  const handleApproveProposal = () => {
    approveProposal({
      proposalName: proposal.name,
      federatedGraphName: slug,
      namespace,
      updateAction: {
        case: "state",
        value: "APPROVED",
      },
    });
  };

  const handleCloseProposal = () => {
    closeProposal({
      proposalName: proposal.name,
      federatedGraphName: slug,
      namespace,
      updateAction: {
        case: "state",
        value: "CLOSED",
      },
    });
  };

  const handleSubmitReview = () => {
    if (reviewAction === "APPROVED") {
      handleApproveProposal();
    } else if (reviewAction === "CLOSED") {
      handleCloseProposal();
    }
  };

  const proposalSubgraph = proposal.subgraphs.find((s) => s.name === subgraph);

  const activeSubgraph = proposalSubgraph || proposal.subgraphs?.[0];
  const activeSubgraphName = activeSubgraph?.name;
  const activeSubgraphSdl = activeSubgraph?.schemaSDL || " ";

  const currentSubgraph = currentSubgraphs.find(
    (subgraph) => subgraph.name === activeSubgraphName,
  );
  const currentSubgraphSdl = currentSubgraph?.schemaSDL || "";

  const {
    name,
    createdAt,
    createdByEmail,
    state,
    subgraphs,
    latestCheckSuccess,
  } = proposal;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 overflow-x-auto border-b scrollbar-thin">
        <dl className="flex w-full flex-row gap-x-4 gap-y-2 space-x-4 px-4 py-4 text-sm lg:px-8">
          <div className="flex-start flex max-w-[200px] flex-col gap-1">
            <dt className="text-sm text-muted-foreground">Status</dt>
            <dd>
              <div className="flex items-center gap-x-2">
                <Badge
                  variant="outline"
                  className={cn("gap-2 py-1.5", {
                    "border-success/20 bg-success/10 text-success hover:bg-success/20":
                      state === "APPROVED",
                    "border-warning/20 bg-warning/10 text-warning hover:bg-warning/20":
                      state === "DRAFT",
                    "border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/20":
                      state === "CLOSED",
                    "border-purple-400/20 bg-purple-400/10 text-purple-400 hover:bg-purple-400/20":
                      state === "PUBLISHED",
                  })}
                >
                  <span>{state}</span>
                </Badge>
              </div>
            </dd>
          </div>

          <div className="flex-start flex max-w-[250px] flex-1 flex-col gap-2 pl-4">
            <dt className="text-sm text-muted-foreground">Proposal Name</dt>
            <dd className="whitespace-nowrap text-sm">{name}</dd>
          </div>

          <div className="flex-start flex max-w-[250px] flex-1 flex-col gap-2 ">
            <dt className="text-sm text-muted-foreground">Created By</dt>
            <dd className="whitespace-nowrap text-sm">{createdByEmail}</dd>
          </div>

          <div className="flex-start flex max-w-[200px] flex-1 flex-col gap-2 ">
            <dt className="text-sm text-muted-foreground">Created</dt>
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

          <div className="flex-start flex max-w-[200px] flex-col gap-1">
            <dt className="text-sm text-muted-foreground">Latest Check</dt>
            <dd>
              <div className="flex items-center gap-x-2">
                <Badge
                  variant="outline"
                  className={cn("gap-2 py-1.5", {
                    "border-success/20 bg-success/10 text-success hover:bg-success/20":
                      latestCheckSuccess,
                    "border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/20":
                      !latestCheckSuccess,
                  })}
                >
                  {latestCheckSuccess ? "PASSED" : "FAILED"}
                </Badge>
              </div>
            </dd>
          </div>

          <div className="flex flex-1 items-center justify-end gap-1">
            {state === "DRAFT" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="ml-4" disabled={isApproving || isClosing}>
                    Review Changes
                    <ChevronDownIcon className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[500px] p-3">
                  <div className="flex flex-col space-y-4 px-2 py-1">
                    <div className="flex border-b">
                      <span className="text-md mb-3 font-medium text-muted-foreground">
                        Finish your review
                      </span>
                    </div>

                    <RadioGroup
                      value={reviewAction || ""}
                      onValueChange={(value: string) => {
                        if (value === "APPROVED" || value === "CLOSED") {
                          setReviewAction(value as "APPROVED" | "CLOSED");
                        } else {
                          setReviewAction(null);
                        }
                      }}
                      className="space-y-4"
                    >
                      <div
                        className={cn(
                          "flex cursor-pointer items-start space-x-2",
                          !latestCheckSuccess &&
                            "cursor-not-allowed opacity-50",
                        )}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      >
                        <RadioGroupItem
                          value="APPROVED"
                          id="approve-option"
                          disabled={!latestCheckSuccess}
                          className="h-[14px] w-[14px]"
                        />
                        <div className="grid gap-1.5">
                          <Label
                            htmlFor="approve-option"
                            className={cn(
                              "cursor-pointer font-semibold",
                              !latestCheckSuccess
                                ? "cursor-not-allowed text-muted-foreground"
                                : "",
                            )}
                          >
                            Approve
                          </Label>
                          <p className="text-sm text-muted-foreground">
                            Approve the changes made by the proposal.
                          </p>
                        </div>
                      </div>

                      <div
                        className="flex cursor-pointer items-start space-x-2"
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      >
                        <RadioGroupItem
                          value="CLOSED"
                          id="close-option"
                          className="h-[14px] w-[14px]"
                        />
                        <div className="grid gap-1.5">
                          <Label
                            htmlFor="close-option"
                            className="cursor-pointer font-semibold"
                          >
                            Close
                          </Label>
                          <p className="text-sm text-muted-foreground">
                            Close the proposal without approving the changes.
                          </p>
                        </div>
                      </div>
                    </RadioGroup>

                    <div className="mt-4 flex justify-end border-t pt-3">
                      <Button
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          handleSubmitReview();
                        }}
                        isLoading={isApproving || isClosing}
                        disabled={!reviewAction}
                        size="sm"
                      >
                        Submit review
                      </Button>
                    </div>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </dl>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="h-full flex-1">
          <Tabs
            value={tab ?? "schemas"}
            className="flex h-full min-h-0 flex-col"
          >
            <div className="flex flex-row px-4 py-4 lg:px-6">
              <TabsList>
                <TabsTrigger
                  value="schemas"
                  className="flex items-center gap-x-2"
                  asChild
                >
                  <Link href={{ query: { ...router.query, tab: "schemas" } }}>
                    <ReaderIcon className="flex-shrink-0" />
                    Proposed Schemas
                  </Link>
                </TabsTrigger>
                <TabsTrigger
                  value="checks"
                  className="flex items-center gap-x-2"
                  asChild
                >
                  <Link href={{ query: { ...router.query, tab: "checks" } }}>
                    <CheckCircledIcon className="flex-shrink-0" />
                    Checks
                  </Link>
                </TabsTrigger>
              </TabsList>
            </div>
            <div className="flex min-h-0 flex-1">
              <TabsContent value="schemas" className="relative w-full flex-1">
                {subgraphs.length === 0 ? (
                  <EmptyState
                    icon={<ExclamationTriangleIcon />}
                    title="No subgraph schemas in this proposal. "
                  />
                ) : (
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
                              <span
                                className={cn({
                                  "!text-success": activeSubgraph?.isNew,
                                  "!text-destructive":
                                    activeSubgraph?.isDeleted,
                                })}
                              >
                                {activeSubgraphName}
                              </span>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                                <Component2Icon className="h-3 w-3" /> Subgraphs
                              </SelectLabel>
                              {subgraphs.map((sg) => {
                                return (
                                  <SelectItem key={sg.name} value={sg.name}>
                                    <div
                                      className={cn({
                                        "text-destructive": sg.isDeleted,
                                        "text-success": sg.isNew,
                                      })}
                                    >
                                      <p>{sg.name}</p>
                                      {sg.isDeleted && (
                                        <p className="text-xs">(deleted)</p>
                                      )}
                                    </div>
                                  </SelectItem>
                                );
                              })}
                            </SelectGroup>
                          </SelectContent>
                        </Select>

                        {!activeSubgraph?.isDeleted && (
                          <SDLViewerActions
                            sdl={activeSubgraphSdl}
                            size="icon"
                            targetName={activeSubgraphName}
                          />
                        )}
                      </div>
                    </div>
                    <SDLViewerMonaco
                      schema={currentSubgraphSdl}
                      newSchema={activeSubgraphSdl}
                    />
                  </div>
                )}
              </TabsContent>
              <TabsContent value="checks" className="relative w-full flex-1">
                {isChecksLoading ? (
                  <Loader />
                ) : checksError ||
                  checksData?.response?.code !== EnumStatusCode.OK ? (
                  <EmptyState
                    icon={<ExclamationTriangleIcon />}
                    title="Could not retrieve checks for this proposal"
                    description={
                      checksData?.response?.details ||
                      checksError?.message ||
                      "Please try again"
                    }
                  />
                ) : (
                  <div className="flex h-full flex-col gap-y-3 px-4">
                    <TableWrapper>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Check</TableHead>
                            {graphData?.graph?.supportsFederation && (
                              <TableHead>Subgraph</TableHead>
                            )}
                            <TableHead>Tasks</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {checksData.checks.map(
                            ({
                              id,
                              isComposable,
                              isBreaking,
                              hasClientTraffic,
                              isForcedSuccess,
                              subgraphName,
                              timestamp,
                              ghDetails,
                              hasLintErrors,
                              hasGraphPruningErrors,
                              clientTrafficCheckSkipped,
                              lintSkipped,
                              graphPruningSkipped,
                              checkedSubgraphs,
                              proposalMatch,
                              linkedChecks,
                            }) => {
                              const isSuccessful = isCheckSuccessful(
                                isComposable,
                                isBreaking,
                                hasClientTraffic,
                                hasLintErrors,
                                hasGraphPruningErrors,
                                clientTrafficCheckSkipped,
                                proposalMatch === "error",
                                linkedChecks.some(
                                  (linkedCheck) =>
                                    linkedCheck.hasClientTraffic &&
                                    !linkedCheck.isForcedSuccess,
                                ),
                                linkedChecks.some(
                                  (linkedCheck) =>
                                    linkedCheck.hasGraphPruningErrors &&
                                    !linkedCheck.isForcedSuccess,
                                ),
                              );

                              const path = `/${user?.currentOrganization.slug}/${graphData?.graph?.namespace}/graph/${graphData?.graph?.name}/checks/${id}`;

                              return (
                                <TableRow
                                  key={id}
                                  className="group cursor-pointer hover:bg-secondary/30"
                                  onClick={() => router.push(path)}
                                >
                                  <TableCell>
                                    <div className="flex flex-row items-center gap-1">
                                      <div className="w-20">
                                        {getCheckBadge(
                                          isSuccessful,
                                          isForcedSuccess,
                                        )}
                                      </div>

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
                                              {formatDistanceToNow(
                                                new Date(timestamp),
                                                {
                                                  addSuffix: true,
                                                },
                                              )}
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent side="bottom">
                                            {formatDateTime(
                                              new Date(timestamp),
                                            )}
                                          </TooltipContent>
                                        </Tooltip>
                                      </div>
                                    </div>
                                  </TableCell>
                                  {graphData?.graph?.supportsFederation && (
                                    <TableCell>
                                      {subgraphName ||
                                        (checkedSubgraphs.length > 1
                                          ? "Multiple Subgraphs"
                                          : checkedSubgraphs.length > 0
                                          ? checkedSubgraphs[0].subgraphName
                                          : "Subgraph")}
                                    </TableCell>
                                  )}
                                  <TableCell>
                                    <div className="flex flex-wrap items-start gap-2">
                                      <Badge
                                        variant="outline"
                                        className="gap-2 py-1.5"
                                      >
                                        {getCheckIcon(isComposable)}{" "}
                                        <span>Composes</span>
                                      </Badge>

                                      <Badge
                                        variant="outline"
                                        className="gap-2 py-1.5"
                                      >
                                        {getCheckIcon(!isBreaking)}
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
                                    </div>
                                  </TableCell>

                                  <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      {ghDetails ? (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              asChild
                                              variant="ghost"
                                              size="sm"
                                              className="table-action"
                                              onClick={(e) =>
                                                e.stopPropagation()
                                              }
                                            >
                                              <Link
                                                href={`https://github.com/${ghDetails.ownerSlug}/${ghDetails.repositorySlug}/commit/${ghDetails.commitSha}`}
                                                className="inline-flex items-center gap-2 text-xs"
                                                aria-label="View on GitHub"
                                                target="_blank"
                                              >
                                                <GitHubLogoIcon />
                                              </Link>
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            Commit{" "}
                                            {ghDetails.commitSha.substring(
                                              0,
                                              7,
                                            )}
                                            <br />
                                            <strong>View on GitHub</strong>
                                          </TooltipContent>
                                        </Tooltip>
                                      ) : null}
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
                    <Pagination
                      limit={limit}
                      noOfPages={Math.ceil(
                        (checksData.totalChecksCount || 0) / limit,
                      )}
                      pageNumber={pageNumber}
                    />
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

const ProposalDetailsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const user = useUser();
  const graphData = useContext(GraphContext);

  const organizationSlug = user?.currentOrganization.slug;
  const namespace = graphData?.graph?.namespace;
  const slug = graphData?.graph?.name;
  const id = router.query.proposalId as string;

  const { data, isLoading, error, refetch } = useQuery(getProposal, {
    proposalId: id,
  });

  let content: React.ReactNode;

  if (isLoading) {
    content = <Loader fullscreen />;
  } else if (
    error ||
    !data ||
    data?.response?.code !== EnumStatusCode.OK ||
    !data.proposal
  ) {
    content = (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve proposal details."
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  } else if (data) {
    content = (
      <ProposalDetails
        proposal={data.proposal}
        refetch={refetch}
        currentSubgraphs={data.currentSubgraphs}
      />
    );
  }

  return (
    <GraphPageLayout
      title={id}
      subtitle="A quick glance of the details for this proposal"
      breadcrumbs={[
        <Link
          key={0}
          href={`/${organizationSlug}/${namespace}/graph/${slug}/proposals`}
        >
          Proposals
        </Link>,
      ]}
      noPadding
    >
      {content}
    </GraphPageLayout>
  );
};

ProposalDetailsPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Proposal Details",
  });

export default ProposalDetailsPage;

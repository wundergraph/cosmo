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
import { useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import {
  BoxIcon,
  Component2Icon,
  MinusIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getProposal } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  Proposal,
  ProposalSubgraph,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext } from "react";
import { RxComponentInstance } from "react-icons/rx";

const SubgraphDetails = ({ subgraphs }: { subgraphs: ProposalSubgraph[] }) => {
  const getIcon = (isDeleted: boolean) => {
    if (isDeleted) {
      return <MinusIcon className="h-3 w-3 flex-shrink-0" />;
    }
    return <BoxIcon className="h-3 w-3 flex-shrink-0" />;
  };

  return subgraphs
    .sort((a, b) => {
      // Sort by deleted status first, then by name
      if (a.isDeleted !== b.isDeleted) {
        return a.isDeleted ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    })
    .map((subgraph) => {
      return (
        <div
          className={cn("flex flex-col gap-y-1", {
            "text-destructive": subgraph.isDeleted,
          })}
          key={subgraph.name}
        >
          <div className="flex items-start gap-x-1.5 text-sm">
            <div className="mt-1">{getIcon(subgraph.isDeleted)}</div>
            <span>{subgraph.name}</span>
            {subgraph.isDeleted && <span>(deleted)</span>}
          </div>
          {/* Placeholder for subgraph ID. Use a random portion since ProposalSubgraph doesn't have IDs */}
          <span className="pl-5 text-xs">
            {Math.random().toString(36).substring(2, 8)}
          </span>
        </div>
      );
    });
};

export const ProposalDetails = ({ proposal }: { proposal: Proposal }) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const namespace = router.query.namespace as string;
  const slug = router.query.slug as string;
  const id = router.query.proposalId as string;
  const tab = router.query.tab as string;
  const subgraph = router.query.subgraph as string;

  const graphData = useContext(GraphContext);

  const proposalSubgraph = proposal.subgraphs.find((s) => s.name === subgraph);

  const activeSubgraph = proposalSubgraph || proposal.subgraphs?.[0];
  const activeSubgraphName = activeSubgraph?.name;
  const activeSubgraphSdl = activeSubgraph?.schemaSDL;

  const {
    id: proposalId,
    name,
    createdAt,
    createdByEmail,
    state,
    subgraphs,
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
                    "border-primary/20 bg-primary/10 text-primary hover:bg-primary/20":
                      state === "PENDING",
                    "border-warning/20 bg-warning/10 text-warning hover:bg-warning/20":
                      state === "DRAFT",
                    "border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/20":
                      state === "REJECTED",
                    "border-accent/20 bg-accent/10 text-accent hover:bg-accent/20":
                      state === "EXPIRED",
                  })}
                >
                  <span>{state}</span>
                </Badge>
              </div>
            </dd>
          </div>

          <div className="flex-start flex max-w-[250px] flex-1 flex-col gap-2 ">
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
        </dl>
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <dl className="scrollbar-custom grid w-full flex-shrink-0 grid-cols-3 space-y-6 overflow-hidden border-b px-4 py-4 lg:block lg:h-full lg:w-[200px] lg:space-y-8 lg:overflow-auto lg:border-b-0 lg:border-r lg:px-6 xl:w-[220px]">
          <div className="flex-start col-span-full flex flex-1 flex-col gap-2">
            <dt className="text-sm text-muted-foreground">Subgraphs</dt>
            <dd className="mt-2 flex flex-col gap-2">
              {subgraphs.length === 0 ? (
                <span className="text-sm">No subgraphs in this proposal.</span>
              ) : (
                <SubgraphDetails subgraphs={subgraphs} />
              )}
            </dd>
          </div>
        </dl>
        <div className="h-full flex-1">
          <Tabs
            value={tab ?? "schemas"}
            className="flex h-full min-h-0 flex-col"
          >
            <div className="flex flex-row px-4 py-4 lg:px-6">
              <TabsList>
                <TabsTrigger value="schemas" asChild>
                  <Link href={{ query: { ...router.query, tab: "schemas" } }}>
                    Schemas
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
                  activeSubgraphSdl && (
                    <div className="relative flex h-full min-h-[60vh] flex-col">
                      <div className="-top-[60px] right-8 px-5 md:absolute md:px-0">
                        <div className="flex gap-x-2">
                          {subgraphs.length > 1 && (
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
                                  {subgraphs.map((sg) => {
                                    return (
                                      <SelectItem key={sg.name} value={sg.name}>
                                        <div
                                          className={cn({
                                            "text-destructive": sg.isDeleted,
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
                          )}
                          <SDLViewerActions
                            sdl={activeSubgraphSdl}
                            size="icon"
                            targetName={activeSubgraphName}
                          />
                        </div>
                      </div>
                      <SDLViewerMonaco schema={activeSubgraphSdl} />
                    </div>
                  )
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

  const organizationSlug = router.query.organizationSlug as string;
  const namespace = router.query.namespace as string;
  const slug = router.query.slug as string;
  const id = router.query.proposalId as string;

  const { data, isLoading, error, refetch } = useQuery(getProposal, {
    proposalId: id,
  });

  if (isLoading) return <Loader fullscreen />;

  if (
    error ||
    !data ||
    data?.response?.code !== EnumStatusCode.OK ||
    !data.proposal
  )
    return (
      <GraphPageLayout
        title={id}
        subtitle="Details for this proposal"
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
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve proposal details."
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </GraphPageLayout>
    );

  const { proposal } = data;

  return (
    <GraphPageLayout
      title={proposal.name || id}
      subtitle="Details for this schema change proposal"
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
      <ProposalDetails proposal={proposal} />
    </GraphPageLayout>
  );
};

ProposalDetailsPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Proposal Details",
  });

export default ProposalDetailsPage;

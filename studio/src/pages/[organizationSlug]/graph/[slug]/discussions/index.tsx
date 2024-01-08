import { useApplyParams } from "@/components/analytics/use-apply-params";
import { EmptyState } from "@/components/empty-state";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { CommentCard } from "@/components/schema/discussion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toolbar } from "@/components/ui/toolbar";
import { useUser } from "@/hooks/use-user";
import { NextPageWithLayout } from "@/lib/page";
import {
  BookOpenIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  ArrowRightIcon,
  CheckCircledIcon,
  Component2Icon,
  Cross1Icon,
  MagnifyingGlassIcon,
} from "@radix-ui/react-icons";
import { Separator } from "@radix-ui/react-separator";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getAllDiscussions,
  getOrganizationMembers,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { Discussion } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import Fuse from "fuse.js";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext, useMemo, useState } from "react";
import { PiChat, PiGraphLight } from "react-icons/pi";

const Discussions = ({
  discussions,
  refetch,
}: {
  discussions: Record<string, Discussion[]>;
  refetch: () => void;
}) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const slug = router.query.slug as string;

  const user = useUser();

  const { data: membersData } = useQuery({
    ...getOrganizationMembers.useQuery(),
    queryKey: [
      user?.currentOrganization.slug || "",
      "GetOrganizationMembers",
      {},
    ],
  });

  const search = router.query.search as string;

  const fuse = new Fuse(Object.keys(discussions), {
    minMatchCharLength: 1,
  });

  const filtered = search
    ? Object.fromEntries(
        fuse.search(search).map((key) => [key.item, discussions[key.item]]),
      )
    : discussions;

  return (
    <>
      <ol className="relative flex w-full flex-1 flex-col divide-y">
        {Object.entries(filtered).map(([schemaVersionId, discussions]) => {
          return (
            <div
              className="flex w-full flex-col items-start gap-x-12 gap-y-4 py-8 first:pt-0"
              key={schemaVersionId}
            >
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-bold">
                  <span className="text-muted-foreground">Schema version:</span>{" "}
                  {schemaVersionId.slice(0, 6)}
                </h3>
              </div>
              <div className="grid w-full flex-1 grid-cols-1 gap-4 pt-2 md:grid-cols-2 xl:grid-cols-3">
                {discussions.map((ld) => {
                  return (
                    <div
                      key={ld.id}
                      className="flex h-auto w-full max-w-2xl flex-col rounded-md border pb-2 pt-4"
                    >
                      <CommentCard
                        isOpeningComment
                        discussionId={ld.id}
                        comment={ld.openingComment!}
                        author={membersData?.members.find(
                          (m) => m.userID === ld.openingComment?.createdBy,
                        )}
                        onUpdate={() => refetch()}
                        onDelete={() => refetch()}
                      />
                      <Separator className="mb-2 mt-4" />

                      <div className="mt-auto flex items-center gap-4 px-4">
                        {ld.isResolved && (
                          <Badge variant="outline" className="gap-2 py-1.5">
                            <CheckCircledIcon className="h-4 w-4 text-success" />{" "}
                            <span>Resolved</span>
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          className="ml-auto w-max flex-shrink-0"
                          asChild
                        >
                          <Link
                            href={`/${organizationSlug}/graph/${slug}/discussions/${ld.id}`}
                          >
                            View thread <ArrowRightIcon className="ml-2" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </ol>
    </>
  );
};

const DiscussionsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const graphName = router.query.slug as string;
  const organizationSlug = router.query.organizationSlug as string;
  const subgraphName = router.query.subgraph as string;
  const resolved = router.query.resolved as string;

  const graphData = useContext(GraphContext);

  const applyParams = useApplyParams();

  const [search, setSearch] = useState(router.query.search as string);

  const selectedGraph = useMemo(
    () =>
      graphData?.subgraphs.find((s) => s.name === subgraphName) ||
      graphData?.graph,
    [graphData?.graph, graphData?.subgraphs, subgraphName],
  );

  const { data, isLoading, error, refetch } = useQuery({
    ...getAllDiscussions.useQuery({
      targetId: selectedGraph?.targetId,
      schemaVersionId: undefined,
    }),
    enabled: !!selectedGraph,
  });

  const discussionsBySchema = data?.discussions
    .filter((d) => d.isResolved === !!resolved)
    .reduce(
      (acc, discussion) => {
        const schemaVersionId = discussion.schemaVersionId;

        if (!acc[schemaVersionId]) {
          acc[schemaVersionId] = [];
        }

        acc[schemaVersionId].push(discussion);

        return acc;
      },
      {} as Record<string, Discussion[]>,
    );

  return (
    <PageHeader title="Discussions | Studio">
      <GraphPageLayout
        title="Discussions"
        subtitle="View discussions across schema versions of your graph"
        toolbar={
          <Toolbar>
            <Tabs
              defaultValue="open"
              className="w-full md:w-max"
              onValueChange={(v) =>
                applyParams({
                  resolved: v === "resolved" ? "true" : null,
                })
              }
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="open">
                  <div className="flex items-center gap-x-2">
                    <BookOpenIcon className="h-4 w-4" />
                    Open
                  </div>
                </TabsTrigger>
                <TabsTrigger value="resolved">
                  <div className="flex items-center gap-x-2">
                    <CheckCircledIcon className="h-4 w-4" />
                    Resolved
                  </div>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative ml-auto w-full md:w-auto">
              <MagnifyingGlassIcon className="absolute bottom-0 left-3 top-0 my-auto" />
              <Input
                placeholder="Filter by schema version"
                className="pl-8 pr-10"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  applyParams({ search: e.target.value });
                }}
              />
              {search && (
                <Button
                  variant="ghost"
                  className="absolute bottom-0 right-0 top-0 my-auto rounded-l-none"
                  onClick={() => {
                    setSearch("");
                    applyParams({
                      search: null,
                    });
                  }}
                >
                  <Cross1Icon />
                </Button>
              )}
            </div>
            <Select
              onValueChange={(name) => {
                applyParams({
                  subgraph:
                    graphData?.subgraphs.find((s) => s.name === name)?.name ||
                    null,
                });
              }}
            >
              <SelectTrigger
                value={selectedGraph?.name ?? ""}
                className="w-full md:w-[200px]"
              >
                <SelectValue aria-label={selectedGraph?.name ?? ""}>
                  {selectedGraph?.name ?? ""}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                    <PiGraphLight className="h-3 w-3" /> Graph
                  </SelectLabel>
                  <SelectItem value={graphData?.graph?.name ?? ""}>
                    {graphName}
                  </SelectItem>
                </SelectGroup>
                <Separator className="my-2" />
                <SelectGroup>
                  <SelectLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                    <Component2Icon className="h-3 w-3" /> Subgraphs
                  </SelectLabel>
                  {graphData?.subgraphs?.map(({ name }) => {
                    return (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Toolbar>
        }
      >
        {isLoading && <Loader fullscreen />}
        {(error || data?.response?.code !== EnumStatusCode.OK) && (
          <EmptyState
            icon={<ExclamationTriangleIcon />}
            title="Could not retrieve discussions"
            description={
              data?.response?.details || error?.message || "Please try again"
            }
            actions={<Button onClick={() => refetch()}>Retry</Button>}
          />
        )}
        {discussionsBySchema && (
          <Discussions
            discussions={discussionsBySchema}
            refetch={() => refetch()}
          />
        )}
        {Object.keys(discussionsBySchema ?? {}).length === 0 && !isLoading && (
          <EmptyState
            icon={<PiChat />}
            title="No discussions found"
            description={"You can start a new one from the schema page"}
            actions={
              <Button asChild>
                <Link href={`/${organizationSlug}/graph/${graphName}/schema`}>
                  Take me there
                </Link>
              </Button>
            }
          />
        )}
      </GraphPageLayout>
    </PageHeader>
  );
};

DiscussionsPage.getLayout = getGraphLayout;

export default DiscussionsPage;

import { docsBaseURL } from "@/lib/constants";
import { formatDateTime } from "@/lib/format-date";
import { FederatedGraphsTable } from "@/pages/[organizationSlug]/[namespace]/subgraph/[subgraphSlug]/graphs";
import { InformationCircleIcon } from "@heroicons/react/24/outline";
import {
  FeatureFlag,
  FederatedGraph,
  Subgraph,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { EmptyState } from "./empty-state";
import { SubgraphsTable } from "./subgraphs-table";
import { Badge } from "./ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export const FeatureFlagDetails = ({
  featureFlag,
  federatedGraphs,
  featureSubgraphs,
}: {
  featureFlag: FeatureFlag;
  federatedGraphs: FederatedGraph[];
  featureSubgraphs: Subgraph[];
}) => {
  const router = useRouter();
  const slug = router.query.slug as string;
  const tab = router.query.tab as string;
  const { name, labels, createdAt, createdBy, isEnabled } = featureFlag;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 overflow-x-auto border-b scrollbar-thin">
        <dl className="flex w-full flex-row gap-x-4 gap-y-2 space-x-4 px-4 py-4 text-sm lg:px-8">
          <div className="flex-start flex max-w-[200px] flex-1 flex-col gap-1">
            <dt className="text-sm text-muted-foreground">Name</dt>
            <dd>
              {name}
            </dd>
          </div>
          <div className="flex-start flex max-w-[200px] flex-1 flex-col gap-1">
            <dt className="text-sm text-muted-foreground">Enabled</dt>
            <dd>
              <div className="flex items-center gap-x-2">
                <Badge variant={isEnabled ? "success" : "destructive"}>
                  {isEnabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
            </dd>
          </div>
          <div className="flex-start flex max-w-[250px] flex-1 flex-col gap-1">
            <dt className="text-sm text-muted-foreground">Labels</dt>
            <dd>
              <div className="flex flex-wrap gap-2">
                {labels.length === 0 && (
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger>-</TooltipTrigger>
                    <TooltipContent>
                      Only graphs with empty label matchers will compose this
                      subgraph
                    </TooltipContent>
                  </Tooltip>
                )}
                {labels.map(({ key, value }) => {
                  return (
                    <Badge variant="secondary" key={key + value}>
                      {key}={value}
                    </Badge>
                  );
                })}
              </div>
            </dd>
          </div>
          <div className="flex-start flex max-w-[250px] flex-1 flex-col gap-2 ">
            <dt className="text-sm text-muted-foreground">Created By</dt>
            <dd className="whitespace-nowrap text-sm">{createdBy || "-"}</dd>
          </div>
          <div className="flex-start flex max-w-[250px] flex-1 flex-col gap-2 ">
            <dt className="text-sm text-muted-foreground">Created At</dt>
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
        <div className="h-full flex-1">
          <Tabs
            value={slug ? "featureSubgraphs" : tab ?? "graphs"}
            className="flex h-full min-h-0 flex-col"
          >
            <div className="flex flex-row px-4 py-4 lg:px-6">
              <TabsList>
                {!slug && (
                  <TabsTrigger value="graphs" asChild>
                    <Link href={{ query: { ...router.query, tab: "graphs" } }}>
                      Federated Graphs
                    </Link>
                  </TabsTrigger>
                )}
                <TabsTrigger value="featureSubgraphs" asChild>
                  <Link
                    href={{
                      query: { ...router.query, tab: "featureSubgraphs" },
                    }}
                  >
                    Feature Subgraphs
                  </Link>
                </TabsTrigger>
              </TabsList>
            </div>
            <div className="flex min-h-0 flex-1">
              {!slug && (
                <TabsContent value="graphs" className="w-full">
                  <div className="px-6">
                    {federatedGraphs.length > 0 ? (
                      <FederatedGraphsTable graphs={federatedGraphs} />
                    ) : (
                      <EmptyState
                        icon={<InformationCircleIcon />}
                        title="No associated federated graphs found."
                        description={
                          <>
                            To associate a federated graph with this feature
                            flag, please try updating the labels of the feature
                            flag or publishing the feature subgraphs of the
                            feature flag if not already.{" "}
                            <a
                              target="_blank"
                              rel="noreferrer"
                              href={docsBaseURL + "/cli/feature-flags/create"}
                              className="text-primary"
                            >
                              Learn more.
                            </a>
                          </>
                        }
                        actions={[]}
                      />
                    )}
                  </div>
                </TabsContent>
              )}
              <TabsContent value="featureSubgraphs" className="w-full">
                <div className="px-6">
                  <SubgraphsTable
                    subgraphs={featureSubgraphs}
                    totalCount={featureSubgraphs.length}
                    tab="featureSubgraphs"
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

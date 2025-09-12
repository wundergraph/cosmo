import { formatDateTime } from "@/lib/format-date";
import { FederatedGraphsTable } from "@/pages/[organizationSlug]/[namespace]/subgraph/[subgraphSlug]/graphs";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { Component1Icon, HomeIcon } from "@radix-ui/react-icons";
import {
  FeatureFlag,
  FederatedGraph,
  Subgraph,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { PiGraphLight } from "react-icons/pi";
import { EmptyState } from "./empty-state";
import { SubgraphsTable } from "./subgraphs-table";
import { Badge } from "./ui/badge";
import { CLI, CLISteps } from "./ui/cli";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

const FeatureFlagOverview = ({
  federatedGraphs,
  featureSubgraphs,
  isEnabled,
}: {
  federatedGraphs: { federatedGraph: FederatedGraph; isConnected: boolean }[];
  featureSubgraphs: Subgraph[];
  isEnabled: boolean;
}) => {
  const router = useRouter();
  const { namespace: { name: namespace } } = useWorkspace();
  const currentOrg = useCurrentOrganization();
  const slug = router.query.slug as string;

  let content: React.ReactNode;
  if (featureSubgraphs.length === 0) {
    content = (
      <EmptyState
        icon={<ExclamationTriangleIcon className="text-destructive" />}
        title="Feature flag is not used for composition."
        description={
          <>
            {`This feature flag does not contain any feature subgraphs, so won't
              be considered during composition.`}
          </>
        }
        actions={
          <CLISteps
            steps={[
              {
                description:
                  "Create a feature subgraph using the below command.",
                command: `npx wgc feature-subgraph create <feature-subgraph-name> --namespace ${namespace} -r <routing-url> --subgraph <base-subgraph-name>`,
              },
              {
                description:
                  "Update your feature subgraphs of this feature flag.",
                command: `npx wgc feature-flag update <feature-flag-name> --namespace ${namespace} --feature-subgraphs <featureSubgraphs...>`,
              },
            ]}
          />
        }
      />
    );
  } else if (!isEnabled) {
    content = (
      <EmptyState
        icon={<ExclamationTriangleIcon className="text-destructive" />}
        title="Feature flag is not used for composition."
        description={
          <>
            Feature flag is disabled. To enable the feature flag, use the below
            command.
          </>
        }
        actions={
          <CLI
            command={`npx wgc feature-flag enable <feature-flag-name> --namespace <namespace>`}
          />
        }
      />
    );
  } else if (
    federatedGraphs.find((f) => f.federatedGraph.name === slug)?.isConnected
  ) {
    if (featureSubgraphs.some((fs) => fs.lastUpdatedAt !== "")) {
      content = (
        <EmptyState
          icon={<CheckCircleIcon className="text-success" />}
          title="Feature flag is active."
          description={
            <>
              This feature flag will be a part of compositions of this federated
              graph. Once the feature flag is composed successfully, you can
              query the feature flag in the{" "}
              <Link
                href={`/${currentOrg?.slug}/${namespace}/graph/${slug}/playground`}
                className="text-sm text-primary"
              >
                playground
              </Link>
              .
            </>
          }
          actions={[]}
        />
      );
    } else {
      content = (
        <EmptyState
          icon={<ExclamationTriangleIcon className="text-destructive" />}
          title="Feature flag is not used for composition."
          description={
            <>
              None of the feature subgraphs which are part of this feature flag
              are published. Please publish the feature subgraphs using the
              command below. Publish the feature subgraphs using the below
              command.
            </>
          }
          actions={
            <CLI
              command={`npx wgc subgraph publish <feature-subgraph-name> --namespace ${namespace} --schema <path-to-schema>`}
            />
          }
        />
      );
    }
  } else {
    content = (
      <EmptyState
        icon={<ExclamationTriangleIcon className="text-destructive" />}
        title="Feature flag is not used for composition."
        description={
          <>
            The labels of this feature flag match to that of this federated
            graph. But to be used for composition, the feature subgraphs which
            are part of this feature flag should have their respective base
            subgraphs be a part of this federated graph.{" "}
          </>
        }
        actions={[]}
      />
    );
  }

  return <>{content}</>;
};

export const FeatureFlagDetails = ({
  featureFlag,
  federatedGraphs,
  featureSubgraphs,
}: {
  featureFlag: FeatureFlag;
  federatedGraphs: { federatedGraph: FederatedGraph; isConnected: boolean }[];
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
            <dd>{name}</dd>
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
            <dd className="whitespace-nowrap text-sm">
              {createdBy || "unknown user"}
            </dd>
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
            value={slug ? tab ?? "overview" : tab ?? "graphs"}
            className="flex h-full min-h-0 flex-col"
          >
            <div className="flex flex-row px-4 py-4 lg:px-6">
              <TabsList>
                {!slug && (
                  <TabsTrigger
                    value="graphs"
                    className="flex items-center gap-x-2"
                    asChild
                  >
                    <Link href={{ query: { ...router.query, tab: "graphs" } }}>
                      <PiGraphLight className="h-4 w-4" />
                      Federated Graphs
                    </Link>
                  </TabsTrigger>
                )}
                {slug && (
                  <TabsTrigger
                    value="overview"
                    className="flex items-center gap-x-2"
                    asChild
                  >
                    <Link
                      href={{ query: { ...router.query, tab: "overview" } }}
                    >
                      <HomeIcon className="h-4 w-4" />
                      Overview
                    </Link>
                  </TabsTrigger>
                )}
                <TabsTrigger
                  value="featureSubgraphs"
                  className="flex items-center gap-x-2"
                  asChild
                >
                  <Link
                    href={{
                      query: { ...router.query, tab: "featureSubgraphs" },
                    }}
                  >
                    <Component1Icon className="h-4 w-4" />
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
                      <FederatedGraphsTable
                        graphs={federatedGraphs}
                        noFeatureSubgraphs={featureSubgraphs.length === 0}
                      />
                    ) : (
                      <EmptyState
                        icon={<InformationCircleIcon />}
                        title="No associated federated graphs found."
                        description={
                          <>
                            To associate a federated graph with this feature
                            flag, please try updating the labels of the feature
                            flag to match the required federated graphs.{" "}
                          </>
                        }
                        actions={[]}
                      />
                    )}
                  </div>
                </TabsContent>
              )}
              {slug && (
                <TabsContent value="overview" className="w-full">
                  <FeatureFlagOverview
                    featureSubgraphs={featureSubgraphs}
                    federatedGraphs={federatedGraphs}
                    isEnabled={isEnabled}
                  />
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

import { useUser } from "@/hooks/use-user";
import { docsBaseURL } from "@/lib/constants";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import { TooltipContent, TooltipTrigger } from "@radix-ui/react-tooltip";
import {
  FeatureFlag,
  FederatedGraph,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { EmptyState } from "./empty-state";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { CLISteps } from "./ui/cli";
import { Pagination } from "./ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "./ui/table";
import { Tooltip } from "./ui/tooltip";
import { useWorkspace } from "@/hooks/use-workspace";

export const Empty = ({ graph }: { graph?: FederatedGraph }) => {
  const { namespace: { name: namespace } } = useWorkspace();

  let label = "[labels...]";
  if (graph?.labelMatchers && graph.labelMatchers.length > 0) {
    label = graph.labelMatchers[0].split(",")[0];
  }
  return (
    <EmptyState
      icon={<CommandLineIcon />}
      title="Create feature flag using CLI"
      description={
        <>
          No feature flags found. Use the CLI tool to create one.{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={docsBaseURL + "/cli/feature-flags/create-feature-flag"}
            className="text-primary"
          >
            Learn more.
          </a>
        </>
      }
      actions={
        <CLISteps
          steps={[
            {
              description: "Create a feature subgraph using the below command.",
              command: `npx wgc feature-subgraph create <feature-subgraph-name> --namespace ${namespace} -r <routing-url> --subgraph <base-subgraph-name>`,
            },
            {
              description:
                "Publish a feature subgraph using the below command.",
              command: `npx wgc subgraph publish <feature-subgraph-name> --namespace ${namespace} --schema <schema-path> `,
            },
            {
              description: "Create a feature flag using the below command.",
              command: `npx wgc feature-flag create <feature-flag-name> --namespace ${namespace} --label ${label} --enabled --feature-subgraphs <feature-subgraph-names...>`,
            },
          ]}
        />
      }
    />
  );
};

export const FeatureFlagsTable = ({
  graph,
  featureFlags,
  totalCount,
}: {
  graph?: FederatedGraph;
  featureFlags: FeatureFlag[];
  totalCount: number;
}) => {
  const user = useUser();
  const router = useRouter();
  const organizationSlug = user?.currentOrganization.slug;

  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;
  const limit = Number.parseInt((router.query.pageSize as string) || "10");
  const noOfPages = Math.ceil(totalCount / limit);

  if (!featureFlags || featureFlags.length === 0)
    return <Empty graph={graph} />;

  return (
    <>
      <TableWrapper className="mb-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-1/12 px-4">Name</TableHead>
              <TableHead className="w-1/12">Enabled</TableHead>
              <TableHead className="w-3/12 px-4">Labels</TableHead>
              <TableHead className="w-2/12 px-4">Created By</TableHead>
              <TableHead className="w-2/12 px-4">Created At</TableHead>
              <TableHead className="w-2/12 px-4">Updated At</TableHead>
              <TableHead className="w-1/12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {featureFlags.map(
              ({
                name,
                labels,
                createdAt,
                updatedAt,
                createdBy,
                namespace,
                isEnabled,
              }) => {
                const path = graph
                  ? `${router.asPath.split("?")[0]}/${name}`
                  : `/${organizationSlug}/feature-flags/${name}?namespace=${namespace}`;

                return (
                  <TableRow
                    key={name}
                    className=" group cursor-pointer py-1 hover:bg-secondary/30"
                    onClick={() => router.push(path)}
                  >
                    <TableCell className="px-4 font-medium">{name}</TableCell>
                    <TableCell className="px-4">
                      <Badge variant={isEnabled ? "success" : "destructive"}>
                        {isEnabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4">
                      <div className="flex flex-wrap gap-2">
                        {labels.length === 0 && (
                          <Tooltip delayDuration={200}>
                            <TooltipTrigger>-</TooltipTrigger>
                            <TooltipContent>
                              Only graphs with empty label matchers will compose
                              this subgraph
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
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {createdBy || 'unknown user'}
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {createdAt
                        ? formatDistanceToNow(new Date(createdAt), {
                            addSuffix: true,
                          })
                        : "Never"}
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {updatedAt
                        ? formatDistanceToNow(new Date(updatedAt), {
                            addSuffix: true,
                          })
                        : "Never"}
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
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
            )}
          </TableBody>
        </Table>
      </TableWrapper>
      <Pagination limit={limit} noOfPages={noOfPages} pageNumber={pageNumber} />
    </>
  );
};

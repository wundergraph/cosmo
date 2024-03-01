import { EmptyState } from "@/components/empty-state";
import {
  SubgraphPageLayout,
  getSubgraphLayout,
} from "@/components/layout/subgraph-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CLI } from "@/components/ui/cli";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSubgraph } from "@/hooks/use-subgraph";
import { docsBaseURL } from "@/lib/constants";
import { NextPageWithLayout } from "@/lib/page";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getFederatedGraphsBySubgraphLabels } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { FederatedGraph } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";

export const Empty = ({ labels }: { labels: string[] }) => {
  const router = useRouter();

  return (
    <EmptyState
      icon={<CommandLineIcon />}
      title="Create a federated graph which includes this subgraph."
      description={
        <>
          No federated graphs include this subgraph. Create a federated graph
          with subgraph labels{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={docsBaseURL + "/cli/federated-graph/create"}
            className="text-primary"
          >
            Learn more.
          </a>
        </>
      }
      actions={
        <CLI
          command={`npx wgc federated-graph create production --namespace ${
            router.query.namespace
          } --label-matcher ${labels.join(
            " ",
          )} --routing-url http://localhost:4000/graphql`}
        />
      }
    />
  );
};

export const FederatedGraphsTable = ({
  graphs,
}: {
  graphs: FederatedGraph[];
}) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug;
  const subgraph = useSubgraph();

  if (!graphs || graphs.length === 0)
    return (
      <Empty
        labels={
          subgraph && subgraph.subgraph
            ? subgraph.subgraph.labels.map(({ key, value }) => {
                return `${key}=${value}`;
              })
            : []
        }
      />
    );

  return (
    <TableWrapper>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-4">Name</TableHead>
            <TableHead className="w-4/12 px-4">Url</TableHead>
            <TableHead className="w-4/12 px-4">Label Matchers</TableHead>
            <TableHead className="w-2/12 px-4 text-right">
              Last Published
            </TableHead>
            <TableHead className="w-1/12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {graphs.map(
            ({ name, routingURL, lastUpdatedAt, labelMatchers, namespace }) => {
              const path = `/${organizationSlug}/${namespace}/graph/${name}`;
              return (
                <TableRow
                  key={name}
                  className="group py-1 even:bg-secondary/20 hover:bg-secondary/40"
                >
                  <TableCell className="px-4 font-medium">{name}</TableCell>
                  <TableCell className="px-4 text-muted-foreground hover:text-current">
                    <Link target="_blank" rel="noreferrer" href={routingURL}>
                      {routingURL}
                    </Link>
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="flex space-x-2">
                      {labelMatchers.length === 0 && (
                        <Tooltip delayDuration={200}>
                          <TooltipTrigger>-</TooltipTrigger>
                          <TooltipContent>
                            This graph will only compose subgraphs without
                            labels
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {labelMatchers.map((l) => {
                        return (
                          <Badge variant="secondary" key={l}>
                            {l}
                          </Badge>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 text-right text-muted-foreground">
                    {lastUpdatedAt
                      ? formatDistanceToNow(new Date(lastUpdatedAt), {
                          addSuffix: true,
                        })
                      : "Never"}
                  </TableCell>
                  <TableCell className="flex">
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
  );
};

const FederatedGraphsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const subgraphSlug = router.query.subgraphSlug as string;
  const namespace = router.query.namespace as string;

  const { data, error, refetch, isLoading } = useQuery({
    ...getFederatedGraphsBySubgraphLabels.useQuery({
      subgraphName: subgraphSlug,
      namespace,
    }),
    enabled: !!subgraphSlug,
  });

  if (isLoading) {
    return <Loader fullscreen />;
  }

  if (error || !data || data.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon className="h-10 w-10" />}
        title="Could not retrieve the federated graphs that include this subgraph."
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  return <FederatedGraphsTable graphs={data.graphs} />;
};

FederatedGraphsPage.getLayout = (page) =>
  getSubgraphLayout(
    <SubgraphPageLayout
      title="Federated Graphs"
      subtitle="View the federated graph that include this subgraph."
    >
      {page}
    </SubgraphPageLayout>,
    { title: "Federated Graphs" },
  );

export default FederatedGraphsPage;

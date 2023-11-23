import { docsBaseURL } from "@/lib/constants";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import {
  FederatedGraph,
  Subgraph,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { EmptyState } from "./empty-state";
import { Badge } from "./ui/badge";
import { CLISteps } from "./ui/cli";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

export const Empty = ({ graph }: { graph?: FederatedGraph }) => {
  let label = "team=A";
  if (graph?.labelMatchers && graph.labelMatchers.length > 0) {
    label = graph.labelMatchers[0].split(",")[0];
  }
  return (
    <EmptyState
      icon={<CommandLineIcon />}
      title="Create subgraph using CLI"
      description={
        <>
          No subgraphs found. Use the CLI tool to create one.{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={docsBaseURL + "/cli/subgraphs/create"}
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
              description:
                "Publish a subgraph. If the subgraph does not exist, it will be created.",
              command: `npx wgc subgraph publish users --schema users.graphql --label ${label} --routing-url http://localhost:4003/graphql`,
            },
          ]}
        />
      }
    />
  );
};

export const SubgraphsTable = ({
  graph,
  subgraphs,
}: {
  graph?: FederatedGraph;
  subgraphs: Subgraph[];
}) => {
  if (!subgraphs || subgraphs.length === 0) return <Empty graph={graph} />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="px-4">Name</TableHead>
          <TableHead className="w-4/12 px-4">Url</TableHead>
          <TableHead className="w-4/12 px-4 text-right">Labels</TableHead>
          <TableHead className="w-2/12 px-4 text-right">
            Last Published
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {subgraphs.map(({ name, routingURL, lastUpdatedAt, labels }) => {
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
                <div className="flex justify-end space-x-2">
                  {labels.map(({ key, value }) => {
                    return (
                      <Badge variant="secondary" key={key + value}>
                        {key}={value}
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
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

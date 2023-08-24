import { docsBaseURL } from "@/lib/constants";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import {
  Subgraph,
  FederatedGraph,
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
  TableRow
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
            href={docsBaseURL}
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
              description: "Create a subgraph",
              command: `npx wgc subgraph create users --label ${label} --routing-url http://localhost:4003/graphql`,
            },
            {
              description: "Publish schema to the subgraph",
              command: "npx wgc subgraph publish users --schema users.graphql",
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
          <TableHead>Name</TableHead>
          <TableHead>Url</TableHead>
          <TableHead>Last Published</TableHead>
          <TableHead>Labels</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {subgraphs.map(({ name, routingURL, lastUpdatedAt, labels }) => {
          return (
            <TableRow key={name}>
              <TableCell className="font-medium">{name}</TableCell>
              <TableCell>
                <Link target="_blank" rel="noreferrer" href={routingURL}>
                  {routingURL}
                </Link>
              </TableCell>
              <TableCell>
                {lastUpdatedAt
                  ? formatDistanceToNow(new Date(lastUpdatedAt))
                  : "Never"}
              </TableCell>
              <TableCell className="flex items-center">
                <div className="flex space-x-2">
                  {labels.map(({ key, value }) => {
                    return (
                      <Badge variant="secondary" key={key + value}>
                        {key}={value}
                      </Badge>
                    );
                  })}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

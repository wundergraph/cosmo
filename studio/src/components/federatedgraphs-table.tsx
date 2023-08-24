import { docsBaseURL } from "@/lib/constants";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { FederatedGraph } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { EmptyState } from "./empty-state";
import { CLI } from "./ui/cli";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { ComposeStatus, ComposeStatusMessage } from "./compose-status";
import { Badge } from "./ui/badge";
import { useRouter } from "next/router";

export const Empty = ({ graph }: { graph?: FederatedGraph }) => {
  let labels = "team=A";
  return (
    <EmptyState
      icon={<CommandLineIcon />}
      title="Create federated graph using CLI"
      description={
        <>
          No federated graphs found. Use the CLI tool to create one.{" "}
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
        <CLI
          command={`npx wgc federated-graph create production --label-matcher ${labels} --routing-url http://localhost:4000/graphql`}
        />
      }
    />
  );
};

export const FederatedGraphsTable = ({
  graphs,
}: {
  graphs?: FederatedGraph[];
}) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  if (!graphs || graphs.length === 0) return <Empty />;

  return (
    <Table>
      <TableCaption>Showing {graphs.length} graphs</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Url</TableHead>
          <TableHead>Last Published</TableHead>
          <TableHead>Matchers</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {graphs.map(
          ({
            name,
            routingURL,
            labelMatchers,
            lastUpdatedAt,
            isComposable,
            compositionErrors,
            connectedSubgraphs,
          }) => {
            return (
              <TableRow key={name}>
                <TableCell className="font-medium">
                  <Link
                    key={name}
                    href={`/${organizationSlug}/graph/${name}`}
                    className="hover:text-gray-400 hover:underline"
                  >
                    {name}
                  </Link>
                </TableCell>
                <TableCell className="flex items-center">
                  <TooltipProvider>
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger>
                        <ComposeStatus
                          validGraph={isComposable && !!lastUpdatedAt}
                          emptyGraph={!lastUpdatedAt && !isComposable}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <ComposeStatusMessage
                          errors={compositionErrors}
                          isComposable={isComposable}
                          lastUpdatedAt={lastUpdatedAt}
                          subgraphsCount={connectedSubgraphs}
                        />
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
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
                    {labelMatchers.map((lm) => {
                      return (
                        <Badge variant="secondary" key={lm}>
                          {lm}
                        </Badge>
                      );
                    })}
                  </div>
                </TableCell>
              </TableRow>
            );
          }
        )}
      </TableBody>
    </Table>
  );
};

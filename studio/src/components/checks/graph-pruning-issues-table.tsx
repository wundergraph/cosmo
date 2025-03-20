import { cn } from "@/lib/utils";
import { CheckCircleIcon, NoSymbolIcon } from "@heroicons/react/24/outline";
import { Cross1Icon } from "@radix-ui/react-icons";
import {
  GraphPruningIssue,
  LintSeverity,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import Link from "next/link";
import { useRouter } from "next/router";
import { CiWarning } from "react-icons/ci";
import { EmptyState } from "../empty-state";
import { Button } from "../ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "../ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export const GraphPruningIssuesTable = ({
  pruneIssues,
  caption,
  isGraphPruningEnabled,
}: {
  pruneIssues: GraphPruningIssue[];
  caption?: React.ReactNode;
  isGraphPruningEnabled: boolean;
}) => {
  const router = useRouter();

  if (pruneIssues.length === 0 && !isGraphPruningEnabled) {
    return (
      <EmptyState
        icon={<NoSymbolIcon className="text-gray-400" />}
        title="Schema Graph Pruning Skipped"
        description="Pruning was skipped for this run. Configure it to catch pruning issues in your schema."
        actions={
          <Button
            onClick={() => {
              router.push(
                `/${router.query.organizationSlug}/lint-policy?namespace=${router.query.namespace}`,
              );
            }}
          >
            Configure Lint Policy
          </Button>
        }
      />
    );
  }

  if (pruneIssues.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircleIcon className="text-success" />}
        title="Graph Prune Check Successful"
        description="There are no graph pruning issues in the proposed schema."
      />
    );
  }
  return (
    <TableWrapper className="max-h-full">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[300px]">Rule</TableHead>
            <TableHead>Field Path</TableHead>
            <TableHead>Message</TableHead>
            {pruneIssues[0].subgraphName && <TableHead>Subgraph</TableHead>}
            <TableHead className="w-[5px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pruneIssues.map((l, i) => (
            <TableRow key={l.severity + l.message} className="group">
              <TableCell
                className={cn(
                  l.severity === LintSeverity.error
                    ? "text-destructive"
                    : "text-warning",
                )}
              >
                <div className="flex items-center gap-x-2">
                  {l.severity === LintSeverity.error ? (
                    <Cross1Icon />
                  ) : (
                    <CiWarning className="h-[15px] w-[15px]" />
                  )}
                  <div className="block w-[300px] items-center truncate">
                    {l.graphPruningRuleType}
                  </div>
                </div>
              </TableCell>
              <TableCell>{l.fieldPath}</TableCell>
              <TableCell>{l.message}</TableCell>
              {l.subgraphName && <TableCell>{l.subgraphName}</TableCell>}
              <TableCell>
                <div className="flex items-center gap-x-2">
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="table-action"
                      >
                        <Link
                          href={`/${router.query.organizationSlug}/${
                            router.query.namespace
                          }/graph/${router.query.slug}/checks/${
                            router.query.checkId
                          }?tab=schema&${
                            l.subgraphName
                              ? `subgraph=${l.subgraphName}`
                              : ""
                          }${
                            l.issueLocation?.line
                              ? `#L${l.issueLocation?.line}`
                              : ""
                          }`}
                        >
                          View
                        </Link>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>View Issue in Schema</TooltipContent>
                  </Tooltip>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        {caption && <TableCaption>{caption}</TableCaption>}
      </Table>
    </TableWrapper>
  );
};

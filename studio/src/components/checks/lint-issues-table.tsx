import { cn } from "@/lib/utils";
import { CheckCircleIcon, NoSymbolIcon } from "@heroicons/react/24/outline";
import { Cross1Icon } from "@radix-ui/react-icons";
import {
  LintIssue,
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
import { useUser } from "@/hooks/use-user";
import { useContext } from "react";
import { GraphContext } from "@/components/layout/graph-layout";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

export const LintIssuesTable = ({
  lintIssues,
  caption,
  isLintingEnabled,
}: {
  lintIssues: LintIssue[];
  caption?: React.ReactNode;
  isLintingEnabled: boolean;
}) => {
  const router = useRouter();
  const user = useUser();
  const graphContext = useContext(GraphContext);
  const { namespace: { name: namespace } } = useWorkspace();
  const organizationSlug = useCurrentOrganization()?.slug;

  if (lintIssues.length === 0 && !isLintingEnabled) {
    return (
      <EmptyState
        icon={<NoSymbolIcon className="text-gray-400" />}
        title="Schema Linting Skipped"
        description="Linting was skipped for this run. Configure it to catch linting issues in your schema."
        actions={
          <Button
            onClick={() => {
              router.push(
                `/${user!.currentOrganization.slug}/policies?namespace=${graphContext?.graph?.namespace ?? "default"}`,
              );
            }}
          >
            Configure Lint Policy
          </Button>
        }
      />
    );
  }

  if (lintIssues.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircleIcon className="text-success" />}
        title="Lint Check Successful"
        description="There are no lint issues in the proposed schema."
      />
    );
  }
  return (
    <TableWrapper>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[380px]">Severity</TableHead>
            <TableHead>Message</TableHead>
            {lintIssues[0].subgraphName && <TableHead>Subgraph</TableHead>}
            <TableHead className="w-[5px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lintIssues.map((l, i) => (
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
                  <div
                    className={cn("block w-[350px] items-center truncate", {
                      "text-center": !l.lintRuleType,
                    })}
                  >
                    {l.lintRuleType || "-"}
                  </div>
                </div>
              </TableCell>
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
                          href={`/${organizationSlug}/${
                            namespace
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

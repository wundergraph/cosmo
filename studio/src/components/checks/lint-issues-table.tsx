import { cn } from "@/lib/utils";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { Cross1Icon, EyeOpenIcon } from "@radix-ui/react-icons";
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

export const LintIssuesTable = ({
  lintIssues,
  caption,
}: {
  lintIssues: LintIssue[];
  caption?: React.ReactNode;
}) => {
  const router = useRouter();

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
            <TableHead className="w-[200px]">Severity</TableHead>
            <TableHead>Message</TableHead>
            <TableHead className="w-1/12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lintIssues.map((l, i) => (
            <TableRow
              key={l.severity + l.message}
              className="group hover:bg-secondary/20"
            >
              <TableCell
                className={cn(
                  l.severity === LintSeverity.error
                    ? "text-destructive"
                    : "text-yellow-600",
                )}
              >
                <div className="flex items-center gap-x-2">
                  {l.severity === LintSeverity.error ? (
                    <Cross1Icon />
                  ) : (
                    <CiWarning className="h-[15px] w-[15px]" />
                  )}
                  <span className="block w-[160px] truncate">
                    {l.severity === LintSeverity.error ? "ERROR" : "WARNING"}
                  </span>
                </div>
              </TableCell>
              <TableCell>{l.message}</TableCell>
              <TableCell>
                <div className="flex items-center gap-x-2">
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="table-action"
                      >
                        <Link
                          href={`/${router.query.organizationSlug}/${
                            router.query.namespace
                          }/graph/${router.query.slug}/checks/${
                            router.query.checkId
                          }?tab=schema${
                            l.issueLocation?.line
                              ? `#L${l.issueLocation?.line}`
                              : ""
                          }`}
                        >
                          <EyeOpenIcon />
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

import { cn } from "@/lib/utils";
import { Cross1Icon, GlobeIcon } from "@radix-ui/react-icons";
import {
  LintIssue,
  LintSeverity,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import Link from "next/link";
import { useRouter } from "next/router";
import { CiWarning } from "react-icons/ci";
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
  return (
    <TableWrapper>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">Severity</TableHead>
            <TableHead>Message</TableHead>
            <TableHead className="w-2/12 2xl:w-1/12"></TableHead>
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
                <div className="flex items-center gap-3">
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
                          href={{
                            pathname: `/[organizationSlug]/[namespace]/graph/[slug]/checks/[checkId]`,
                            query: {
                              organizationSlug: router.query.organizationSlug,
                              namespace: router.query.namespace,
                              slug: router.query.slug,
                              checkId: router.query.checkId,
                              tab: "schema",
                            },
                          }}
                        >
                          <GlobeIcon />
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

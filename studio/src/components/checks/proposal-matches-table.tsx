import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui/table";
import { useUser } from "@/hooks/use-user";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  NoSymbolIcon,
} from "@heroicons/react/24/outline";
import { CrossCircledIcon } from "@radix-ui/react-icons";
import { GetCheckSummaryResponse_ProposalSchemaMatch } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useRouter } from "next/router";
import React, { useContext } from "react";
import { GraphContext } from "../layout/graph-layout";

export const ProposalMatchesTable = ({
  proposalMatches,
  caption,
  isProposalsEnabled,
  proposalMatch,
}: {
  proposalMatches: GetCheckSummaryResponse_ProposalSchemaMatch[];
  caption?: React.ReactNode;
  isProposalsEnabled: boolean;
  proposalMatch?: string;
}) => {
  const router = useRouter();
  const user = useUser();
  const graphContext = useContext(GraphContext);

  if (!proposalMatch && !isProposalsEnabled) {
    return (
      <EmptyState
        icon={<NoSymbolIcon className="text-gray-400" />}
        title="Proposals are disabled"
        description="Proposals are not configured for this graph. Enable them to match schema checks with proposals."
        actions={
          <Button
            onClick={() => {
              router.push(
                `/${user?.currentOrganization.slug}/policies?namespace=${graphContext?.graph?.namespace}#proposals`,
              );
            }}
          >
            Configure Proposals
          </Button>
        }
      />
    );
  }

  if (!proposalMatch) {
    return (
      <EmptyState
        icon={<NoSymbolIcon className="text-gray-400" />}
        title="Proposal match is skipped"
        description="Proposal match is skipped for this check."
      />
    );
  }

  if (proposalMatch === "error" && proposalMatches.length === 0) {
    return (
      <EmptyState
        icon={<CrossCircledIcon className="h-16 w-16 text-destructive" />}
        title="Proposal Match Check Failed"
        description="The proposal match check failed for this check as no matching proposal was found."
      />
    );
  }

  if (proposalMatch === "warn" && proposalMatches.length === 0) {
    return (
      <EmptyState
        icon={<ExclamationCircleIcon className="h-16 w-16 text-warning" />}
        title="Proposal Match Check passed with warnings"
        description="The proposal match check passed with warnings as the check severity was set to warn."
      />
    );
  }

  return (
    <TableWrapper>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">Status</TableHead>
            <TableHead>Proposal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {proposalMatches.map((match) => (
            <TableRow key={match.proposalId} className="group">
              <TableCell>
                <div className="flex items-center">
                  {match.proposalMatch ? (
                    <span className="inline-flex items-center rounded-md bg-success/20 px-2 py-1 text-xs text-success">
                      <CheckCircleIcon className="mr-1 h-3 w-3" />
                      Matching
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-md bg-destructive/20 px-2 py-1 text-xs text-destructive">
                      {proposalMatch === "error" ? (
                        <CrossCircledIcon className="mr-1 h-3 w-3 text-destructive" />
                      ) : (
                        <ExclamationCircleIcon className="mr-1 h-3 w-3 text-destructive" />
                      )}
                      Not Matching
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="font-medium">
                <div className="flex items-center gap-x-2">
                  <span>{match.proposalName}</span>
                </div>
              </TableCell>
              <TableCell className="mx-2 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    router.push(
                      `/${user?.currentOrganization.slug}/${graphContext?.graph?.namespace}/graph/${graphContext?.graph?.name}/proposals/${match.proposalId}`,
                    );
                  }}
                >
                  View Proposal
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        {caption && <TableCaption>{caption}</TableCaption>}
      </Table>
    </TableWrapper>
  );
};

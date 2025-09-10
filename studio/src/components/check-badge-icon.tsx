import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";
import { Badge } from "./ui/badge";

const isCheckSuccessful = (
  isComposable: boolean,
  isBreaking: boolean,
  hasClientTraffic: boolean,
  hasLintErrors: boolean,
  hasGraphPruningErrors: boolean,
  clientTrafficCheckSkipped: boolean,
  hasProposalMatchError: boolean,
  isLinkedTrafficCheckFailed?: boolean,
  isLinkedPruningCheckFailed?: boolean,
) => {
  // if a subgraph is linked to another subgraph, then the status of the check depends on the traffic and pruning check of the linked subgraph
  if (isLinkedTrafficCheckFailed || isLinkedPruningCheckFailed) {
    return false;
  }

  return (
    isComposable &&
    // If no breaking changes found
    // OR Breaking changes are found, but no client traffic is found and traffic check is not skipped
    (!isBreaking ||
      (isBreaking && !hasClientTraffic && !clientTrafficCheckSkipped)) &&
    !hasLintErrors &&
    !hasGraphPruningErrors &&
    !hasProposalMatchError
  );
};

const getCheckBadge = (successful: boolean, isForced: boolean) => {
  if (isForced) {
    return <Badge variant="outline">FORCED</Badge>;
  }

  return successful ? (
    <Badge variant="success">PASSED</Badge>
  ) : (
    <Badge variant="destructive">FAILED</Badge>
  );
};

const getCheckIcon = (check: boolean) => {
  if (check) {
    return (
      <div className="flex justify-center">
        <CheckCircledIcon className="h-4 w-4 text-success" />
      </div>
    );
  }
  return (
    <div className="flex justify-center">
      <CrossCircledIcon className="h-4 w-4 text-destructive" />
    </div>
  );
};

export { getCheckBadge, getCheckIcon, isCheckSuccessful };

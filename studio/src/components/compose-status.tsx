import { BoltIcon, BoltSlashIcon, CircleStackIcon } from '@heroicons/react/24/outline';

export const ComposeStatus = ({
  validGraph,
  emptyGraph,
}: {
  validGraph: boolean;
  emptyGraph: boolean;
}) => {
  if (emptyGraph) {
    return (
      <span className="flex h-5 w-max items-center truncate rounded border border-secondary text-xs">
        <span className="mx-2 truncate">No version</span>
        <span className="flex h-full w-6 items-center justify-center bg-secondary">
          <CircleStackIcon className="h-3 w-3" />
        </span>
      </span>
    );
  }
  if (validGraph) {
    return (
      <span className="flex h-5 w-max items-center truncate rounded border border-success text-xs text-success">
        <span className="mx-2 truncate">Successful</span>
        <span className="flex h-full w-6 items-center justify-center bg-success text-success-foreground">
          <BoltIcon className="h-3 w-3" />
        </span>
      </span>
    );
  } else {
    return (
      <span className="flex h-5 w-max items-center truncate rounded border border-destructive text-xs text-destructive ">
        <span className="mx-2 truncate">Composition error</span>
        <span className="flex h-full w-6 items-center justify-center bg-destructive text-destructive-foreground">
          <BoltSlashIcon className="h-3 w-3" />
        </span>
      </span>
    );
  }
};

export const ComposeStatusMessage = ({
  lastUpdatedAt,
  isComposable,
  errors,
  subgraphsCount,
}: {
  lastUpdatedAt?: string;
  isComposable: boolean;
  errors: string;
  subgraphsCount: number;
}) => {
  return lastUpdatedAt ? (
    isComposable ? (
      <span>Ready to be fetched from the router</span>
    ) : (
      <span className="whitespace-pre-line">{errors}</span>
    )
  ) : subgraphsCount ? (
    <span>Please publish a subgraph.</span>
  ) : (
    <span>Please create a subgraph.</span>
  );
};

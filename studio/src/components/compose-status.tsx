import {
  BoltIcon,
  BoltSlashIcon,
  CircleStackIcon,
} from "@heroicons/react/24/outline";

export const ComposeStatus = ({
  publishedGraph,
}: {
  publishedGraph: boolean;
}) => {
  if (!publishedGraph) {
    return (
      <span className="flex h-5 w-max items-center truncate rounded border border-secondary text-xs">
        <span className="mx-2 truncate">No version</span>
        <span className="flex h-full w-6 items-center justify-center bg-secondary">
          <CircleStackIcon className="h-3 w-3" />
        </span>
      </span>
    );
  }
  return (
    <span className="flex h-5 w-max items-center truncate rounded border border-success text-xs text-success">
      <span className="mx-2 truncate">Successful</span>
      <span className="flex h-full w-6 items-center justify-center bg-success text-success-foreground">
        <BoltIcon className="h-3 w-3" />
      </span>
    </span>
  );
};

export const ComposeStatusMessage = ({
  lastUpdatedAt,
  subgraphsCount,
}: {
  lastUpdatedAt?: string;
  subgraphsCount: number;
}) => {
  return lastUpdatedAt ? (
    <span>Ready to be fetched from the router</span>
  ) : subgraphsCount ? (
    <span>Please publish a subgraph.</span>
  ) : (
    <span>Please create a subgraph.</span>
  );
};

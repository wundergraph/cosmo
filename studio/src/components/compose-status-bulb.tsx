import clsx from "clsx";

export const ComposeStatusBulb = ({
  validGraph,
  emptyGraph,
}: {
  validGraph: boolean;
  emptyGraph: boolean;
}) => {
  return (
    <div
      className={clsx(
        "inline-flex h-2 w-2 items-center rounded-full",
        validGraph
          ? "bg-green-400"
          : emptyGraph
          ? "bg-yellow-400"
          : "bg-red-400"
      )}
    />
  );
};

import clsx from "clsx";

export const ComposeStatusBulb = ({
  publishedGraph,
}: {
  publishedGraph: boolean;
}) => {
  return (
    <div
      className={clsx(
        "inline-flex h-2 w-2 items-center rounded-full",
        publishedGraph ? "bg-green-400" : "bg-gray-400"
      )}
    />
  );
};

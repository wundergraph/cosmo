import { EmptyState } from "@/components/empty-state";
import { GraphContext } from "@/components/layout/graph-layout";
import { CLI } from "@/components/ui/cli";
import { docsBaseURL } from "@/lib/constants";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/router";
import { useContext } from "react";

export const EmptySchema = ({ subgraphName }: { subgraphName?: string }) => {
  const router = useRouter();
  const graphContext = useContext(GraphContext);

  const isFederated = graphContext?.graph?.supportsFederation;

  return (
    <EmptyState
      icon={<CommandLineIcon />}
      title="No schema found"
      description={
        isFederated ? (
          <>
            {subgraphName
              ? "Use the CLI tool to publish the subgraph."
              : "No subgraphs found. Use the CLI tool to create and publish one."}{" "}
            <a
              target="_blank"
              rel="noreferrer"
              href={docsBaseURL + "/cli/subgraphs/publish"}
              className="text-primary"
            >
              Learn more.
            </a>
          </>
        ) : (
          <>
            Please publish a schema to your monograph.{" "}
            <a
              target="_blank"
              rel="noreferrer"
              href={docsBaseURL + "/cli/monograph/publish"}
              className="text-primary"
            >
              Learn more.
            </a>
          </>
        )
      }
      actions={
        <CLI
          command={
            isFederated
              ? subgraphName
                ? `npx wgc subgraph publish ${subgraphName} --namespace ${router.query.namespace} --schema <path-to-schema>`
                : `npx wgc subgraph publish <subgraph-name> --namespace ${router.query.namespace} --schema <path-to-schema> --label <labels> --routing-url <routing-url>`
              : `npx wgc monograph publish ${graphContext?.graph?.name} --namespace ${router.query.namespace} --schema <path-to-schema>`
          }
        />
      }
    />
  );
};

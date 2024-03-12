import { EmptyState } from "@/components/empty-state";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { OverviewToolbar } from "@/components/overview/OverviewToolbar";
import { CLI } from "@/components/ui/cli";
import { docsBaseURL } from "@/lib/constants";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/router";
import { useContext } from "react";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

const Empty = ({ fedGraphName }: { fedGraphName: string }) => {
  const router = useRouter();
  const graphContext = useContext(GraphContext);

  return (
    <EmptyState
      icon={<CommandLineIcon />}
      title="Add federated graph README using CLI"
      description={
        <>
          No graph readme found. Use the CLI tool to add the readme.{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={docsBaseURL + "/studio/graph-documentation"}
            className="text-primary"
          >
            Learn more.
          </a>
        </>
      }
      actions={
        <CLI
          command={`npx wgc ${
            graphContext?.graph?.type === "federated"
              ? "federated-graph"
              : "monograph"
          } update ${fedGraphName} --namespace ${
            router.query.namespace
          } --readme <path-to-readme>`}
        />
      }
    />
  );
};

const FederatedGraphReadmePage = () => {
  const router = useRouter();
  const slug = router.query.slug as string;
  const graph = useContext(GraphContext);

  if (!graph || !graph.graph) return null;

  const { readme } = graph.graph;

  return (
    <div>
      {readme ? (
        <div className="flex h-full w-full">
          <div className="prose-pre:scrollbar-custom prose mx-auto h-full w-full max-w-full dark:prose-invert prose-code:bg-secondary prose-pre:!bg-secondary/50">
            <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {readme}
            </Markdown>
          </div>
        </div>
      ) : (
        <Empty fedGraphName={slug} />
      )}
    </div>
  );
};

FederatedGraphReadmePage.getLayout = (page: React.ReactNode) => {
  return getGraphLayout(page, {
    title: "README",
  });
};

FederatedGraphReadmePage.getLayout = (page: React.ReactNode) => {
  return getGraphLayout(
    <GraphPageLayout
      title="README"
      subtitle="The readme of your federated graph"
      toolbar={<OverviewToolbar tab="readme" />}
    >
      {page}
    </GraphPageLayout>,
    {
      title: "README",
    },
  );
};

export default FederatedGraphReadmePage;

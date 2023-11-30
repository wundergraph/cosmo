import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { SubgraphsTable } from "@/components/subgraphs-table";
import { NextPageWithLayout } from "@/lib/page";
import { useContext } from "react";

const SubGraphsPage: NextPageWithLayout = () => {
  const graphData = useContext(GraphContext);

  if (!graphData) return null;

  return (
    <SubgraphsTable subgraphs={graphData.subgraphs} graph={graphData.graph} />
  );
};

SubGraphsPage.getLayout = (page) =>
  getGraphLayout(
    <GraphPageLayout
      title="Subgraphs"
      subtitle="View the subgraphs that compose this federated graph"
    >
      {page}
    </GraphPageLayout>,
    { title: "Subgraphs" },
  );

export default SubGraphsPage;

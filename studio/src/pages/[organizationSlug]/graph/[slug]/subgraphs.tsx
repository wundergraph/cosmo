import { GraphContext, getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
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
    <PageHeader title="Studio | Subgraphs">
      <TitleLayout
        title="Subgraphs"
        subtitle="View the subgraphs that compose this federated graph"
      >
        {page}
      </TitleLayout>
    </PageHeader>
  );

export default SubGraphsPage;

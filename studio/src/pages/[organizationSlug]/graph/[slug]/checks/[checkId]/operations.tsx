import { ChecksToolbar } from "@/components/checks/toolbar";
import { getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { NextPageWithLayout } from "@/lib/page";

const CheckOperationsPage: NextPageWithLayout = () => {
  return <div>WIP</div>;
};

CheckOperationsPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Studio | Checks">
      <TitleLayout
        title="Check Operations"
        subtitle="View all affected operations for this check run"
        toolbar={<ChecksToolbar tab="operations" />}
      >
        {page}
      </TitleLayout>
    </PageHeader>,
  );

export default CheckOperationsPage;

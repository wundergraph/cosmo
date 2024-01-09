import { GraphDiscussions } from "@/components/discussions/discussions";
import { DiscussionsToolbar } from "@/components/discussions/toolbar";
import { PageHeader } from "@/components/layout/head";
import {
  SubgraphPageLayout,
  getSubgraphLayout,
} from "@/components/layout/subgraph-layout";
import { Toolbar } from "@/components/ui/toolbar";
import { useSubgraph } from "@/hooks/use-subgraph";
import { NextPageWithLayout } from "@/lib/page";
import { useRouter } from "next/router";

const SubgraphDiscussionsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const subgraphName = router.query.subgraphSlug as string;

  const subgraph = useSubgraph();

  return (
    <PageHeader title="Discussions | Studio">
      <SubgraphPageLayout
        title="Discussions"
        subtitle="View discussions across schema versions of your graph"
        toolbar={
          <Toolbar>
            <DiscussionsToolbar />
          </Toolbar>
        }
      >
        <GraphDiscussions
          targetId={subgraph?.subgraph?.targetId}
          linkToSchema={`/${organizationSlug}/subgraph/${subgraphName}/schema`}
        />
      </SubgraphPageLayout>
    </PageHeader>
  );
};

SubgraphDiscussionsPage.getLayout = getSubgraphLayout;

export default SubgraphDiscussionsPage;

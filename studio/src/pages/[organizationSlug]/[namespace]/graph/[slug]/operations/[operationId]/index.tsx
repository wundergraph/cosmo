import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { useRouter } from "next/router";
import { NextPageWithLayout } from "@/lib/page";
import { useCurrentOrganization } from "@/hooks/use-current-organization";
import { useWorkspace } from "@/hooks/use-workspace";
import Link from "next/link";

const OperationDetailsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const id = router.query.operationId as string;
  const organizationSlug = useCurrentOrganization()?.slug;
  const slug = router.query.slug as string;
  const {
    namespace: { name: namespace },
  } = useWorkspace();

  return (
    <GraphPageLayout
      title={id}
      subtitle="Detail related to a specific operation"
      breadcrumbs={[
        <Link
          key={0}
          href={`/${organizationSlug}/${namespace}/graph/${slug}/operations`}
        >
          Operations
        </Link>,
      ]}
    >
      <div className="flex h-full flex-col">
        <div className="flex-shrink-0 overflow-x-auto border-b scrollbar-thin">
          <dl className="flex w-full flex-col flex-wrap gap-x-8 gap-y-4 px-4 py-4 text-sm xl:flex-row">
            <div className="flex-start flex min-w-[240px] flex-col gap-2">
              <dt className="text-sm text-muted-foreground">Operation ID</dt>
              <dd className="text-sm">{id}</dd>
            </div>
          </dl>
        </div>
      </div>
    </GraphPageLayout>
  );
};

OperationDetailsPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Operation Details",
  });

export default OperationDetailsPage;

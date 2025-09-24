import { Changelog } from "@/components/changelog/changelog";
import { EmptyState } from "@/components/empty-state";
import {
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import {
  ExclamationTriangleIcon,
  InfoCircledIcon,
} from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getChangelogBySchemaVersion } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

const SchemaVersionChangelogPage: NextPageWithLayout = () => {
  const router = useRouter();
  const organizationSlug = useCurrentOrganization()?.slug;
  const { namespace: { name: namespace } } = useWorkspace();
  const slug = router.query.slug as string;
  const id = router.query.schemaVersionId as string;

  const { data, isLoading, error, refetch } = useQuery(
    getChangelogBySchemaVersion,
    {
      schemaVersionId: id,
    },
  );

  if (isLoading) return <Loader fullscreen />;

  return (
    <GraphPageLayout
      title={id}
      subtitle=""
      breadcrumbs={[
        <Link
          key={0}
          href={`/${organizationSlug}/${namespace}/graph/${slug}/changelog`}
        >
          Changelog
        </Link>,
      ]}
      noPadding
    >
      {!data ||
      !data.changelog ||
      error ||
      data.response?.code !== EnumStatusCode.OK ? (
        <EmptyState
          icon={<ExclamationTriangleIcon className="h-8 w-8" />}
          title="Could not retrieve changelog"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      ) : data.changelog.changelogs.length === 0 ? (
        <EmptyState
          icon={<InfoCircledIcon className="h-8 w-8" />}
          title="No changes found for this schema version"
          actions={<Button onClick={() => router.back()}>Go back</Button>}
        />
      ) : (
        <div className="p-8">
          <Changelog entries={[data.changelog]} />
        </div>
      )}
    </GraphPageLayout>
  );
};

SchemaVersionChangelogPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Changelog",
  });

export default SchemaVersionChangelogPage;

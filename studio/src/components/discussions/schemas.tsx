import { EmptyState } from "@/components/empty-state";
import { SDLViewerMonaco } from "@/components/schema/sdl-viewer-monaco";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getDiscussionSchemas } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { Discussion } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useRouter } from "next/router";

export const DiscussionSchemas = ({
  view,
  discussion,
}: {
  view: "single" | "diff";
  discussion?: Discussion;
}) => {
  const router = useRouter();
  const slug = router.query.slug as string;
  const id = router.query.discussionId as string;

  const { data, isLoading, error, refetch } = useQuery(
    getDiscussionSchemas.useQuery({
      discussionId: id,
    }),
  );

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve reference schema"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  if (!data || !discussion) return null;

  return (
    <SDLViewerMonaco
      schema={data?.schemas?.reference ?? ""}
      newSchema={view === "diff" ? data?.schemas?.latest ?? "" : undefined}
      line={discussion?.referenceLine}
    />
  );
};

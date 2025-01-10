import { CacheOperationsTable } from "@/components/cache/operations-table";
import { EmptyState } from "@/components/empty-state";
import {
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { useToast } from "@/components/ui/use-toast";
import { NextPageWithLayout } from "@/lib/page";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon, UpdateIcon } from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  computeCacheWarmerOperations,
  getCacheWarmerOperations,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";

const CacheOperationsPage: NextPageWithLayout = () => {
  const router = useRouter();

  const federatedGraphName = router.query.slug as string;
  const namespace = router.query.namespace as string;

  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;
  const pageSize = Number.parseInt((router.query.pageSize as string) || "10");
  const limit = pageSize > 50 ? 50 : pageSize;
  const offset = (pageNumber - 1) * limit;

  const { toast } = useToast();

  const { data, isLoading, error, refetch } = useQuery(
    getCacheWarmerOperations,
    {
      federatedGraphName,
      namespace,
      limit,
      offset,
    },
  );

  const { mutate } = useMutation(computeCacheWarmerOperations, {
    onSuccess: (d) => {
      if (d.response?.code === EnumStatusCode.OK) {
        refetch();
      } else {
        toast({
          description:
            d.response?.details ??
            "Could not recompute cache warmer operations. Please try again.",
          duration: 3000,
        });
      }
    },
    onError: () => {
      toast({
        description:
          "Could not recompute cache warmer operations. Please try again.",
        duration: 3000,
      });
    },
  });

  if (isLoading) {
    return <Loader fullscreen />;
  }

  if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={
          <ExclamationTriangleIcon className="h-12 w-12 text-destructive" />
        }
        title="Could not retrieve cache warmer operations."
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          className="flex gap-x-2"
          onClick={() => {
            mutate({ federatedGraphName, namespace });
          }}
        >
          <UpdateIcon />
          Recompute
        </Button>
      </div>
      <CacheOperationsTable
        operations={data.operations}
        totalCount={data.totalCount}
      />
    </div>
  );
};

CacheOperationsPage.getLayout = (page) =>
  getGraphLayout(
    <GraphPageLayout
      title="Cache Operations"
      subtitle="View the cache operations of the federated graph"
    >
      {page}
    </GraphPageLayout>,
    { title: "Cache" },
  );

export default CacheOperationsPage;

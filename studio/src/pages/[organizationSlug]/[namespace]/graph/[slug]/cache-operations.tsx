import { CacheDetailsSheet } from "@/components/cache/cache-details-sheet";
import { CacheOperationsTable } from "@/components/cache/operations-table";
import { EmptyState } from "@/components/empty-state";
import {
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { useToast } from "@/components/ui/use-toast";
import { useUser } from "@/hooks/use-user";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import {
  ExclamationTriangleIcon,
  InfoCircledIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  computeCacheWarmerOperations,
  getCacheWarmerOperations,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { formatDistanceToNow } from "date-fns";
import debounce from "debounce";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

const CacheOperationsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const federatedGraphName = router.query.slug as string;
  const namespace = router.query.namespace as string;
  const user = useUser();
  const plan = user?.currentOrganization?.billing?.plan;

  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;
  const pageSize = Number.parseInt((router.query.pageSize as string) || "10");
  const limit = pageSize > 50 ? 50 : pageSize;
  const offset = (pageNumber - 1) * limit;

  const { toast } = useToast();

  const [recomputeDisabled, setRecomputeDisabled] = useState(false);
  const [lastComputedAt, setLastComputedAt] = useState<Date | null>(null);

  const { data, isLoading, error, refetch } = useQuery(
    getCacheWarmerOperations,
    {
      federatedGraphName,
      namespace,
      limit,
      offset,
    },
    {
      enabled: plan === "enterprise",
    },
  );

  useEffect(() => {
    if (!data) return;
    const computedAt = data.operations.find(
      (op) => op.isManuallyAdded === false,
    )?.createdAt;
    if (computedAt) {
      setLastComputedAt(new Date(computedAt));
    }
  }, [data]);

  const debounceRecompute = debounce(() => {
    setRecomputeDisabled(false);
  }, 2000);

  const { mutate, isPending } = useMutation(computeCacheWarmerOperations, {
    onSuccess: (d) => {
      if (d.response?.code === EnumStatusCode.OK) {
        refetch();
        setRecomputeDisabled(true);
        debounceRecompute();
        toast({
          description: "Cache warmer operations recomputed successfully.",
          duration: 1500,
        });
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

  if (plan !== "enterprise") {
    return (
      <EmptyState
        icon={<InfoCircledIcon className="h-12 w-12" />}
        title="Cache Warmer is not available"
        description="Please upgrade to the enterprise plan to use the cache warmer."
        actions={
          <Button
            onClick={() => {
              router.push(`/${router.query.organizationSlug}/billing`);
            }}
          >
            Upgrade
          </Button>
        }
      />
    );
  }

  if (!data?.isCacheWarmerEnabled) {
    return (
      <EmptyState
        icon={<InfoCircledIcon className="h-12 w-12" />}
        title="Cache Warmer is not enabled"
        description="Enable cache warmer to warm the router with your top operations."
        actions={
          <Button
            onClick={() => {
              router.push(
                `/${router.query.organizationSlug}/cache-warmer?namespace=${router.query.namespace}`,
              );
            }}
          >
            Configure Cache Warmer
          </Button>
        }
      />
    );
  }

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
        <div className="flex items-center gap-x-3">
          {lastComputedAt && (
            <p className="text-sm font-semibold text-muted-foreground">{`Last computed ${formatDistanceToNow(new Date(lastComputedAt), {
              addSuffix: true,
            })}`}</p>
          )}
          <Button
            variant="outline"
            className="flex gap-x-2"
            onClick={() => {
              mutate({ federatedGraphName, namespace });
            }}
            disabled={isPending || recomputeDisabled}
          >
            <UpdateIcon
              className={cn("", {
                "animate-spin": isPending,
              })}
            />
            Recompute
          </Button>
        </div>
      </div>
      <CacheOperationsTable
        operations={data.operations}
        totalCount={data.totalCount}
      />
      <CacheDetailsSheet operations={data.operations} />
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

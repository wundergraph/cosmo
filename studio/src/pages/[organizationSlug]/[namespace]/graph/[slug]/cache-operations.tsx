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
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { docsBaseURL } from "@/lib/constants";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";
import { useWorkspace } from "@/hooks/use-workspace";

const CacheOperationsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const federatedGraphName = router.query.slug as string;
  const { namespace: { name: namespace } } = useWorkspace();
  const user = useUser();
  const checkUserAccess = useCheckUserAccess();
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
              router.push(`/${user?.currentOrganization.slug}/billing`);
            }}
          >
            Upgrade
          </Button>
        }
      />
    );
  }

  if (isLoading) {
    return <Loader fullscreen />;
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
                `/${user?.currentOrganization.slug}/cache-warmer?namespace=${namespace}`,
              );
            }}
          >
            Configure Cache Warmer
          </Button>
        }
      />
    );
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
      <div className="flex items-center justify-between">
        <div className="items-start">
          <p className="text-sm text-muted-foreground">
            Operations provided to the router to warm the cache. Manually added
            operation have priority over the top 100 operations computed by
            planning time.{" "}
            <Link
              href={docsBaseURL + "/concepts/cache-warmer"}
              className="text-primary"
              target="_blank"
              rel="noreferrer"
            >
              Learn more
            </Link>
          </p>
        </div>
        <div className="flex justify-end">
          <div className="flex items-center gap-x-3">
            <Button
              variant="outline"
              className="flex gap-x-2"
              onClick={() => {
                mutate({ federatedGraphName, namespace });
              }}
              disabled={
                isPending ||
                recomputeDisabled ||
                !checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] })
              }
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
      </div>
      <div className="grid auto-cols-fr grid-flow-col grid-rows-2 gap-4 py-4 md:grid-rows-none">
        <div className="flex h-full w-full flex-col gap-y-4 rounded-md border px-8 py-6">
          <h2 className="flex items-center gap-x-2">
            <span className="leading-none tracking-tight text-muted-foreground">
              Total Items
            </span>
          </h2>
          <div>
            <span className="text-xl font-semibold">{data.totalCount}</span>
          </div>
        </div>
        <div className="flex h-full w-full flex-col gap-y-4 rounded-md border px-8 py-6">
          <h2 className="flex items-center gap-x-2">
            <span className="leading-none tracking-tight text-muted-foreground">
              Last Computed
            </span>
          </h2>
          <div>
            <span className="text-xl font-semibold">
              {" "}
              {lastComputedAt && (
                <p>
                  {formatDistanceToNow(new Date(lastComputedAt), {
                    addSuffix: true,
                  })}
                </p>
              )}
            </span>
          </div>
        </div>
      </div>
      <CacheOperationsTable
        operations={data.operations}
        totalCount={data.totalCount}
        refetch={refetch}
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

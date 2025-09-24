import { CacheWarmerConfig } from "@/components/cache/cache-warmer-config";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { useFeature } from "@/hooks/use-feature";
import { useUser } from "@/hooks/use-user";
import { docsBaseURL } from "@/lib/constants";
import { NextPageWithLayout } from "@/lib/page";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import {
  ExclamationTriangleIcon,
  InfoCircledIcon,
} from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  configureCacheWarmer,
  getCacheWarmerConfig,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";
import { WorkspaceSelector } from "@/components/dashboard/workspace-selector";
import { useWorkspace } from "@/hooks/use-workspace";

const CacheWarmerPage: NextPageWithLayout = () => {
  const router = useRouter();
  const user = useUser();
  const checkUserAccess = useCheckUserAccess();
  const { namespace: { name: namespace } } = useWorkspace();
  const cacheWarmerFeature = useFeature("cache-warmer");
  const { mutate } = useMutation(configureCacheWarmer);
  const { toast } = useToast();

  const { data, isLoading, refetch, error } = useQuery(getCacheWarmerConfig, {
    namespace,
  });

  const [cacheWarmerEnabled, setCacheWarmerEnabled] = useState(false);
  const [currentOperationsCount, setCurrentOperationsCount] = useState(100);

  useEffect(() => {
    if (!data || data?.response?.code !== EnumStatusCode.OK) return;
    setCacheWarmerEnabled(data.isCacheWarmerEnabled);
    setCurrentOperationsCount(data.maxOperationsCount || 100);
  }, [data]);

  if (isLoading) {
    return <Loader fullscreen />;
  }
  if (
    error ||
    !data ||
    (data?.response?.code !== EnumStatusCode.OK &&
      data?.response?.code !== EnumStatusCode.ERR_UPGRADE_PLAN)
  ) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon className="h-12 w-12" />}
        title="Could not retrieve the cache warmer config of the namesapce"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  if (data?.response?.code === EnumStatusCode.ERR_UPGRADE_PLAN) {
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

  return (
      <div className="space-y-6 rounded-lg border p-6">
        <div className="flex w-full items-center justify-between">
          <div className="flex flex-col gap-y-1">
            <h3 className="font-semibold tracking-tight">
              Enable Cache Warmer
            </h3>
            <p className="text-sm text-muted-foreground">
              {!!cacheWarmerFeature?.enabled
                ? "Enable cache warmer to warm the router with your top opeartions."
                : "Upgrade your billing plan to use this cacheWarmer."}{" "}
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
          <Switch
            checked={cacheWarmerEnabled}
            disabled={
              !cacheWarmerFeature?.enabled ||
              !checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] })
            }
            onCheckedChange={(checked) => {
              setCacheWarmerEnabled(checked);
              mutate(
                {
                  enableCacheWarmer: checked,
                  namespace,
                  maxOperationsCount: checked ? 100 : undefined,
                },
                {
                  onSuccess: (d) => {
                    if (d.response?.code === EnumStatusCode.OK) {
                      toast({
                        description: checked
                          ? "Cache Warmer enabled successfully."
                          : "Cache Warmer disabled successfully",
                        duration: 3000,
                      });
                    } else if (d.response?.details) {
                      toast({
                        description: d.response.details,
                        duration: 3000,
                      });
                    }
                    refetch();
                  },
                  onError: (error) => {
                    toast({
                      description: checked
                        ? "Could not enable the cache warmer. Please try again."
                        : "Could not disable the cache warmer. Please try again.",
                      duration: 3000,
                    });
                  },
                },
              );
            }}
          />
        </div>
      <CacheWarmerConfig
        key={currentOperationsCount}
        cacheWarmerEnabled={cacheWarmerEnabled}
        currentOperationsCount={currentOperationsCount}
        refetch={refetch}
      />
    </div>
  );
};

CacheWarmerPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Cache Warmer",
    "Configure cache warming to warm your router with top operations..",
    undefined,
    undefined,
    [<WorkspaceSelector key="0" />],
  );
};

export default CacheWarmerPage;

import { useEffect, useState } from "react";
import { NextPageWithLayout } from "@/lib/page";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { WorkspaceSelector } from "@/components/dashboard/workspace-selector";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import {
  getSubgraphCheckExtensionsConfig,
  configureSubgraphCheckExtensions,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useWorkspace } from "@/hooks/use-workspace";
import { Loader } from "@/components/ui/loader";
import { useFeature } from "@/hooks/use-feature";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { EmptyState } from "@/components/empty-state";
import { ExclamationTriangleIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/router";
import { useUser } from "@/hooks/use-user";
import { Switch } from "@/components/ui/switch";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";
import {
  CheckExtensionsConfig,
  type SubgraphCheckExtensionsConfig
} from "@/components/check-extensions/check-extensions-config";
import { useToast } from "@/components/ui/use-toast";

const CheckExtensionsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const user = useUser();
  const { toast } = useToast();
  const checkUserAccess = useCheckUserAccess();
  const { namespace: { name: namespace } } = useWorkspace();
  const subgraphCheckExtensionsFeature = useFeature("subgraph-check-extensions");
  const [enableSubgraphCheckExtensions, setEnableSubgraphCheckExtensions] = useState(false);

  const { mutate, isPending } = useMutation(configureSubgraphCheckExtensions);
  const { data, isLoading, isRefetching, refetch, error } = useQuery(
    getSubgraphCheckExtensionsConfig,
    { namespace },
    {
      select(res) {
        return {
          code: res.response?.code,
          details: res.response?.details,
          isSecretKeyAssigned: res.isSecretKeyAssigned,
          isLintingEnabledForNamespace: res.isLintingEnabledForNamespace,
          isGraphPruningEnabledForNamespace: res.isGraphPruningEnabledForNamespace,
          config: {
            ...res,
            enableSubgraphCheckExtensions: res.isEnabledForNamespace,
            secretKey: undefined,
          } satisfies SubgraphCheckExtensionsConfig
        };
      },
    },
  );

  useEffect(
    () => setEnableSubgraphCheckExtensions(data?.config.enableSubgraphCheckExtensions === true),
    [data?.config.enableSubgraphCheckExtensions],
  );

  const saveChanges = (
    config: Partial<SubgraphCheckExtensionsConfig>,
    onSuccessMessage: string,
    onFailureMessage: string,
    onConfigUpdated?: (newConfig: SubgraphCheckExtensionsConfig) => void
  ) => {
    mutate(
      { namespace, ...config, enableSubgraphCheckExtensions },
      {
        onSuccess(d) {
          if (d.response?.code === EnumStatusCode.OK) {
            toast({ description: onSuccessMessage, duration: 3000 });
            refetch().then(
              (result) => {
                if (result.data?.code === EnumStatusCode.OK) {
                  onConfigUpdated?.(result.data.config)
                }
              },
              () => {
                if (data?.config) {
                  onConfigUpdated?.(data.config);
                }
              },
            );
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 3000 });
          }
        },
        onError() {
          toast({ description: onFailureMessage });
        },
      },
    );
  };

  if (isLoading) {
    return <Loader fullscreen />;
  }

  if (error || !data || (data?.code !== EnumStatusCode.OK && data?.code !== EnumStatusCode.ERR_UPGRADE_PLAN)) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon className="h-12 w-12" />}
        title="Could not retrieve the subgraph check extensions config of the namespace"
        description={
          data?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  if (data.code === EnumStatusCode.ERR_UPGRADE_PLAN) {
    return (
      <EmptyState
        icon={<InfoCircledIcon className="h-12 w-12" />}
        title="Subgraph Check Extensions are not available"
        description="Please upgrade to the enterprise plan to use the subgraph check extensions."
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
            Enable Subgraph Check Extensions
          </h3>
        </div>

        <Switch
          checked={enableSubgraphCheckExtensions}
          disabled={
            isPending ||
            isRefetching ||
            !subgraphCheckExtensionsFeature?.enabled ||
            !checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] })
          }
          onCheckedChange={setEnableSubgraphCheckExtensions}
        />
      </div>

      <CheckExtensionsConfig
        config={data.config}
        enableSubgraphCheckExtensions={enableSubgraphCheckExtensions}
        isSecretKeyAssigned={data.isSecretKeyAssigned}
        isLintingEnabledForNamespace={data.isLintingEnabledForNamespace}
        isGraphPruningEnabledForNamespace={data.isGraphPruningEnabledForNamespace}
        isUpdatingConfig={isPending || isRefetching}
        onSaveChanges={(newConfig, onConfigUpdated) => saveChanges(
          newConfig,
          'Subgraph check extensions config updated successfully.',
          'Could not update the subgraph check extensions config. Please try again.',
          onConfigUpdated,
        )}
      />
    </div>
  );
}

CheckExtensionsPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Check Extensions",
    "Configure subgraph check extensions.",
    undefined,
    undefined,
    [<WorkspaceSelector key="0" />],
  );
}

export default CheckExtensionsPage;
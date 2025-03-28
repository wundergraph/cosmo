import { ProposalConfig } from "@/components/proposal/proposal-config";
import { NamespaceSelector } from "@/components/dashboard/NamespaceSelector";
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
import { checkUserAccess } from "@/lib/utils";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import {
  ExclamationTriangleIcon,
  InfoCircledIcon,
} from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  configureNamespaceProposalConfig,
  enableProposalsForNamespace,
  getNamespaceProposalConfig,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { LintSeverity } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";

const ProposalConfigPage: NextPageWithLayout = () => {
  const router = useRouter();
  const user = useUser();
  const namespace = router.query.namespace as string;
  const proposalsFeature = useFeature("proposals");
  const { mutate: enableProposals } = useMutation(enableProposalsForNamespace);
  const { toast } = useToast();

  const { data, isLoading, refetch, error } = useQuery(
    getNamespaceProposalConfig,
    {
      namespace: namespace || "default",
    },
  );

  const [proposalsEnabled, setProposalsEnabled] = useState(false);
  const [checkSeverityLevel, setCheckSeverityLevel] = useState<LintSeverity>(
    LintSeverity.warn,
  );
  const [publishSeverityLevel, setPublishSeverityLevel] =
    useState<LintSeverity>(LintSeverity.warn);

  useEffect(() => {
    if (!data || data?.response?.code !== EnumStatusCode.OK) return;
    setProposalsEnabled(data.enabled);
    setCheckSeverityLevel(data.checkSeverityLevel);
    setPublishSeverityLevel(data.publishSeverityLevel);
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
        title="Could not retrieve the proposal config of the namespace"
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
        title="Proposals are not available"
        description="Please upgrade to the enterprise plan to use proposals."
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
          <h3 className="font-semibold tracking-tight">Enable Proposals</h3>
          <p className="text-sm text-muted-foreground">
            {!!proposalsFeature?.enabled
              ? "Enable proposals to require changes to the schema to go through a proposal process."
              : "Upgrade your billing plan to use proposals."}{" "}
            <Link
              href={docsBaseURL + "/concepts/proposals"}
              className="text-primary"
              target="_blank"
              rel="noreferrer"
            >
              Learn more
            </Link>
          </p>
        </div>
        <Switch
          checked={proposalsEnabled}
          disabled={
            !proposalsFeature?.enabled ||
            !checkUserAccess({
              rolesToBe: ["admin"],
              userRoles: user?.currentOrganization.roles || [],
            })
          }
          onCheckedChange={(checked) => {
            setProposalsEnabled(checked);
            enableProposals(
              {
                namespace: namespace || "default",
                enableProposals: checked,
              },
              {
                onSuccess: (d) => {
                  if (d.response?.code === EnumStatusCode.OK) {
                    toast({
                      description: checked
                        ? "Proposals enabled successfully."
                        : "Proposals disabled successfully",
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
                      ? "Could not enable proposals. Please try again."
                      : "Could not disable proposals. Please try again.",
                    duration: 3000,
                  });
                },
              },
            );
          }}
        />
      </div>
      <ProposalConfig
        key={proposalsEnabled ? "enabled" : "disabled"}
        proposalsEnabled={proposalsEnabled}
        currentCheckSeverityLevel={checkSeverityLevel}
        currentPublishSeverityLevel={publishSeverityLevel}
        refetch={refetch}
      />
    </div>
  );
};

ProposalConfigPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Proposal Config",
    "Configure proposals for the namespace.",
    undefined,
    undefined,
    [<NamespaceSelector key="0" />],
  );
};

export default ProposalConfigPage;

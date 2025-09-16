import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { useState } from "react";
import { useToast } from "../ui/use-toast";
import {
  configureNamespaceProposalConfig,
  enableProposalsForNamespace,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useMutation } from "@connectrpc/connect-query";
import { Button } from "../ui/button";
import {
  GetNamespaceProposalConfigResponse,
  LintSeverity,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useFeature } from "@/hooks/use-feature";
import { docsBaseURL } from "@/lib/constants";
import Link from "next/link";
import { Switch } from "../ui/switch";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";
import { useWorkspace } from "@/hooks/use-workspace";

export const ProposalConfig = ({
  data,
  refetch,
}: {
  data: GetNamespaceProposalConfigResponse;
  refetch: () => void;
}) => {
  const checkUserAccess = useCheckUserAccess();
  const { namespace: { name: namespace } } = useWorkspace();

  const proposalsFeature = useFeature("proposals");

  const { mutate: enableProposals } = useMutation(enableProposalsForNamespace);
  const { mutate: configureProposalConfig, isPending } = useMutation(
    configureNamespaceProposalConfig,
  );
  const [proposalsEnabled, setProposalsEnabled] = useState(data.enabled);
  const [checkSeverityLevel, setCheckSeverityLevel] = useState<string>(
    data.checkSeverityLevel === LintSeverity.warn ? "warn" : "error",
  );
  const [publishSeverityLevel, setPublishSeverityLevel] = useState<string>(
    data.publishSeverityLevel === LintSeverity.warn ? "warn" : "error",
  );
  const { toast } = useToast();

  const severityOptions = [
    { value: "error", label: "error" },
    { value: "warn", label: "warn" },
  ];

  return (
    <div className="space-y-6 rounded-lg border p-6" id="proposals">
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
            !checkUserAccess({ rolesToBe: ["organization-admin"] })
          }
          onCheckedChange={(checked) => {
            setProposalsEnabled(checked);
            enableProposals(
              {
                namespace,
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
                onError: (_) => {
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

      <Card>
        <CardHeader>
          <div className="flex w-full items-center justify-between">
            <div className="flex flex-col gap-y-2">
              <CardTitle>Proposal Configuration</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                {proposalsEnabled
                  ? "Configure the proposal severity levels for subgraph checks and publishes."
                  : "Enable proposals to set the severity levels."}
              </CardDescription>
            </div>
            <Button
              type="submit"
              variant="default"
              isLoading={isPending}
              disabled={
                !proposalsEnabled ||
                !checkUserAccess({ rolesToBe: ["organization-admin"] })
              }
              onClick={() => {
                configureProposalConfig(
                  {
                    namespace,
                    checkSeverityLevel:
                      checkSeverityLevel === "error"
                        ? LintSeverity.error
                        : LintSeverity.warn,
                    publishSeverityLevel:
                      publishSeverityLevel === "error"
                        ? LintSeverity.error
                        : LintSeverity.warn,
                  },
                  {
                    onSuccess: (d) => {
                      if (d.response?.code === EnumStatusCode.OK) {
                        toast({
                          description: "Proposal config set successfully.",
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
                    onError: (_) => {
                      toast({
                        description:
                          "Could not set the proposal config. Please try again.",
                        duration: 3000,
                      });
                    },
                  },
                );
              }}
            >
              Apply
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex w-full flex-col gap-y-3 divide-y divide-solid divide-secondary">
            <div className="flex w-full flex-col justify-between gap-y-4 pt-3 md:flex-row md:items-center">
              <div className="flex flex-col gap-y-1">
                <label
                  htmlFor="OperationsCount"
                  className="break-all text-sm font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Check Severity Level
                </label>
                <span className="text-sm text-muted-foreground">
                  Set the severity level for subgraph checks during proposal
                  evaluation
                </span>
              </div>
              <Select
                value={checkSeverityLevel}
                disabled={!proposalsEnabled}
                onValueChange={(value) => {
                  setCheckSeverityLevel(value);
                }}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {severityOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-full flex-col justify-between gap-y-4 pt-3 md:flex-row md:items-center">
              <div className="flex flex-col gap-y-1">
                <label
                  htmlFor="OperationsCount"
                  className="break-all text-sm font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Publish Severity Level
                </label>
                <span className="text-sm text-muted-foreground">
                  Set the severity level for subgraph publishes during proposal
                  evaluation
                </span>
              </div>
              <Select
                value={publishSeverityLevel}
                disabled={!proposalsEnabled}
                onValueChange={(value) => {
                  setPublishSeverityLevel(value);
                }}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {severityOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

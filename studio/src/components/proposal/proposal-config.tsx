import { useRouter } from "next/router";
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
import { useUser } from "@/hooks/use-user";
import { checkUserAccess } from "@/lib/utils";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { useState } from "react";
import { useToast } from "../ui/use-toast";
import { configureNamespaceProposalConfig } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useMutation } from "@connectrpc/connect-query";
import { Button } from "../ui/button";
import { LintSeverity } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";

export const ProposalConfig = ({
  currentCheckSeverityLevel,
  currentPublishSeverityLevel,
  proposalsEnabled,
  refetch,
}: {
  currentCheckSeverityLevel: LintSeverity;
  currentPublishSeverityLevel: LintSeverity;
  proposalsEnabled: boolean;
  refetch: () => void;
}) => {
  const router = useRouter();
  const user = useUser();
  const namespace = router.query.namespace as string;
  const { mutate: configureProposalConfig, isPending } = useMutation(
    configureNamespaceProposalConfig,
  );
  const [checkSeverityLevel, setCheckSeverityLevel] = useState<string>(
    currentCheckSeverityLevel === LintSeverity.error ? "error" : "warn",
  );
  const [publishSeverityLevel, setPublishSeverityLevel] = useState<string>(
    currentPublishSeverityLevel === LintSeverity.error ? "error" : "warn",
  );
  const { toast } = useToast();

  const severityOptions = [
    { value: "warn", label: "warn" },
    { value: "error", label: "error" },
  ];

  return (
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
              !checkUserAccess({
                rolesToBe: ["admin"],
                userRoles: user?.currentOrganization.roles || [],
              })
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
                  onError: (error) => {
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
  );
};

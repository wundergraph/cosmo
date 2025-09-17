import { useFeature } from "@/hooks/use-feature";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { useUser } from "@/hooks/use-user";
import { docsBaseURL, graphPruningRules } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useMutation } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  configureNamespaceGraphPruningConfig,
  enableGraphPruning,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  GetNamespaceGraphPruningConfigResponse,
  GraphPruningConfig,
  LintSeverity,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Switch } from "../ui/switch";
import { useToast } from "../ui/use-toast";
import { SeverityDropdown } from "./linter-config";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";
import { useWorkspace } from "@/hooks/use-workspace";

const fetchPeriodOptions = (
  limit: number,
): { label: string; value: string }[] => {
  const options = [
    { label: "3 days", value: "3" },
    { label: "7 days", value: "7" },
    { label: "10 days", value: "10" },
    { label: "14 days", value: "14" },
    { label: "30 days", value: "30" },
    { label: "45 days", value: "45" },
    { label: "60 days", value: "60" },
    { label: "90 days", value: "90" },
  ];

  return options.filter((option) => Number(option.value) <= limit);
};

export const GracePeriodDropdown = ({
  onChange,
  value,
  disabled,
}: {
  onChange: (value: string) => void;
  value: string;
  disabled: boolean;
}) => {
  const limit = useFeatureLimit("field-pruning-grace-period", 7);
  const options = fetchPeriodOptions(limit);

  return (
    <Select
      value={value}
      onValueChange={(value) => {
        onChange(value);
      }}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-36">
        <SelectValue placeholder={value} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Field Grace Period</SelectLabel>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};

export const SchemaUsageCheckPeriodDropdown = ({
  onChange,
  value,
  disabled,
}: {
  onChange: (value: string) => void;
  value: string;
  disabled: boolean;
}) => {
  // this is the limit used for schema usage check
  const limit = useFeatureLimit("breaking-change-retention", 7);
  const options = fetchPeriodOptions(limit);

  return (
    <Select
      value={value}
      onValueChange={(value) => {
        onChange(value);
      }}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-36">
        <SelectValue placeholder={value} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Schema Usage Check Period</SelectLabel>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};

export const GraphPruningLintConfig = ({
  data,
  refetch,
}: {
  data: GetNamespaceGraphPruningConfigResponse;
  refetch: () => void;
}) => {
  const user = useUser();
  const checkUserAccess = useCheckUserAccess();
  const { namespace: { name: namespace } } = useWorkspace();
  const feature = useFeature("field-pruning-grace-period");
  const plan = user?.currentOrganization?.billing?.plan;

  const { mutate: configureGraphPruningRules, isPending: isConfiguring } =
    useMutation(configureNamespaceGraphPruningConfig);
  const { mutate } = useMutation(enableGraphPruning);

  const { toast } = useToast();

  const [graphPruningEnabled, setGraphPruningEnabled] = useState(
    data.graphPrunerEnabled,
  );
  const [selectedPruneRules, setSelectedPruneRules] = useState<
    GraphPruningConfig[]
  >(data.configs);

  useEffect(() => {
    setGraphPruningEnabled(data.graphPrunerEnabled);
    setSelectedPruneRules(data.configs);
  }, [data]);

  return (
    <div className="space-y-6 rounded-lg border p-6">
      <div className="flex w-full items-center justify-between">
        <div className="flex flex-col gap-y-1">
          <h3 className="font-semibold tracking-tight">
            Enable Graph Pruning Linter
          </h3>
          <p className="text-sm text-muted-foreground">
            {!!feature?.limit
              ? "Run the graph prune lint check on all the check operations of this namespace."
              : "Upgrade your billing plan to use this feature."}
          </p>
        </div>
        <Switch
          checked={graphPruningEnabled}
          disabled={
            !feature?.limit ||
            !checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] })
          }
          onCheckedChange={(checked) => {
            setGraphPruningEnabled(checked);
            mutate(
              {
                namespace,
                enableGraphPruning: checked,
              },
              {
                onSuccess: (d) => {
                  if (d.response?.code === EnumStatusCode.OK) {
                    toast({
                      description: checked
                        ? "Graph Pruning Linter enabled successfully."
                        : "Graph Pruning Linter disabled successfully",
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
                      ? "Could not enable the graph pruning linter. Please try again."
                      : "Could not disable the graph pruning linter. Please try again.",
                    duration: 3000,
                  });
                },
              },
            );
          }}
        />
      </div>
      {!!feature?.limit && (
        <Card>
          <CardHeader>
            <div className="flex w-full items-center justify-between">
              <div className="flex flex-col gap-y-1">
                <CardTitle>Graph Pruning Lint Rules</CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  {data.graphPrunerEnabled
                    ? "Configure the graph pruning linter rules and its options for the check performed during each check operation of this namespace."
                    : "Enable the graph pruning linter to configure the rules."}{" "}
                  <Link
                    href={docsBaseURL + "/studio/graph-pruning"}
                    className="text-primary"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Learn more
                  </Link>
                  <ul>
                    <li>
                      Grace Period: The time given to fields after they are
                      added or updated. During this period, the fields are not
                      checked for graph pruning issues.{" "}
                    </li>
                    <li>
                      Schema Usage Check Period: The time period for which the
                      schema usage of the field is checked.{" "}
                      {`${
                        plan !== "enterprise"
                          ? "Only available on the enterprise plan."
                          : ""
                      }`}
                    </li>
                  </ul>
                </CardDescription>
              </div>
              <Button
                className="mt-2"
                type="submit"
                variant="default"
                isLoading={isConfiguring}
                disabled={
                  !data.graphPrunerEnabled ||
                  !checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] })
                }
                onClick={() => {
                  configureGraphPruningRules(
                    {
                      namespace,
                      configs: selectedPruneRules,
                    },
                    {
                      onSuccess: (d) => {
                        if (d.response?.code === EnumStatusCode.OK) {
                          toast({
                            description:
                              "Graph Pruning Lint Policy applied successfully.",
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
                            "Could not apply the graph pruning lint policy. Please try again.",
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
            <div className="mt-1 flex w-full flex-col gap-y-3">
              {graphPruningRules.map((rule, index) => {
                return (
                  <div
                    className="flex w-full flex-col justify-between gap-y-4 rounded-md border p-4 md:flex-row md:items-center"
                    key={index + rule.name}
                  >
                    <div
                      className={cn("flex items-start gap-x-4", {
                        "cursor-not-allowed text-muted-foreground":
                          !data.graphPrunerEnabled,
                      })}
                    >
                      <Checkbox
                        id={rule.name}
                        className="h-5 w-5"
                        disabled={
                          !data.graphPrunerEnabled ||
                          !checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] })
                        }
                        checked={selectedPruneRules.some(
                          (l) => l.ruleName === rule.name,
                        )}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            const config = new GraphPruningConfig({
                              ruleName: rule.name,
                              severityLevel: LintSeverity.warn,
                              gracePeriodInDays: 7,
                            });
                            if (plan === "enterprise") {
                              config.schemaUsageCheckPeriodInDays = 7;
                            }
                            setSelectedPruneRules([
                              ...selectedPruneRules,
                              config,
                            ]);
                          } else {
                            setSelectedPruneRules(
                              selectedPruneRules.filter(
                                (l) => l.ruleName !== rule.name,
                              ),
                            );
                          }
                        }}
                      />
                      <div className="flex flex-col gap-y-1">
                        <label
                          htmlFor={rule.name}
                          className="break-all text-sm font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          {rule.name}
                        </label>
                        <span className="text-sm text-muted-foreground">
                          {rule.description}
                        </span>
                      </div>
                    </div>
                    <div></div>

                    <div className="ml-8 flex gap-x-3 md:ml-0">
                      {rule.name !== "REQUIRE_DEPRECATION_BEFORE_DELETION" && (
                        <>
                          <SchemaUsageCheckPeriodDropdown
                            onChange={(value) => {
                              setSelectedPruneRules(
                                selectedPruneRules.map((l) => {
                                  if (l.ruleName === rule.name) {
                                    return {
                                      ...l,
                                      schemaUsageCheckPeriodInDays:
                                        parseInt(value),
                                    } as GraphPruningConfig;
                                  } else {
                                    return l;
                                  }
                                }),
                              );
                            }}
                            value={
                              selectedPruneRules
                                .find((l) => l.ruleName === rule.name)
                                ?.schemaUsageCheckPeriodInDays?.toString() ||
                              "7"
                            }
                            disabled={
                              !data.graphPrunerEnabled || plan !== "enterprise"
                            }
                          />
                          <GracePeriodDropdown
                            onChange={(value) => {
                              setSelectedPruneRules(
                                selectedPruneRules.map((l) => {
                                  if (l.ruleName === rule.name) {
                                    return {
                                      ...l,
                                      gracePeriodInDays: parseInt(value),
                                    } as GraphPruningConfig;
                                  } else {
                                    return l;
                                  }
                                }),
                              );
                            }}
                            value={
                              selectedPruneRules
                                .find((l) => l.ruleName === rule.name)
                                ?.gracePeriodInDays.toString() || "7"
                            }
                            disabled={!data.graphPrunerEnabled}
                          />
                        </>
                      )}
                      <SeverityDropdown
                        value={
                          selectedPruneRules.find(
                            (l) => l.ruleName === rule.name,
                          )?.severityLevel === LintSeverity.error
                            ? "error"
                            : "warn"
                        }
                        onChange={(value) => {
                          setSelectedPruneRules(
                            selectedPruneRules.map((l) => {
                              if (l.ruleName === rule.name) {
                                return {
                                  ...l,
                                  severityLevel:
                                    value === "error"
                                      ? LintSeverity.error
                                      : LintSeverity.warn,
                                } as GraphPruningConfig;
                              } else {
                                return l;
                              }
                            }),
                          );
                        }}
                        disabled={!data.graphPrunerEnabled}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

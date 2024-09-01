import { useMutation } from "@connectrpc/connect-query";
import {
  configureNamespaceGraphPruningConfig,
  enableGraphPruningForTheNamespace,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  GetNamespaceGraphPruningConfigResponse,
  GraphPruningConfig,
  LintSeverity,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useRouter } from "next/router";
import { useState } from "react";
import { useToast } from "../ui/use-toast";
import { Switch } from "../ui/switch";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Button } from "../ui/button";
import { docsBaseURL, graphPruningRules } from "@/lib/constants";
import Link from "next/link";
import { Checkbox } from "../ui/checkbox";
import { SeverityDropdown } from "./linter-config";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useFeature } from "@/hooks/use-feature";
import { useFeatureLimit } from "@/hooks/use-feature-limit";

const fetchGracePeriodOptions = (
  limit: number,
): { label: string; value: string }[] => {
  if (limit === 7) {
    return [
      {
        label: "3 days",
        value: "3",
      },
      {
        label: "7 days",
        value: "7",
      },
    ];
  } else if (limit === 14) {
    return [
      {
        label: "3 days",
        value: "3",
      },
      {
        label: "7 days",
        value: "7",
      },
      {
        label: "10 days",
        value: "10",
      },
      {
        label: "14 days",
        value: "14",
      },
    ];
  } else if (limit === 30) {
    return [
      {
        label: "3 days",
        value: "3",
      },
      {
        label: "7 days",
        value: "7",
      },
      {
        label: "10 days",
        value: "10",
      },
      {
        label: "14 days",
        value: "14",
      },
      {
        label: "30 days",
        value: "30",
      },
    ];
  }
  return [];
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
  const limit = useFeatureLimit("field-grace-period", 7);
  const options = fetchGracePeriodOptions(limit);
  console.log(options, limit);
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

export const GraphPruningLintConfig = ({
  data,
  refetch,
}: {
  data: GetNamespaceGraphPruningConfigResponse;
  refetch: () => void;
}) => {
  const router = useRouter();
  const namespace = router.query.namespace as string;
  const feature = useFeature("field-grace-period");

  const { mutate: configureGraphPruningRules, isPending: isConfiguring } =
    useMutation(configureNamespaceGraphPruningConfig);
  const { mutate } = useMutation(enableGraphPruningForTheNamespace);

  const { toast } = useToast();

  const [graphPruningEnabled, setGraphPruningEnabled] = useState(
    data.graphPrunerEnabled,
  );
  const [selectedPruneRules, setSelectedPruneRules] = useState<
    GraphPruningConfig[]
  >(data.configs);

  return (
    <div className="space-y-6 rounded-lg border p-6">
      <div className="flex w-full items-center justify-between">
        <div className="flex flex-col gap-y-1">
          <h3 className="font-semibold tracking-tight">
            Enable Graph Pruning Linter
          </h3>
          <p className="text-sm text-muted-foreground">
            {feature
              ? "Run the graph prune lint check on all the check operations of this namespace."
              : "Upgrade your billing plan to use this feature."}
          </p>
        </div>
        <Switch
          checked={graphPruningEnabled}
          disabled={!feature}
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
                onError: (error) => {
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
      {feature && (
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
                  <p>
                    Note: The grace period is the time given to fields after
                    they are added or updated. During this period, the fields
                    are not checked for graph pruning issues.
                  </p>
                </CardDescription>
              </div>
              <Button
                className="mt-2"
                type="submit"
                variant="default"
                isLoading={isConfiguring}
                disabled={!data.graphPrunerEnabled}
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
                              "Graph Pruning Lint Policy applied succesfully.",
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
                        disabled={!data.graphPrunerEnabled}
                        checked={selectedPruneRules.some(
                          (l) => l.ruleName === rule.name,
                        )}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedPruneRules([
                              ...selectedPruneRules,
                              {
                                ruleName: rule.name,
                                severityLevel: LintSeverity.warn,
                                gracePeriod: 7,
                              } as GraphPruningConfig,
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
                      <GracePeriodDropdown
                        onChange={(value) => {
                          setSelectedPruneRules(
                            selectedPruneRules.map((l) => {
                              if (l.ruleName === rule.name) {
                                return {
                                  ...l,
                                  gracePeriod: parseInt(value),
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
                            ?.gracePeriod.toString() || "7"
                        }
                        disabled={!data.graphPrunerEnabled}
                      />
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

import { docsBaseURL, lintCategories } from "@/lib/constants";
import { cn, countLintConfigsByCategory } from "@/lib/utils";
import { useMutation } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  configureNamespaceLintConfig,
  enableLintingForTheNamespace,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  GetNamespaceLintConfigResponse,
  LintConfig,
  LintSeverity,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import Link from "next/link";
import { useState, useEffect } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Badge } from "../ui/badge";
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
import { useCheckUserAccess } from "@/hooks/use-check-user-access";
import { useWorkspace } from "@/hooks/use-workspace";

export const SeverityDropdown = ({
  onChange,
  value,
  disabled,
}: {
  onChange: (value: string) => void;
  value: "error" | "warn";
  disabled: boolean;
}) => {
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
          <SelectLabel>Lint Severity</SelectLabel>
          {["warn", "error"].map((pageSize) => (
            <SelectItem key={pageSize} value={`${pageSize}`}>
              {pageSize}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};

export const LinterConfig = ({
  data,
  refetch,
}: {
  data: GetNamespaceLintConfigResponse;
  refetch: () => void;
}) => {
  const checkUserAccess = useCheckUserAccess();
  const { namespace: { name: namespace } } = useWorkspace();

  const { mutate: configureLintRules, isPending: isConfiguring } = useMutation(
    configureNamespaceLintConfig,
  );
  const { mutate } = useMutation(enableLintingForTheNamespace);

  const { toast } = useToast();

  const [linterEnabled, setLinterEnabled] = useState(data.linterEnabled);
  const [selectedLintRules, setSelectedLintRules] = useState<LintConfig[]>(
    data.configs,
  );
  const countByCategory = countLintConfigsByCategory(data.configs);

  useEffect(() => {
    setLinterEnabled(data.linterEnabled);
    setSelectedLintRules(data.configs);
  }, [data]);

  return (
    <div className="space-y-6 rounded-lg border p-6">
      <div className="flex w-full items-center justify-between">
        <div className="flex flex-col gap-y-1">
          <h3 className="font-semibold tracking-tight">Enable Linter</h3>
          <p className="text-sm text-muted-foreground">
            Run the lint check on all the check operations of this namespace.
          </p>
        </div>
        <Switch
          checked={linterEnabled}
          disabled={
            !checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] })
          }
          onCheckedChange={(checked) => {
            setLinterEnabled(checked);
            mutate(
              {
                namespace,
                enableLinting: checked,
              },
              {
                onSuccess: (d) => {
                  if (d.response?.code === EnumStatusCode.OK) {
                    toast({
                      description: checked
                        ? "Linter enabled successfully."
                        : "Linter disabled successfully",
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
                      ? "Could not enable the linter. Please try again."
                      : "Could not disable the linter. Please try again.",
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
            <div className="flex flex-col gap-y-1">
              <CardTitle>Lint Rules</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                {data.linterEnabled
                  ? "Configure the linter rules and its severity levels for the lint check performed during each check operation of this namespace."
                  : "Enable the linter to configure the lint rules."}{" "}
                <Link
                  href={docsBaseURL + "/studio/policies"}
                  className="text-primary"
                  target="_blank"
                  rel="noreferrer"
                >
                  Learn more
                </Link>
              </CardDescription>
            </div>
            <Button
              className="mt-2"
              type="submit"
              variant="default"
              isLoading={isConfiguring}
              disabled={
                !data.linterEnabled ||
                !checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] })
              }
              onClick={() => {
                configureLintRules(
                  {
                    namespace,
                    configs: selectedLintRules,
                  },
                  {
                    onSuccess: (d) => {
                      if (d.response?.code === EnumStatusCode.OK) {
                        toast({
                          description: "Lint Policy applied succesfully.",
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
                          "Could not apply the lint policy. Please try again.",
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
          <Accordion type="single" collapsible disabled={!data.linterEnabled}>
            {lintCategories.map((lintCategory, index) => {
              return (
                <AccordionItem value={index.toString()} key={index.toString()}>
                  <AccordionTrigger
                    className={cn("hover:no-underline", {
                      "cursor-not-allowed text-muted-foreground":
                        !data.linterEnabled,
                    })}
                    disabled={!data.linterEnabled}
                  >
                    <div className="flex w-full flex-col items-start gap-y-1">
                      <div className="flex items-center gap-x-2">
                        <span>{lintCategory.title}</span>
                        {countByCategory && (
                          <Badge variant="muted">
                            {`${countByCategory[index]} of ${lintCategory.rules.length}`}
                          </Badge>
                        )}
                      </div>
                      <span className="text-left text-muted-foreground">
                        {lintCategory.description}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="mt-2 flex w-full flex-col gap-y-3">
                      {lintCategory.rules.map((rule, index) => {
                        return (
                          <div
                            className="flex w-full flex-col justify-between gap-y-4 rounded-md border p-4 md:flex-row md:items-center"
                            key={index + rule.name}
                          >
                            <div className="flex items-start gap-x-4">
                              <Checkbox
                                id={rule.name}
                                className="h-5 w-5"
                                checked={selectedLintRules.some(
                                  (l) => l.ruleName === rule.name,
                                )}
                                disabled={
                                  !checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] })
                                }
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedLintRules([
                                      ...selectedLintRules,
                                      {
                                        ruleName: rule.name,
                                        severityLevel: LintSeverity.warn,
                                      } as LintConfig,
                                    ]);
                                  } else {
                                    setSelectedLintRules(
                                      selectedLintRules.filter(
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

                            <div className="ml-8 md:ml-0">
                              <SeverityDropdown
                                value={
                                  selectedLintRules.find(
                                    (l) => l.ruleName === rule.name,
                                  )?.severityLevel === LintSeverity.error
                                    ? "error"
                                    : "warn"
                                }
                                onChange={(value) => {
                                  setSelectedLintRules(
                                    selectedLintRules.map((l) => {
                                      if (l.ruleName === rule.name) {
                                        return {
                                          ...l,
                                          severityLevel:
                                            value === "error"
                                              ? LintSeverity.error
                                              : LintSeverity.warn,
                                        } as LintConfig;
                                      } else {
                                        return l;
                                      }
                                    }),
                                  );
                                }}
                                disabled={!data.linterEnabled}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
};

import { UserContext } from "@/components/app-provider";
import { NamespaceSelector } from "@/components/dashboard/NamespaceSelector";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader } from "@/components/ui/loader";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { docsBaseURL, lintCategories } from "@/lib/constants";
import { NextPageWithLayout } from "@/lib/page";
import { cn, countLintConfigsByCategory } from "@/lib/utils";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  configureNamespaceLintConfig,
  enableLintingForTheNamespace,
  getNamespaceLintConfig,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  LintConfig,
  LintSeverity,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import Link from "next/link";
import { useContext, useEffect, useState } from "react";

const SeverityDropdown = ({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: "error" | "warn";
}) => {
  return (
    <Select
      value={value}
      onValueChange={(value) => {
        onChange(value);
      }}
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

const LintPolicyPage: NextPageWithLayout = () => {
  const user = useContext(UserContext);
  const [namespace] = useLocalStorage("namespace", "default");
  const { data, isLoading, refetch, error } = useQuery({
    ...getNamespaceLintConfig.useQuery({
      namespace,
    }),
    queryKey: [
      user?.currentOrganization.slug || "",
      "GetNamespaceLintConfig",
      { namespace },
    ],
  });
  const { mutate: configureLintRules, isPending: isConfiguring } = useMutation(
    configureNamespaceLintConfig.useMutation(),
  );

  const { mutate } = useMutation(enableLintingForTheNamespace.useMutation());

  const { toast } = useToast();

  const [linterEnabled, setLinterEnabled] = useState(false);
  const [selectedLintRules, setSelectedLintRules] = useState<LintConfig[]>([]);
  const [countByCategory, setCountByCategory] = useState<number[]>();

  useEffect(() => {
    if (!data) return;
    setSelectedLintRules(data.configs);
    setLinterEnabled(data.linterEnabled);
    setCountByCategory(countLintConfigsByCategory(data.configs));
  }, [data]);

  if (isLoading) return <Loader fullscreen />;
  if (error || data?.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve the lint config of the namesapce"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  return (
    <div className="space-y-6">
      <div className="flex w-full items-center justify-between">
        <div className="flex flex-col gap-y-1">
          <h3 className="font-semibold tracking-tight">Enable Linter</h3>
          <p className="text-sm text-muted-foreground">
            Run the lint check on all the check operations of this namespace.
          </p>
        </div>
        <Switch
          checked={linterEnabled}
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
                  href={docsBaseURL + "/studio/lint-policy"}
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
              disabled={!data.linterEnabled}
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

LintPolicyPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Lint Policy",
    "Configure the rules used for linting the subgraphs of the namespace.",
    undefined,
    undefined,
    [<NamespaceSelector key="0" />],
  );
};

export default LintPolicyPage;

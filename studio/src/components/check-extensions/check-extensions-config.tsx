import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlainMessage } from "@bufbuild/protobuf";
import { ConfigureSubgraphCheckExtensionsRequest } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import * as z from "zod";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { docsBaseURL } from "@/lib/constants";
import { useZodForm } from "@/hooks/use-form";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { clsx } from "clsx";
import { useCurrentOrganization } from "@/hooks/use-current-organization";
import { useWorkspace } from "@/hooks/use-workspace";
import Link from "next/link";

export type SubgraphCheckExtensionsConfig = Omit<PlainMessage<ConfigureSubgraphCheckExtensionsRequest>, 'namespace'>;

const validationSchema = z.object({
  endpoint: z.string()
    .trim()
    .superRefine((val, ctx) =>{
      if (!val) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Must be a valid absolute URL starting with https://',
        });
        return;
      }

      try {
        const url = new URL(val); // Ensure that the value is a valid absolute URL
        if (url.hostname.toLowerCase() === 'localhost') {
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Must be a valid absolute URL starting with http:// or https://',
            });
          }

          return;
        }

        if (url.protocol !== 'https:') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Must be a valid absolute URL starting with https://',
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Must be a valid absolute URL starting with https://',
        });
      }
    }),
  secretKey: z.string().trim().optional(),
  includeComposedSdl: z.boolean(),
  includeLintingIssues: z.boolean(),
  includePruningIssues: z.boolean(),
  includeSchemaChanges: z.boolean(),
  includeAffectedOperations: z.boolean(),
  enableSubgraphCheckExtensions: z.boolean(),
});

interface CheckExtensionsConfigProps {
  config: SubgraphCheckExtensionsConfig;
  isSecretKeyAssigned: boolean;
  isLintingEnabledForNamespace: boolean;
  isGraphPruningEnabledForNamespace: boolean;
  isUpdatingConfig: boolean;
  onSaveChanges(
    newConfig: SubgraphCheckExtensionsConfig,
    onConfigUpdated: (newConfig: SubgraphCheckExtensionsConfig) => void,
  ): void;
}

interface ToggleableOptionsType {
  key: keyof z.infer<typeof validationSchema>;
  label: string;
  description?: ReactNode;
  docsLink?: string;
  isDisabled?: boolean;
}

export function CheckExtensionsConfig({
  config,
  isSecretKeyAssigned,
  isLintingEnabledForNamespace,
  isGraphPruningEnabledForNamespace,
  isUpdatingConfig,
  onSaveChanges
}: CheckExtensionsConfigProps) {
  const { namespace } = useWorkspace();
  const organizationSlug = useCurrentOrganization()?.slug;
  const isDisabled = isUpdatingConfig || !config.enableSubgraphCheckExtensions;
  const [showConfirmationDialog, setShowConfirmationDialog] = useState(false);
  const [forceShowSecretKeyInput, setForceShowSecretKeyInput] = useState<boolean | undefined>(undefined);
  const form = useZodForm({
    schema: validationSchema,
    mode: "onChange",
    defaultValues: config,
  });

  useEffect(() => {
    form.reset(config);
    // We intentionally only observe the `enableSubgraphCheckExtensions` field so we don't undo any
    // modifications every time the configuration is refreshed
  }, [form, config.enableSubgraphCheckExtensions]);

  const onConfigUpdated = (newConfig: SubgraphCheckExtensionsConfig) => {
    form.reset(newConfig);
    setForceShowSecretKeyInput(undefined);
  };

  const onSaveChangesCallback = (newConfig: SubgraphCheckExtensionsConfig) => {
    if (isSecretKeyAssigned && forceShowSecretKeyInput && !newConfig.secretKey?.trim().length) {
      // The user has emptied the secret key, lets give ask them to confirm whether this is intended
      setShowConfirmationDialog(true);
    } else {
      onSaveChanges(newConfig, onConfigUpdated);
    }
  };

  const toggleableOptions = useMemo<ToggleableOptionsType[]>(() => [
    {
      key: 'includeComposedSdl',
      label: 'Composed SDL',
      description:
        "Provides both the previous and newly composed Schema Definition Language (SDL) documents for the subgraph " +
        "being checked, along with the composed SDL for the federated graph.",
      docsLink: "/studio/alerts-and-notifications/webhooks#verification"
    },
    {
      key: "includeLintingIssues",
      label: "Lint Warnings and Errors",
      description: isLintingEnabledForNamespace
        ? "Linting issues identified based on the configured rules for the namespace."
        : (
          <>
            <>
              You must{" "}
              <Link
                href={`/${organizationSlug}/policies?namespace=${namespace.name}`}
                className="text-primary"
              >
                enable the linter
              </Link>
              {" "}for the namespace to be able to receive lint warnings and errors.
            </>
          </>
        ),
      docsLink: "/studio/alerts-and-notifications/webhooks#verification",
      isDisabled: !isLintingEnabledForNamespace,
    },
    {
      key: "includePruningIssues",
      label: "Graph Pruning Warnings and Errors",
      description: isGraphPruningEnabledForNamespace
        ? "Graph pruning issues identified based on the configured rules for the namespace."
        : (
          <>
            You must{" "}
            <Link
              href={`/${organizationSlug}/policies?namespace=${namespace.name}`}
              className="text-primary"
            >
              enable the graph pruning linter
            </Link>
            {" "}for the namespace to be able to receive graph pruning warnings and errors.
          </>
        ),
      docsLink: "/studio/alerts-and-notifications/webhooks#verification",
      isDisabled: !isGraphPruningEnabledForNamespace,
    },
    {
      key: "includeSchemaChanges",
      label: "Schema Changes",
      description: "Lists the changes detected in the subgraph schema, including additions, removals, and modifications.",
      docsLink: "/studio/alerts-and-notifications/webhooks#verification",
    },
    {
      key: "includeAffectedOperations",
      label: "Affected Operations",
      description: "Lists the operations that may be impacted by changes to the subgraph schema.",
      docsLink: "/studio/alerts-and-notifications/webhooks#verification",
    },
  ], [isLintingEnabledForNamespace, isGraphPruningEnabledForNamespace, namespace.name, organizationSlug]);

  const showSecretKeyInput = forceShowSecretKeyInput || !config.enableSubgraphCheckExtensions || !isSecretKeyAssigned;
  return (
    <>
      <AlertDialog open={showConfirmationDialog}>
        <AlertDialogContent>
          <AlertDialogTitle>Secret key removed</AlertDialogTitle>
          <AlertDialogDescription>
            You are about to update the webhook configuration and remove the secret key.{" "}
            Are you sure you want to do this?
          </AlertDialogDescription>
          <AlertDialogFooter>
            <Button
              variant="secondary"
              onClick={() => setShowConfirmationDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowConfirmationDialog(false);
                onSaveChanges(form.getValues(), onConfigUpdated);
              }}
            >
              Continue
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSaveChangesCallback)}>
          <Card>
            <CardHeader>
              <div className="flex w-full items-center justify-between">
                <div className="flex flex-col gap-y-2">
                  <CardTitle>Subgraph Check Extensions</CardTitle>
                  <CardDescription className="text-sm text-muted-foreground">
                    {config.enableSubgraphCheckExtensions
                      ? "Configure the subgraph check extensions of this namespace."
                      : "Enable subgraph check extensions to set the configuration."}
                  </CardDescription>
                </div>

                <Button
                  type="submit"
                  isLoading={isUpdatingConfig}
                  disabled={isDisabled || !form.formState.isValid}
                >
                  Apply
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-1.5 pt-6 border-t">
              <FormField
                control={form.control}
                name="endpoint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Endpoint</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="text"
                        placeholder="https://example.com/webhook"
                        disabled={isDisabled}
                      />
                    </FormControl>

                    <FormDescription>
                      The endpoint that will receive POST requests with event data. Must be a valid absolute{" "}
                      URL starting with <code className="font-mono">https://</code>.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />

              <FormField
                control={form.control}
                name="secretKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Secret key</FormLabel>

                    {showSecretKeyInput ? (
                      <FormControl>
                        <Input {...field} type="text" placeholder="*************" disabled={isDisabled}/>
                      </FormControl>
                    ) : (
                      <div
                        className="flex justify-start items-center gap-x-1 h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm hover:border-input-active dark:bg-black"
                      >
                        <span>If you have lost or forgotten this secret key, you can change it.</span>
                        <Button
                          variant="link"
                          className="p-0 h-auto"
                          onClick={() => {
                            setForceShowSecretKeyInput(true);
                            form.setValue("secretKey", "");
                          }}
                        >
                          Change secret key
                        </Button>
                      </div>
                    )}

                    <FormDescription>
                      This can be used to verify if the events are originating from Cosmo.{" "}
                      <a
                        rel="noreferrer"
                        href={docsBaseURL + "/studio/alerts-and-notifications/webhooks#verification"}
                        target="_blank"
                        className="text-primary"
                      >
                        Learn more.
                      </a>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="py-2 text-sm space-y-1">
                <p className="font-medium leading-none">Included fields</p>
                <p className="text-muted-foreground">
                  Specifies which data elements should be included in the generated file delivered via the webhook..{" "}
                  <a
                    href={docsBaseURL + "/"}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary ml-1"
                  >
                    Learn more
                  </a>.
                </p>
              </div>

              {toggleableOptions.map((item) => {
                const isItemDisabled = isDisabled || Boolean(item.isDisabled);
                return (
                  <FormField
                    key={`opt-${item.key}`}
                    control={form.control}
                    name={item.key}
                    render={({ field }) => (
                      <FormItem className="w-full flex justify-start items-start gap-3 rounded-md border p-4 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={!item.isDisabled && (!config.enableSubgraphCheckExtensions || field.value === true)}
                            disabled={isDisabled || item.isDisabled}
                            className="w-5 h-5 flex-shrink-0"
                            onCheckedChange={(checked) => field.onChange(checked === true)}
                          />
                        </FormControl>

                        <div className="flex flex-col gap-y-1">
                          <FormLabel
                            className={clsx(isItemDisabled && "text-muted-foreground cursor-not-allowed")}
                          >
                            {item.label}
                          </FormLabel>
                          {(item.description || item.docsLink) && (
                            <p className="text-sm text-muted-foreground">
                              <span>{item.description}</span>
                              {item.docsLink && (
                                <>
                                  <a
                                    href={docsBaseURL + item.docsLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary ml-1"
                                  >
                                    Learn more
                                  </a>.
                                </>
                              )}
                            </p>
                          )}
                        </div>
                      </FormItem>
                    )}
                  />
                );
              })}
            </CardContent>
          </Card>
        </form>
      </Form>
    </>
  );
}
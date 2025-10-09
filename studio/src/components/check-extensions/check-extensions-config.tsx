import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlainMessage } from "@bufbuild/protobuf";
import { ConfigureSubgraphCheckExtensionsRequest } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import * as z from "zod";
import { useEffect, useState } from "react";
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
          return;
        }

        if (!val.toLowerCase().startsWith('https://')) {
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
  isUpdatingConfig: boolean;
  onSaveChanges(
    newConfig: SubgraphCheckExtensionsConfig,
    onConfigUpdated: (newConfig: SubgraphCheckExtensionsConfig) => void,
  ): void;
}

const toggleableOptions: { key: keyof z.infer<typeof validationSchema>, label: string, description?: string }[] = [
  {
    key: 'includeComposedSdl',
    label: 'Include Composed SDL',
  },
  {
    key: 'includeLintingIssues',
    label: 'Include Linting Warnings and Errors',
  },
  {
    key: 'includePruningIssues',
    label: 'Include Pruning Warnings and Errors',
  },
  {
    key: 'includeSchemaChanges',
    label: 'Include Schema Changes',
  },
  {
    key: 'includeAffectedOperations',
    label: 'Include Affected Operations',
  },
];

export function CheckExtensionsConfig({
  config,
  isSecretKeyAssigned,
  isUpdatingConfig,
  onSaveChanges
}: CheckExtensionsConfigProps) {
  const isDisabled = isUpdatingConfig || !config.enableSubgraphCheckExtensions;
  const [showConfirmationDialog, setShowConfirmationDialog] = useState(false);
  const [forceShowSecretKeyInput, setForceShowSecretKeyInput] = useState<boolean | undefined>(undefined);
  const form = useZodForm({
    schema: validationSchema,
    mode: "onChange",
    defaultValues: config,
  });

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

  const showSecretKeyInput = forceShowSecretKeyInput || !config.enableSubgraphCheckExtensions || !isSecretKeyAssigned;
  return (
    <>
      <AlertDialog open={showConfirmationDialog}>
        <AlertDialogContent>
          <AlertDialogTitle>Secret key removed</AlertDialogTitle>
          <AlertDialogDescription>
            You are about to update the webhook configuration and remove the secret key.{' '}
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
                            form.setValue('secretKey', '');
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

              {toggleableOptions.map((item) => (
                <FormField
                  key={`opt-${item.key}`}
                  control={form.control}
                  name={item.key}
                  render={({ field }) => (
                    <FormItem
                      className="w-full flex justify-between items-center gap-4"
                    >
                      <FormLabel className="w-full py-2 space-y-1">
                        <span>{item.label}</span>
                        {item.description && (<p className="text-sm text-muted-foreground">{item.description}</p>)}
                      </FormLabel>

                      <div className="ml-8 flex gap-x-3 flex-shrink-0">
                        <FormControl>
                          <Checkbox
                            checked={!config.enableSubgraphCheckExtensions || field.value === true}
                            disabled={isDisabled}
                            onCheckedChange={(checked) => field.onChange(checked === true)}
                          />
                        </FormControl>
                      </div>
                    </FormItem>
                  )}
                />
              ))}
            </CardContent>
          </Card>
        </form>
      </Form>
    </>
  );
}
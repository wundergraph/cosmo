import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader } from '@/components/ui/loader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { SubmitHandler, useZodForm } from '@/hooks/use-form';
import { formatDateTime } from '@/lib/format-date';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  deleteAuditLogStreamConfig,
  getAuditLogStreamConfig,
  testAuditLogStreamConfig,
  upsertAuditLogStreamConfig,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { AuditLogStreamConfig } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { useState } from 'react';
import { z } from 'zod';

const FormSchema = z
  .object({
    destination: z.enum(['none', 'splunk']),
    endpoint: z.string(),
    token: z.string(),
    // A saved token is kept when the token field is left empty.
    hasStoredToken: z.boolean(),
    index: z.string().optional(),
    sourcetype: z.string().optional(),
    enabled: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.destination === 'none') {
      return;
    }
    if (!z.string().url().safeParse(values.endpoint).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endpoint'], message: 'Enter a valid URL' });
    }
    if (!values.token && !values.hasStoredToken) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['token'], message: 'A token is required' });
    }
  });

type Input = z.infer<typeof FormSchema>;

const toFormValues = (config?: AuditLogStreamConfig): Input => ({
  destination: config ? 'splunk' : 'none',
  endpoint: config?.endpoint ?? '',
  token: '',
  hasStoredToken: !!config,
  index: config?.index ?? '',
  sourcetype: config?.sourcetype ?? '',
  enabled: config?.enabled ?? true,
});

/**
 * Configures exporting the organization's audit logs. An organization has at most one destination, and Splunk HEC
 * streaming is the only kind for now. Choosing None and saving removes it.
 */
export const AuditLogStreamDialog = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery(getAuditLogStreamConfig, {}, { enabled: isOpen });
  const config = data?.config;

  const { mutate: upsert, isPending: isSaving } = useMutation(upsertAuditLogStreamConfig);
  const { mutate: remove, isPending: isRemoving } = useMutation(deleteAuditLogStreamConfig);
  const { mutate: sendTest, isPending: isTesting } = useMutation(testAuditLogStreamConfig);

  const form = useZodForm<Input>({
    mode: 'onChange',
    schema: FormSchema,
    // Passing values rather than defaultValues resets the form when the config first loads.
    values: toFormValues(config),
  });

  // Refetch even on failure, since the status shown changes.
  const handle = (success: string, failure: string) => ({
    onSuccess: async (d: { response?: { code: EnumStatusCode; details?: string } }) => {
      const ok = d.response?.code === EnumStatusCode.OK;
      toast({ description: ok ? success : `${failure}: ${d.response?.details}`, duration: 3000 });
      const { data } = await refetch();
      // values doesn't reset the form when the fields come back unchanged, e.g. after a new token.
      if (ok) {
        form.reset(toFormValues(data?.config));
      }
    },
    onError: () => toast({ description: failure, duration: 3000 }),
  });

  const destination = form.watch('destination');

  const onSubmit: SubmitHandler<Input> = ({ destination, hasStoredToken, ...values }) => {
    if (destination === 'none') {
      remove({}, handle('Audit log export removed', 'Could not remove the audit log export'));
      return;
    }
    upsert(
      { ...values, token: values.token || undefined },
      handle('Audit log export saved', 'Could not save the audit log export'),
    );
  };
  const onTest = () => sendTest({}, handle('Test event delivered', 'Test event failed'));

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        // The form outlives the dialog, so unsaved edits are discarded on close.
        if (!open) {
          form.reset();
        }
        setIsOpen(open);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Export audit logs
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export audit logs</DialogTitle>
          <DialogDescription>Send your organization&apos;s audit logs to another system.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Loader className="my-8" />
        ) : (
          <Form {...form}>
            <form className="flex w-full flex-col gap-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <FormField
                control={form.control}
                name="destination"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Destination</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        // The URL and token are only required for Splunk.
                        form.trigger(['endpoint', 'token']);
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="splunk">Splunk HTTP Event Collector</SelectItem>
                      </SelectContent>
                    </Select>
                    {destination === 'splunk' && (
                      <FormDescription>New entries are streamed within about a minute.</FormDescription>
                    )}
                  </FormItem>
                )}
              />

              {destination === 'splunk' && (
                <>
                  <FormField
                    control={form.control}
                    name="enabled"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between space-y-0 rounded-lg border p-4">
                        <div className="flex flex-col gap-y-1">
                          <FormLabel>Enabled</FormLabel>
                          <FormDescription>
                            Turn off to pause. Entries written while paused are sent when you turn it back on.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {config && (config.lastSuccessAt || config.lastError) && (
                    <div className="flex flex-col gap-y-1 text-sm">
                      {config.lastSuccessAt && (
                        <span className="text-muted-foreground">
                          Last delivered {formatDateTime(new Date(config.lastSuccessAt))}
                        </span>
                      )}
                      {config.lastError && config.lastErrorAt && (
                        <span className="text-destructive">
                          Failing since {formatDateTime(new Date(config.lastErrorAt))}: {config.lastError}
                        </span>
                      )}
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="endpoint"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Collector URL</FormLabel>
                        <FormControl>
                          <Input placeholder="https://splunk.example.com:8088" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="token"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>HEC token</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            autoComplete="off"
                            placeholder={config ? `••••${config.tokenSuffix} (leave empty to keep)` : ''}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="index"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Index</FormLabel>
                          <FormControl>
                            <Input placeholder="Token default" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="sourcetype"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Sourcetype</FormLabel>
                          <FormControl>
                            <Input placeholder="wundergraph:cosmo:audit" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </>
              )}

              <DialogFooter className="gap-2">
                {config && destination === 'splunk' && (
                  <Button type="button" variant="outline" isLoading={isTesting} onClick={onTest}>
                    Send test event
                  </Button>
                )}
                <Button
                  type="submit"
                  isLoading={isSaving || isRemoving}
                  // Saving None is only meaningful when there's a destination to remove.
                  disabled={(!form.formState.isValid && form.formState.isDirty) || (destination === 'none' && !config)}
                >
                  Save
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
};

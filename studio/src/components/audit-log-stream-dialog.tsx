import { EmptyState } from '@/components/empty-state';
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
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { useFeature } from '@/hooks/use-feature';
import { buildUrl } from '@/lib/build-url';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import { ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  deleteAuditLogStreamConfig,
  getAuditLogStreamConfig,
  testAuditLogStreamConfig,
  upsertAuditLogStreamConfig,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { AuditLogStreamConfig } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';

/** The rules must match `normalizeHecEndpoint` in the controlplane, which makes the final decision. */
const isValidHecEndpoint = (input: string) => {
  try {
    const url = new URL(input.trim());
    return url.protocol === 'https:' && url.hostname !== 'localhost' && !url.username && !url.password;
  } catch {
    return false;
  }
};

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
    if (!isValidHecEndpoint(values.endpoint)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endpoint'], message: 'Enter a valid HTTPS URL' });
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
  const organization = useCurrentOrganization();
  const isEntitled = !!useFeature('audit-log-streaming')?.enabled;

  const { data, isLoading, error, refetch } = useQuery(getAuditLogStreamConfig, {}, { enabled: isOpen });
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
  const { isDirty, isValid } = form.formState;
  const isAlreadyNone = destination === 'none' && !config;
  // Button ignores isLoading once disabled is passed, so the pending states must be checked here too.
  // An organization that lost the feature can still remove its config, which no longer streams.
  const canSave =
    !isSaving && !isRemoving && isDirty && isValid && !isAlreadyNone && (isEntitled || destination === 'none');
  const canTest = !isTesting && !isDirty;

  const onSubmit: SubmitHandler<Input> = ({ destination, hasStoredToken, ...values }) => {
    if (destination === 'none') {
      remove({}, handle('Audit log export removed', 'Could not remove the audit log export'));
      return;
    }
    upsert(
      { ...values, source: config?.source, token: values.token || undefined },
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
        ) : error || data?.response?.code !== EnumStatusCode.OK ? (
          <EmptyState
            icon={<ExclamationTriangleIcon />}
            title="Could not retrieve the audit log export"
            description={data?.response?.details || error?.message || 'Please try again'}
            actions={<Button onClick={() => refetch()}>Retry</Button>}
          />
        ) : !isEntitled && !config ? (
          <EmptyState
            icon={<InformationCircleIcon />}
            title="Audit log export is not available"
            description="Upgrade to the Enterprise plan to stream your organization's audit logs to Splunk."
            actions={
              <Button asChild>
                <Link href={buildUrl('/:organizationSlug/billing', { organizationSlug: organization?.slug })}>
                  Upgrade
                </Link>
              </Button>
            }
          />
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
                        <SelectItem value="splunk" disabled={!isEntitled}>
                          Splunk HTTP Event Collector
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {!isEntitled ? (
                      <FormDescription className="text-destructive">
                        Your plan no longer includes audit log export, so nothing is being sent. Choose None and save to
                        remove the stored URL and token.
                      </FormDescription>
                    ) : (
                      destination === 'splunk' && (
                        <FormDescription>New entries are streamed within about a minute.</FormDescription>
                      )
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
                {config && isEntitled && destination === 'splunk' && (
                  <span title={isDirty ? 'Save your changes before sending a test event' : undefined}>
                    <Button type="button" variant="outline" isLoading={isTesting} disabled={!canTest} onClick={onTest}>
                      Send test event
                    </Button>
                  </span>
                )}
                <Button type="submit" isLoading={isSaving || isRemoving} disabled={!canSave}>
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

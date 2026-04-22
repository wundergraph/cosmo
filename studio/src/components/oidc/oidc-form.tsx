import { z } from 'zod';
import { useZodForm } from '@/hooks/use-form';
import { Form, FormField, FormLabel, FormMessage, FormItem, FormControl } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { absoluteUrlValidator } from '@/lib/zod';

const OIDCProviderInputSchema = z.object({
  name: z.string().min(1),
  discoveryEndpoint: absoluteUrlValidator,
  clientID: z.string().min(1),
  clientSecret: z.string().min(1),
});

export type OIDCProviderInput = z.infer<typeof OIDCProviderInputSchema>;

export interface OIDCFormProps {
  isPending: boolean;
  handleSubmit(data: OIDCProviderInput): void;
  onCancel(): void;
}

export function OIDCForm({ isPending, handleSubmit, onCancel }: OIDCFormProps) {
  const form = useZodForm<OIDCProviderInput>({
    schema: OIDCProviderInputSchema,
    mode: 'onChange',
  });

  return (
    <Form {...form}>
      <form className="mt-2 flex flex-col gap-y-3" onSubmit={form.handleSubmit(handleSubmit)}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-y-1">
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Name" disabled={isPending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="discoveryEndpoint"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-y-1">
              <FormLabel>Discovery Endpoint</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  disabled={isPending}
                  placeholder="https://hostname/auth/realms/master/.wellknown/openid-configuration"
                  className="w-full"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="clientID"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-y-1">
              <FormLabel>Client ID</FormLabel>
              <FormControl>
                <Input {...field} disabled={isPending} className="w-full" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="clientSecret"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-y-1">
              <FormLabel>Client Secret</FormLabel>
              <FormControl>
                <Input {...field} disabled={isPending} type="password" className="w-full" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="mt-2 flex items-center justify-end gap-x-2">
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>

          <Button type="submit" disabled={!form.formState.isValid || isPending} isLoading={isPending}>
            Connect
          </Button>
        </div>
      </form>
    </Form>
  );
}

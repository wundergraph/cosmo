import { useEffect } from 'react';
import { useOnboarding } from '@/hooks/use-onboarding';
import { OnboardingContainer } from './onboarding-container';
import { OnboardingNavigation } from './onboarding-navigation';
import { useMutation } from '@connectrpc/connect-query';
import { createOnboarding } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useRouter } from 'next/router';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { useToast } from '../ui/use-toast';
import { SubmitHandler, useZodForm } from '@/hooks/use-form';
import { Controller, useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { emailSchema, organizationNameSchema } from '@/lib/schemas';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '../ui/form';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Cross1Icon, PlusIcon } from '@radix-ui/react-icons';

const onboardingSchema = z.object({
  organizationName: organizationNameSchema,
  members: z.array(
    z.object({
      email: emailSchema.or(z.literal('')),
    }),
  ),
  channels: z.object({
    slack: z.boolean(),
    email: z.boolean(),
  }),
});

type OnboardingFormValues = z.infer<typeof onboardingSchema>;

export const Step1 = () => {
  const router = useRouter();
  const { toast } = useToast();
  const organization = useCurrentOrganization();
  const { setStep, setSkipped, setOnboarding, onboarding } = useOnboarding();

  const form = useZodForm<OnboardingFormValues>({
    mode: 'onChange',
    schema: onboardingSchema,
    defaultValues: {
      organizationName: organization?.name ?? '',
      members: [{ email: '' }],
      channels: { slack: onboarding?.slack ?? false, email: onboarding?.email ?? false },
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'members',
  });

  const { mutate, isPending } = useMutation(createOnboarding, {
    onSuccess: (d) => {
      if (d.response?.code !== EnumStatusCode.OK) {
        toast({
          description: d.response?.details ?? 'We had issues with storing your data. Please try again.',
          duration: 3000,
        });
        return;
      }

      // TODO: read slack + email from CreateOnboarding response once proto is updated
      const formValues = form.getValues();
      setOnboarding({
        federatedGraphsCount: d.federatedGraphsCount,
        finishedAt: d.finishedAt ? new Date(d.finishedAt) : undefined,
        slack: formValues.channels.slack,
        email: formValues.channels.email,
      });
      router.push('/onboarding/2');
    },
    onError: (error) => {
      toast({
        description: error.details.toString() ?? 'We had issues with storing your data. Please try again.',
        duration: 3000,
      });
    },
  });

  const onSubmit: SubmitHandler<OnboardingFormValues> = (data) => {
    const emails = data.members.map((m) => m.email).filter((e) => e.length > 0);

    mutate({
      organizationName: data.organizationName,
      slack: data.channels.slack,
      email: data.channels.email,
      invititationEmails: emails,
    });
  };

  useEffect(() => {
    setStep(1);
  }, [setStep]);

  return (
    <OnboardingContainer>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="w-full space-y-8 text-left">
          <FormField
            control={form.control}
            name="organizationName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Organization Name</FormLabel>
                <FormDescription>This is your organization name. You can always change it later.</FormDescription>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="space-y-3 pt-4">
            <FormLabel>Invite Members</FormLabel>
            <FormDescription>Add team members by email.</FormDescription>
            <div className="space-y-2">
              {fields.map((field, index) => (
                <div key={field.id}>
                  <div className="flex items-center gap-2">
                    <Input placeholder="janedoe@example.com" {...form.register(`members.${index}.email`)} />
                    {fields.length > 1 && (
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(index)}>
                        <Cross1Icon />
                      </Button>
                    )}
                  </div>
                  {form.formState.errors.members?.[index]?.email && (
                    <p className="mt-1 text-sm text-destructive">
                      {form.formState.errors.members[index].email.message}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => append({ email: '' })}>
              <PlusIcon className="mr-2" /> Add another
            </Button>
          </div>

          <div className="space-y-3 pt-4">
            <FormLabel>Preferred way for us to reach you?</FormLabel>
            <FormDescription>If you get stuck with your Cosmo setup, we want to be able to help you.</FormDescription>
            <div className="space-y-4">
              <Controller
                control={form.control}
                name="channels.slack"
                render={({ field }) => (
                  <label className="flex items-start gap-3">
                    <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                    <div className="flex flex-col gap-y-1">
                      <span className="text-sm font-medium leading-none">Slack</span>
                      <span className="text-[0.8rem] text-muted-foreground">
                        We automatically create a Slack channel for you
                      </span>
                    </div>
                  </label>
                )}
              />
              <Controller
                control={form.control}
                name="channels.email"
                render={({ field }) => (
                  <label className="flex items-start gap-3">
                    <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                    <div className="flex flex-col gap-y-1">
                      <span className="text-sm font-medium leading-none">Email</span>
                      <span className="text-[0.8rem] text-muted-foreground">Receive updates via email</span>
                    </div>
                  </label>
                )}
              />
            </div>
          </div>
        </form>
      </Form>

      <OnboardingNavigation
        onSkip={setSkipped}
        forward={{
          onClick: form.handleSubmit(onSubmit),
          isLoading: isPending,
          disabled: !form.formState.isValid,
        }}
      />
    </OnboardingContainer>
  );
};

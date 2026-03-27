import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useZodForm } from '@/hooks/use-form';
import { emailSchema, organizationNameSchema } from '@/lib/form-schemas';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { Cross1Icon, PlusIcon } from '@radix-ui/react-icons';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { Controller, useFieldArray } from 'react-hook-form';
import { z } from 'zod';

const onboardingSchema = z.object({
  organizationName: organizationNameSchema,
  members: z.array(
    z.object({
      email: emailSchema,
    }),
  ),
  channels: z.object({
    slack: z.boolean(),
    email: z.boolean(),
  }),
});

type OnboardingFormValues = z.infer<typeof onboardingSchema>;

export function OnboardingForm() {
  const router = useRouter();
  const org = useCurrentOrganization();

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { isValid, errors },
  } = useZodForm<OnboardingFormValues>({
    mode: 'onChange',
    schema: onboardingSchema,
    defaultValues: {
      organizationName: '',
      members: [],
      channels: { slack: true, email: false },
    },
  });

  useEffect(() => {
    if (org?.name) {
      reset((prev) => ({ ...prev, organizationName: org.name }));
    }
  }, [org?.name, reset]);

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'members',
  });

  const onSubmit = (data: OnboardingFormValues) => {
    // TODO: wire up submission
    console.log(data);
  };

  return (
    <form className="space-y-8" onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-2">
        <label className="text-sm font-medium">Organization Name</label>
        <p className="text-sm text-muted-foreground">
          This is your organization name. Feel free to keep it or change it.
        </p>
        <Input placeholder="Acme Inc." className="max-w-md" {...register('organizationName')} />
        {errors.organizationName && <span className="text-sm text-destructive">{errors.organizationName.message}</span>}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Invite Members</label>
        <p className="text-sm text-muted-foreground">Add team members by email. You can always invite more later.</p>
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-2">
              <Input placeholder="janedoe@example.com" className="max-w-md" {...register(`members.${index}.email`)} />
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(index)}>
                <Cross1Icon />
              </Button>
            </div>
          ))}
          {fields.map((_, index) =>
            errors.members?.[index]?.email ? (
              <span key={index} className="text-sm text-destructive">
                {errors.members[index].email.message}
              </span>
            ) : null,
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => append({ email: '' })}>
          <PlusIcon className="mr-2" /> Add another
        </Button>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Communication Channels</label>
        <p className="text-sm text-muted-foreground">Choose how you&apos;d like to receive notifications.</p>
        <div className="space-y-3">
          <Controller
            control={control}
            name="channels.slack"
            render={({ field }) => (
              <label className="flex items-start gap-3">
                <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                <div className="flex flex-col gap-y-1">
                  <span className="text-sm font-medium leading-none">Slack</span>
                  <span className="text-sm text-muted-foreground">Get notified in your Slack workspace</span>
                </div>
              </label>
            )}
          />
          <Controller
            control={control}
            name="channels.email"
            render={({ field }) => (
              <label className="flex items-start gap-3">
                <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                <div className="flex flex-col gap-y-1">
                  <span className="text-sm font-medium leading-none">Email</span>
                  <span className="text-sm text-muted-foreground">Receive updates via email</span>
                </div>
              </label>
            )}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={() => router.push(`/${org?.slug}/graphs`)}>
          Skip
        </Button>
        <Button type="submit" disabled={!isValid}>
          Continue
        </Button>
      </div>
    </form>
  );
}

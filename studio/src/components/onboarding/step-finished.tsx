import { useRouter } from 'next/router';
import { z } from 'zod';
import { useCallback } from 'react';
import { useFieldArray } from 'react-hook-form';
import { ArrowRightIcon, Cross1Icon, ExternalLinkIcon, PlusIcon } from '@radix-ui/react-icons';
import { BookOpenIcon, UserPlusIcon } from '@heroicons/react/24/outline';
import { MdArrowOutward } from 'react-icons/md';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import {
  inviteUsers,
  getOrganizationGroups,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SubmitHandler, useZodForm } from '@/hooks/use-form';
import { cn } from '@/lib/utils';
import { docsBaseURL } from '@/lib/constants';
import { OnboardingContainer } from './onboarding-container';
import { Form, FormField, FormControl, FormItem, FormMessage, FormLabel, FormDescription } from '../ui/form';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { useToast } from '../ui/use-toast';
import { useOnboarding } from '@/hooks/use-onboarding';

const MAXIMUM_BATCH_SIZE = 5;

const emailSchema = z.string().email();
const inviteSchema = z.object({
  members: z
    .array(
      z.object({
        email: emailSchema.or(z.literal('')),
      }),
    )
    .refine((rows) => rows.some((r) => r.email.trim().length > 0), {
      message: 'Enter at least one email',
    })
    .refine((rows) => rows.length <= MAXIMUM_BATCH_SIZE, {
      message: `Maximum ${MAXIMUM_BATCH_SIZE} members per invitation`,
    }),
});

type InviteFormValues = z.infer<typeof inviteSchema>;

const DocumentationLinkItem = ({
  title,
  description,
  href,
  onClick,
}: {
  title: string;
  description: string;
  href: string;
  onClick: () => void;
}) => (
  <li>
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start justify-between gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted/50"
      onClick={onClick}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <ExternalLinkIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
    </a>
  </li>
);

const HubPromoLink = () => (
  <a
    href="https://hub.wundergraph.com/login?utm_source=cosmo&utm_content=onboarding&utm_medium=internal"
    target="_blank"
    rel="noopener noreferrer"
    className="group block overflow-hidden rounded-md bg-gradient-to-r from-[hsla(271,91%,65%,1)] to-[hsla(330,81%,60%,1)] p-[1px] transition-all duration-300 ease-out hover:shadow-[0_0_24px_-4px_hsla(271,91%,65%,0.4)]"
  >
    <div className="flex items-start justify-between gap-3 rounded-[5px] bg-card p-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Discover Hub</span>
          <span className="rounded-full bg-gradient-to-r from-[hsla(271,91%,65%,1)] to-[hsla(330,81%,60%,1)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            New
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          A smarter way to design schemas, collaborate, and govern changes — all in one place.
        </span>
      </div>
      <MdArrowOutward className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
    </div>
  </a>
);

export function StepFinished() {
  const router = useRouter();
  const { toast } = useToast();
  const { setStep } = useOnboarding();

  const handleFinish = () => {
    captureOnboardingEvent(posthog, {
      name: 'onboarding_completed',
      options: {
        step_name: 'onboarding_users_invited_opt'
      }
    })
    setStep(undefined);
    router.push('/');
  };

  const form = useZodForm<InviteFormValues>({
    mode: 'onSubmit',
    schema: inviteSchema,
    defaultValues: { members: [{ email: '' }] },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'members',
  });

  const watchedMembers = form.watch('members');
  const hasValidEmail = watchedMembers.some((m) => emailSchema.safeParse(m.email).success);

  const { data: groupsData } = useQuery(getOrganizationGroups);
  const viewerGroupId = groupsData?.groups?.find((g) => g.name.toLowerCase() === 'viewer')?.groupId;

  const { mutate, isPending } = useMutation(inviteUsers);

  const onSubmit: SubmitHandler<InviteFormValues> = (data) => {
    const emails = data.members.map((m) => m.email.trim()).filter((e) => e.length > 0);
    mutate(
      { emails, groups: viewerGroupId ? [viewerGroupId] : [] },
      {
        onSuccess: (d) => {
          if (d.response?.code !== EnumStatusCode.OK) {
            toast({
              description: d.response?.details ?? 'Could not invite members. Please try again.',
              duration: 3000,
            });
            return;
          }

          if (d.invitationErrors.length > 0) {
            const failed = d.invitationErrors.map((e) => e.email).join(', ');
            toast({
              description: `Some invitations failed: ${failed}`,
              duration: 5000,
            });
            return;
          }

          toast({
            description: `Invited ${emails.length} ${emails.length === 1 ? 'member' : 'members'}.`,
            duration: 3000,
          });
          captureOnboardingEvent(posthog, {
            name: 'onboarding_step_completed',
            options: {
              step_name: 'onboarding_users_invited_opt',
              users_invited: emails.length,
            },
          });
          form.reset({ members: [{ email: '' }] });
        },
        onError: () => {
          toast({
            description: 'Could not invite members. Please try again.',
            duration: 3000,
          });
        },
      },
    );
  };

  const trackDocumentationLinkClick = useCallback(() => {
    captureOnboardingEvent(posthog, {
      name: 'onboarding_step_completed',
      options: {
        step_name: 'onboarding_docs_visit_opt',
      },
    });
  }, [posthog]);

  return (
    <OnboardingContainer>
      <div className="flex w-full flex-1 flex-col gap-6 text-left">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">You&apos;re all set!</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your graph is live. Invite your teammates and explore the docs to keep going.
          </p>
        </div>

        <section className="flex flex-col gap-3">
          <div>
            <h3 className="flex items-center gap-x-2 text-sm font-semibold">
              <UserPlusIcon className="size-4 text-muted-foreground" />
              Invite your team
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Add teammates by email so they can join your organization.
            </p>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                {fields.map((field, index) => (
                  <FormField
                    key={field.id}
                    control={form.control}
                    name={`members.${index}.email`}
                    render={({ field: emailField }) => (
                      <FormItem>
                        <div className="flex items-center">
                          <FormControl>
                            <Input placeholder="janedoe@example.com" {...emailField} />
                          </FormControl>
                          <div
                            className={cn(
                              'shrink-0 overflow-hidden transition-[width] duration-150 ease-out',
                              fields.length > 1 ? 'w-10' : 'w-0',
                            )}
                          >
                            <div
                              className={cn(
                                'flex items-center justify-center transition-opacity duration-150 ease-out',
                                fields.length > 1 ? 'opacity-100 delay-150' : 'opacity-0',
                              )}
                            >
                              <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(index)}>
                                <Cross1Icon />
                              </Button>
                            </div>
                          </div>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
              {form.formState.errors.members?.root?.message && (
                <p className="text-sm text-destructive">{form.formState.errors.members.root.message}</p>
              )}
              <div className="flex items-center justify-between">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => append({ email: '' })}
                        disabled={fields.length >= MAXIMUM_BATCH_SIZE}
                      >
                        <PlusIcon className="mr-2" /> Add another
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {fields.length >= MAXIMUM_BATCH_SIZE && (
                    <TooltipContent>You can invite more members later</TooltipContent>
                  )}
                </Tooltip>
                {hasValidEmail && !viewerGroupId ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button type="submit" variant="secondary" disabled>
                          Invite
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Unable to load organization data. Please refresh the page.</TooltipContent>
                  </Tooltip>
                ) : (
                  <Button type="submit" variant="secondary" disabled={!hasValidEmail || isPending}>
                    {isPending ? 'Inviting…' : 'Invite'}
                  </Button>
                )}
              </div>
            </form>
          </Form>
        </section>

        <section className="mt-6 flex flex-col gap-3">
          <div>
            <h3 className="flex items-center gap-x-2 text-sm font-semibold">
              <BookOpenIcon className="size-4 text-muted-foreground" />
              Further reading
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">Jump into the docs to go deeper.</p>
          </div>
          <ul className="flex flex-col gap-2">
            <DocumentationLinkItem
              title="Introduction to Cosmo"
              description="What Cosmo is, the moving parts, and how federation fits together."
              href={`${docsBaseURL}/overview`}
              onClick={trackDocumentationLinkClick}
            />
            <DocumentationLinkItem
              title="CLI reference"
              description="Everything you can do with the wgc command-line tool."
              href={`${docsBaseURL}/cli/intro`}
              onClick={trackDocumentationLinkClick}
            />
            <DocumentationLinkItem
              title="Tutorials"
              description="Hands-on guides covering common Cosmo use cases, end to end."
              href={`${docsBaseURL}/tutorial`}
              onClick={trackDocumentationLinkClick}
            />
          </ul>
          <HubPromoLink />
        </section>

        <div className="mt-auto flex justify-end pt-8">
          <Button className="group" onClick={handleFinish}>
            Take me in
            <ArrowRightIcon className="ml-2 transition-transform group-hover:translate-x-1" />
          </Button>
        </div>
      </div>
    </OnboardingContainer>
  );
}

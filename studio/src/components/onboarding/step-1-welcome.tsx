import { OnboardingForm } from '@/components/onboarding/onboarding-form';
import { useToast } from '@/components/ui/use-toast';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { useMutation } from '@connectrpc/connect-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { completeOnboardingStep1 } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useRouter } from 'next/router';

export function Step1Welcome() {
  const router = useRouter();
  const org = useCurrentOrganization();
  const { toast } = useToast();

  const { mutate, isPending } = useMutation(completeOnboardingStep1);

  const onSubmit = (data: {
    organizationName: string;
    members: { email: string }[];
    channels: { slack: boolean; email: boolean };
  }) => {
    mutate(
      {
        organizationName: data.organizationName,
        memberEmails: data.members.map((m) => m.email),
        slack: data.channels.slack,
        email: data.channels.email,
      },
      {
        onSuccess(res) {
          if (res.response?.code === EnumStatusCode.OK) {
            router.push(`/${org?.slug}/graphs`);
          } else if (res.response?.details) {
            toast({ description: res.response.details, duration: 3000 });
          }
        },
        onError() {
          toast({
            description: 'Could not complete onboarding. Please try again.',
            duration: 3000,
          });
        },
      },
    );
  };

  return <OnboardingForm onSubmit={onSubmit} isPending={isPending} />;
}

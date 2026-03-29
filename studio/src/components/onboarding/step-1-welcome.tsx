import { useEffect, type Dispatch } from 'react';
import { OnboardingForm } from '@/components/onboarding/onboarding-form';
import { useToast } from '@/components/ui/use-toast';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { useMutation } from '@connectrpc/connect-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { completeOnboardingStep1 } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { SetStateAction } from 'react';
import { Onboarding } from './onboarding-provider';

interface Step1WelcomeProps {
  onDismiss: () => void;
  onSubmitSuccess: Dispatch<SetStateAction<Onboarding | undefined>>;
}

export function Step1Welcome({ onSubmitSuccess, onDismiss }: Step1WelcomeProps) {
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
          if (res.response?.code === EnumStatusCode.OK && res.onboarding) {
            onSubmitSuccess({
              ...res.onboarding,
              createdAt: new Date(res.onboarding.createdAt),
              finishedAt: res.onboarding.finishedAt ? new Date(res.onboarding.finishedAt) : null,
              updatedAt: res.onboarding.updatedAt ? new Date(res.onboarding.updatedAt) : null,
              federatedGraphId: res.onboarding.federatedGraphId || undefined,
            });
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

  useEffect(() => {
    return () => {
      onDismiss();
    };
  }, [onDismiss]);

  return <OnboardingForm onSubmit={onSubmit} onDismiss={onDismiss} isPending={isPending} />;
}

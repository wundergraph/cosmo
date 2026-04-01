import { useEffect } from 'react';
import { useOnboarding } from '@/hooks/use-onboarding';
import { OnboardingNavigation } from './onboarding-navigation';
import { useMutation } from '@connectrpc/connect-query';
import { createOnboarding } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useRouter } from 'next/router';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { useToast } from '../ui/use-toast';

export const Step1 = () => {
  const router = useRouter();
  const { toast } = useToast();
  const organization = useCurrentOrganization();
  const { setStep, setSkipped, setOnboarding } = useOnboarding();

  const { mutate, isPending } = useMutation(createOnboarding, {
    onSuccess: (d) => {
      if (d.response?.code !== EnumStatusCode.OK) {
        toast({
          description: d.response?.details ?? 'We had issues with storing your data. Please try again.',
          duration: 3000,
        });
        return;
      }

      setOnboarding({
        federatedGraphsCount: d.federatedGraphsCount,
        finishedAt: d.finishedAt ? new Date(d.finishedAt) : undefined,
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

  useEffect(() => {
    setStep(1);
  }, [setStep]);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h2 className="text-2xl font-semibold tracking-tight">Step 1</h2>
      <OnboardingNavigation
        onSkip={setSkipped}
        forward={{
          onClick: () => {
            // TODO: replace with real values in form
            mutate({
              organizationName: organization?.name ?? '',
              slack: true,
              email: false,
              invititationEmails: [],
            });
          },
          isLoading: isPending,
        }}
      />
    </div>
  );
};

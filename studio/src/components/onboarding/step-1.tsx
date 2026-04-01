import { useEffect } from 'react';
import { useOnboarding } from '@/hooks/use-onboarding';
import { OnboardingContainer } from './onboarding-container';
import { OnboardingNavigation } from './onboarding-navigation';
import { useMutation } from '@connectrpc/connect-query';
import { createOnboarding } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useRouter } from 'next/router';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { useToast } from '../ui/use-toast';

export const Step1 = () => {
  const router = useRouter();
  const { toast } = useToast();
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
    <OnboardingContainer>
      <h2 className="text-2xl font-semibold tracking-tight">Step 1</h2>
      <OnboardingNavigation
        onSkip={setSkipped}
        forward={{
          onClick: () => {
            // TODO: replace with real values in form
            mutate({
              slack: true,
              email: false,
            });
          },
          isLoading: isPending,
        }}
      />
    </OnboardingContainer>
  );
};

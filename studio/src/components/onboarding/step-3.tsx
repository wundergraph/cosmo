import { useEffect } from 'react';
import { useOnboarding } from '@/hooks/use-onboarding';
import { OnboardingNavigation } from './onboarding-navigation';
import { useMutation } from '@connectrpc/connect-query';
import { finishOnboarding } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useToast } from '../ui/use-toast';
import { useRouter } from 'next/router';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';

export const Step3 = () => {
  const router = useRouter();
  const { toast } = useToast();
  const { setStep, setSkipped, setOnboarding } = useOnboarding();

  useEffect(() => {
    setStep(3);
  }, [setStep]);

  const { mutate, isPending } = useMutation(finishOnboarding, {
    onSuccess: (d) => {
      if (d.response?.code !== EnumStatusCode.OK) {
        toast({
          description: d.response?.details ?? 'We had issues with finishing the onboarding. Please try again.',
          duration: 3000,
        });
        return;
      }

      setOnboarding((prev) => ({
        ...prev,
        finishedAt: new Date(d.finishedAt),
        federatedGraphsCount: d.federatedGraphsCount,
      }));

      setStep(undefined);
      router.push('/');
    },
    onError: (error) => {
      toast({
        description: error.details.toString() ?? 'We had issues with finishing the onboarding. Please try again.',
        duration: 3000,
      });
    },
  });

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h2 className="text-2xl font-semibold tracking-tight">Step 4</h2>
      <OnboardingNavigation
        onSkip={setSkipped}
        backHref="/onboarding/3"
        forward={{
          onClick: () => mutate({}),
          isLoading: isPending,
        }}
        forwardLabel="Finish"
      />
    </div>
  );
};

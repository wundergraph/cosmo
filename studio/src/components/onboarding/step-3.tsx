import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useMutation } from '@connectrpc/connect-query';
import { useOnboarding } from '@/hooks/use-onboarding';
import { finishOnboarding } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { useToast } from '../ui/use-toast';
import { Link } from '../ui/link';
import { Button } from '../ui/button';

export const Step3 = () => {
  const router = useRouter();
  const { toast } = useToast();
  const { setStep, setSkipped, setOnboarding } = useOnboarding();

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

  useEffect(() => {
    setStep(3);
  }, [setStep]);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h2 className="text-2xl font-semibold tracking-tight">Step 3</h2>
      <div className="flex w-full justify-between">
        <Button asChild variant="secondary" onClick={setSkipped}>
          <Link href="/">Skip</Link>
        </Button>
        <div className="flex">
          <Button className="mr-2" asChild>
            <Link href="/onboarding/2">Back</Link>
          </Button>
          <Button
            onClick={() => {
              mutate({});
            }}
            isLoading={isPending}
            disabled={isPending}
          >
            Finish
          </Button>
        </div>
      </div>
    </div>
  );
};

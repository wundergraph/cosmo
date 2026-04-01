import { useEffect } from 'react';
import { Link } from '../ui/link';
import { Button } from '../ui/button';
import { useOnboarding } from '@/hooks/use-onboarding';

export const Step4 = () => {
  const { setStep, setSkipped } = useOnboarding();

  useEffect(() => {
    setStep(3);
  }, [setStep]);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h2 className="text-2xl font-semibold tracking-tight">Step 4</h2>
      <div className="flex w-full justify-between">
        <Button asChild variant="secondary" onClick={setSkipped}>
          <Link href="/">Skip</Link>
        </Button>
        <div className="flex">
          <Button className="mr-2" asChild>
            <Link href="/onboarding/3">Back</Link>
          </Button>
          <Button asChild>
            <Link href="/">Finish</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

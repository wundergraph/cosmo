import { useEffect } from 'react';
import { Link } from '../ui/link';
import { Button } from '../ui/button';
import { useOnboarding } from '@/hooks/use-onboarding';

export const Step2 = () => {
  const { setStep, setSkipped } = useOnboarding();

  useEffect(() => {
    setStep(2);
  }, [setStep]);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h2 className="text-2xl font-semibold tracking-tight">Step 2</h2>
      <div className="flex w-full justify-between">
        <Button asChild variant="secondary" onClick={setSkipped}>
          <Link href="/">Skip</Link>
        </Button>
        <div className="flex">
          <Button className="mr-2" asChild>
            <Link href="/onboarding/1">Back</Link>
          </Button>
          <Button asChild>
            <Link href="/onboarding/3">Next</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

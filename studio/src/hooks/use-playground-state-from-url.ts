import { useToast } from '@/components/ui/use-toast';
import { DEFAULT_QUERY_TEMPLATE } from '@/lib/constants';
import { extractStateFromUrl } from '@/lib/playground-url-state-decoding';
import { PlaygroundUrlState } from '@/types/playground.types';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

export const usePlaygroundStateFromUrl = () => {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = useState<PlaygroundUrlState | null>(null);

  useEffect(() => {
    const { playgroundUrlState } = router.query;
    // already cleared or doesn't exist
    if (!playgroundUrlState || typeof playgroundUrlState !== 'string') {
      return;
    }

    try {
      const extractedState = extractStateFromUrl();

      if (extractedState) {
        setState(extractedState);
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'development') {
        console.error('Error extracting state from URL:', (err as Error)?.message);
      }
      // fallback state when error occurs
      setState({ operation: DEFAULT_QUERY_TEMPLATE });
      toast({
        title: 'Error loading playground state',
        description: 'The playground has been reset to its default state due to invalid URL parameters.',
        variant: 'destructive',
      });
    }
  }, [router.query, toast]);

  // function to manually clear the state
  const clearState = () => {
    const { playgroundUrlState, ...query } = router.query;
    // critical to do this so that page refresh doesn't show the old state
    router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
    setState(null);
  };

  return { state, clearState };
};
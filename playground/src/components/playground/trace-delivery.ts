export type TraceDeliveryPhase = 'idle' | 'streaming' | 'complete' | 'incomplete' | 'cancelled' | 'error';

export type TraceDeliveryNotice = {
  kind: 'waiting' | 'partial' | 'incomplete';
  title: string;
  description: string;
};

export const getTraceDeliveryNotice = ({
  phase,
  hasTrace,
  message,
}: {
  phase: TraceDeliveryPhase;
  hasTrace: boolean;
  message?: string;
}): TraceDeliveryNotice | undefined => {
  if (phase === 'streaming') {
    return hasTrace
      ? {
          kind: 'partial',
          title: 'Partial trace',
          description: 'Deferred fetches are still running. The terminal result will replace this trace.',
        }
      : {
          kind: 'waiting',
          title: 'Waiting for the initial trace',
          description: 'The request is running and no complete multipart result has arrived yet.',
        };
  }

  if (phase === 'incomplete' || phase === 'cancelled' || phase === 'error') {
    return {
      kind: 'incomplete',
      title: 'Incomplete trace',
      description:
        message ||
        (phase === 'cancelled'
          ? 'The incremental response was cancelled before terminal ART arrived.'
          : 'The incremental response ended before terminal ART arrived.'),
    };
  }
};

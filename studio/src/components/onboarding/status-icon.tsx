import { CheckCircledIcon } from '@radix-ui/react-icons';

export type OnboardingStatus = 'pending' | 'ok' | 'fail' | 'error';

export const StatusIcon = ({ status }: { status: OnboardingStatus }) => {
  switch (status) {
    case 'pending':
      return (
        <span className="relative -mt-[1px] flex size-6 shrink-0 items-center justify-center">
          <span className="absolute inline-flex size-3 animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex size-3 rounded-full bg-success" />
        </span>
      );
    case 'ok':
      return (
        <span className="-mt-[1px] flex size-6 shrink-0 items-center justify-center text-success">
          <CheckCircledIcon className="size-5" />
        </span>
      );
    case 'error':
    case 'fail':
      return (
        <span className="-mt-[1px] flex size-6 shrink-0 items-center justify-center">
          <span className="inline-flex size-3 rounded-full bg-destructive" />
        </span>
      );
  }
};

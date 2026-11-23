import * as React from 'react';
import { Cross1Icon } from '@radix-ui/react-icons';

import { cn } from '@/lib/utils';
import { Button } from './button';
import { Input, InputProps } from './input';

export interface ClearableInputProps extends InputProps {
  /** Shows a clear button inside the right edge of the input while set. */
  onClear?: () => void;
  clearLabel?: string;
  /** Shown inside the left edge of the input, e.g. a search icon. */
  icon?: React.ReactNode;
  /** Classes for the wrapper, which takes the input's place in the layout. */
  containerClassName?: string;
}

const ClearableInput = React.forwardRef<HTMLInputElement, ClearableInputProps>(
  ({ className, onClear, clearLabel = 'Clear', icon, containerClassName, ...props }, ref) => {
    return (
      <div className={cn('relative w-full', containerClassName)}>
        {icon && <span className="absolute bottom-0 left-3 top-0 my-auto flex items-center">{icon}</span>}
        <Input ref={ref} className={cn(!!icon && 'pl-8', onClear && 'pr-10', className)} {...props} />
        {onClear && (
          <Button
            type="button"
            variant="ghost"
            aria-label={clearLabel}
            className="absolute bottom-0 right-0 top-0 my-auto rounded-l-none"
            onClick={onClear}
          >
            <Cross1Icon />
          </Button>
        )}
      </div>
    );
  },
);
ClearableInput.displayName = 'ClearableInput';

export { ClearableInput };

import { cn } from '@/lib/utils';
import { CodeViewer } from '../code-viewer';
import { Button, ButtonProps } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';

export const ViewOutput = ({
  output,
  asChild,
  label = 'View Output',
  variant = 'secondary',
  buttonClassName,
}: {
  output: any;
  asChild?: boolean;
  label?: string;
  variant?: ButtonProps['variant'];
  buttonClassName?: string;
}) => {
  return (
    <Dialog>
      <DialogTrigger asChild={asChild} className={cn(!asChild && 'text-primary')}>
        {asChild ? (
          <Button variant={variant} size="sm" className={cn('flex-1', buttonClassName)}>
            <span className="flex-shrink-0">{label}</span>
          </Button>
        ) : (
          label
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Output</DialogTitle>
        </DialogHeader>

        <div className="scrollbar-custom h-96 overflow-auto rounded border">
          <CodeViewer code={JSON.stringify(output)} language="json" />
        </div>
      </DialogContent>
    </Dialog>
  );
};

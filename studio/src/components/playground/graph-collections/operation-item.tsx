import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { DotsHorizontalIcon } from '@radix-ui/react-icons';
import { GraphCollectionOperationMeta } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

export const OperationItem = ({
  operation,
  canEdit,
  isOpen,
  isActive,
  onOpen,
  onCopyLink,
  onRename,
  onDelete,
}: {
  operation: GraphCollectionOperationMeta;
  canEdit: boolean;
  isOpen: boolean;
  isActive: boolean;
  onOpen: () => void;
  onCopyLink: () => void;
  onRename: () => void;
  onDelete: () => void;
}) => {
  return (
    <div
      className={cn('group flex min-h-7 items-center gap-x-1 rounded px-2 hover:bg-accent', isActive && 'bg-accent')}
      aria-current={isActive ? 'true' : undefined}
    >
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left" title={operation.name}>
        <span
          className={cn(
            'block truncate text-sm leading-5',
            isActive && 'font-medium text-foreground',
            isOpen && !isActive && 'text-foreground',
          )}
        >
          {operation.name}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            className="h-5 w-5 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label={`Actions for ${operation.name}`}
          >
            <DotsHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onCopyLink}>Copy link</DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
              <DropdownMenuItem onSelect={onDelete} className="text-destructive">
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

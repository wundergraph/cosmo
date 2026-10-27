import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDownIcon, ChevronRightIcon, DotsHorizontalIcon } from '@radix-ui/react-icons';
import { GraphCollection, GraphCollectionOperationMeta } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OperationItem } from './operation-item';

export const CollectionItem = ({
  collection,
  isExpanded,
  onToggle,
  boundOperationIds,
  activeOperationId,
  onOpenOperation,
  onCopyLink,
  onRename,
  onShare,
  onDelete,
  onCopyOperationLink,
  onRenameOperation,
  onDeleteOperation,
}: {
  collection: GraphCollection;
  isExpanded: boolean;
  onToggle: () => void;
  boundOperationIds: Set<string>;
  activeOperationId: string | undefined;
  onOpenOperation: (operation: GraphCollectionOperationMeta) => void;
  onCopyLink: () => void;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
  onCopyOperationLink: (operation: GraphCollectionOperationMeta) => void;
  onRenameOperation: (operation: GraphCollectionOperationMeta) => void;
  onDeleteOperation: (operation: GraphCollectionOperationMeta) => void;
}) => {
  return (
    <div>
      <div className="group flex min-h-7 items-center gap-x-1 rounded px-1 hover:bg-accent">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-x-1 text-left">
          {isExpanded ? (
            <ChevronDownIcon className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRightIcon className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate text-sm leading-5">{collection.name}</span>
        </button>

        {/* The menu is always present: copying a link needs only the ability to
            see the collection, so a read-only member still gets that one. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-5 w-5 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label={`Actions for ${collection.name}`}
            >
              <DotsHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onCopyLink}>Copy link</DropdownMenuItem>
            {collection.canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
                {/* Sharing is one-way, so it disappears once the collection is
                    already team-scoped rather than becoming a no-op. */}
                {!collection.isTeamScoped && <DropdownMenuItem onSelect={onShare}>Share with team</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onDelete} className="text-destructive">
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isExpanded && (
        <div className="ml-3 border-l pl-2">
          {collection.operations.length === 0 ? (
            <p className="px-2 py-0.5 text-xs text-muted-foreground">No operations saved yet.</p>
          ) : (
            collection.operations.map((operation) => (
              <OperationItem
                key={operation.id}
                operation={operation}
                canEdit={collection.canEdit}
                isOpen={boundOperationIds.has(operation.id)}
                isActive={operation.id === activeOperationId}
                onOpen={() => onOpenOperation(operation)}
                onCopyLink={() => onCopyOperationLink(operation)}
                onRename={() => onRenameOperation(operation)}
                onDelete={() => onDeleteOperation(operation)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

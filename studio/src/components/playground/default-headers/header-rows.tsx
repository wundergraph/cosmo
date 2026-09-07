import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DefaultHeaderEntry, isValidHeaderName } from '@/lib/playground-headers';
import { PlusIcon, TrashIcon } from '@radix-ui/react-icons';

/**
 * A blank key is a row the user has not filled in yet, not an error - it is filtered
 * out before saving.
 */
export const isInvalidKey = (entry: DefaultHeaderEntry) => entry.key.trim() !== '' && !isValidHeaderName(entry.key);

export interface HeaderRowsProps {
  entries: DefaultHeaderEntry[];
  disabled?: boolean;
  onChange: (entries: DefaultHeaderEntry[]) => void;
}

export const HeaderRows = ({ entries, disabled = false, onChange }: HeaderRowsProps) => {
  const update = (index: number, patch: Partial<DefaultHeaderEntry>) => {
    onChange(entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  };

  return (
    <div className="flex flex-col gap-y-2">
      {entries.map((entry, index) => {
        const isInvalid = isInvalidKey(entry);

        return (
          <div key={index} className="flex items-start gap-x-2">
            <div className="flex-1">
              <Input
                aria-label="Header name"
                placeholder="Header name"
                value={entry.key}
                disabled={disabled}
                onChange={(e) => update(index, { key: e.target.value })}
                className={isInvalid ? 'border-destructive' : undefined}
              />
              {isInvalid && <p className="mt-1 text-xs text-destructive">Not a valid HTTP header name</p>}
            </div>
            <Input
              aria-label="Header value"
              placeholder="Value"
              value={entry.value}
              disabled={disabled}
              onChange={(e) => update(index, { value: e.target.value })}
              className="flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove header"
              disabled={disabled}
              onClick={() => onChange(entries.filter((_, i) => i !== index))}
            >
              <TrashIcon className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...entries, { key: '', value: '' }])}
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          Add header
        </Button>
      </div>
    </div>
  );
};

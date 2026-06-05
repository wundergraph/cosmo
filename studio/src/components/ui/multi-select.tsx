import * as React from 'react';
import { CaretSortIcon, CheckIcon, Cross2Icon } from '@radix-ui/react-icons';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
  description?: string;
  /** Optional heading to group this option under in the dropdown. */
  group?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  disabled,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No options.',
  className,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);

  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const selectedOptions = options.filter((o) => selectedSet.has(o.value));

  const toggle = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  // Preserve option order while grouping by the optional `group` heading.
  const groups = React.useMemo(() => {
    const map = new Map<string, MultiSelectOption[]>();
    for (const option of options) {
      const key = option.group ?? '';
      const bucket = map.get(key);
      if (bucket) {
        bucket.push(option);
      } else {
        map.set(key, [option]);
      }
    }
    return Array.from(map.entries());
  }, [options]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'h-auto min-h-9 w-full justify-between gap-2 px-3 py-2 font-normal',
            className,
          )}
        >
          <div className="flex flex-1 flex-wrap gap-1.5">
            {selectedOptions.length === 0 ? (
              <span className="font-normal text-muted-foreground">{placeholder}</span>
            ) : (
              selectedOptions.map((option) => (
                <Badge key={option.value} variant="secondary" className="gap-x-1 py-0 font-normal">
                  {option.label}
                  {!disabled && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${option.label}`}
                      className="rounded-sm outline-none ring-offset-background hover:text-foreground focus:ring-2 focus:ring-ring"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggle(option.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          toggle(option.value);
                        }
                      }}
                    >
                      <Cross2Icon className="h-3 w-3" />
                    </span>
                  )}
                </Badge>
              ))
            )}
          </div>
          <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] overflow-hidden p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map(([groupName, groupOptions]) => (
              <CommandGroup key={groupName || 'ungrouped'} heading={groupName || undefined}>
                {groupOptions.map((option) => {
                  const isSelected = selectedSet.has(option.value);
                  return (
                    <CommandItem
                      key={option.value}
                      value={`${option.label} ${option.value}`}
                      onSelect={() => toggle(option.value)}
                      className="cursor-pointer items-start gap-x-2"
                    >
                      <div
                        className={cn(
                          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary',
                          isSelected ? 'bg-primary text-primary-foreground' : 'opacity-50 [&_svg]:invisible',
                        )}
                      >
                        <CheckIcon className="h-3 w-3" />
                      </div>
                      <div className="flex flex-col">
                        <span>{option.label}</span>
                        {option.description && (
                          <span className="text-xs text-muted-foreground">{option.description}</span>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

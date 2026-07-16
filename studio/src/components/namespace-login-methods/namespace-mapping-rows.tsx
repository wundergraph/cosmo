import { Dispatch, SetStateAction } from 'react';
import { MinusCircledIcon, PlusIcon } from '@radix-ui/react-icons';
import { Button } from '@/components/ui/button';
import { MultiSelect, MultiSelectOption } from '@/components/ui/multi-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface NamespaceLite {
  id: string;
  name: string;
}

export interface MappingRow {
  id: number;
  // The namespace id, or '' until the user picks one.
  namespaceId: string;
  // Selected login-method values (SSO provider ids and/or the password sentinel).
  methodValues: string[];
}

interface NamespaceMappingRowsProps {
  namespaces: NamespaceLite[];
  methodOptions: MultiSelectOption[];
  rows: MappingRow[];
  updateRows: Dispatch<SetStateAction<MappingRow[]>>;
  disabled?: boolean;
}

/**
 * One row per restricted namespace: a namespace single-select plus a multi-select
 * of the login methods allowed for it, with a remove button and an "Add
 * namespace" button. A namespace can be configured at most once — namespaces
 * used by other rows are hidden from a row's namespace dropdown.
 */
export function NamespaceMappingRows({
  namespaces,
  methodOptions,
  rows,
  updateRows,
  disabled,
}: NamespaceMappingRowsProps) {
  const usedNamespaceIds = new Set(rows.map((r) => r.namespaceId).filter(Boolean));
  const allNamespacesUsed = namespaces.every((n) => usedNamespaceIds.has(n.id));

  return (
    <div className="flex flex-col gap-y-4">
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No namespaces are restricted. Every namespace is open to all login methods (default-open). Add a namespace to
          restrict it.
        </div>
      ) : (
        <div className="hidden grid-cols-[18rem_1fr_auto] gap-x-3 px-1 text-xs font-medium text-muted-foreground md:grid">
          <span>Namespace</span>
          <span>Allowed login methods</span>
          <span />
        </div>
      )}

      {rows.map((row, index) => {
        const available = namespaces.filter((n) => n.id === row.namespaceId || !usedNamespaceIds.has(n.id));
        const namespaceLabel = namespaces.find((n) => n.id === row.namespaceId)?.name ?? 'Select a namespace';

        return (
          <div key={row.id} className="grid grid-cols-1 items-start gap-3 md:grid-cols-[18rem_1fr_auto]">
            <Select
              value={row.namespaceId || undefined}
              disabled={disabled}
              onValueChange={(namespaceId) =>
                updateRows((prev) => prev.map((r, i) => (i === index ? { ...r, namespaceId } : r)))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a namespace">{namespaceLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {available.map((ns) => (
                  <SelectItem key={ns.id} value={ns.id}>
                    {ns.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <MultiSelect
              options={methodOptions}
              selected={row.methodValues}
              disabled={disabled}
              placeholder="Select login methods"
              searchPlaceholder="Search login methods…"
              emptyText="No login methods available."
              onChange={(methodValues) =>
                updateRows((prev) => prev.map((r, i) => (i === index ? { ...r, methodValues } : r)))
              }
            />

            <Button
              aria-label="remove"
              size="icon"
              variant="ghost"
              disabled={disabled}
              onClick={() => updateRows((prev) => prev.filter((_, i) => i !== index))}
            >
              <MinusCircledIcon />
            </Button>
          </div>
        );
      })}

      <Button
        className="flex w-max gap-x-2"
        variant="outline"
        disabled={disabled || allNamespacesUsed}
        onClick={() => updateRows((prev) => [...prev, { id: Date.now(), namespaceId: '', methodValues: [] }])}
      >
        <PlusIcon />
        <p>{rows.length === 0 ? 'Add namespace' : 'Add another'}</p>
      </Button>
    </div>
  );
}

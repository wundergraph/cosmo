import { OrganizationGroup } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Cross1Icon } from '@radix-ui/react-icons';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import * as z from 'zod';

export interface OIDCGroupMapperProps {
  mapper: MapperInput;
  availableGroups: OrganizationGroup[];
  isPending: boolean;
  onChange(updatedMapper: MapperInput): void;
  onRemove(): void;
}

export const schema = z.object({
  groupId: z.string().trim().uuid(),
  ssoGroup: z.string().trim().min(1),
});

export type MapperInput = z.infer<typeof schema> & { id: string };

export function OIDCGroupMapper({ mapper, availableGroups, isPending, onChange, onRemove }: OIDCGroupMapperProps) {
  const groupLabel = availableGroups.find((group) => group.groupId === mapper.groupId)?.name ?? 'Select a group';

  return (
    <div className="grid grid-cols-2 justify-between gap-x-2 px-1">
      <div className="flex flex-col gap-y-1">
        <Select
          value={mapper.groupId}
          disabled={isPending}
          onValueChange={(groupId) => onChange({ ...mapper, groupId })}
        >
          <SelectTrigger value={mapper.groupId}>
            <SelectValue aria-label={groupLabel}>{groupLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {availableGroups.map((group) => (
              <SelectItem key={`group-${group.groupId}`} value={group.groupId}>
                {group.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!mapper.groupId.trim() && <p className="px-2 text-sm text-destructive">Please select a group</p>}
      </div>
      <div className="flex items-start justify-start gap-x-1">
        <div className="flex flex-col gap-y-1">
          <Input
            placeholder="Group name or regex"
            disabled={isPending}
            value={mapper.ssoGroup}
            onInput={(e) =>
              onChange({
                ...mapper,
                ssoGroup: e.currentTarget.value,
              })
            }
          />

          {!mapper.ssoGroup.trim() && <p className="px-2 text-sm text-destructive">Please enter a value</p>}
        </div>

        <Button disabled={isPending} variant="ghost" className="w-10" onClick={onRemove}>
          <Cross1Icon className="size-4 shrink-0" />
        </Button>
      </div>
    </div>
  );
}

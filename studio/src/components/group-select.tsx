import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OrganizationGroup } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useQuery } from "@connectrpc/connect-query";
import { getOrganizationGroups } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { Button } from "@/components/ui/button";

export function GroupSelect({ value, disabled = false, onGroupChange }: {
  value?: string;
  disabled?: boolean;
  onGroupChange(group: OrganizationGroup): void;
}) {
  const { data, isPending, error, refetch } = useQuery(getOrganizationGroups);
  if (isPending) {
    return (
      <Button
        variant="outline"
        className="w-full"
        isLoading
      />
    );
  }

  if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <Button
        variant="outline"
        className="w-full"
        onClick={() => refetch()}
      >
        Failed to load groups. Try again.
      </Button>
    );
  }

  const availableGroups = data.groups;
  const activeGroup = availableGroups.find((group) => group.groupId === value);
  const groupLabel = activeGroup?.name ?? "Select a group";

  return (
    <Select
      value={value}
      onValueChange={(groupId) => {
        const selectedGroup = availableGroups.find((group) => group.groupId === groupId);
        if (!selectedGroup) {
          return;
        }

        onGroupChange(selectedGroup);
      }}
      disabled={disabled}
    >
      <SelectTrigger value={value}>
        <SelectValue aria-label={groupLabel}>{groupLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {availableGroups.map((group) => (
          <SelectItem
            key={`group-${group.groupId}`}
            value={group.groupId}
          >
            {group.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
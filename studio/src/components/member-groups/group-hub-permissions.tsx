import { create } from '@bufbuild/protobuf';
import { useMutation } from '@connectrpc/connect-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { updateOrganizationGroupHubPermissions } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import {
  GetUserAccessibleResourcesResponse,
  HubPermissionGrantSchema,
  OrganizationGroup,
  UpdateOrganizationGroupRequest_GroupRuleSchema,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { useState } from 'react';
import { GroupResourceSelector } from '@/components/member-groups/group-resource-selector';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useCheckUserAccess } from '@/hooks/use-check-user-access';
import { roles } from '@/lib/constants';

const hubPermissions = [
  { name: 'create_sandbox', label: 'Create sandboxes' },
  { name: 'share_sandbox', label: 'Share sandboxes' },
  { name: 'edit_sandbox', label: 'Edit sandboxes' },
  { name: 'propose', label: 'Open proposals' },
  { name: 'approve', label: 'Approve proposals' },
  { name: 'run_agents', label: 'Run agents' },
  { name: 'open_portals', label: 'Open portals' },
  { name: 'approve_egress', label: 'Approve egress' },
  { name: 'manage_egress_credentials', label: 'Manage egress credentials' },
  { name: 'manage_integrations', label: 'Manage integrations' },
  { name: 'view_audit_log', label: 'View the audit log' },
] as const;

type HubPermissionName = (typeof hubPermissions)[number]['name'];

const allHubPermissionNames: HubPermissionName[] = hubPermissions.map((permission) => permission.name);

const hubPermissionPresets: { name: string; description: string; permissions: HubPermissionName[] }[] = [
  { name: 'Viewer', description: 'No Hub actions', permissions: [] },
  {
    name: 'Editor',
    description: 'Sandboxes, proposals, agents and portals',
    permissions: [
      'create_sandbox',
      'share_sandbox',
      'edit_sandbox',
      'propose',
      'approve',
      'run_agents',
      'open_portals',
    ],
  },
  { name: 'Admin', description: 'Every Hub permission', permissions: allHubPermissionNames },
];

const graphScopeRole = roles.find((role) => role.key === 'graph-viewer');

function isHubPermissionName(name: string): name is HubPermissionName {
  return allHubPermissionNames.some((permissionName) => permissionName === name);
}

export function GroupHubPermissions({
  group,
  accessibleResources,
  onSaved,
}: {
  group: OrganizationGroup;
  accessibleResources: GetUserAccessibleResourcesResponse | undefined;
  onSaved(): Promise<unknown>;
}) {
  const { toast } = useToast();
  const checkUserAccess = useCheckUserAccess();
  const isOrganizationAdmin = checkUserAccess({ rolesToBe: ['organization-admin'] });

  const [selectedPermissions, setSelectedPermissions] = useState<HubPermissionName[]>(
    group.hubPermissions.map((grant) => grant.permission).filter(isHubPermissionName),
  );

  const firstGrant = group.hubPermissions[0];
  const [scope, setScope] = useState(
    create(UpdateOrganizationGroupRequest_GroupRuleSchema, {
      namespaces: firstGrant?.namespaces ?? [],
      resources: firstGrant?.resources ?? [],
    }),
  );

  const { mutate, isPending } = useMutation(updateOrganizationGroupHubPermissions);
  const isDisabled = !isOrganizationAdmin || isPending;

  const togglePermission = (name: HubPermissionName, checked: boolean) => {
    if (checked) {
      setSelectedPermissions([...selectedPermissions, name]);
    } else {
      setSelectedPermissions(selectedPermissions.filter((selected) => selected !== name));
    }
  };

  const onSaveClick = () => {
    const grants = selectedPermissions.map((permission) =>
      create(HubPermissionGrantSchema, {
        permission,
        namespaces: scope.namespaces,
        resources: scope.resources,
      }),
    );

    mutate(
      { groupId: group.groupId, hubPermissions: grants },
      {
        onSuccess(resp) {
          if (resp?.response?.code === EnumStatusCode.OK) {
            onSaved().finally(() => {
              toast({ description: 'Hub permissions updated', duration: 3000 });
            });
          } else {
            toast({
              description: resp?.response?.details ?? 'Could not update the Hub permissions. Please try again.',
              duration: 3000,
            });
          }
        },
        onError() {
          toast({ description: 'Could not update the Hub permissions. Please try again.', duration: 3000 });
        },
      },
    );
  };

  return (
    <section className="space-y-4 border-t pt-6">
      <div>
        <h3 className="font-medium">Hub permissions</h3>
        <p className="text-sm text-muted-foreground">
          What members of this group can do in Hub. Start from a preset, then adjust.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {hubPermissionPresets.map((preset) => (
          <Button
            key={preset.name}
            variant="outline"
            size="sm"
            disabled={isDisabled}
            title={preset.description}
            onClick={() => setSelectedPermissions(preset.permissions)}
          >
            {preset.name}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {hubPermissions.map((permission) => (
          <div key={permission.name} className="flex items-center gap-x-2">
            <Checkbox
              id={`hub-permission-${permission.name}`}
              checked={selectedPermissions.includes(permission.name)}
              disabled={isDisabled}
              onCheckedChange={(checked) => togglePermission(permission.name, checked === true)}
            />
            <Label htmlFor={`hub-permission-${permission.name}`} className="font-normal">
              {permission.label}
            </Label>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-x-3">
        <span className="shrink-0 text-sm text-muted-foreground">Scope</span>
        <GroupResourceSelector
          rule={scope}
          disabled={isDisabled}
          activeRole={graphScopeRole}
          accessibleResources={accessibleResources}
          onRuleUpdated={setScope}
        />
      </div>

      {isOrganizationAdmin && (
        <div className="flex justify-end">
          <Button isLoading={isPending} disabled={isDisabled} onClick={onSaveClick}>
            Save Hub permissions
          </Button>
        </div>
      )}
    </section>
  );
}

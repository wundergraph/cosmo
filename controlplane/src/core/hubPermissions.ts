import { GraphResourceKind, HubPermission } from '../db/models.js';
import { graphResourceKindEnum, hubPermissionEnum } from '../db/schema.js';

export const allHubPermissions: readonly HubPermission[] = hubPermissionEnum.enumValues;

const editorHubPermissions: HubPermission[] = [
  'create_sandbox',
  'share_sandbox',
  'edit_sandbox',
  'propose',
  'approve',
  'run_agents',
  'open_portals',
];

// Seeded for the groups every organization starts with, keyed by group name.
// Hidden schema is only ever granted explicitly, so no group starts with it.
export const defaultHubPermissionsByGroupName: Record<string, readonly HubPermission[]> = {
  admin: allHubPermissions.filter((permission) => permission !== 'view_hidden_schema'),
  developer: editorHubPermissions,
  viewer: [],
};

export function parseHubPermission(value: string): HubPermission | undefined {
  return allHubPermissions.find((permission) => permission === value);
}

export function parseGraphResourceKind(value: string): GraphResourceKind | undefined {
  return graphResourceKindEnum.enumValues.find((kind) => kind === value);
}

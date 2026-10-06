export const createBlobStoragePath = ({
  organizationId,
  fedGraphId,
  clientName,
  operationId,
}: {
  organizationId: string;
  fedGraphId: string;
  clientName: string;
  operationId: string;
}): string => `${organizationId}/${fedGraphId}/operations/${clientName}/${operationId}.json`;

export const createManifestBlobStoragePath = ({
  organizationId,
  fedGraphId,
}: {
  organizationId: string;
  fedGraphId: string;
}): string => `${organizationId}/${fedGraphId}/operations/manifest.json`;

export function isValidPersistedOperationId(id: string): boolean {
  if (id.length === 0 || id.length > 250) {
    return false;
  }

  for (const character of id) {
    // Printable ASCII runs from space through tilde; path separators are excluded.
    if (character < ' ' || character > '~' || character === '/' || character === '\\') {
      return false;
    }
  }

  return true;
}

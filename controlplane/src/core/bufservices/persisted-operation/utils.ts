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

const MAX_PERSISTED_OPERATION_ID_LENGTH = 250;

export function isValidPersistedOperationId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_PERSISTED_OPERATION_ID_LENGTH) {
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

// Quotes and escapes an operation ID for error messages. IDs are cut one character past the
// maximum length, which is enough to show they are too long without echoing arbitrarily large input.
export function formatPersistedOperationIdForError(id: string): string {
  if (id.length <= MAX_PERSISTED_OPERATION_ID_LENGTH + 1) {
    return JSON.stringify(id);
  }
  return `${JSON.stringify(id.slice(0, MAX_PERSISTED_OPERATION_ID_LENGTH + 1))}… (${id.length} characters)`;
}

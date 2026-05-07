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

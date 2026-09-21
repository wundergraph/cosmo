export interface S3RouterConfigMetadata extends Record<string, string> {
  version: string;
}

export type RouterConfigMetadataInput = {
  version: string;
  signature?: string;
};

export function createRouterConfigMetadata({ version, signature }: RouterConfigMetadataInput): S3RouterConfigMetadata {
  const metadata: S3RouterConfigMetadata = { version };

  if (signature) {
    metadata['signature-sha256'] = signature;
  }

  return metadata;
}

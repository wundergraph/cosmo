import { compressionBrotli, createConnectTransport } from '@bufbuild/connect-node';
import { createPromiseClient, PromiseClient } from '@bufbuild/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_connect';

export interface ClientOptions {
  baseUrl: string;
  apiKey?: string;
}

export interface Client {
  platform: PromiseClient<typeof PlatformService>;
  node: PromiseClient<typeof NodeService>;
}

export const CreateClient = (opts: ClientOptions): Client => {
  const transport = createConnectTransport({
    // Requests will be made to <baseUrl>/<package>.<service>/method
    baseUrl: opts.baseUrl,

    // You have to tell the Node.js http API which HTTP version to use.
    httpVersion: '1.1',

    // Avoid compression for small requests
    compressMinBytes: 1024,

    acceptCompression: [compressionBrotli],

    // The default limit is the maximum supported value of ~4GiB
    // We go with 32MiB to avoid allocating too much memory for large requests
    writeMaxBytes: 32 * 1024 * 1024,

    // Interceptors apply to all calls running through this transport.
    interceptors: [],
  });

  return {
    platform: createPromiseClient(PlatformService, transport),
    node: createPromiseClient(NodeService, transport),
  };
};

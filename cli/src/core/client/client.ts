import { compressionBrotli, compressionGzip, createConnectTransport } from '@connectrpc/connect-node';
import { createPromiseClient, PromiseClient } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_connect';
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface ClientOptions {
  baseUrl: string;
  apiKey?: string;
  proxyUrl?: string;
}

export interface Client {
  platform: PromiseClient<typeof PlatformService>;
  node?: PromiseClient<typeof NodeService>;
}

export const CreateClient = (opts: ClientOptions): Client => {
  const transport = createConnectTransport({
    // Requests will be made to <baseUrl>/<package>.<service>/method
    baseUrl: opts.baseUrl,

    // You have to tell the Node.js http API which HTTP version to use.
    httpVersion: '1.1',
    nodeOptions: {
      ...(opts.proxyUrl ? { agent: new HttpsProxyAgent(opts.proxyUrl) } : {}),
    },
    // Avoid compression for small requests
    compressMinBytes: 1024,

    acceptCompression: [compressionBrotli, compressionGzip],

    // The default limit is the maximum supported value of ~4GiB
    // We go with 32MiB to avoid allocating too much memory for large requests
    writeMaxBytes: 32 * 1024 * 1024,

    sendCompression: compressionBrotli,

    // Interceptors apply to all calls running through this transport.
    interceptors: [],
    defaultTimeoutMs: 75_000,
  });

  return {
    platform: createPromiseClient(PlatformService, transport),
    node: createPromiseClient(NodeService, transport),
  };
};

import { compressionBrotli, compressionGzip, createConnectTransport } from '@connectrpc/connect-node';
import { Code, ConnectError, createClient, Client as ConnectClient } from '@connectrpc/connect';
import type { Interceptor } from '@connectrpc/connect';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { instanceRegistry, type InstanceRegistry } from '../instances.js';

export interface ClientOptions {
  baseUrl: string;
  apiKey?: string;
  proxyUrl?: string;
}

export interface Client {
  platform: ConnectClient<typeof PlatformService>;
  node?: ConnectClient<typeof NodeService>;
}

/** Refuses a call whose bearer is a Hub token for another instance than the call's target. */
export const instanceGuard =
  (registry: InstanceRegistry): Interceptor =>
  (next) =>
  async (request) => {
    const token = request.header.get('authorization')?.replace(/^Bearer /, '');
    if (token) {
      const allowed = await registry.authorize(token, new URL(request.url));
      if (!allowed.success) {
        const { message, remediation } = toFailure(allowed);
        throw new ConnectError([message, remediation].filter(Boolean).join('\n'), Code.PermissionDenied);
      }
    }
    return next(request);
  };

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
    interceptors: [instanceGuard(instanceRegistry)],
    defaultTimeoutMs: 120_000,
  });

  return {
    platform: createClient(PlatformService, transport),
    node: createClient(NodeService, transport),
  };
};

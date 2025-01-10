import { randomUUID } from 'node:crypto';
import { compressionBrotli, compressionGzip, createConnectTransport } from '@connectrpc/connect-node';
import { createPromiseClient, type Interceptor, PromiseClient } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_connect';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Response } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import pc from 'picocolors';
import { config } from '../config.js';

export interface ClientOptions {
  baseUrl: string;
  apiKey?: string;
  proxyUrl?: string;
}

export interface Client {
  platform: PromiseClient<typeof PlatformService>;
  node: PromiseClient<typeof NodeService>;
}

/**
 * Interceptor generating a request ID on requests to the server.
 */
export const requestIdInterceptor: Interceptor = (next) => async (req) => {
  const requestId = randomUUID();

  req.header.set('x-request-id', requestId);

  const timeStamp = new Date().toISOString();
  const res = await next(req);

  if ((res.message?.response as Response)?.code === EnumStatusCode.ERR) {
    console.log(pc.yellow('---'));
    console.log(pc.yellow('Something went wrong while processing a request for this command.'));
    console.log();
    console.log(pc.yellow(`Request ID: ${requestId}`));
    console.log(pc.yellow(`Request sent at: ${timeStamp}`));
    console.log(pc.yellow(`RPC Method: ${res.method.name}`));
    console.log(pc.yellow('---'));
  }

  return res;
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
    interceptors: [requestIdInterceptor],
    defaultTimeoutMs: 75_000,
  });

  return {
    platform: createPromiseClient(PlatformService, transport),
    node: createPromiseClient(NodeService, transport),
  };
};

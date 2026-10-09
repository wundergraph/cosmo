import { readFileSync } from 'node:fs';
import { compressionBrotli, compressionGzip, createConnectTransport } from '@connectrpc/connect-node';
import { createClient, Client as ConnectClient } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface ClientOptions {
  baseUrl: string;
  apiKey?: string;
  proxyUrl?: string;
  tls?: TlsClientOptions;
}

export interface TlsClientOptions {
  cert: Buffer;
  key: Buffer;
}

export type TlsClientResult =
  | { success: true; data: TlsClientOptions | undefined }
  | { success: false; errors: Array<Error> };

/**
 * Reads the mTLS client certificate and key from the given file paths.
 * Returns `data: undefined` when neither is set. Setting only one of the two is an error.
 */
export const loadTlsClientOptions = (certPath?: string, keyPath?: string): TlsClientResult => {
  if (!certPath && !keyPath) {
    return { success: true, data: undefined };
  }

  if (!certPath || !keyPath) {
    return {
      success: false,
      errors: [new Error('COSMO_TLS_CLIENT_CERT and COSMO_TLS_CLIENT_KEY must be set together.')],
    };
  }

  try {
    return { success: true, data: { cert: readFileSync(certPath), key: readFileSync(keyPath) } };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      errors: [new Error(`Failed to read the TLS client certificate or key: ${reason}`)],
    };
  }
};

export interface Client {
  platform: ConnectClient<typeof PlatformService>;
  node?: ConnectClient<typeof NodeService>;
}

export const CreateClient = (opts: ClientOptions): Client => {
  const transport = createConnectTransport({
    // Requests will be made to <baseUrl>/<package>.<service>/method
    baseUrl: opts.baseUrl,
    // You have to tell the Node.js http API which HTTP version to use.
    httpVersion: '1.1',
    nodeOptions: {
      ...(opts.proxyUrl ? { agent: new HttpsProxyAgent(opts.proxyUrl) } : {}),
      // cert and key are request options, so they are also used for the TLS
      // handshake with the target when the request is tunneled through a proxy
      ...(opts.tls ? { cert: opts.tls.cert, key: opts.tls.key } : {}),
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
    defaultTimeoutMs: 120_000,
  });

  return {
    platform: createClient(PlatformService, transport),
    node: createClient(NodeService, transport),
  };
};

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { CreateClient, loadTlsClientOptions } from '../src/core/client/client.js';

// `tls.setDefaultCACertificates` replaces, for the whole process, the list of certificate authorities (CAs) that
// Node trusts when it connects to an HTTPS server. We need it because the test server uses a certificate signed by a
// throwaway CA generated with openssl, which is not in Node's default list. A process-wide setting (instead of a
// per-request `ca` option) is required for the proxy test, where the TLS connection to the server is created by the
// proxy agent and we cannot hand it a `ca` from CreateClient.
//
// The function exists since Node 22.19, but the installed @types/node does not declare it yet, so TypeScript would
// reject `tls.setDefaultCACertificates`. We therefore tell TypeScript what shape `tls` has:
// `tls as unknown` forgets its declared type, `as { ... }` then declares the one we need.
// Remove this cast once @types/node includes the function.
const setDefaultCACertificates = (tls as unknown as { setDefaultCACertificates: (certs: readonly string[]) => void })
  .setDefaultCACertificates;

let dir: string;
let certPath: string;
let keyPath: string;

const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });

// Creates <name>.key and <name>.crt, signed by the throwaway CA (ca.crt / ca.key)
const createCertificateSignedByCa = (name: string, commonName: string) => {
  // 1. private key + certificate signing request
  openssl(
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    `${name}.key`,
    '-out',
    `${name}.csr`,
    '-subj',
    `/CN=${commonName}`,
  );
  // 2. the CA signs the request, producing the certificate
  openssl(
    'x509',
    '-req',
    '-in',
    `${name}.csr`,
    '-CA',
    'ca.crt',
    '-CAkey',
    'ca.key',
    '-CAcreateserial',
    '-out',
    `${name}.crt`,
    '-days',
    '1',
    '-extfile',
    'san.cnf',
  );
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wgc-mtls-'));
  certPath = join(dir, 'client.crt');
  keyPath = join(dir, 'client.key');

  // self-signed CA, server cert and client cert signed by that CA
  openssl(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'ca.key',
    '-out',
    'ca.crt',
    '-subj',
    '/CN=test-ca',
    '-days',
    '1',
  );
  writeFileSync(join(dir, 'san.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1');
  createCertificateSignedByCa('server', 'localhost');
  createCertificateSignedByCa('client', 'wgc-test-client');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const startServer = async () => {
  const seen: Array<string | undefined> = [];
  const tlsErrors: Array<Error> = [];
  const server = https.createServer(
    {
      cert: readFileSync(join(dir, 'server.crt')),
      key: readFileSync(join(dir, 'server.key')),
      ca: readFileSync(join(dir, 'ca.crt')),
      requestCert: true,
      rejectUnauthorized: true,
    },
    (req, res) => {
      seen.push((req.socket as tls.TLSSocket).getPeerCertificate().subject?.CN);
      res.writeHead(200, { 'content-type': 'application/proto' });
      res.end();
    },
  );
  server.on('tlsClientError', (err) => tlsErrors.push(err));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, seen, tlsErrors, url: `https://localhost:${port}` };
};

describe('loadTlsClientOptions', () => {
  test('returns undefined when neither variable is set', () => {
    expect(loadTlsClientOptions(undefined, undefined)).toEqual({ success: true, data: undefined });
  });

  test('errors when only one of cert and key is set', () => {
    expect(loadTlsClientOptions('/some/cert.pem', undefined).success).toBe(false);
    expect(loadTlsClientOptions(undefined, '/some/key.pem').success).toBe(false);
  });

  test('errors when a file cannot be read', () => {
    const result = loadTlsClientOptions('/does/not/exist.crt', '/does/not/exist.key');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0].message).toContain('Failed to read the TLS client certificate or key');
    }
  });

  test('reads cert and key from disk', () => {
    const result = loadTlsClientOptions(certPath, keyPath);
    expect(result).toEqual({ success: true, data: { cert: readFileSync(certPath), key: readFileSync(keyPath) } });
  });
});

describe('CreateClient with mTLS', () => {
  // make the test server (signed by our throwaway CA) trusted by the client
  beforeAll(() => {
    if (typeof setDefaultCACertificates !== 'function') {
      throw new TypeError(
        `These tests require Node.js >= 22.19 (tls.setDefaultCACertificates), but you are running ${process.version}. ` +
          'Please upgrade Node.js.',
      );
    }
    // trust the default CAs plus our throwaway CA; applies to every TLS client in the process,
    // including the one created by the proxy agent
    setDefaultCACertificates([...tls.rootCertificates, readFileSync(join(dir, 'ca.crt'), 'utf8')]);
  });
  afterAll(() => {
    // restore the default CAs so the throwaway CA does not leak into other tests
    if (typeof setDefaultCACertificates === 'function') {
      setDefaultCACertificates(tls.rootCertificates);
    }
  });

  test('presents the client certificate to the server', async () => {
    const { server, seen, url } = await startServer();
    try {
      const tlsOptions = loadTlsClientOptions(certPath, keyPath);
      if (!tlsOptions.success) {
        throw new Error('unexpected');
      }
      const client = CreateClient({ baseUrl: url, apiKey: 'x', tls: tlsOptions.data });
      await client.platform.whoAmI({}).catch(() => {
        // the dummy server does not speak the protocol, only the TLS handshake matters
      });
      expect(seen).toContain('wgc-test-client');
    } finally {
      server.close();
    }
  });

  test('is rejected by the server without a client certificate', async () => {
    const { server, seen, tlsErrors, url } = await startServer();
    try {
      const client = CreateClient({ baseUrl: url, apiKey: 'x' });
      await client.platform.whoAmI({}).catch(() => {});
      expect(seen).toHaveLength(0);
      // proves the server rejected the handshake because of the missing client certificate
      expect(tlsErrors.length).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });

  test('presents the client certificate to the server when going through an HTTP proxy', async () => {
    const { server, seen, url } = await startServer();
    const targetPort = Number(new URL(url).port);
    const connects: string[] = [];

    // minimal CONNECT proxy that blindly tunnels bytes
    const proxy = http.createServer();
    proxy.on('connect', (req, clientSocket) => {
      connects.push(req.url ?? '');
      const upstream = net.connect(targetPort, '127.0.0.1', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstream.destroy());
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

    try {
      const tlsOptions = loadTlsClientOptions(certPath, keyPath);
      if (!tlsOptions.success) {
        throw new Error('unexpected');
      }
      const client = CreateClient({ baseUrl: url, apiKey: 'x', proxyUrl, tls: tlsOptions.data });
      await client.platform.whoAmI({}).catch(() => {});
      expect(connects).toHaveLength(1);
      expect(seen).toContain('wgc-test-client');
    } finally {
      proxy.close();
      server.close();
    }
  });
});

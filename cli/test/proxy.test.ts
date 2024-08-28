import { describe, test, expect, vi, beforeEach } from 'vitest';
import { setGlobalDispatcher, ProxyAgent } from 'undici';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Mocks the actual used undici modules
// The tests check if those have been configured
// correctly after starting the cli with or without
// a proxy
vi.mock('undici', () => ({
  setGlobalDispatcher: vi.fn(),
  ProxyAgent: vi.fn().mockImplementation((opts) => ({
    uri: opts.uri,
  })),
}));

// Mocks https-proxy-agent used inside the
// connectrpc platform client which will be
// injected whenever a proxy was configured
vi.mock('https-proxy-agent', () => ({
  HttpsProxyAgent: vi.fn().mockImplementation((proxyUrl) => ({
    proxyUrl,
  })),
}));

// ensure all env variables and spies are cleaned up after each test
const prepare = () => {
  // resets e.g. ProxyAgent mock state between describes
  vi.resetModules();
  vi.resetAllMocks();

  delete process.env.HTTPS_PROXY;
  delete process.env.HTTP_PROXY;
};

beforeEach(prepare);

describe('fetch when the HTTP_PROXY variable is set', () => {
  test('when using HTTP_PROXY the ProxyAgent for native fetch was configured', async () => {
    process.env.HTTP_PROXY = 'http://proxy-server:8080';
    await import('../src/commands/index.js');

    expect(ProxyAgent).toHaveBeenCalledOnce();
    expect(ProxyAgent).toHaveBeenCalledWith({
      uri: 'http://proxy-server:8080/',
    });

    expect(setGlobalDispatcher).toHaveBeenCalledOnce();
  });
});

describe('fetch when the HTTP(S)_PROXY variable is set', () => {
  test('when using HTTPS_PROXY the fetch ProxyAgent was set (without trailing slash)', async () => {
    process.env.HTTPS_PROXY = 'https://proxy-server:8080';

    await import('../src/commands/index.js');

    expect(ProxyAgent).toHaveBeenCalledOnce();
    expect(ProxyAgent).toHaveBeenCalledWith({
      uri: 'https://proxy-server:8080/',
    });

    expect(setGlobalDispatcher).toHaveBeenCalledOnce();
  });
  test('when using HTTPS_PROXY the fetch ProxyAgent was set (with leading slash)', async () => {
    process.env.HTTPS_PROXY = 'https://proxy-server:8080/';

    await import('../src/commands/index.js');

    expect(ProxyAgent).toHaveBeenCalledOnce();
    expect(ProxyAgent).toHaveBeenCalledWith({
      uri: 'https://proxy-server:8080/',
    });

    expect(setGlobalDispatcher).toHaveBeenCalledOnce();
  });
});

describe('Platform Client Proxy Configuration', () => {
  test('does not create proxy agent when proxyUrl is not provided', async () => {
    await import('../src/commands/index.js');
    expect(HttpsProxyAgent).not.toHaveBeenCalled();
  });

  test('creates a proxy agent when given a proxyUrl', async () => {
    process.env.HTTPS_PROXY = 'https://proxy-server:8080';

    await import('../src/commands/index.js');
    expect(HttpsProxyAgent).toHaveBeenCalledOnce();
  });
});

describe('when the HTTPS_PROXY variable is not set', () => {
  test('the global undici or connect proxy was not initizalized', async () => {
    await import('../src/commands/index.js');

    // native fetch
    expect(ProxyAgent).not.toHaveBeenCalled();
    expect(setGlobalDispatcher).not.toHaveBeenCalled();

    // connect client
    expect(HttpsProxyAgent).not.toHaveBeenCalled();
  });
});

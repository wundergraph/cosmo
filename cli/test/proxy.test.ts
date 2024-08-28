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

describe('that when the HTTP_PROXY variable is set', () => {
  test('the ProxyAgent for native fetch is configured using HTTP_PROXY', async () => {
    process.env.HTTP_PROXY = 'http://proxy-server:8080';
    await import('../src/commands/index.js');

    expect(ProxyAgent).toHaveBeenCalledOnce();
    expect(ProxyAgent).toHaveBeenCalledWith({
      uri: 'http://proxy-server:8080/',
    });

    expect(setGlobalDispatcher).toHaveBeenCalledOnce();
  });
});

describe('that when the HTTPS_PROXY variable is set', () => {
  test('the fetch ProxyAgent is set without a trailing slash in HTTPS_PROXY', async () => {
    process.env.HTTPS_PROXY = 'https://proxy-server:8080';

    await import('../src/commands/index.js');

    expect(ProxyAgent).toHaveBeenCalledOnce();
    expect(ProxyAgent).toHaveBeenCalledWith({
      uri: 'https://proxy-server:8080/',
    });

    expect(setGlobalDispatcher).toHaveBeenCalledOnce();
  });
  test('the fetch ProxyAgent is set with a trailing slash in HTTPS_PROXY', async () => {
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
  test('that a proxy agent is not created when no proxyUrl is provided', async () => {
    await import('../src/commands/index.js');
    expect(HttpsProxyAgent).not.toHaveBeenCalled();
  });

  test('that a proxy agent is created when a proxyUrl is provided', async () => {
    process.env.HTTPS_PROXY = 'https://proxy-server:8080';

    await import('../src/commands/index.js');
    expect(HttpsProxyAgent).toHaveBeenCalledOnce();
  });
});

describe('when the HTTPS_PROXY variable is not set', () => {
  test('the global undici or connect proxy is not initizalized', async () => {
    await import('../src/commands/index.js');

    // native fetch
    expect(ProxyAgent).not.toHaveBeenCalled();
    expect(setGlobalDispatcher).not.toHaveBeenCalled();

    // connect client
    expect(HttpsProxyAgent).not.toHaveBeenCalled();
  });
});

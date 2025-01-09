import { describe, test, expect, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { config } from "../src/core/config.js";
import { requestIdInterceptor } from '../src/core/client/client.js';

describe('requestIdInterceptor()', () => {
  test('Should log the request ID when the response errored', async () => {
    config.requestId = '00000000-0000-0000-0000-000000000001';
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const req = { headers: {} };
    await requestIdInterceptor(() => ({ message: { response: { code: EnumStatusCode.ERR, details: 'An error occurred' } } }))(req);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(config.requestId));
    consoleLogSpy.mockRestore();
  });

  test('Should not log the request ID when the response was successful', async () => {
    config.requestId = '00000000-0000-0000-0000-000000000001';
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const req = { headers: {} };
    await requestIdInterceptor(() => ({ message: { response: { code: EnumStatusCode.OK, details: 'No error here' } } }))(req);

    expect(consoleLogSpy).not.toHaveBeenCalled();
    consoleLogSpy.mockRestore();
  });
});

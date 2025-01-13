import { afterEach, describe, test, expect, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { requestIdInterceptor } from '../src/core/client/client.js';
import { expectUuid } from './utils/utils.js';

let mockedId = 'mocked-id';

const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

vi.mock('node:crypto', () => ({
  randomUUID: () => mockedId,
}));

const ERR_RESPONSE = { message: { response: { code: EnumStatusCode.ERR, details: 'An error occurred' } }, method: { name: 'WhoAmI' } };
const SUCCESS_RESPONSE = { message: { response: { code: EnumStatusCode.OK, details: 'No error here' } } };


describe('requestIdInterceptor()', () => {
  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  test('Should log the request ID when the response errored', async () => {
    const req = {
      header: {
        set: (key, val) => {}
      }
    };

    await requestIdInterceptor(() => ERR_RESPONSE)(req);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(mockedId));
  });

  test('Should NOT log the request ID when the response was successful', async () => {
    const req = {
      header: {
        set: (key, val) => {}
      }
    };

    await requestIdInterceptor(() => SUCCESS_RESPONSE)(req);

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  test('Should set request ID on outgoing request', async () => {
    mockedId = 'ae9b88e5-ea1e-487c-b142-e37717748c06';

    const setHeaders: Record<string, string> = {};
    const req = {
      header: {
        set: (key, val) => {
          setHeaders[key] = val;
        }
      }
    };

    await requestIdInterceptor(() => SUCCESS_RESPONSE)(req);

    expect(setHeaders).toHaveProperty('x-request-id');
    expect(setHeaders['x-request-id']).toBe(mockedId);
  });

  test('Should set request ID as a valid UUID on outgoing request', async () => {
    // Temporarily unmock node:crypto for this test
    vi.unmock('node:crypto');

    const setHeaders: Record<string, string> = {};
    const req = {
      header: {
        set: (key, val) => {
          setHeaders[key] = val;
        }
      }
    };

    await requestIdInterceptor(() => SUCCESS_RESPONSE)(req);

    // Check if the generated UUID is valid
    expect(setHeaders).toHaveProperty('x-request-id');
    expectUuid(setHeaders['x-request-id']);

    // Re-mock node:crypto after the test
    vi.mock('node:crypto', () => ({
      randomUUID: () => mockedId,
    }));
  });
});

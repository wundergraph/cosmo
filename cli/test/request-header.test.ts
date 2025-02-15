import { describe, test, expect, vi } from 'vitest';
import { Command } from 'commander';
import { Response, WhoAmIResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CreateClient } from '../src/core/client/client.js';
import WhoAmI from '../src/commands/auth/commands/whoami.js';
import { config } from '../src/core/config.js';
import { expectUuid } from './utils/utils.js';

function createInterceptor(cb: (req) => void = () => {}, code = 0) {
  return (req) => {
    cb(req);

    return {
      message: new WhoAmIResponse({
        response: new Response( { code, details: 'details' } )
      }),
      method: { name: 'WhoAmI' }
    };
  };
}

describe('Command', () => {
  test('Includes request ID header on outgoing requests', async () => {
    const client = CreateClient({
      baseUrl: config.baseURL,
      apiKey: config.apiKey,
      interceptors: [(next) => createInterceptor((req) => {
        expectUuid(req.header.get('x-request-id'));
      })]
    });

    const program = new Command();

    await program.addCommand(
      WhoAmI({
        client,
      }),
    ).parseAsync(['whoami'], {
      from: 'user',
    });
  });

  test('Should log the request ID when the response errored', async () => {
    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let generatedUuid: string;

    const client = CreateClient({
      baseUrl: config.baseURL,
      apiKey: config.apiKey,
      interceptors: [(next) => createInterceptor((req) => {
        // Capture the generated UUID
        generatedUuid = req.header.get('x-request-id');
      }, 1)]
    });

    const program = new Command();

    try {
      await program.addCommand(
        WhoAmI({
          client,
        }),
      ).parseAsync(['whoami'], {
        from: 'user',
      });
    } catch {
      // Explicitly ignoring error returned by command due to error response
    }

    expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining(generatedUuid));
    consoleErrSpy.mockRestore();
  });

  test('Should NOT log the request ID when the response was successful', async () => {
    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let generatedUuid: string;

    const client = CreateClient({
      baseUrl: config.baseURL,
      apiKey: config.apiKey,
      interceptors: [(next) => createInterceptor()]
    });

    const program = new Command();

    try {
      await program.addCommand(
        WhoAmI({
          client,
        }),
      ).parseAsync(['whoami'], {
        from: 'user',
      });
    } catch {
      // Explicitly ignoring error returned by command due to error response
    }

    expect(consoleErrSpy).not.toHaveBeenCalled();
    consoleErrSpy.mockRestore();
  });
});


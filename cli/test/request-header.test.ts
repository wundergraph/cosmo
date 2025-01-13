import { describe, test, expect } from 'vitest';
import { Command } from 'commander';
import { Response, WhoAmIResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CreateClient } from '../src/core/client/client.js';
import WhoAmI from '../src/commands/auth/commands/whoami.js';
import { config } from '../src/core/config.js';
import { expectUuid } from './utils/utils.js';


const interceptor = (req) => {
  expectUuid(req.header.get('x-request-id'));

  return {
    message: new WhoAmIResponse({
      response: new Response( { code: 0, details: 'OK' } )
    })
  };
};

describe('Command', () => {
  test('Includes request ID header on outgoing requests', async () => {
    const client = CreateClient({
      baseUrl: config.baseURL,
      apiKey: config.apiKey,
      interceptors: [(next) => interceptor]
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
});


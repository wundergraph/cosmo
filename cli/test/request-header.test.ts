import { describe, test, expect } from 'vitest';
import { Command } from 'commander';
import { Response, WhoAmIResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CreateClient } from '../src/core/client/client.js';
import WhoAmI from '../src/commands/auth/commands/whoami.js';
import { config } from '../src/core/config.js';


const interceptor = (req) => {
  expect(req.header.get('x-request-id'), "must be a valid UUID").toMatch(/^[\da-f]{8}-[\da-f]{4}-[0-5][\da-f]{3}-[089ab][\da-f]{3}-[\da-f]{12}$/i);

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


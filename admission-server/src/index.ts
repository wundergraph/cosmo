import dotenv from 'dotenv';

import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { compress } from 'hono/compress';
import { Hono } from 'hono';
import { RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { makeSignature } from './signature.js';

dotenv.config();

if (!process.env.AUTH_SIGNATURE_KEY) {
  throw new Error('AUTH_SIGNATURE_KEY is required');
}

const signatureKey = process.env.AUTH_SIGNATURE_KEY;

const app = new Hono();

if (process.env.NODE_ENV !== 'production') {
  app.use('*', logger());
}
app.use('*', compress());

app.post('/validate-config', async (c) => {
  const jsonBody = await c.req.json<{ privateConfigUrl: string; federatedGraphId: string; organizationId: string }>();

  const resp = await fetch(jsonBody.privateConfigUrl, {
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Accept-Encoding': 'gzip',
    },
  });

  if (!resp.ok) {
    return c.json({ error: 'Failed to fetch private config' }, 400);
  }

  const configAsText = await resp.text();

  const config = RouterConfig.fromJsonString(configAsText);

  console.log('Validate config with version', config.version);

  const hmacDigest = await makeSignature(configAsText, signatureKey);

  return c.json({ signatureSha256: hmacDigest }, 200);
});

const port = 3009;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

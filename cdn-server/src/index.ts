import dotenv from 'dotenv';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cdn } from '@wundergraph/cosmo-cdn';
import { compress } from 'hono/compress';
import { createS3BlobStorage } from './s3';

dotenv.config();

if (!process.env.S3_STORAGE_URL) {
  throw new Error('S3_STORAGE_URL is required');
}

const blobStorage = createS3BlobStorage(process.env.S3_STORAGE_URL);

const app = new Hono();
if (process.env.NODE_ENV !== 'production') {
  app.use('*', logger());
}
app.use('*', compress());
cdn(app, {
  authJwtSecret: process.env.AUTH_JWT_SECRET!,
  authAdmissionJwtSecret: process.env.AUTH_ADMISSION_JWT_SECRET!,
  blobStorage,
});

let exiting = false;
app.get('/health', (c) => {
  if (exiting) {
    c.status(503);
    return c.json({ status: 'exiting' });
  }
  return c.json({ status: 'ok' });
});

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8787;
const server = serve({ fetch: app.fetch, port });

console.log(`Listening on port ${port}`);

const exit = () => {
  console.log('Exiting gracefully...');
  exiting = true;
  server.close((err) => {
    console.log('Server closed');
    if (err) {
      console.error(err);
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1);
    }
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  });
};

process.on('SIGTERM', exit);
process.on('SIGINT', exit);

import dotenv from 'dotenv';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cdn } from '../cdn/src/index';
import { createS3BlobStorage } from './s3';

dotenv.config();

if (!process.env.S3_STORAGE_URL) {
  throw new Error('S3_STORAGE_URL is required');
}

const blobStorage = createS3BlobStorage(process.env.S3_STORAGE_URL);

const app = new Hono();
cdn(app, {
  authJwtSecret: process.env.AUTH_JWT_SECRET!,
  blobStorage,
});

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8787;
serve({ fetch: app.fetch, port });

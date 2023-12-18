import type { Config } from 'drizzle-kit';

import * as dotenv from 'dotenv';
dotenv.config();

export default {
  schema: 'src/db/schema.ts',
  out: 'migrations',
  strict: true,
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DB_URL,
  },
} satisfies Config;

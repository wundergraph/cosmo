import type { Config } from 'drizzle-kit';

export default {
  schema: 'src/db/schema.ts',
  out: 'migrations',
  strict: true,
} satisfies Config;

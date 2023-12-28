import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export type Schema = typeof schema;

export type DB = PostgresJsDatabase<typeof schema>;

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterEach, describe, expect, test } from 'vitest';
import { RunMigration } from '../src/core/migrate.js';
import { afterAllSetup, beforeAllSetup } from '../src/core/test-util.js';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

async function readJournal(): Promise<Journal> {
  return JSON.parse(await readFile('migrations/meta/_journal.json', 'utf8'));
}

async function migrateUpTo(url: string, lastTag: string) {
  const folder = await mkdtemp(path.join(tmpdir(), 'cosmo-migrations-'));
  await cp('migrations', folder, { recursive: true });

  const journal = await readJournal();
  const lastIndex = journal.entries.findIndex((entry) => entry.tag === lastTag);
  journal.entries = journal.entries.slice(0, lastIndex + 1);
  await writeFile(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal));

  const connection = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(connection), { migrationsFolder: folder });
  await connection.end();
  await rm(folder, { recursive: true });
}

async function appliedMigrations(url: string) {
  const connection = postgres(url, { max: 1 });
  const rows = await connection<{ created_at: string }[]>`
    select created_at from drizzle.__drizzle_migrations order by created_at`;
  await connection.end();

  return rows.map((row) => Number(row.created_at));
}

describe('RunMigration', () => {
  let dbname = '';

  afterEach(async () => {
    await afterAllSetup(dbname);
  });

  test('upgrades a database where one pending migration uses an enum value an earlier one adds', async () => {
    dbname = await beforeAllSetup();
    const url = `postgresql://postgres:changeme@localhost:5432/${dbname}`;
    await migrateUpTo(url, '0160_drop_hub_ai_settings');

    await RunMigration(url);

    const journal = await readJournal();
    expect(await appliedMigrations(url)).toEqual(journal.entries.map((entry) => entry.when));

    await RunMigration(url);
    const connection = postgres(url, { max: 1, onnotice: () => {} });
    await migrate(drizzle(connection), { migrationsFolder: 'migrations' });
    await connection.end();
    expect(await appliedMigrations(url)).toEqual(journal.entries.map((entry) => entry.when));
  });

  test('migrates a fresh database', async () => {
    dbname = await beforeAllSetup();
    const url = `postgresql://postgres:changeme@localhost:5432/${dbname}`;

    await RunMigration(url);

    const journal = await readJournal();
    expect(await appliedMigrations(url)).toEqual(journal.entries.map((entry) => entry.when));
  });
});

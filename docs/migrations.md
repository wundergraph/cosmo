# Migrations

## PostgreSQL

We use [DrizzleORM](https://github.com/drizzle-team/drizzle-orm) to manage migrations for PostgreSQL.
Before you can run migrations, you need to pass `DB_URL` as an environment variable.

## ClickHouse

We use [dbmate](https://github.com/amacneil/dbmate) to manage migrations for ClickHouse. (Important: ClickHouse does not support transactions, so be careful when writing migrations.)
Before you can run migrations, you need to pass `CLICKHOUSE_MIGRATION_DSN` or `CLICKHOUSE_DSN` as an environment variable.
Dbmate does not support clickhouse http protocol, so we need two different dsn in production and development environment.

## Create a new migration

Go to the controlplane [directory](../controlplane) and run the following command:

### PostgreSQL

```sh
# Create a new migration from the current schema changes
pnpm db:generate
# Create a custom migration e.g. for data migration
pnpm db:custom
# (Important) Use this command to delete the last migration
pnpm db:drop
```

### ClickHouse

```sh
# Create a new migration
pnpm ch:new-migration foo
```

### Apply all for development

Run this command from the root of the repository:

```sh
make migrate
```

## Rollback

Database migrations are not reversible. If you need to rollback a migration, you need to create a new migration that undoes the changes. This will be applied in the next deployment run.
Try to write migrations that are backwards compatible. For complex migrations, many database provides allow you to fork databases. This allows you to test the migration on a copy of the database before applying it to the production database.

## Production migrations

In production, we coordinate all migrations with [Kapp](https://carvel.dev/kapp/) and Kubernetes Jobs. In that way, we can ensure that all migrations are run in the correct order and only once. Additionally, the deployment is stopped if a migration fails.




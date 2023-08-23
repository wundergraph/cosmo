# Migrations

## PostgreSQL

We use [DrizzleORM](https://github.com/drizzle-team/drizzle-orm) to manage migrations for PostgreSQL.

## ClickHouse

We use [dbmate](https://github.com/amacneil/dbmate) to manage migrations for ClickHouse. (Important: ClickHouse does not support transactions, so be careful when writing migrations.)
Before you can run migrations, you need to pass `CLICKHOUSE_DSN` as an environment variable.

## Create a new migration

```sh
# Create a new migration
make name=foo new-ch-migration
# Create database + apply all migrations
make migrate-ch
```

## Rollback

```sh
# Apply all migrations
make rollback-ch
```

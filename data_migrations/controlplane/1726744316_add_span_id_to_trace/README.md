# New SpanID column to traces table to accurately retrieve trace information

## Purpose:
This migration will help customers to retrieve accurate trace information. This can happen when there are multiple root spans for a given Trace ID.

### Migration Overview:
We need to drop both the `traces_mv` materialized view and `traces` table, recreate and repopulate them. We do the repopulation in hourly batches.

---

## Prerequisites:
Before proceeding, ensure the following:

1. **If you need to do this**: If you already have SpanID in `traces` and `traces_mv` then you can skip this entire migration.
2. **Back up existing data**: Always back up your existing tables and data to avoid any accidental data loss.
3. **Database maintenance window**: Schedule downtime if necessary to avoid service interruptions during the migration.
4. **!! Clickhouse client is installed**: You can find instructions here https://clickhouse.com/docs/en/install
4. **Go**: You need to have the latest version of go installed to run the scripts

---

## Migration Steps

Please ensure the latest version of Cosmo has been deployed. This migration is only applicable to the following components:

- **Clickhouse**: 24.6
- **Controlplane**: vx.Y

The clickhouse DSN will be in the format: `clickhouse://user:password@host:port/database`

### Step 1: Run the migration script

Run the script [migrate.go](./files/migrate.go) with the clickhouse dsn as the argument. This will repopulate the table on an hourly basis. 

This script outputs `success_log.txt` and `error_log.txt` to keep track of the migration. After the script is done you can retry errors with the `--retry` option. If you happen to kill the script you can pick up where you left off with the `--resume` option. 

> Running the script again without either option will run the migration from scratch!

```bash
go run ./files/migrate.go <dsn>
```

### Step 2: Verify end-to-end functionality

After applying the migration, ensure that the system is functioning as expected. This includes:

1. Querying your graph.
2. Checking if new traces are being populated and their respective information is correctly retrieved.

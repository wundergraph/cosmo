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

---

## Migration Steps

Please ensure the latest version of Cosmo has been deployed. This migration is only applicable to the following components:

- **Clickhouse**: 24.6
- **Controlplane**: vx.Y

The clickhouse DSN will be in the format: `clickhouse://user:password@host:port/database`

### Step 1: Drop view and table and recreate `traces`

We will drop both the `traces` table and `traces_mv` view. We will recreate the table with the new column. We will create the materialized view again after repopulation.

Run the first script [1_drop_create_trace.sql](./files/1_drop_create_trace.sql)

```bash
clickhouse client <dsn> --queries-file ./1_drop_create_trace.sql
```

### Step 2: Repopulate the `traces` table

Run the bash script [2_populate.sh](./files/2_populate.sh) with the clickhouse dsn as the argument. This will repopulate the table on an hourly basis.

```bash
chmod +x 2_populate.sh
./2_populate.sh <dsn>
```

### Step 3: Recreate the `traces_mv` materialized view

Run the final script [3_create_trace_mv.sql](./files/3_create_trace_mv.sql) to recreate the materialized view.

```bash
clickhouse client <dsn> --queries-file ./3_create_trace_mv.sql
```

### Step 4: Verify end-to-end functionality

After applying the migration, ensure that the system is functioning as expected. This includes:

1. Querying your graph.
2. Running GraphQL pruning and subgraph checks and verify if the functionality is working as expected.

---

## Potential Issues & Troubleshooting

- **Data mismatch**: If there are discrepancies in the row count, check for errored dates in the `error_log.txt` file written by the populate script and rerun it with the `--retry` option. This will rerun for just the errored dates

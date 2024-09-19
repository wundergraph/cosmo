# New SpanID column to traces table to accurately retrieve trace information

## Purpose:
This migration will help customers to retrieve accurate trace information. This can happen when there are multiple root spans for a given Trace ID.

### Migration Overview:
We need to drop both the `traces_mv` materialized view and `traces` table, recreate and repopulate them. We do the repopulation in hourly batches. During migration temporary table and view are created to continue recording new entires which are then copied over to the original table.

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

### Step 1: Recreate `traces` table

We will drop both the `traces` table and `traces_mv` view. We will recreate only the table with the new column. We will also create corresponding temporary table and view so that we still record new traces during migration. 

Run the first script [1_recreate_trace.sql](./files/1_recreate_trace.sql)

```bash
clickhouse client <dsn> --queries-file ./1_recreate_trace.sql
```

### Step 2: Repopulate the `traces` table

Run the script [2_populate.go](./files/2_populate.go) with the clickhouse dsn as the argument. This will repopulate the table on an hourly basis.

```bash
go run ./2_populate.go <dsn>
```

### Step 3: Recreate the `traces_mv` materialized view

Run the script [3_create_trace_mv.sql](./files/3_create_trace_mv.sql) to recreate the materialized view. This will also delete the temp view since it is no longer needed

```bash
clickhouse client <dsn> --queries-file ./3_create_trace_mv.sql
```

### Step 4: Copy data from temp table to the traces table

To populate data that was ingested during migration, run the script [4_copy_temp.go](./files/4_copy_temp.go).

```bash
go run ./4_copy_temp.go <dsn>
```

### Step 5: Drop the temp table

Once all the data has been copied over to the main traces table we can drop the temp table.
Run the script [5_drop_temp_traces.sql](./files/5_drop_temp_traces.sql).

```bash
clickhouse client <dsn> --queries-file ./5_drop_temp_traces.sql
```

### Step 6: Verify end-to-end functionality

After applying the migration, ensure that the system is functioning as expected. This includes:

1. Querying your graph.
2. Checking if new traces are being populated and their respective information is correctly retrieved.

---

## Potential Issues & Troubleshooting

- **Data mismatch**: If there are discrepancies in the row count, check for errored dates in the `error_log.txt` file written by the scripts and rerun them with the `--retry` option. This will rerun for just the errored dates.

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

---

## Migration Steps

Please ensure the latest version of Cosmo has been deployed. This migration is only applicable to the following components:

- **Clickhouse**: 24.4
- **Controlplane**: vx.Y

### Step 1: Drop view and table

It is good practice to drop the materialized view first

```sql
DROP VIEW IF EXISTS cosmo.traces_mv;
DROP TABLE IF EXISTS cosmo.traces;
```

### Step 2: Recreate the `traces` table only

After running the above script, we need to recreate the table. We will create the materialized view again after repopulation.

```sql
CREATE TABLE IF NOT EXISTS traces (
   TraceId String CODEC (ZSTD(3)),
   SpanId String CODEC (ZSTD(3)),
   Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(3)),
   OperationName String CODEC (ZSTD(3)),
   OperationType LowCardinality(String) CODEC (ZSTD(3)),
   FederatedGraphID String CODEC(ZSTD(3)),
   OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
   Duration Int64 CODEC(ZSTD(3)),
   StatusCode LowCardinality(String) CODEC (ZSTD(3)),
   HasError bool CODEC(ZSTD(3)),
   StatusMessage String CODEC (ZSTD(3)),
   OperationHash String CODEC (ZSTD(3)),
   OperationContent String CODEC (ZSTD(3)),
   OperationPersistedID String CODEC (ZSTD(3)),
   HttpStatusCode String CODEC (ZSTD(3)),
   HttpHost String CODEC (ZSTD(3)),
   HttpUserAgent String CODEC (ZSTD(3)),
   HttpMethod String CODEC (ZSTD(3)),
   HttpTarget String CODEC (ZSTD(3)),
   ClientName String CODEC (ZSTD(3)),
   ClientVersion String CODEC (ZSTD(3)),
   Subscription Bool CODEC(ZSTD(3)),

   -- Indexes for filtering because the table serve as a source for the raw traces view
   INDEX idx_operation_name OperationName TYPE bloom_filter(0.01) GRANULARITY 1,
   INDEX idx_operation_type OperationType TYPE bloom_filter(0.01) GRANULARITY 1,
   INDEX idx_operation_hash OperationHash TYPE bloom_filter(0.001) GRANULARITY 1,
   INDEX idx_operation_persistent_id OperationPersistedID TYPE bloom_filter(0.001) GRANULARITY 1,
   INDEX idx_client_name ClientName TYPE bloom_filter(0.01) GRANULARITY 1,
   INDEX idx_client_version ClientVersion TYPE bloom_filter(0.01) GRANULARITY 1,
   INDEX idx_duration Duration TYPE minmax GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
-- This allows us to fetch traces by federated graph in the most efficient way
ORDER BY (
    FederatedGraphID, OrganizationID, toUnixTimestamp(Timestamp), OperationType, ClientName, HttpStatusCode, ClientVersion, Duration, OperationName, OperationPersistedID, OperationHash
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
```

### Step 4: Repopulate the `traces` table

Run the below bash script with the clickhouse dsn as the argument. This will repopulate the table on an hourly basis.
> NOTE: Ensure you have the clickhouse client installed

```bash
#!/bin/bash

connection_string="$1"

date_to_seconds() {
    local date_str="$1"
    if date --version >/dev/null 2>&1; then
        date -d "$date_str" +%s
    else
        date -j -f "%Y-%m-%d %H:%M:%S" "$date_str" +"%s"
    fi
}

increment_date() {
    local date_str="$1"
    if date --version >/dev/null 2>&1; then
        # GNU date
        date -d "$date_str +1 day" +"%Y-%m-%d"
    else
        # BSD date (macOS)
        date -j -f "%Y-%m-%d" -v+1d "$date_str" +"%Y-%m-%d"
    fi
}

start_date=$(clickhouse client $connection_string --query="SELECT toDate(min(Timestamp)) FROM cosmo.otel_traces FORMAT TabSeparated")
end_date=$(clickhouse client $connection_string --query="SELECT toDate(max(Timestamp)) FROM cosmo.otel_traces FORMAT TabSeparated")

# Remove any whitespace
start_date=$(echo "$start_date" | tr -d '[:space:]')
end_date=$(echo "$end_date" | tr -d '[:space:]')

# Check if start_date and end_date are not empty
if [ -z "$start_date" ] || [ -z "$end_date" ]; then
    echo "Failed to retrieve start_date or end_date from the database."
    exit 1
fi

echo "Start date: $start_date"
echo "End date: $end_date"

current_date="$start_date"

while [ "$(date_to_seconds "$current_date 00:00:00")" -le "$(date_to_seconds "$end_date 23:59:59")" ]; do
    echo "Processing date: $current_date"
    for hour in {0..23}; do
        hour_formatted=$(printf "%02d" "$hour")
        echo "  Processing hour: $hour_formatted"
        sql_command=$(cat <<EOF
INSERT INTO cosmo.traces
SELECT
    TraceId,
    SpanId,
    toDateTime(Timestamp, 'UTC') AS Timestamp,
    SpanAttributes['wg.operation.name'] AS OperationName,
    toLowCardinality(SpanAttributes['wg.operation.type']) AS OperationType,
    SpanAttributes['wg.federated_graph.id'] AS FederatedGraphID,
    toLowCardinality(SpanAttributes['wg.organization.id']) AS OrganizationID,
    Duration,
    toLowCardinality(StatusCode) AS StatusCode,
    if(
        StatusMessage = 'STATUS_CODE_ERROR' OR
        position(SpanAttributes['http.status_code'], '5') = 1 OR
        position(SpanAttributes['http.status_code'], '4') = 1 OR
        mapContains(SpanAttributes, 'wg.request.error'),
        true, false
    ) AS HasError,
    StatusMessage,
    SpanAttributes['wg.operation.hash'] AS OperationHash,
    SpanAttributes['wg.operation.content'] AS OperationContent,
    SpanAttributes['wg.operation.persisted_id'] AS OperationPersistedID,
    SpanAttributes['http.status_code'] AS HttpStatusCode,
    SpanAttributes['http.host'] AS HttpHost,
    SpanAttributes['http.user_agent'] AS HttpUserAgent,
    SpanAttributes['http.method'] AS HttpMethod,
    SpanAttributes['http.target'] AS HttpTarget,
    SpanAttributes['wg.client.name'] AS ClientName,
    SpanAttributes['wg.client.version'] AS ClientVersion,
    mapContains(SpanAttributes, 'wg.subscription') AS Subscription
FROM
    cosmo.otel_traces
WHERE
    (SpanAttributes['wg.router.root_span'] = 'true' OR SpanAttributes['wg.component.name'] = 'router-server')
    AND toDate(Timestamp) = '$current_date'
    AND toHour(Timestamp) = $hour;
EOF
)
    clickhouse client $connection_string --multiquery --query="$sql_command" 

        if [ $? -ne 0 ]; then
            echo "Error occurred while processing date: $current_date hour: $hour_formatted" | tee -a error_log.txt
        fi
    done

    current_date=$(increment_date "$current_date")
done

echo "Data repopulation completed."
```

# Recreate the `traces_mv` materialized view

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.traces_mv TO cosmo.traces AS
SELECT
    TraceId,
    SpanId,
    toDateTime(Timestamp, 'UTC') as Timestamp,
    SpanAttributes [ 'wg.operation.name' ] as OperationName,
    toLowCardinality(SpanAttributes [ 'wg.operation.type' ]) as OperationType,
    SpanAttributes [ 'wg.federated_graph.id'] as FederatedGraphID,
    toLowCardinality(SpanAttributes ['wg.organization.id']) as OrganizationID,
    Duration,
    toLowCardinality(StatusCode) as StatusCode,
    if(StatusMessage == 'STATUS_CODE_ERROR' OR position(SpanAttributes['http.status_code'],'5') = 1 OR position(SpanAttributes['http.status_code'],'4') = 1 OR mapContains(SpanAttributes, 'wg.request.error'), true, false) as HasError,
    StatusMessage,
    SpanAttributes [ 'wg.operation.hash' ] as OperationHash,
    SpanAttributes [ 'wg.operation.content' ] as OperationContent,
    SpanAttributes [ 'wg.operation.persisted_id' ] as OperationPersistedID,
    SpanAttributes [ 'http.status_code' ] as HttpStatusCode,
    SpanAttributes [ 'http.host' ] as HttpHost,
    SpanAttributes [ 'http.user_agent' ] as HttpUserAgent,
    SpanAttributes [ 'http.method' ] as HttpMethod,
    SpanAttributes [ 'http.target' ] as HttpTarget,
    SpanAttributes [ 'wg.client.name' ] as ClientName,
    SpanAttributes [ 'wg.client.version' ] as ClientVersion,
    mapContains(SpanAttributes, 'wg.subscription') as Subscription
FROM
    cosmo.otel_traces
WHERE
    -- Only include router root spans
    SpanAttributes [ 'wg.router.root_span' ] = 'true' OR
    -- For backwards compatibility (router < 0.61.2)
    SpanAttributes [ 'wg.component.name' ] = 'router-server'
ORDER BY
    Timestamp DESC;
```


### Step 5: Verify end-to-end functionality

After applying the migration, ensure that the system is functioning as expected. This includes:

1. Querying your graph.
2. Running GraphQL pruning and subgraph checks and verify if the functionality is working as expected.

---

## Potential Issues & Troubleshooting

- **Data mismatch**: If there are discrepancies in the row count, check for errors in the `error_log.txt` file written by the above script.

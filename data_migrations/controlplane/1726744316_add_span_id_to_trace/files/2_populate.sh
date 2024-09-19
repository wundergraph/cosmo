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

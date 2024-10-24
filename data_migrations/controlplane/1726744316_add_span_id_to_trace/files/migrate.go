package main

import (
	"bufio"
	"bytes"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	ConcurrencyLimit = 20
	DateTimeFormat   = "2006-01-02 15:04:05"
)

// Repopulator struct to encapsulate the variables and methods
type Repopulator struct {
	ConnectionString string
}

// ParseDateTime parses a date string into a time.Time object
func (r *Repopulator) ParseDateTime(dateStr string) (time.Time, error) {
	return time.Parse(DateTimeFormat, dateStr)
}

// FormatDateTime formats a time.Time object into a string
func (r *Repopulator) FormatDateTime(t time.Time) string {
	return t.Format(DateTimeFormat)
}

// RecreateTables drops and recreates necessary tables and views
func (r *Repopulator) RecreateTables() time.Time {
	query := `DROP VIEW IF EXISTS cosmo.traces_mv;
DROP TABLE IF EXISTS cosmo.traces;

CREATE TABLE IF NOT EXISTS cosmo.traces (
    TraceId String CODEC (ZSTD(3)),
    SpanId String CODEC (ZSTD(3)),
    Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(3)),
    OperationName String CODEC (ZSTD(3)),
    OperationType LowCardinality(String) CODEC (ZSTD(3)),
    FederatedGraphID String CODEC(ZSTD(3)),
    OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
    Duration Int64 CODEC(ZSTD(3)),
    StatusCode LowCardinality(String) CODEC (ZSTD(3)),
    HasError bool CODEC (ZSTD(3)),
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
    -- Indexes for filtering because the table serves as a source for the raw traces view
    INDEX idx_operation_name OperationName TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_operation_type OperationType TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_operation_hash OperationHash TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_operation_persistent_id OperationPersistedID TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_client_name ClientName TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_client_version ClientVersion TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_duration Duration TYPE minmax GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (
    FederatedGraphID,
    OrganizationID,
    toUnixTimestamp(Timestamp),
    OperationType,
    ClientName,
    HttpStatusCode,
    ClientVersion,
    Duration,
    OperationName,
    OperationPersistedID,
    OperationHash
)
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.traces_mv TO cosmo.traces AS
SELECT TraceId,
    SpanId,
    toDateTime(Timestamp, 'UTC') as Timestamp,
    SpanAttributes [ 'wg.operation.name' ] as OperationName,
    toLowCardinality(SpanAttributes [ 'wg.operation.type' ]) as OperationType,
    SpanAttributes [ 'wg.federated_graph.id'] as FederatedGraphID,
    toLowCardinality(SpanAttributes ['wg.organization.id']) as OrganizationID,
    Duration,
    toLowCardinality(StatusCode) as StatusCode,
    if(
        StatusMessage == 'STATUS_CODE_ERROR'
        OR position(SpanAttributes ['http.status_code'], '5') = 1
        OR position(SpanAttributes ['http.status_code'], '4') = 1
        OR mapContains(SpanAttributes, 'wg.request.error'),
        true,
        false
    ) as HasError,
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
FROM cosmo.otel_traces
WHERE -- Only include router root spans
    SpanAttributes [ 'wg.router.root_span' ] = 'true'
    OR -- For backwards compatibility (router < 0.61.2)
    SpanAttributes [ 'wg.component.name' ] = 'router-server'
ORDER BY Timestamp DESC;`

	cmd := exec.Command("clickhouse", "client", r.ConnectionString, "--send-timeout", "30000", "--receive-timeout", "30000", "--multiquery", query)
	err := cmd.Run()
	if err != nil {
		log.Fatalf("Failed to execute ClickHouse query: %v", err)
	}

	return time.Now().UTC()
}

// GenerateSQLCommand creates the SQL command for the given date and hour
func (r *Repopulator) GenerateSQLCommand(startTime, endTime time.Time) string {
	startTimeStr := r.FormatDateTime(startTime)
	endTimeStr := r.FormatDateTime(endTime)
	return fmt.Sprintf(`INSERT INTO cosmo.traces
SETTINGS max_insert_threads = 32
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
    AND Timestamp >= '%s'
    AND Timestamp < '%s'`, startTimeStr, endTimeStr)
}

// ExecuteSQLCommand runs the SQL command and handles retries
func (r *Repopulator) ExecuteSQLCommand(startTime, endTime time.Time, wg *sync.WaitGroup, semaphore chan struct{}) {
	defer wg.Done()
	semaphore <- struct{}{}

	const maxRetries = 5

	sqlCommand := r.GenerateSQLCommand(startTime, endTime)

	var out bytes.Buffer
	var finalErr error
	success := false

	for attempt := 0; attempt <= maxRetries; attempt++ {
		cmd := exec.Command("clickhouse", "client", r.ConnectionString, "--send-timeout", "30000", "--receive-timeout", "30000", "--query", sqlCommand)
		cmd.Stdout = &out
		cmd.Stderr = &out

		err := cmd.Run()
		if err == nil {
			success = true
			break
		} else {
			finalErr = err
			if attempt < maxRetries {
				time.Sleep(time.Duration(attempt+1) * 5 * time.Second)
			}
		}
	}

	if !success {
		log.Printf("Error occurred while processing time range: %s to %s: %v\n", r.FormatDateTime(startTime), r.FormatDateTime(endTime), finalErr)
		r.AppendToFile("error_log.txt", fmt.Sprintf("%s %s %s\n", r.FormatDateTime(startTime), r.FormatDateTime(endTime), finalErr.Error()))
	} else {
		log.Printf("Successfully processed time range: %s to %s\n", r.FormatDateTime(startTime), r.FormatDateTime(endTime))
		r.AppendToFile("success_log.txt", fmt.Sprintf("%s %s\n", r.FormatDateTime(startTime), r.FormatDateTime(endTime)))
	}

	<-semaphore
}

// AppendToFile appends text to a file
func (r *Repopulator) AppendToFile(filename, text string) {
	f, err := os.OpenFile(filename, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
	if err != nil {
		log.Printf("Failed to open file %s: %v", filename, err)
		return
	}
	defer f.Close()

	if _, err := f.WriteString(text); err != nil {
		log.Printf("Failed to write to file %s: %v", filename, err)
	}
}

// GetMinMaxDate runs a query and returns the result as a string
func (r *Repopulator) GetMinMaxDate(query string) string {
	cmd := exec.Command("clickhouse", "client", r.ConnectionString, "--send-timeout", "30000", "--receive-timeout", "30000", "--query", query)
	var out bytes.Buffer
	cmd.Stdout = &out
	err := cmd.Run()
	if err != nil {
		log.Fatalf("Failed to execute ClickHouse query: %v", err)
	}
	return strings.TrimSpace(out.String())
}

// ReadSuccessLog reads the success log and returns a map of processed time ranges
func (r *Repopulator) ReadSuccessLog() (string, map[string]bool) {
	file, err := os.Open("success_log.txt")
	if err != nil {
		log.Fatalf("Failed to open success log: %v", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	processed := make(map[string]bool)
	var endTimestamp string

	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.SplitN(line, " ", 4)
		if len(parts) == 4 {
			processed[line] = true
		} else if len(parts) == 2 {
			endTimestamp = line
		}
	}

	if err := scanner.Err(); err != nil {
		log.Fatalf("Failed to read success log: %v", err)
	}

	return endTimestamp, processed
}

func main() {
	// Initialize the Repopulator struct
	repopulator := Repopulator{
		ConnectionString: os.Args[1],
	}

	retry := false
	resume := false
	if len(os.Args) > 2 && os.Args[2] == "--retry" {
		retry = true
	}
	if len(os.Args) > 2 && os.Args[2] == "--resume" {
		resume = true
	}

	if resume == true && retry == true {
		log.Fatal("Both resume and retry flags detected. Please use one.")
	}

	var startTimestampStr string
	var endTimestamp time.Time
	var processedRanges map[string]bool

	if !retry && !resume {
		// Clear the contents of success log and error log if run from scratch
		if err := os.WriteFile("success_log.txt", []byte{}, 0644); err != nil {
			log.Fatalf("Failed to clear success log: %v", err)
		}
		if err := os.WriteFile("error_log.txt", []byte{}, 0644); err != nil {
			log.Fatalf("Failed to clear error log: %v", err)
		}

		// Recreate tables and get the time when the materialized view was created
		endTimestamp = repopulator.RecreateTables()

		// Get the start timestamp after recreating the tables
		startTimestampStr = repopulator.GetMinMaxDate("SELECT min(Timestamp) FROM cosmo.otel_traces FORMAT TabSeparated")

		if startTimestampStr == "" {
			log.Fatal("Failed to retrieve start timestamp from the database.")
		}

		log.Printf("Start timestamp: %s\n", startTimestampStr)
		log.Printf("End timestamp: %s\n", repopulator.FormatDateTime(endTimestamp))

		// Append the end timestamp as the first line to the success log
		repopulator.AppendToFile("success_log.txt", repopulator.FormatDateTime(endTimestamp)+"\n")
	} else if resume {
		startTimestampStr = repopulator.GetMinMaxDate("SELECT min(Timestamp) FROM cosmo.otel_traces FORMAT TabSeparated")
		// Read the end timestamp and processed ranges from success log
		endTimestampStr, processedRangesRead := repopulator.ReadSuccessLog()

		processedRanges = processedRangesRead
		endTimestamp, _ = repopulator.ParseDateTime(endTimestampStr)
		log.Println("Resume mode enabled. Using end date from success log and skipping processed ranges.")
		log.Printf("Start timestamp: %s\n", startTimestampStr)
		log.Printf("End timestamp: %s\n", repopulator.FormatDateTime(endTimestamp))
	} else {
		log.Println("Retry mode enabled. Processing dates and hours from error_log.txt.")
	}

	var wg sync.WaitGroup
	semaphore := make(chan struct{}, ConcurrencyLimit)

	if retry {
		file, err := os.Open("error_log.txt")
		if err != nil {
			log.Fatalf("Failed to open error log: %v", err)
		}
		defer file.Close()

		var failedJobs []string
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := scanner.Text()
			failedJobs = append(failedJobs, line)
		}

		if err := scanner.Err(); err != nil {
			log.Fatalf("Failed to read error log: %v", err)
		}

		// Clear the contents of the error_log.txt after all lines are read
		if err := os.WriteFile("error_log.txt", []byte{}, 0644); err != nil {
			log.Fatalf("Failed to clear error log: %v", err)
		}

		// Process all stored start and end times
		for _, job := range failedJobs {
			parts := strings.SplitN(job, " ", 5)
			if len(parts) < 4 {
				log.Printf("Invalid line in error log: %s\n", job)
				continue
			}
			startTimeStr := parts[0] + " " + parts[1]
			endTimeStr := parts[2] + " " + parts[3]

			startTime, err := repopulator.ParseDateTime(startTimeStr)
			if err != nil {
				log.Printf("Failed to parse startTime in error log: %s\n", startTimeStr)
				continue
			}
			endTime, err := repopulator.ParseDateTime(endTimeStr)
			if err != nil {
				log.Printf("Failed to parse endTime in error log: %s\n", endTimeStr)
				continue
			}

			wg.Add(1)
			go repopulator.ExecuteSQLCommand(startTime, endTime, &wg, semaphore)
		}
	} else {
		// Parse startTimestamp
		startTimestamp, err := repopulator.ParseDateTime(startTimestampStr)
		if err != nil {
			log.Fatalf("Failed to parse start timestamp: %v", err)
		}

		// Round start timestamp to the start of the hour
		currentTime := startTimestamp.Truncate(time.Hour)

		for currentTime.Before(endTimestamp) {
			nextTime := currentTime.Add(time.Hour)
			if nextTime.After(endTimestamp) {
				nextTime = endTimestamp
			}

			timeRangeKey := fmt.Sprintf("%s %s", repopulator.FormatDateTime(currentTime), repopulator.FormatDateTime(nextTime))
			if processedRanges != nil && processedRanges[timeRangeKey] {
				// Skip already processed range
				currentTime = nextTime
				continue
			}

			wg.Add(1)
			go repopulator.ExecuteSQLCommand(currentTime, nextTime, &wg, semaphore)

			currentTime = nextTime
		}
	}

	wg.Wait()
	log.Println("Data repopulation completed.")
}

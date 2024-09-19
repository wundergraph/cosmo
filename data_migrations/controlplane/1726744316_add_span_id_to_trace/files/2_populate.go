package main

import (
	"bufio"
	"bytes"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	concurrencyLimit = 20
)

var connectionString string

func dateToSeconds(dateStr string) int64 {
	layout := "2006-01-02 15:04:05"
	t, err := time.Parse(layout, dateStr)
	if err != nil {
		log.Fatalf("Failed to parse date: %v", err)
	}
	return t.Unix()
}

func incrementDate(dateStr string) string {
	layout := "2006-01-02"
	t, err := time.Parse(layout, dateStr)
	if err != nil {
		log.Fatalf("Failed to parse date: %v", err)
	}
	return t.AddDate(0, 0, 1).Format(layout)
}

func generateSQLCommand(dateStr string, hour int) string {
	return fmt.Sprintf(`INSERT INTO cosmo.traces
SETTINGS max_insert_threads = 32, async_insert=1, wait_for_async_insert=1
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
    AND toDate(Timestamp) = '%s'
    AND toHour(Timestamp) = %d`, dateStr, hour)
}

func executeSQLCommand(dateStr string, hour int, wg *sync.WaitGroup, semaphore chan struct{}) {
	defer wg.Done()
	semaphore <- struct{}{}

	const maxRetries = 5
	const retryDelay = 5 * time.Second

	sqlCommand := generateSQLCommand(dateStr, hour)
	cmd := exec.Command("clickhouse", "client", connectionString, "--send-timeout", "30000", "--receive-timeout", "30000", "--secure", "--query", sqlCommand)

	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out

	success := false
	var finalErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		err := cmd.Run()
		if err == nil {
			success = true
			break
		} else {
			finalErr = err
			if attempt < maxRetries {
				time.Sleep(retryDelay)
			}
		}
	}

	if !success {
		log.Printf("Error occurred while processing date: %s hour: %d: %v\n", dateStr, hour, finalErr)
		appendToFile("error_log.txt", fmt.Sprintf("%s %02d %s\n", dateStr, hour, finalErr.Error()))
	} else {
		log.Printf("Successfully processed date: %s hour: %02d\n", dateStr, hour)
	}

	<-semaphore
}

func appendToFile(filename, text string) {
	f, err := os.OpenFile(filename, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
	if err != nil {
		log.Printf("Failed to open error log: %v", err)
		return
	}
	defer f.Close()

	if _, err := f.WriteString(text); err != nil {
		log.Printf("Failed to write to error log: %v", err)
	}
}

func getMinMaxDate(query string) string {
	cmd := exec.Command("clickhouse", "client", connectionString, "--send-timeout", "30000", "--receive-timeout", "30000", "--secure", "--query", query)
	var out bytes.Buffer
	cmd.Stdout = &out
	err := cmd.Run()
	if err != nil {
		log.Fatalf("Failed to execute ClickHouse query: %v", err)
	}
	return strings.TrimSpace(out.String())
}

func main() {
	connectionString = os.Args[1]

	retry := false
	if len(os.Args) > 2 && os.Args[2] == "--retry" {
		retry = true
	}

	var startDate, endDate string
	if !retry {
		startDate = getMinMaxDate("SELECT toDate(min(Timestamp)) FROM cosmo.otel_traces FORMAT TabSeparated")
		endDate = getMinMaxDate("SELECT toDate(max(Timestamp)) FROM cosmo.otel_traces FORMAT TabSeparated")

		if startDate == "" || endDate == "" {
			log.Fatal("Failed to retrieve start_date or end_date from the database.")
		}

		log.Printf("Start date: %s\n", startDate)
		log.Printf("End date: %s\n", endDate)
	} else {
		log.Println("Retry mode enabled. Processing dates and hours from error_log.txt.")
	}

	var wg sync.WaitGroup
	semaphore := make(chan struct{}, concurrencyLimit)

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

		// Clear the contents of the error_log.txt
		if err := os.WriteFile("error_log.txt", []byte{}, 0644); err != nil {
			log.Fatalf("Failed to clear error log: %v", err)
		}

		// Process all stored date and hour combinations
		for _, job := range failedJobs {
			dateHour := strings.Split(job, " ")
			date := dateHour[0]
			hour, _ := strconv.Atoi(dateHour[1])
			println(date, hour)
			wg.Add(1)
			go executeSQLCommand(date, hour, &wg, semaphore)
		}
	} else {
		currentDate := startDate
		for dateToSeconds(currentDate+" 00:00:00") <= dateToSeconds(endDate+" 23:59:59") {
			for hour := 0; hour < 24; hour++ {
				wg.Add(1)
				go executeSQLCommand(currentDate, hour, &wg, semaphore)
			}
			currentDate = incrementDate(currentDate)
		}
	}

	wg.Wait()
	log.Println("Data repopulation completed.")
}

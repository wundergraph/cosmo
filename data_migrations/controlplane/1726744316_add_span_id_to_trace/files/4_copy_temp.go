package main

import (
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
	concurrencyLimit = 10 // Limit the number of concurrent insertions
)

var connectionString string

func generateCopySQLCommand(startDate, endDate string) string {
	return fmt.Sprintf(`INSERT INTO cosmo.traces
SELECT *
FROM cosmo.temp_traces
WHERE toDate(Timestamp) BETWEEN '%s' AND '%s'`, startDate, endDate)
}

func executeCopySQLCommand(startDate, endDate string, wg *sync.WaitGroup, semaphore chan struct{}) {
	defer wg.Done()
	semaphore <- struct{}{} // Acquire semaphore

	const maxRetries = 5
	const retryDelay = 5 * time.Second

	sqlCommand := generateCopySQLCommand(startDate, endDate)
	cmd := exec.Command("clickhouse", "client", connectionString, "--send-timeout", "30000", "--receive-timeout", "30000", "--secure", "--query", sqlCommand)

	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out

	success := false
	var errorMessage string

	for attempt := 1; attempt <= maxRetries; attempt++ {
		err := cmd.Run()
		if err == nil {
			success = true
			break
		} else {
			errorMessage = err.Error()
			if attempt < maxRetries {
				time.Sleep(retryDelay)
			}
		}
	}

	if !success {
		log.Printf("Failed to copy data from %s to %s after %d attempts: %s\n", startDate, endDate, maxRetries, errorMessage)
		appendToFile("copy_error_log.txt", fmt.Sprintf("%s to %s: %s\n", startDate, endDate, errorMessage))
	} else {
		log.Printf("Successfully copied data from %s to %s\n", startDate, endDate)
	}

	<-semaphore // Release semaphore
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
	if len(os.Args) < 2 {
		log.Fatalf("Usage: %s <connection_string>", os.Args[0])
	}
	connectionString = os.Args[1]

	startDate := getMinMaxDate("SELECT toDate(min(Timestamp)) FROM cosmo.temp_traces FORMAT TabSeparated")
	endDate := getMinMaxDate("SELECT toDate(max(Timestamp)) FROM cosmo.temp_traces FORMAT TabSeparated")

	if startDate == "" || endDate == "" {
		log.Fatal("Failed to retrieve start_date or end_date from the database.")
	}

	log.Printf("Start date: %s\n", startDate)
	log.Printf("End date: %s\n", endDate)

	var wg sync.WaitGroup
	semaphore := make(chan struct{}, concurrencyLimit)

	// Assuming we want to copy data day by day, use a loop to iterate through each date
	currentDate := startDate
	for dateToSeconds(currentDate+" 00:00:00") <= dateToSeconds(endDate+" 23:59:59") {
		wg.Add(1)
		// Assuming copying data day by day
		go executeCopySQLCommand(currentDate, currentDate, &wg, semaphore)
		currentDate = incrementDate(currentDate)
	}

	wg.Wait()
	log.Println("Data copy from temp_traces to traces completed.")
}

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

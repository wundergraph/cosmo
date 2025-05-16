package httpclient

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRetry(t *testing.T) {
	// Create a counter to track the number of requests
	requestCount := 0

	// Create a test server that returns 503 for the first two requests
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if requestCount <= 2 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		// Return success on the third request
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"message":"success"}`))
	}))
	defer server.Close()

	// Create client with retry
	client := New(
		WithBaseURL(server.URL),
		WithRetryMax(3),
	)

	// Make request
	ctx := context.Background()
	response, err := client.Get(ctx, "/test")

	// Check for errors
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Check status code
	if response.StatusCode != http.StatusOK {
		t.Errorf("Expected status code %d, got %d", http.StatusOK, response.StatusCode)
	}

	// Check that retry happened
	if requestCount != 3 {
		t.Errorf("Expected 3 requests, got %d", requestCount)
	}
}

func TestRetryNetworkError(t *testing.T) {
	// Create a client with retry
	client := New(
		WithBaseURL("http://nonexistent-server.example.com"),
		WithTimeout(500*time.Millisecond), // Short timeout to speed up the test
		WithRetryMax(2),
	)

	// Make request
	ctx := context.Background()
	_, err := client.Get(ctx, "/test")

	// Check that error is returned after retries
	if err == nil {
		t.Fatal("Expected error, got nil")
	}

	// Check that the error is a network error
	var netErr net.Error
	if !errors.As(err, &netErr) {
		t.Errorf("Expected net.Error, got %T", err)
	}
}

func TestDisableRetry(t *testing.T) {
	// Create a counter to track the number of requests
	requestCount := 0

	// Create a test server that returns 503 for all requests
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	// Create client with retry disabled
	client := New(
		WithBaseURL(server.URL),
		WithoutRetry(),
	)

	// Make request
	ctx := context.Background()
	response, err := client.Get(ctx, "/test")

	// Check for errors
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Check status code
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("Expected status code %d, got %d", http.StatusServiceUnavailable, response.StatusCode)
	}

	// Check that only one request was made
	if requestCount != 1 {
		t.Errorf("Expected 1 request, got %d", requestCount)
	}
}

func TestCustomRetryPolicy(t *testing.T) {
	// Create a counter to track the number of requests
	requestCount := 0

	// Create a test server that returns 429 for the first request
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if requestCount == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		// Return success on the second request
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"message":"success"}`))
	}))
	defer server.Close()

	// Create client with retry
	client := New(
		WithBaseURL(server.URL),
		WithRetryMax(3),
	)

	// Make request
	ctx := context.Background()
	response, err := client.Get(ctx, "/test")

	// Check for errors
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Check status code
	if response.StatusCode != http.StatusOK {
		t.Errorf("Expected status code %d, got %d", http.StatusOK, response.StatusCode)
	}

	// Check that retry happened
	if requestCount != 2 {
		t.Errorf("Expected 2 requests, got %d", requestCount)
	}
}

package retrytransport

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/cloudflare/backoff"
	"go.uber.org/zap"
)

type ShouldRetryFunc func(err error, req *http.Request, resp *http.Response) bool
type OnRetryFunc func(count int, req *http.Request, resp *http.Response, sleepDuration time.Duration, err error)

type RetryOptions struct {
	Enabled       bool
	Algorithm     string
	MaxRetryCount int
	Interval      time.Duration
	MaxDuration   time.Duration
	Expression    string
	ShouldRetry   ShouldRetryFunc

	// Test specific only
	OnRetry OnRetryFunc
}

type requestLoggerGetter func(req *http.Request) *zap.Logger

type RetryHTTPTransport struct {
	RoundTripper     http.RoundTripper
	RetryOptions     RetryOptions
	getRequestLogger requestLoggerGetter
}

// parseRetryAfterHeader parses the Retry-After header value according to RFC 7231.
// It supports both delay-seconds and HTTP-date formats.
// Returns the duration to wait before retrying, or 0 if parsing fails.
func parseRetryAfterHeader(logger *zap.Logger, retryAfter string) time.Duration {
	if retryAfter == "" {
		return 0
	}

	var errJoin error

	seconds, err := strconv.Atoi(retryAfter)
	if err != nil {
		errJoin = errors.Join(errJoin, err)
	} else {
		if seconds >= 0 {
			return time.Duration(seconds) * time.Second
		}
	}

	t, err := http.ParseTime(retryAfter)
	if err != nil {
		errJoin = errors.Join(errJoin, err)
	} else {
		if duration := time.Until(t); duration > 0 {
			return duration
		}
	}

	// Collect and print the error in case of a malformed header
	if errJoin != nil {
		logger.Error("Failed to parse Retry-After header", zap.String("retry-after", retryAfter), zap.Error(errJoin))
	}

	return 0
}

// shouldUseRetryAfter determines if we should use Retry-After header for 429 responses
func shouldUseRetryAfter(logger *zap.Logger, resp *http.Response, maxDuration time.Duration) (time.Duration, bool) {
	if resp == nil || resp.StatusCode != http.StatusTooManyRequests {
		return 0, false
	}

	retryAfter := resp.Header.Get("Retry-After")
	if retryAfter == "" {
		return 0, false
	}

	duration := parseRetryAfterHeader(logger, retryAfter)
	if duration > maxDuration {
		duration = maxDuration
	}

	return duration, duration > 0
}

func NewRetryHTTPTransport(
	roundTripper http.RoundTripper,
	retryOptions RetryOptions,
	getRequestLogger requestLoggerGetter,
) *RetryHTTPTransport {
	return &RetryHTTPTransport{
		RoundTripper:     roundTripper,
		RetryOptions:     retryOptions,
		getRequestLogger: getRequestLogger,
	}
}

func (rt *RetryHTTPTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	resp, err := rt.RoundTripper.RoundTrip(req)
	// Short circuit if the request was successful.
	if err == nil && isResponseOK(resp) {
		return resp, nil
	}

	b := backoff.New(rt.RetryOptions.MaxDuration, rt.RetryOptions.Interval)
	defer b.Reset()

	requestLogger := rt.getRequestLogger(req)

	// Retry logic
	retries := 0
	for (rt.RetryOptions.ShouldRetry(err, req, resp)) && retries < rt.RetryOptions.MaxRetryCount {
		retries++

		// Check if we should use Retry-After header for 429 responses
		var sleepDuration time.Duration
		if retryAfterDuration, useRetryAfter := shouldUseRetryAfter(requestLogger, resp, rt.RetryOptions.MaxDuration); useRetryAfter {
			sleepDuration = retryAfterDuration
			requestLogger.Debug("Using Retry-After header for 429 response",
				zap.Int("retry", retries),
				zap.String("url", req.URL.String()),
				zap.Duration("retry-after", sleepDuration),
			)
		} else {
			// Use normal backoff for non-429 or 429 without valid Retry-After
			sleepDuration = b.Duration()
			requestLogger.Debug("Retrying request",
				zap.Int("retry", retries),
				zap.String("url", req.URL.String()),
				zap.Duration("sleep", sleepDuration),
			)
		}

		// Test Specific
		if rt.RetryOptions.OnRetry != nil {
			rt.RetryOptions.OnRetry(retries, req, resp, sleepDuration, err)
		}

		// Wait for the specified duration
		time.Sleep(sleepDuration)

		// drain the previous response before retrying
		rt.drainBody(resp, requestLogger)

		// Retry the request
		resp, err = rt.RoundTripper.RoundTrip(req)

		// Short circuit if the request was successful
		if err == nil && isResponseOK(resp) {
			return resp, nil
		}

	}

	return resp, err
}

func (rt *RetryHTTPTransport) drainBody(resp *http.Response, logger *zap.Logger) {
	if resp == nil || resp.Body == nil {
		return
	}

	defer func() {
		err := resp.Body.Close()
		if err != nil {
			logger.Error("Failed draining when closing the body", zap.Error(err))
		}
	}()

	// When we close the body only will go internally marks the persisted connection as true
	// which is important so that it can reuse the connection internally for retrying
	_, err := io.Copy(io.Discard, resp.Body)
	if err != nil {
		logger.Error("Failed draining when discarding the body", zap.Error(err))
	}
}

func isResponseOK(resp *http.Response) bool {
	// Ensure we don't wait for no reason when subgraphs don't behave
	// spec-compliant and returns a different status code than 200.
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

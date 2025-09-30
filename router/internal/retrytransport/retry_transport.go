package retrytransport

import (
	"errors"
	"github.com/cloudflare/backoff"
	"go.uber.org/zap"
	"io"
	"net/http"
	"strings"
	"syscall"
	"time"
)

var defaultRetryableErrors = []error{
	syscall.ECONNREFUSED, // "connection refused"
	syscall.ECONNRESET,   // "connection reset by peer"
	syscall.ETIMEDOUT,    // "operation timed out"
	errors.New("i/o timeout"),
	errors.New("no such host"),
	errors.New("handshake failure"),
	errors.New("handshake timeout"),
	errors.New("timeout awaiting response headers"),
	errors.New("unexpected EOF"),
	errors.New("unexpected EOF reading trailer"),
}

var defaultRetryableStatusCodes = []int{
	http.StatusInternalServerError,
	http.StatusBadGateway,
	http.StatusServiceUnavailable,
	http.StatusGatewayTimeout,
	http.StatusTooManyRequests,
}

type ShouldRetryFunc func(err error, req *http.Request, resp *http.Response) bool

type RetryOptions struct {
	Enabled       bool
	MaxRetryCount int
	Interval      time.Duration
	MaxDuration   time.Duration
	OnRetry       func(count int, req *http.Request, resp *http.Response, err error)
	ShouldRetry   ShouldRetryFunc
}

type requestLoggerGetter func(req *http.Request) *zap.Logger

type RetryHTTPTransport struct {
	RoundTripper     http.RoundTripper
	RetryOptions     RetryOptions
	getRequestLogger requestLoggerGetter
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
	for rt.RetryOptions.ShouldRetry(err, req, resp) && retries < rt.RetryOptions.MaxRetryCount {
		if rt.RetryOptions.OnRetry != nil {
			rt.RetryOptions.OnRetry(retries, req, resp, err)
		}

		retries++

		// Wait for the specified backoff period
		sleepDuration := b.Duration()

		requestLogger.Debug("Retrying request",
			zap.Int("retry", retries),
			zap.String("url", req.URL.String()),
			zap.Duration("sleep", sleepDuration),
		)

		// Wait for the specified backoff period
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

func IsRetryableError(err error, resp *http.Response) bool {

	if err != nil {
		// Network
		s := err.Error()
		for _, retryableError := range defaultRetryableErrors {
			if strings.HasSuffix(
				strings.ToLower(s),
				strings.ToLower(retryableError.Error())) {
				return true
			}
		}
	}

	if resp != nil {
		// HTTP
		for _, retryableStatusCode := range defaultRetryableStatusCodes {
			if resp.StatusCode == retryableStatusCode {
				return true
			}
		}
	}

	return false
}

package retrytransport

import (
	"errors"
	"github.com/cloudflare/backoff"
	"go.uber.org/zap"
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

type RetryOptions struct {
	MaxRetryCount int
	Interval      time.Duration
	MaxDuration   time.Duration
	OnRetry       func(count int, req *http.Request, resp *http.Response, err error)
	ShouldRetry   func(err error, req *http.Request, resp *http.Response) bool
}

type RetryHTTPTransport struct {
	RoundTripper http.RoundTripper
	RetryOptions RetryOptions
	Logger       *zap.Logger
}

func NewRetryHTTPTransport(roundTripper http.RoundTripper, retryOptions RetryOptions, logger *zap.Logger) *RetryHTTPTransport {
	return &RetryHTTPTransport{
		RoundTripper: roundTripper,
		RetryOptions: retryOptions,
		Logger:       logger,
	}
}

func (rt *RetryHTTPTransport) RoundTrip(req *http.Request) (*http.Response, error) {

	resp, err := rt.RoundTripper.RoundTrip(req)

	b := backoff.New(rt.RetryOptions.MaxDuration, rt.RetryOptions.Interval)
	defer b.Reset()

	// Retry logic
	retries := 0
	for rt.RetryOptions.ShouldRetry(err, req, resp) && retries < rt.RetryOptions.MaxRetryCount {
		if rt.RetryOptions.OnRetry != nil {
			rt.RetryOptions.OnRetry(retries, req, resp, err)
		}

		retries++

		// Wait for the specified backoff period
		sleepDuration := b.Duration()

		rt.Logger.Info("Retrying request", zap.Int("retry", retries), zap.String("url", req.URL.String()), zap.Duration("sleep", sleepDuration))

		// Wait for the specified backoff period
		time.Sleep(sleepDuration)

		// Retry the request
		resp, err = rt.RoundTripper.RoundTrip(req)

	}

	return resp, err
}

func IsRetryableError(err error, resp *http.Response) bool {

	if resp != nil {
		// HTTP
		if resp.StatusCode == http.StatusBadGateway ||
			resp.StatusCode == http.StatusServiceUnavailable ||
			resp.StatusCode == http.StatusGatewayTimeout ||
			resp.StatusCode == http.StatusTooManyRequests {
			return true
		}
	}

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

	return false
}

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

var defaultRetryableStatusCodes = []int{
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
	// Short circuit if the request was successful
	if err == nil && resp.StatusCode == http.StatusOK {
		return resp, nil
	}

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

		rt.Logger.Debug("Retrying request",
			zap.Int("retry", retries),
			zap.String("url", req.URL.String()),
			zap.Duration("sleep", sleepDuration),
		)

		// Wait for the specified backoff period
		time.Sleep(sleepDuration)

		// Retry the request
		resp, err = rt.RoundTripper.RoundTrip(req)

		// Short circuit if the request was successful
		if err == nil && resp.StatusCode == http.StatusOK {
			return resp, nil
		}

	}

	return resp, err
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

package retrytransport

import (
	"errors"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
	"net/http"
	"net/http/httptest"
	"syscall"
	"testing"
	"time"
)

type MockTransport struct {
	roundTripper http.RoundTripper
	handler      func(req *http.Request) (*http.Response, error)
}

func (dt *MockTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return dt.handler(req)
}

func TestRetryOnHTTP5xx(t *testing.T) {

	logger := zap.NewNop()
	retries := 0

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				if retries == 0 {
					return &http.Response{
						StatusCode: http.StatusBadGateway,
					}, nil
				} else if retries == 1 {
					return &http.Response{
						StatusCode: http.StatusServiceUnavailable,
					}, nil
				} else if retries == 2 {
					return &http.Response{
						StatusCode: http.StatusGatewayTimeout,
					}, nil
				}

				return &http.Response{
					StatusCode: http.StatusOK,
				}, nil
			},
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: 3,
			MinDuration:   1 * time.Millisecond,
			MaxDuration:   10 * time.Millisecond,
			ShouldRetry: func(err error, req *http.Request, resp *http.Response) bool {
				return IsRetryableError(err, resp)
			},
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				retries++
			},
		},
		Logger: logger,
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)

	resp, err := tr.RoundTrip(req)
	assert.Nil(t, err)

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	assert.Equal(t, 3, retries)

}

func TestRetryOnNetErrors(t *testing.T) {

	logger := zap.NewNop()
	retries := 0

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				if retries == 0 {
					return nil, syscall.ECONNREFUSED
				} else if retries == 1 {
					return nil, syscall.ECONNRESET
				} else if retries == 2 {
					return nil, syscall.ETIMEDOUT
				} else if retries == 3 {
					return nil, errors.New("i/o timeout")
				}

				return &http.Response{
					StatusCode: http.StatusOK,
				}, nil
			},
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: 4,
			MinDuration:   1 * time.Millisecond,
			MaxDuration:   10 * time.Millisecond,
			ShouldRetry: func(err error, req *http.Request, resp *http.Response) bool {
				return IsRetryableError(err, resp)
			},
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				retries++
			},
		},
		Logger: logger,
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)

	resp, err := tr.RoundTrip(req)
	assert.Nil(t, err)

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	assert.Equal(t, 4, retries)

}

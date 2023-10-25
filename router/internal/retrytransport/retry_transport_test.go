package retrytransport

import (
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type MockTransport struct {
	handler func(req *http.Request) (*http.Response, error)
}

func (dt *MockTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return dt.handler(req)
}

func TestRetryOnHTTP5xx(t *testing.T) {

	logger := zap.NewNop()
	retries := 0
	index := -1

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {

				if index < len(defaultRetryableStatusCodes)-1 {
					index++
					return &http.Response{
						StatusCode: defaultRetryableStatusCodes[index],
					}, nil
				} else {
					return &http.Response{
						StatusCode: http.StatusOK,
					}, nil
				}
			},
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: len(defaultRetryableStatusCodes),
			Interval:      1 * time.Millisecond,
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

func TestRetryOnNetErrors(t *testing.T) {

	logger := zap.NewNop()
	retries := 0
	index := -1

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {

				if index < len(defaultRetryableErrors)-1 {
					index++
					return nil, defaultRetryableErrors[index]
				} else {
					return &http.Response{
						StatusCode: http.StatusOK,
					}, nil
				}
			},
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: len(defaultRetryableErrors),
			Interval:      1 * time.Millisecond,
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

	assert.Equal(t, 10, retries)

}

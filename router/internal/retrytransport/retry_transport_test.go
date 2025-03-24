package retrytransport

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
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

	assert.Equal(t, len(defaultRetryableStatusCodes), retries)

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

	assert.Equal(t, len(defaultRetryableErrors), retries)

}

func TestDoNotRetryWhenErrorIsNotRetryableAndResponseIsNil(t *testing.T) {
	logger := zap.NewNop()
	finalError := errors.New("some error")

	expectedRetries := 2
	retries := 0
	index := -1
	maxRetryCount := 7

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				index++
				switch index {
				case 0:
					// The first retry we return a retryable error
					return &http.Response{StatusCode: defaultRetryableStatusCodes[0]}, nil
				case 1:
					// The second retry we return a retryable status code
					return nil, defaultRetryableErrors[index]
				default:
					// The third retry we return a nil response as well as a non-retryable error
					return nil, finalError
				}
			},
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: maxRetryCount,
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
	assert.Error(t, finalError, err)
	assert.Nil(t, resp)

	assert.Equal(t, expectedRetries, retries)
	assert.NotEqual(t, maxRetryCount, retries)
}

// TrackableBody is a custom io.ReadCloser that tracks if it's been read and closed
type TrackableBody struct {
	index  int
	read   bool
	closed bool
}

func (b *TrackableBody) Read(p []byte) (n int, err error) {
	b.read = true
	return 0, io.EOF
}

func (b *TrackableBody) Close() error {
	b.closed = true
	return nil
}

func TestResponseBodyDraining(t *testing.T) {
	logger := zap.NewNop()
	actualRetries := 0
	index := -1

	// Create trackable bodies for each response
	retryCount := 2

	bodies := make([]*TrackableBody, retryCount+1)
	for i := range bodies {
		bodies[i] = &TrackableBody{
			index: i,
		}
	}

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				index++
				if index < retryCount {
					return &http.Response{
						StatusCode: defaultRetryableStatusCodes[0],
						Body:       bodies[index],
					}, nil
				} else {
					return &http.Response{
						StatusCode: http.StatusOK,
						Body:       bodies[index],
					}, nil
				}
			},
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: retryCount,
			Interval:      1 * time.Millisecond,
			MaxDuration:   10 * time.Millisecond,
			ShouldRetry: func(err error, req *http.Request, resp *http.Response) bool {
				return IsRetryableError(err, resp)
			},
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				actualRetries++
			},
		},
		Logger: logger,
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)

	resp, err := tr.RoundTrip(req)
	assert.Nil(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, retryCount, actualRetries)

	// Verify all bodies were read and closed
	for i, body := range bodies {
		if i < retryCount {
			assert.True(t, body.read, fmt.Sprintf("Body %d was not read", i))
			assert.True(t, body.closed, fmt.Sprintf("Body %d was not closed", i))
		} else {
			// the final successful body should not be read
			assert.False(t, body.read, fmt.Sprintf("Body %d was read when it shouldnt be", i))
			assert.False(t, body.closed, fmt.Sprintf("Body %d was closed when it shouldnt be", i))
		}
	}
}

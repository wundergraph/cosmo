package retrytransport

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap/zapcore"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
)

// simpleShouldRetry provides simple retry logic for testing the transport implementation
func simpleShouldRetry(err error, req *http.Request, resp *http.Response) bool {
	// Simple logic for testing - retry on 5xx status codes or any error
	if err != nil {
		return true
	}
	if resp != nil && resp.StatusCode >= 500 {
		return true
	}
	return false
}

type MockTransport struct {
	handler func(req *http.Request) (*http.Response, error)
}

func (dt *MockTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return dt.handler(req)
}

func TestRetryOnHTTP5xx(t *testing.T) {
	retries := 0
	attemptCount := 0
	maxRetries := 3

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				attemptCount++
				if attemptCount <= maxRetries {
					// Return 500 to trigger retry
					return &http.Response{
						StatusCode: http.StatusInternalServerError,
					}, nil
				}
				// Finally return success
				return &http.Response{
					StatusCode: http.StatusOK,
				}, nil
			},
		},
		getRequestLogger: func(req *http.Request) *zap.Logger {
			return zap.NewNop()
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: maxRetries,
			Interval:      1 * time.Millisecond,
			MaxDuration:   10 * time.Millisecond,
			ShouldRetry:   simpleShouldRetry,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				retries++
			},
		},
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)

	resp, err := tr.RoundTrip(req)
	assert.Nil(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	// Should have retried exactly maxRetries times
	assert.Equal(t, maxRetries, retries)
	// Should have made maxRetries + 1 total attempts
	assert.Equal(t, maxRetries+1, attemptCount)
}

func TestRetryOnErrors(t *testing.T) {
	retries := 0
	attemptCount := 0
	maxRetries := 3

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				attemptCount++
				if attemptCount <= maxRetries {
					// Return any error to trigger retry
					return nil, errors.New("some network error")
				}
				// Finally return success
				return &http.Response{
					StatusCode: http.StatusOK,
				}, nil
			},
		},
		getRequestLogger: func(req *http.Request) *zap.Logger {
			return zap.NewNop()
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: maxRetries,
			Interval:      1 * time.Millisecond,
			MaxDuration:   10 * time.Millisecond,
			ShouldRetry:   simpleShouldRetry,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				retries++
			},
		},
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)

	resp, err := tr.RoundTrip(req)
	assert.Nil(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	// Should have retried exactly maxRetries times
	assert.Equal(t, maxRetries, retries)
	// Should have made maxRetries + 1 total attempts
	assert.Equal(t, maxRetries+1, attemptCount)
}

func TestDoNotRetryWhenShouldRetryReturnsFalse(t *testing.T) {
	nonRetryableError := errors.New("non-retryable error")

	retries := 0
	attemptCount := 0
	maxRetryCount := 5

	// Custom ShouldRetry that returns false for our specific non-retryable error
	shouldRetry := func(err error, req *http.Request, resp *http.Response) bool {
		if err != nil && err.Error() == "non-retryable error" {
			return false
		}
		return simpleShouldRetry(err, req, resp)
	}

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				attemptCount++
				switch attemptCount {
				case 1:
					// First attempt: return retryable error
					return nil, errors.New("retryable error")
				case 2:
					// Second attempt: return retryable status code
					return &http.Response{StatusCode: http.StatusInternalServerError}, nil
				default:
					// Third attempt: return non-retryable error (should stop retrying)
					return nil, nonRetryableError
				}
			},
		},
		getRequestLogger: func(req *http.Request) *zap.Logger {
			return zap.NewNop()
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: maxRetryCount,
			Interval:      1 * time.Millisecond,
			MaxDuration:   10 * time.Millisecond,
			ShouldRetry:   shouldRetry,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				retries++
			},
		},
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)

	resp, err := tr.RoundTrip(req)
	assert.Error(t, err)
	assert.Equal(t, nonRetryableError, err)
	assert.Nil(t, resp)

	// Should have retried exactly 2 times before encountering non-retryable error
	assert.Equal(t, 2, retries)
	assert.Equal(t, 3, attemptCount)
	// Should not have exhausted max retry count
	assert.NotEqual(t, maxRetryCount, retries)
}

// TrackableBody is a custom io.ReadCloser that tracks if it's been read and closed
type TrackableBody struct {
	index  int
	read   bool
	closed bool

	throwOnRead  bool
	throwOnClose bool
}

func (b *TrackableBody) Read(p []byte) (n int, err error) {
	b.read = true

	if b.throwOnRead {
		return 0, fmt.Errorf("retry read error, index: %d", b.index)
	}
	return 0, io.EOF
}

func (b *TrackableBody) Close() error {
	b.closed = true

	if b.throwOnClose {
		return fmt.Errorf("retry close error, index: %d", b.index)
	}
	return nil
}

func TestShortCircuitOnSuccess(t *testing.T) {
	attemptCount := 0

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				attemptCount++
				// Always return success
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(strings.NewReader("success")),
				}, nil
			},
		},
		getRequestLogger: func(req *http.Request) *zap.Logger {
			return zap.NewNop()
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: 5,
			Interval:      1 * time.Millisecond,
			MaxDuration:   10 * time.Millisecond,
			ShouldRetry:   simpleShouldRetry,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				t.Error("OnRetry should not be called when first request succeeds")
			},
		},
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)
	resp, err := tr.RoundTrip(req)

	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	// Should only make one attempt since first attempt succeeds
	assert.Equal(t, 1, attemptCount)

	body, err := io.ReadAll(resp.Body)
	assert.NoError(t, err)
	assert.Equal(t, "success", string(body))
	resp.Body.Close()
}

// Mock round tripper for testing
type mockRoundTripper struct {
	roundTripFunc func(req *http.Request) (*http.Response, error)
}

func (m *mockRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return m.roundTripFunc(req)
}

func TestMaxRetryCountRespected(t *testing.T) {
	maxRetries := 2
	retries := 0
	attemptCount := 0

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				attemptCount++
				// Always return retryable error to test max retry limit
				return nil, errors.New("always fail")
			},
		},
		getRequestLogger: func(req *http.Request) *zap.Logger {
			return zap.NewNop()
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: maxRetries,
			Interval:      1 * time.Millisecond,
			MaxDuration:   10 * time.Millisecond,
			ShouldRetry:   simpleShouldRetry,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				retries++
			},
		},
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)
	resp, err := tr.RoundTrip(req)

	assert.Error(t, err)
	assert.Nil(t, resp)
	// Should have retried exactly maxRetries times
	assert.Equal(t, maxRetries, retries)
	// Should have made maxRetries + 1 total attempts
	assert.Equal(t, maxRetries+1, attemptCount)
}

func TestResponseBodyDraining(t *testing.T) {
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
						StatusCode: http.StatusInternalServerError,
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
		getRequestLogger: func(req *http.Request) *zap.Logger {
			return zap.NewNop()
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: retryCount,
			Interval:      1 * time.Millisecond,
			MaxDuration:   10 * time.Millisecond,
			ShouldRetry:   simpleShouldRetry,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				actualRetries++
			},
		},
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

func TestRequestLoggerIsUsed(t *testing.T) {
	requestLoggerBuf, requestLogger := createTestLogger(t)

	actualRetries := 0
	index := -1

	// Create trackable bodies for each response
	retryCount := 5

	bodies := make([]*TrackableBody, retryCount+1)
	for i := range bodies {
		trackableBody := &TrackableBody{
			index: i,
		}

		switch i {
		case 1:
			trackableBody.throwOnRead = true
		case 2:
			trackableBody.throwOnClose = true
		}
		bodies[i] = trackableBody
	}

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				index++
				if index < retryCount {
					return &http.Response{
						StatusCode: http.StatusInternalServerError,
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
		getRequestLogger: func(req *http.Request) *zap.Logger {
			return requestLogger
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: retryCount,
			Interval:      1 * time.Millisecond,
			MaxDuration:   10 * time.Millisecond,
			ShouldRetry:   simpleShouldRetry,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				actualRetries++
			},
		},
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)

	tr.RoundTrip(req)

	assert.Contains(t, requestLoggerBuf.String(), "Failed draining when discarding the body\t{\"error\": \"retry read error, index: 1\"}")
	assert.Contains(t, requestLoggerBuf.String(), "Failed draining when closing the body\t{\"error\": \"retry close error, index: 2\"}")
}

func createTestLogger(t *testing.T) (*bytes.Buffer, *zap.Logger) {
	t.Helper()

	var buf bytes.Buffer
	core := zapcore.NewCore(
		zapcore.NewConsoleEncoder(zap.NewDevelopmentEncoderConfig()),
		zapcore.AddSync(&buf),
		zapcore.InfoLevel,
	)
	unusedLogger := zap.New(core)
	return &buf, unusedLogger
}

func TestOnRetryCallbackInvoked(t *testing.T) {
	maxRetries := 3
	retries := 0
	var retryCallbacks []struct {
		count int
		err   error
		resp  *http.Response
	}

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				if retries < maxRetries {
					// Return retryable error
					return nil, errors.New("retryable error")
				}
				// Finally return success
				return &http.Response{
					StatusCode: http.StatusOK,
				}, nil
			},
		},
		getRequestLogger: func(req *http.Request) *zap.Logger {
			return zap.NewNop()
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: maxRetries,
			Interval:      1 * time.Millisecond,
			MaxDuration:   10 * time.Millisecond,
			ShouldRetry:   simpleShouldRetry,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				retries++
				retryCallbacks = append(retryCallbacks, struct {
					count int
					err   error
					resp  *http.Response
				}{count: count, err: err, resp: resp})
			},
		},
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)
	resp, err := tr.RoundTrip(req)

	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	// Verify OnRetry was called the right number of times
	assert.Equal(t, maxRetries, retries)
	assert.Len(t, retryCallbacks, maxRetries)

	// Verify callback parameters are correct
	for i, callback := range retryCallbacks {
		assert.Equal(t, i, callback.count)
		assert.Error(t, callback.err)
		assert.Equal(t, "retryable error", callback.err.Error())
		assert.Nil(t, callback.resp)
	}
}

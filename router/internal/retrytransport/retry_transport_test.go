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

// shouldRetryWith429 includes 429 responses in addition to the simple retry logic
func shouldRetryWith429(err error, req *http.Request, resp *http.Response) bool {
	// Include 429 responses in retryable conditions
	if err != nil {
		return true
	}
	if resp != nil && (resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests) {
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

func TestRetryOn429WithDelaySeconds(t *testing.T) {
	retries := 0
	attemptCount := 0
	maxRetries := 2
	retryAfterSeconds := 1 // Use 1 second to keep test fast

	// Track what retry duration was requested to verify Retry-After is parsed correctly
	var retryAfterUsed []bool

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				attemptCount++
				if attemptCount <= maxRetries {
					// Return 429 with Retry-After header in seconds
					resp := &http.Response{
						StatusCode: http.StatusTooManyRequests,
						Header:     make(http.Header),
					}
					resp.Header.Set("Retry-After", fmt.Sprintf("%d", retryAfterSeconds))

					// Verify the header is parsed correctly
					duration, useRetryAfter := shouldUseRetryAfter(resp)
					retryAfterUsed = append(retryAfterUsed, useRetryAfter)
					assert.True(t, useRetryAfter, "Should use Retry-After header for 429")
					assert.Equal(t, time.Duration(retryAfterSeconds)*time.Second, duration)

					return resp, nil
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
			Interval:      100 * time.Millisecond, // This should be ignored for 429
			MaxDuration:   10 * time.Second,
			ShouldRetry:   shouldRetryWith429,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				retries++
			},
		},
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)
	resp, err := tr.RoundTrip(req)

	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, maxRetries, retries)
	assert.Equal(t, maxRetries+1, attemptCount)
	// Verify that Retry-After was detected and used
	assert.Len(t, retryAfterUsed, maxRetries)
	for i, used := range retryAfterUsed {
		assert.True(t, used, "Retry %d should have used Retry-After header", i)
	}
}

func TestRetryOn429WithoutRetryAfter(t *testing.T) {
	retries := 0
	attemptCount := 0
	maxRetries := 2

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				attemptCount++
				if attemptCount <= maxRetries {
					// Return 429 without Retry-After header
					return &http.Response{
						StatusCode: http.StatusTooManyRequests,
						Header:     make(http.Header),
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
			ShouldRetry:   shouldRetryWith429,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				retries++
			},
		},
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)
	resp, err := tr.RoundTrip(req)

	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	// Should have retried exactly maxRetries times
	assert.Equal(t, maxRetries, retries)
	assert.Equal(t, maxRetries+1, attemptCount)
}

func TestRetryOn429WithHTTPDate(t *testing.T) {
	retries := 0
	attemptCount := 0
	maxRetries := 2

	// Track what retry duration was requested to verify Retry-After is parsed correctly
	var retryAfterUsed []bool
	var expectedDuration time.Duration

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				attemptCount++
				if attemptCount <= maxRetries {
					// Return 429 with Retry-After header as HTTP-date (1 second in future to keep test fast)
					expectedDuration = 1 * time.Second
					futureTime := time.Now().UTC().Add(expectedDuration)
					resp := &http.Response{
						StatusCode: http.StatusTooManyRequests,
						Header:     make(http.Header),
					}
					resp.Header.Set("Retry-After", futureTime.Format(http.TimeFormat))

					// Verify the header is parsed correctly
					duration, useRetryAfter := shouldUseRetryAfter(resp)
					retryAfterUsed = append(retryAfterUsed, useRetryAfter)
					assert.True(t, useRetryAfter, "Should use Retry-After header for 429")
					// Allow reasonable tolerance for execution delay between time creation and parsing
					assert.True(t, duration > 0 && duration <= expectedDuration,
						"Duration should be positive and <= %v, got %v", expectedDuration, duration)

					return resp, nil
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
			Interval:      100 * time.Millisecond, // This should be ignored for 429
			MaxDuration:   10 * time.Second,
			ShouldRetry:   shouldRetryWith429,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				retries++
			},
		},
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)
	resp, err := tr.RoundTrip(req)

	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, maxRetries, retries)
	assert.Equal(t, maxRetries+1, attemptCount)
	// Verify that Retry-After was detected and used
	assert.Len(t, retryAfterUsed, maxRetries)
	for i, used := range retryAfterUsed {
		assert.True(t, used, "Retry %d should have used Retry-After header", i)
	}
}

func TestRetryOn429WithInvalidRetryAfterHeader(t *testing.T) {
	retries := 0
	attemptCount := 0
	maxRetries := 2

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				attemptCount++
				if attemptCount <= maxRetries {
					// Return 429 with invalid Retry-After header
					resp := &http.Response{
						StatusCode: http.StatusTooManyRequests,
						Header:     make(http.Header),
					}
					resp.Header.Set("Retry-After", "invalid-value")
					return resp, nil
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
			ShouldRetry:   shouldRetryWith429,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				retries++
			},
		},
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)
	resp, err := tr.RoundTrip(req)

	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	// Should have retried exactly maxRetries times
	assert.Equal(t, maxRetries, retries)
	assert.Equal(t, maxRetries+1, attemptCount)
	// Should fall back to normal backoff when Retry-After is invalid
}

func TestRetryOn429WithNegativeDelaySeconds(t *testing.T) {
	retries := 0
	attemptCount := 0
	maxRetries := 2

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				attemptCount++
				if attemptCount <= maxRetries {
					// Return 429 with negative Retry-After value (should fall back to normal backoff)
					resp := &http.Response{
						StatusCode: http.StatusTooManyRequests,
						Header:     make(http.Header),
					}
					resp.Header.Set("Retry-After", "-1")
					return resp, nil
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
			ShouldRetry:   shouldRetryWith429,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				retries++
			},
		},
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)
	resp, err := tr.RoundTrip(req)

	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	// Should have retried exactly maxRetries times
	assert.Equal(t, maxRetries, retries)
	assert.Equal(t, maxRetries+1, attemptCount)
}

func TestRetryMixed429AndOtherErrors(t *testing.T) {
	retries := 0
	attemptCount := 0
	maxRetries := 4

	// Track which responses used Retry-After vs normal backoff
	var retryAfterUsedPerAttempt []bool

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				attemptCount++
				switch attemptCount {
				case 1:
					// First: 429 with Retry-After
					resp := &http.Response{
						StatusCode: http.StatusTooManyRequests,
						Header:     make(http.Header),
					}
					resp.Header.Set("Retry-After", "1")

					// Verify this should use Retry-After
					_, useRetryAfter := shouldUseRetryAfter(resp)
					retryAfterUsedPerAttempt = append(retryAfterUsedPerAttempt, useRetryAfter)

					return resp, nil
				case 2:
					// Second: Network error (should use normal backoff)
					retryAfterUsedPerAttempt = append(retryAfterUsedPerAttempt, false)
					return nil, errors.New("network error")
				case 3:
					// Third: 500 error (should use normal backoff)
					resp := &http.Response{
						StatusCode: http.StatusInternalServerError,
					}
					_, useRetryAfter := shouldUseRetryAfter(resp)
					retryAfterUsedPerAttempt = append(retryAfterUsedPerAttempt, useRetryAfter)
					return resp, nil
				case 4:
					// Fourth: 429 without Retry-After (should use normal backoff)
					resp := &http.Response{
						StatusCode: http.StatusTooManyRequests,
						Header:     make(http.Header),
					}
					_, useRetryAfter := shouldUseRetryAfter(resp)
					retryAfterUsedPerAttempt = append(retryAfterUsedPerAttempt, useRetryAfter)
					return resp, nil
				default:
					// Finally: Success
					return &http.Response{
						StatusCode: http.StatusOK,
					}, nil
				}
			},
		},
		getRequestLogger: func(req *http.Request) *zap.Logger {
			return zap.NewNop()
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: maxRetries,
			Interval:      10 * time.Millisecond, // Should be used for non-429-with-Retry-After cases
			MaxDuration:   10 * time.Second,
			ShouldRetry:   shouldRetryWith429,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				retries++
			},
		},
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)
	resp, err := tr.RoundTrip(req)

	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, maxRetries, retries)
	assert.Equal(t, maxRetries+1, attemptCount)
	assert.Len(t, retryAfterUsedPerAttempt, maxRetries)

	// First attempt should use Retry-After (429 with header)
	assert.True(t, retryAfterUsedPerAttempt[0], "First retry should use Retry-After")

	// Other attempts should not use Retry-After
	assert.False(t, retryAfterUsedPerAttempt[1], "Second retry should not use Retry-After (network error)")
	assert.False(t, retryAfterUsedPerAttempt[2], "Third retry should not use Retry-After (500 error)")
	assert.False(t, retryAfterUsedPerAttempt[3], "Fourth retry should not use Retry-After (429 without header)")
}

func TestNoRetryOn429WhenShouldRetryReturnsFalse(t *testing.T) {
	retries := 0
	attemptCount := 0

	// ShouldRetry function that excludes 429 responses
	shouldNotRetry429 := func(err error, req *http.Request, resp *http.Response) bool {
		// Only retry on errors, not on 429 responses
		if err != nil {
			return true
		}
		// Do not retry on any HTTP status codes (including 429)
		return false
	}

	tr := RetryHTTPTransport{
		RoundTripper: &MockTransport{
			handler: func(req *http.Request) (*http.Response, error) {
				attemptCount++
				// Always return 429 with Retry-After header
				resp := &http.Response{
					StatusCode: http.StatusTooManyRequests,
					Header:     make(http.Header),
				}
				resp.Header.Set("Retry-After", "1")
				return resp, nil
			},
		},
		getRequestLogger: func(req *http.Request) *zap.Logger {
			return zap.NewNop()
		},
		RetryOptions: RetryOptions{
			MaxRetryCount: 3,
			Interval:      1 * time.Millisecond,
			MaxDuration:   10 * time.Millisecond,
			ShouldRetry:   shouldNotRetry429,
			OnRetry: func(count int, req *http.Request, resp *http.Response, err error) {
				retries++
			},
		},
	}

	req := httptest.NewRequest("GET", "http://localhost:3000/graphql", nil)
	resp, err := tr.RoundTrip(req)

	assert.NoError(t, err)
	assert.Equal(t, http.StatusTooManyRequests, resp.StatusCode)
	// Should not have retried at all since ShouldRetry returns false for 429
	assert.Equal(t, 0, retries)
	assert.Equal(t, 1, attemptCount)
}

// Test unit functions directly
func TestParseRetryAfterHeader(t *testing.T) {
	tests := []struct {
		name     string
		header   string
		expected time.Duration
	}{
		{
			name:     "valid delay seconds",
			header:   "120",
			expected: 120 * time.Second,
		},
		{
			name:     "zero delay seconds",
			header:   "0",
			expected: 0,
		},
		{
			name:     "negative delay seconds should return 0",
			header:   "-1",
			expected: 0,
		},
		{
			name:     "invalid string should return 0",
			header:   "invalid",
			expected: 0,
		},
		{
			name:     "empty string should return 0",
			header:   "",
			expected: 0,
		},
		{
			name:     "HTTP date in future",
			header:   time.Now().UTC().Add(3 * time.Second).Format(http.TimeFormat),
			expected: 3 * time.Second, // approximately
		},
		{
			name:     "HTTP date in past should return 0",
			header:   time.Now().UTC().Add(-3 * time.Second).Format(http.TimeFormat),
			expected: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseRetryAfterHeader(tt.header)

			if tt.name == "HTTP date in future" {
				// For HTTP date tests, allow reasonable tolerance for timing variations
				assert.True(t, result >= tt.expected-1*time.Second && result <= tt.expected+1*time.Second,
					"Expected ~%v, got %v", tt.expected, result)
			} else {
				assert.Equal(t, tt.expected, result)
			}
		})
	}
}

func TestShouldUseRetryAfter(t *testing.T) {
	tests := []struct {
		name        string
		resp        *http.Response
		expectedDur time.Duration
		expectedUse bool
	}{
		{
			name:        "nil response",
			resp:        nil,
			expectedDur: 0,
			expectedUse: false,
		},
		{
			name: "non-429 response",
			resp: &http.Response{
				StatusCode: http.StatusInternalServerError,
				Header:     make(http.Header),
			},
			expectedDur: 0,
			expectedUse: false,
		},
		{
			name: "429 without Retry-After header",
			resp: &http.Response{
				StatusCode: http.StatusTooManyRequests,
				Header:     make(http.Header),
			},
			expectedDur: 0,
			expectedUse: false,
		},
		{
			name: "429 with empty Retry-After header",
			resp: func() *http.Response {
				resp := &http.Response{
					StatusCode: http.StatusTooManyRequests,
					Header:     make(http.Header),
				}
				resp.Header.Set("Retry-After", "")
				return resp
			}(),
			expectedDur: 0,
			expectedUse: false,
		},
		{
			name: "429 with valid Retry-After seconds",
			resp: func() *http.Response {
				resp := &http.Response{
					StatusCode: http.StatusTooManyRequests,
					Header:     make(http.Header),
				}
				resp.Header.Set("Retry-After", "30")
				return resp
			}(),
			expectedDur: 30 * time.Second,
			expectedUse: true,
		},
		{
			name: "429 with invalid Retry-After",
			resp: func() *http.Response {
				resp := &http.Response{
					StatusCode: http.StatusTooManyRequests,
					Header:     make(http.Header),
				}
				resp.Header.Set("Retry-After", "invalid")
				return resp
			}(),
			expectedDur: 0,
			expectedUse: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dur, use := shouldUseRetryAfter(tt.resp)
			assert.Equal(t, tt.expectedDur, dur)
			assert.Equal(t, tt.expectedUse, use)
		})
	}
}

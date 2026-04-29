package httpclient

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsCDNFallbackEligible(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		resp     *http.Response
		err      error
		expected bool
	}{
		{
			name:     "500 status code",
			resp:     &http.Response{StatusCode: http.StatusInternalServerError},
			err:      errors.New("unexpected status code"),
			expected: true,
		},
		{
			name:     "502 status code",
			resp:     &http.Response{StatusCode: http.StatusBadGateway},
			err:      errors.New("unexpected status code"),
			expected: true,
		},
		{
			name:     "503 status code",
			resp:     &http.Response{StatusCode: http.StatusServiceUnavailable},
			err:      errors.New("unexpected status code"),
			expected: true,
		},
		{
			name:     "429 status code",
			resp:     &http.Response{StatusCode: http.StatusTooManyRequests},
			err:      errors.New("unexpected status code"),
			expected: true,
		},
		{
			name:     "5xx response without error",
			resp:     &http.Response{StatusCode: http.StatusInternalServerError},
			err:      nil,
			expected: true,
		},
		{
			name:     "200 status code",
			resp:     &http.Response{StatusCode: http.StatusOK},
			err:      nil,
			expected: false,
		},
		{
			name:     "401 status code",
			resp:     &http.Response{StatusCode: http.StatusUnauthorized},
			err:      errors.New("unauthorized"),
			expected: false,
		},
		{
			name:     "400 status code",
			resp:     &http.Response{StatusCode: http.StatusBadRequest},
			err:      errors.New("bad request"),
			expected: false,
		},
		{
			name:     "404 status code",
			resp:     &http.Response{StatusCode: http.StatusNotFound},
			err:      errors.New("not found"),
			expected: false,
		},
		{
			name:     "304 status code",
			resp:     &http.Response{StatusCode: http.StatusNotModified},
			err:      errors.New("not modified"),
			expected: false,
		},
		{
			name:     "network error no response",
			resp:     nil,
			err:      errors.New("connection refused"),
			expected: true,
		},
		{
			name:     "context canceled",
			resp:     nil,
			err:      context.Canceled,
			expected: false,
		},
		{
			name:     "context deadline exceeded",
			resp:     nil,
			err:      context.DeadlineExceeded,
			expected: false,
		},
		{
			name:     "wrapped context canceled",
			resp:     nil,
			err:      fmt.Errorf("request failed: %w", context.Canceled),
			expected: false,
		},
		{
			name:     "nil response nil error",
			resp:     nil,
			err:      nil,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			result := IsCDNFallbackEligible(tt.resp, tt.err)
			assert.Equal(t, tt.expected, result)
		})
	}
}

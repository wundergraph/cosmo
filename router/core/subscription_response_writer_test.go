package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type deadlineRecorder struct {
	*httptest.ResponseRecorder
	deadline time.Time
}

func (r *deadlineRecorder) SetWriteDeadline(deadline time.Time) error {
	r.deadline = deadline
	return nil
}

func (r *deadlineRecorder) FlushError() error {
	r.Flush()
	return nil
}

func TestNegotiateSubscriptionParams(t *testing.T) {
	type args struct {
		r *http.Request
	}
	tests := []struct {
		name string
		args args
		want SubscriptionParams
	}{
		{
			name: "No matching headers/subscribe once",
			args: args{
				r: &http.Request{
					URL: &url.URL{RawQuery: "test"},
					Header: http.Header{
						"Accept": []string{"test,text/event-stream"},
					}}},
			want: SubscriptionParams{
				UseSse:        false,
				SubscribeOnce: false,
				UseMultipart:  false,
			},
		},
		{
			name: "Subscribe once",
			args: args{
				r: &http.Request{
					URL: &url.URL{RawQuery: "wg_subscribe_once"},
					Header: http.Header{
						"Accept": []string{"text/event-stream,application/json"},
					}}},
			want: SubscriptionParams{
				UseSse:        true,
				SubscribeOnce: true,
				UseMultipart:  false,
			},
		},
		{
			name: "SSE with query",
			args: args{
				r: &http.Request{
					URL: &url.URL{RawQuery: "wg_sse"},
					Header: http.Header{
						"Accept": []string{"application/json"},
					}}},
			want: SubscriptionParams{
				UseSse:        true,
				SubscribeOnce: false,
				UseMultipart:  false,
			},
		},
		{
			name: "SSE header",
			args: args{
				r: &http.Request{
					URL: &url.URL{RawQuery: "test"},
					Header: http.Header{
						"Accept": []string{"text/event-stream,application/json"},
					}}},
			want: SubscriptionParams{
				UseSse:        true,
				SubscribeOnce: false,
				UseMultipart:  false,
			},
		},
		{
			name: "Multipart header",
			args: args{
				r: &http.Request{
					URL: &url.URL{RawQuery: "test"},
					Header: http.Header{
						"Accept": []string{"multipart/mixed,application/json"},
					}}},
			want: SubscriptionParams{
				UseSse:        false,
				SubscribeOnce: false,
				UseMultipart:  true,
			},
		},
		{
			name: "Respect q preference (multipart wins)",
			args: args{
				r: &http.Request{
					URL: &url.URL{RawQuery: "test"},
					Header: http.Header{
						"Accept": []string{"text/event-stream;q=0.9,application/json;q=0.8,multipart/mixed;q=1.0"},
					}}},
			want: SubscriptionParams{
				UseSse:        false,
				SubscribeOnce: false,
				UseMultipart:  true,
			},
		},
		{
			name: "Respect order (SSE wins)",
			args: args{
				r: &http.Request{
					URL: &url.URL{RawQuery: "test"},
					Header: http.Header{
						"Accept": []string{"text/event-stream,application/json,multipart/mixed"},
					}}},
			want: SubscriptionParams{
				UseSse:        true,
				SubscribeOnce: false,
				UseMultipart:  false,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equalf(t, tt.want, NegotiateSubscriptionParams(tt.args.r, false), "NegotiateSubscriptionParams(%v)", tt.args.r)
		})
	}
}

func TestGetSubscriptionResponseWriter(t *testing.T) {
	// Headers set on a ResponseWriter are only sent to the client on the first
	// Write/WriteHeader/Flush. An SSE subscription must flush the response head
	// (200 + text/event-stream) as soon as it is established, otherwise clients
	// block until the first message arrives instead of connecting immediately.
	t.Run("flushes the SSE response head before any message is written", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
		req.Header.Set("Accept", sseMimeType)

		_, _, err := GetSubscriptionResponseWriter(resolve.NewContext(context.Background()), req, recorder, SubscriptionResponseWriterOptions{})
		require.NoError(t, err)

		assert.Equal(t, sseMimeType, recorder.Header().Get("Content-Type"))
		assert.True(t, recorder.Flushed, "expected the SSE response head to be flushed before any message is written")
	})

	t.Run("sets and refreshes a deadline for SSE headers and data", func(t *testing.T) {
		recorder := &deadlineRecorder{ResponseRecorder: httptest.NewRecorder()}
		req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
		req.Header.Set("Accept", sseMimeType)

		_, writer, err := GetSubscriptionResponseWriter(resolve.NewContext(context.Background()), req, recorder, SubscriptionResponseWriterOptions{SSEWriteTimeout: time.Second})
		require.NoError(t, err)
		headerDeadline := recorder.deadline
		require.False(t, headerDeadline.IsZero())

		time.Sleep(time.Millisecond)
		_, err = writer.Write([]byte(`{"data":{"id":1}}`))
		require.NoError(t, err)
		require.NoError(t, writer.Flush())
		assert.True(t, recorder.deadline.After(headerDeadline), "expected each SSE frame to refresh the write deadline")
	})

	t.Run("fails closed when an SSE deadline is configured but unsupported", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
		req.Header.Set("Accept", sseMimeType)

		_, writer, err := GetSubscriptionResponseWriter(resolve.NewContext(context.Background()), req, recorder, SubscriptionResponseWriterOptions{SSEWriteTimeout: time.Second})
		require.Error(t, err)
		assert.ErrorIs(t, err, http.ErrNotSupported)
		assert.ErrorContains(t, err, "set SSE write deadline")
		assert.Nil(t, writer)
	})
}

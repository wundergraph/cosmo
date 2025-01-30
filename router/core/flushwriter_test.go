package core

import (
	"github.com/stretchr/testify/assert"
	"net/http"
	"net/url"
	"testing"
)

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
						"Accept": []string{"test"},
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
						"Accept": []string{"application/json,multipart/mixed"},
					}}},
			want: SubscriptionParams{
				UseSse:        false,
				SubscribeOnce: false,
				UseMultipart:  true,
			},
		},
		{
			name: "Prefers multipart to SSE",
			args: args{
				r: &http.Request{
					URL: &url.URL{RawQuery: "test"},
					Header: http.Header{
						"Accept": []string{"text/event-stream;q=0.9,application/json,multipart/mixed;q=1.0"},
					}}},
			want: SubscriptionParams{
				UseSse:        false,
				SubscribeOnce: false,
				UseMultipart:  true,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equalf(t, tt.want, NegotiateSubscriptionParams(tt.args.r), "NegotiateSubscriptionParams(%v)", tt.args.r)
		})
	}
}

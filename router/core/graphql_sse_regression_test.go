package core

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	graphql_datasource "github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type aliasingSubscriptionUpdater struct {
	mu          sync.Mutex
	updates     [][]byte
	firstUpdate chan struct{}
	completed   chan struct{}
	closed      chan struct{}
}

func newAliasingSubscriptionUpdater() *aliasingSubscriptionUpdater {
	return &aliasingSubscriptionUpdater{
		firstUpdate: make(chan struct{}, 1),
		completed:   make(chan struct{}, 1),
		closed:      make(chan struct{}, 1),
	}
}

func (a *aliasingSubscriptionUpdater) Update(data []byte) {
	a.mu.Lock()
	a.updates = append(a.updates, data)
	isFirst := len(a.updates) == 1
	a.mu.Unlock()

	if isFirst {
		select {
		case a.firstUpdate <- struct{}{}:
		default:
		}
	}
}

func (a *aliasingSubscriptionUpdater) UpdateSubscription(_ resolve.SubscriptionIdentifier, data []byte) {
	a.Update(data)
}

func (a *aliasingSubscriptionUpdater) Complete() {
	select {
	case a.completed <- struct{}{}:
	default:
	}
}

func (a *aliasingSubscriptionUpdater) Close(_ resolve.SubscriptionCloseKind) {
	select {
	case a.closed <- struct{}{}:
	default:
	}
}

func (a *aliasingSubscriptionUpdater) CloseSubscription(_ resolve.SubscriptionCloseKind, _ resolve.SubscriptionIdentifier) {
}

func (a *aliasingSubscriptionUpdater) Subscriptions() map[context.Context]resolve.SubscriptionIdentifier {
	return nil
}

func (a *aliasingSubscriptionUpdater) Updates() []string {
	a.mu.Lock()
	defer a.mu.Unlock()

	out := make([]string, len(a.updates))
	for i := range a.updates {
		out[i] = string(a.updates[i])
	}
	return out
}

func TestGraphQLSubscriptionClient_SSESingleLinePayloadsRemainStableAfterNextRead(t *testing.T) {
	serverDone := make(chan struct{})
	updater := newAliasingSubscriptionUpdater()

	firstPayload := `{"data":{"tokenPriceUpdated":{"priceUsd":1.0001}}}`
	secondPayload := `{"data":{"tokenPriceUpdated":{"priceUsd":1.0002}}}`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		require.True(t, ok)

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		_, _ = fmt.Fprintf(w, "event: next\ndata: %s\n\n", firstPayload)
		flusher.Flush()

		select {
		case <-updater.firstUpdate:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for first SSE update to be observed")
		}

		_, _ = fmt.Fprintf(w, "event: next\ndata: %s\n\n", secondPayload)
		flusher.Flush()

		_, _ = fmt.Fprint(w, "event: complete\n\n")
		flusher.Flush()

		close(serverDone)
	}))
	defer server.Close()

	engineCtx, engineCancel := context.WithCancel(context.Background())
	defer engineCancel()

	requestCtx, requestCancel := context.WithCancel(context.Background())
	defer requestCancel()

	client := graphql_datasource.NewGraphQLSubscriptionClient(
		http.DefaultClient,
		http.DefaultClient,
		engineCtx,
		graphql_datasource.WithReadTimeout(time.Millisecond),
	)

	done := make(chan error, 1)
	go func() {
		done <- client.Subscribe(resolve.NewContext(requestCtx), graphql_datasource.GraphQLSubscriptionOptions{
			URL: server.URL,
			Body: graphql_datasource.GraphQLBody{
				Query: `subscription { tokenPriceUpdated { priceUsd } }`,
			},
			UseSSE: true,
		}, updater)
	}()

	select {
	case <-updater.completed:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for completion")
	}

	select {
	case <-updater.closed:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for close")
	}

	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for subscription client to exit")
	}

	select {
	case <-serverDone:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for SSE server to finish")
	}

	updates := updater.Updates()
	require.Len(t, updates, 2)
	require.Equal(t, firstPayload, updates[0], "first SSE payload should remain stable after the next event is read")
	require.Equal(t, secondPayload, updates[1])
}

func TestGraphQLSubscriptionClient_SSEPayloadsRemainStableAcrossBurstReads(t *testing.T) {
	const payloadCount = 64

	expectedPayloads := make([]string, 0, payloadCount)
	for i := 0; i < payloadCount; i++ {
		expectedPayloads = append(expectedPayloads, fmt.Sprintf(
			`{"data":{"tokenPriceUpdated":{"sequence":%d,"priceUsd":1.%04d,"note":"%s"}}}`,
			i,
			1000+i,
			strings.Repeat(string(rune('a'+(i%26))), 8+i),
		))
	}

	serverDone := make(chan struct{})
	updater := newAliasingSubscriptionUpdater()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		require.True(t, ok)

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		_, _ = fmt.Fprintf(w, "event: next\ndata: %s\n\n", expectedPayloads[0])
		flusher.Flush()

		select {
		case <-updater.firstUpdate:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for first SSE update to be observed")
		}

		for i := 1; i < len(expectedPayloads); i++ {
			_, _ = fmt.Fprintf(w, "event: next\ndata: %s\n\n", expectedPayloads[i])
			flusher.Flush()
		}

		_, _ = fmt.Fprint(w, "event: complete\n\n")
		flusher.Flush()

		close(serverDone)
	}))
	defer server.Close()

	engineCtx, engineCancel := context.WithCancel(context.Background())
	defer engineCancel()

	requestCtx, requestCancel := context.WithCancel(context.Background())
	defer requestCancel()

	client := graphql_datasource.NewGraphQLSubscriptionClient(
		http.DefaultClient,
		http.DefaultClient,
		engineCtx,
		graphql_datasource.WithReadTimeout(time.Millisecond),
	)

	done := make(chan error, 1)
	go func() {
		done <- client.Subscribe(resolve.NewContext(requestCtx), graphql_datasource.GraphQLSubscriptionOptions{
			URL: server.URL,
			Body: graphql_datasource.GraphQLBody{
				Query: `subscription { tokenPriceUpdated { sequence priceUsd note } }`,
			},
			UseSSE: true,
		}, updater)
	}()

	select {
	case <-updater.completed:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for completion")
	}

	select {
	case <-updater.closed:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for close")
	}

	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for subscription client to exit")
	}

	select {
	case <-serverDone:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for SSE server to finish")
	}

	updates := updater.Updates()
	require.Equal(t, expectedPayloads, updates, "every queued SSE payload should remain stable after later events are read")
}
